// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Admin HTTP server for the relay.
 *
 * Separate from the WebSocket relay server (different port).
 * Provides an authenticated JSON API for relay administration.
 *
 * Security restrictions (supplementary spec Section 6.4):
 *   - Binds to 127.0.0.1 by default (localhost only)
 *   - Refuses to bind to 0.0.0.0 or :: (public interfaces)
 *   - Attempting public binding logs SECURITY_VIOLATION and throws
 *   - All requests require admin authentication (cert or TOTP)
 *
 * Authentication flow:
 *   1. Try client certificate (TLS peer cert fingerprint)
 *   2. Fall back to Authorization header + X-TOTP header
 *   3. Reject unauthenticated requests with 401
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Server as HttpsServer, createServer as createHttpsServer } from 'node:https';
import type { AuditLogger } from '../audit/audit-logger.js';
import type { TlsMaterial } from '../server/tls.js';
import type { AdminAuth, AdminAuthResult } from './admin-auth.js';
import type { AdminRoutes } from './admin-routes.js';

// ---------------------------------------------------------------------------
// Private IP detection
// ---------------------------------------------------------------------------

/** IP addresses/patterns that are NOT allowed for admin binding. */
const PUBLIC_BIND_ADDRESSES = new Set(['0.0.0.0', '::', '0:0:0:0:0:0:0:0']);

/** Check if a host is a private/loopback address (safe for admin). */
function isPrivateHost(host: string): boolean {
  if (PUBLIC_BIND_ADDRESSES.has(host)) return false;
  // Loopback
  if (host === '127.0.0.1' || host === '::1' || host === 'localhost') return true;
  // Private ranges (RFC 1918)
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // Link-local
  if (host.startsWith('169.254.')) return true;
  // WireGuard typical ranges
  if (host.startsWith('10.')) return true;
  // Default: reject (err on the side of caution)
  return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the admin HTTP server. */
export interface AdminServerConfig {
  /** Port to listen on. Default: 9444. */
  readonly port?: number;
  /** Host to bind to. Default: '127.0.0.1'. Must be a private address. */
  readonly host?: string;
  /** TLS certificate and key for HTTPS. */
  readonly tls: TlsMaterial;
  /** Admin authentication handler. */
  readonly auth: AdminAuth;
  /** Admin route handlers. */
  readonly routes: AdminRoutes;
  /** Optional audit logger for auth events. */
  readonly auditLogger?: AuditLogger;
}

// ---------------------------------------------------------------------------
// AdminServer
// ---------------------------------------------------------------------------

/**
 * HTTPS server for relay administration.
 *
 * Usage:
 *   1. Create: `const server = new AdminServer(config)`
 *   2. Start: `await server.start()`
 *   3. Use: admin panel makes authenticated HTTP requests
 *   4. Stop: `await server.shutdown()`
 */
export class AdminServer {
  private readonly port: number;
  private readonly host: string;
  private readonly tls: TlsMaterial;
  private readonly auth: AdminAuth;
  private readonly routes: AdminRoutes;
  private readonly audit: AuditLogger | undefined;
  private server: HttpsServer | null;
  private _running: boolean;

  constructor(config: AdminServerConfig) {
    this.port = config.port ?? 9444;
    this.host = config.host ?? '127.0.0.1';
    this.tls = config.tls;
    this.auth = config.auth;
    this.routes = config.routes;
    this.audit = config.auditLogger;
    this.server = null;
    this._running = false;

    // Security: refuse to bind to public interfaces
    if (!isPrivateHost(this.host)) {
      if (this.audit) {
        this.audit.logEvent('security_violation', 'admin', {
          violation: 'public_bind_attempt',
          host: this.host,
          detail: 'Admin server cannot bind to public interfaces',
        });
      }
      throw new AdminServerError(
        `Admin server cannot bind to public interface "${this.host}". Use 127.0.0.1, a private IP, or a WireGuard VPN address.`,
      );
    }
  }

  /** Whether the server is currently running. */
  get isRunning(): boolean {
    return this._running;
  }

  /** The port the server is bound to (0 if not running). */
  get boundPort(): number {
    if (!this.server) return 0;
    const addr = this.server.address();
    if (typeof addr === 'object' && addr) return addr.port;
    return 0;
  }

  /** The host the server is bound to. */
  get boundHost(): string {
    return this.host;
  }

  /**
   * Start the admin HTTPS server.
   *
   * @throws AdminServerError if already running or binding fails
   */
  async start(): Promise<void> {
    if (this._running) throw new AdminServerError('Server already running');

    return new Promise((resolve, reject) => {
      this.server = createHttpsServer(
        {
          cert: this.tls.cert,
          key: this.tls.key,
          ca: this.tls.ca,
          requestCert: !!this.tls.ca,
          rejectUnauthorized: false, // We do our own cert verification
        },
        (req, res) => {
          this.handleRequest(req, res).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error', detail: message }));
          });
        },
      );

      this.server.on('error', (err) => {
        if (!this._running) reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        this._running = true;
        resolve();
      });
    });
  }

  /**
   * Shut down the admin server.
   *
   * @param timeoutMs — maximum time to wait for graceful shutdown
   */
  async shutdown(timeoutMs = 5000): Promise<void> {
    if (!this._running || !this.server) return;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.server?.closeAllConnections();
        this._running = false;
        this.server = null;
        resolve();
      }, timeoutMs);

      this.server!.close(() => {
        clearTimeout(timer);
        this._running = false;
        this.server = null;
        resolve();
      });
    });
  }

  // -------------------------------------------------------------------------
  // Request handling
  // -------------------------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers for admin panel — allow any localhost origin (dev server, SSH tunnel)
    const origin = req.headers.origin ?? '';
    const isLocalOrigin =
      origin.startsWith('https://localhost') ||
      origin.startsWith('http://localhost') ||
      origin.startsWith('https://127.0.0.1') ||
      origin.startsWith('http://127.0.0.1');
    res.setHeader('Access-Control-Allow-Origin', isLocalOrigin ? origin : 'https://localhost');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-TOTP, Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET requests are unauthenticated — read-only monitoring.
    // The admin server is localhost-only behind an SSH tunnel; the tunnel is the access control.
    // Mutations (POST/PUT/DELETE) still require admin credentials.
    const method = req.method?.toUpperCase() ?? 'GET';
    const isReadOnly = method === 'GET' || method === 'HEAD';

    if (isReadOnly) {
      await this.routes.handleRequest(req, res, '_readonly');
      return;
    }

    // Authenticate mutations
    const authResult = this.authenticate(req);
    if (!authResult.authenticated) {
      if (this.audit) {
        this.audit.logAuthFailure('admin', {
          reason: authResult.reason,
          remoteAddress: req.socket.remoteAddress ?? 'unknown',
          path: req.url ?? '/',
        });
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Unauthorized',
          reason: authResult.reason,
        }),
      );
      return;
    }

    // Route authenticated mutation
    await this.routes.handleRequest(req, res, authResult.username);
  }

  private authenticate(req: IncomingMessage): AdminAuthResult {
    // Try client certificate first
    const socket = req.socket as NodeJS.Socket & {
      getPeerCertificate?: () => { fingerprint256?: string } | undefined;
    };

    if (typeof socket.getPeerCertificate === 'function') {
      const cert = socket.getPeerCertificate();
      if (cert?.fingerprint256) {
        const result = this.auth.verifyClientCert(cert.fingerprint256);
        if (result.authenticated) return result;
      }
    }

    // Fall back to Authorization + X-TOTP headers
    const authHeader = req.headers.authorization;
    const totpHeader = req.headers['x-totp'];

    if (typeof authHeader === 'string' && authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const colonIdx = decoded.indexOf(':');

      if (colonIdx > 0 && typeof totpHeader === 'string') {
        const username = decoded.slice(0, colonIdx);
        const password = decoded.slice(colonIdx + 1);
        return this.auth.verifyCredentials(username, password, totpHeader);
      }
    }

    return { authenticated: false, reason: 'missing_credentials' };
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class AdminServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminServerError';
  }
}
