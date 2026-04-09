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

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Server as HttpsServer, createServer as createHttpsServer } from 'node:https';
import type { AuditLogger } from '../audit/audit-logger.js';
import type { TlsMaterial } from '../server/tls.js';
import { AdminAuth, type AdminAuthResult } from './admin-auth.js';
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
  /** Session JWT expiry in seconds. Default: 1800 (30 minutes). */
  readonly sessionTimeoutSec?: number;
  /** Path to persist admin credentials. Default: null (no persistence). */
  readonly credentialsPath?: string | null;
  /** Secret for signing session JWTs. Generated randomly if not provided. */
  readonly sessionSecret?: Uint8Array;
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
  private readonly sessionSecret: Uint8Array;
  private readonly sessionTimeoutSec: number;
  private readonly credentialsPath: string | null;
  private readonly revokedSessions: Set<string>;
  private server: HttpsServer | null;
  private _running: boolean;

  constructor(config: AdminServerConfig) {
    this.port = config.port ?? 9444;
    this.host = config.host ?? '127.0.0.1';
    this.tls = config.tls;
    this.auth = config.auth;
    this.routes = config.routes;
    this.audit = config.auditLogger;
    this.sessionSecret = config.sessionSecret ?? randomBytes(32);
    this.sessionTimeoutSec = config.sessionTimeoutSec ?? 1800;
    this.credentialsPath = config.credentialsPath ?? null;
    this.revokedSessions = new Set();
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
  // Session JWT helpers
  // -------------------------------------------------------------------------

  private issueSessionJwt(username: string): { token: string; expiresAt: string } {
    const jti = randomUUID();
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + this.sessionTimeoutSec;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: username, scope: 'admin', jti, iat, exp })).toString('base64url');
    const signature = createHmac('sha256', this.sessionSecret).update(`${header}.${payload}`).digest('base64url');
    return {
      token: `${header}.${payload}.${signature}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  private verifySessionJwt(
    token: string,
  ): { valid: true; username: string; jti: string } | { valid: false; reason: string } {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, reason: 'malformed' };
    const [header, payload, signature] = parts;
    const expectedSig = createHmac('sha256', this.sessionSecret).update(`${header}.${payload}`).digest('base64url');
    if (signature !== expectedSig) return { valid: false, reason: 'invalid_signature' };
    try {
      const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
      if (claims.scope !== 'admin') return { valid: false, reason: 'invalid_scope' };
      if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return { valid: false, reason: 'expired' };
      if (this.revokedSessions.has(claims.jti)) return { valid: false, reason: 'revoked' };
      return { valid: true, username: claims.sub, jti: claims.jti };
    } catch {
      return { valid: false, reason: 'invalid_payload' };
    }
  }

  // -------------------------------------------------------------------------
  // Credential persistence
  // -------------------------------------------------------------------------

  private persistCredentials(): void {
    if (!this.credentialsPath) return;
    try {
      const accounts = this.auth.getAccounts().map((a) => ({
        username: a.username,
        passwordHash: a.passwordHash,
        totpSecret: a.totpSecret,
        active: a.active,
      }));
      writeFileSync(this.credentialsPath, JSON.stringify({ accounts }, null, 2), { mode: 0o600 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[!] Failed to persist admin credentials: ${msg}`);
    }
  }

  /** Load credentials from the persistence file. Call before start(). */
  static loadCredentials(path: string): AdminAuth | null {
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      if (data.accounts && Array.isArray(data.accounts) && data.accounts.length > 0) {
        return new AdminAuth({ accounts: data.accounts });
      }
    } catch {
      // File doesn't exist or is invalid — not configured yet
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Admin auth endpoints (/api/admin/*)
  // -------------------------------------------------------------------------

  private async handleAdminEndpoint(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    method: string,
  ): Promise<boolean> {
    if (method === 'GET' && path === '/api/admin/status') {
      this.sendJson(res, 200, {
        configured: this.auth.isConfigured,
        requiresSetup: !this.auth.isConfigured,
      });
      return true;
    }

    if (method === 'POST' && path === '/api/admin/setup') {
      if (this.auth.isConfigured) {
        this.sendJson(res, 409, { error: 'Already configured', reason: 'setup_complete' });
        return true;
      }
      const body = await this.readBody(req);
      const username = body.username as string | undefined;
      const password = body.password as string | undefined;
      const totpSecret = body.totpSecret as string | undefined;
      const totpCode = body.totpCode as string | undefined;

      if (!username || !password || !totpSecret || !totpCode) {
        this.sendJson(res, 400, { error: 'Missing fields: username, password, totpSecret, totpCode' });
        return true;
      }

      // Password strength
      const pwResult = validatePassword(password);
      if (!pwResult.valid) {
        this.sendJson(res, 400, { error: `Weak password: ${pwResult.reason}` });
        return true;
      }

      // Verify TOTP code proves user has set up their authenticator
      if (!AdminAuth.verifyTotp(totpSecret, totpCode)) {
        this.sendJson(res, 400, { error: 'Invalid TOTP code — verify your authenticator is set up correctly' });
        return true;
      }

      const passwordHash = AdminAuth.hashPassword(password);
      this.auth.addAccount({ username, passwordHash, totpSecret, active: true });
      this.persistCredentials();

      if (this.audit) {
        this.audit.logEvent('admin_setup', 'admin', { username, method: 'first_time_setup' });
      }

      this.sendJson(res, 201, { ok: true, username });
      return true;
    }

    if (method === 'POST' && path === '/api/admin/login') {
      const body = await this.readBody(req);
      const username = body.username as string | undefined;
      const password = body.password as string | undefined;
      const totpCode = body.totpCode as string | undefined;

      if (!username || !password || !totpCode) {
        this.sendJson(res, 400, { error: 'Missing fields: username, password, totpCode' });
        return true;
      }

      const result = this.auth.verifyCredentials(username, password, totpCode);
      if (!result.authenticated) {
        const status = result.reason === 'account_locked' ? 423 : 401;
        const extra: Record<string, unknown> = { error: 'Unauthorized', reason: result.reason };
        if (result.reason === 'account_locked') {
          extra.lockedUntil = this.auth.getLockoutExpiry(username)
            ? new Date(this.auth.getLockoutExpiry(username)!).toISOString()
            : null;
        }
        if (this.audit) {
          this.audit.logAuthFailure('admin', { username, reason: result.reason, path: '/api/admin/login' });
        }
        this.sendJson(res, status, extra);
        return true;
      }

      const session = this.issueSessionJwt(username);
      if (this.audit) {
        this.audit.logEvent('auth_success', 'admin', { username, method: 'admin_login' });
      }
      this.sendJson(res, 200, { ok: true, token: session.token, expiresAt: session.expiresAt });
      return true;
    }

    if (method === 'POST' && path === '/api/admin/logout') {
      const bearer = this.extractBearer(req);
      if (bearer) {
        const verified = this.verifySessionJwt(bearer);
        if (verified.valid) {
          this.revokedSessions.add(verified.jti);
        }
      }
      this.sendJson(res, 200, { ok: true });
      return true;
    }

    return false;
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

    const method = req.method?.toUpperCase() ?? 'GET';
    const urlPath = new URL(req.url ?? '/', `https://${req.headers.host ?? 'localhost'}`).pathname;

    // Admin auth endpoints — handled before general routing
    if (urlPath.startsWith('/api/admin/')) {
      const handled = await this.handleAdminEndpoint(req, res, urlPath, method);
      if (handled) return;
    }

    // All requests require authentication — try Bearer token first, then Basic+TOTP
    const bearer = this.extractBearer(req);
    if (bearer) {
      const verified = this.verifySessionJwt(bearer);
      if (verified.valid) {
        await this.routes.handleRequest(req, res, verified.username);
        return;
      }
    }

    // Fall back to Basic + TOTP (backwards compatible)
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
      res.end(JSON.stringify({ error: 'Unauthorized', reason: authResult.reason }));
      return;
    }

    // Route authenticated request
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

  private extractBearer(req: IncomingMessage): string | null {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice(7);
    }
    return null;
  }

  private sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json).toString() });
    res.end(json);
  }

  private readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString();
          resolve(text ? JSON.parse(text) : {});
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }
}

// ---------------------------------------------------------------------------
// Password validation
// ---------------------------------------------------------------------------

function validatePassword(password: string): { valid: boolean; reason?: string } {
  if (password.length < 12) return { valid: false, reason: 'Minimum 12 characters' };
  if (!/[A-Z]/.test(password)) return { valid: false, reason: 'Requires uppercase letter' };
  if (!/[a-z]/.test(password)) return { valid: false, reason: 'Requires lowercase letter' };
  if (!/[0-9]/.test(password)) return { valid: false, reason: 'Requires a digit' };
  return { valid: true };
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
