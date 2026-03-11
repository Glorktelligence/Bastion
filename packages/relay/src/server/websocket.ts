// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * WebSocket relay server with TLS termination.
 *
 * The relay is the central routing hub in the Bastion architecture.
 * It accepts WSS connections from human and AI clients, terminates
 * TLS independently for each client, and manages connection lifecycle.
 *
 * Session lifecycle (supplementary spec Section 2):
 *   1. TLS handshake (this module)
 *   2. Authentication (future: JWT verification)
 *   3. Key exchange (future: public key forwarding)
 *   4. Active session with heartbeat monitoring
 *   5. Graceful shutdown / timeout / error termination
 *
 * The relay never sees plaintext message payloads — it routes
 * EncryptedEnvelopes using only the plaintext metadata fields.
 *
 * Non-TLS connections are immediately rejected (BASTION-1002).
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { type Server as HttpsServer, createServer } from 'node:https';
import { type WebSocket, WebSocketServer } from 'ws';
import type { AuditLogger } from '../audit/audit-logger.js';
import { AUDIT_EVENT_TYPES } from '../audit/audit-logger.js';
import { type HeartbeatConfig, HeartbeatMonitor } from './heartbeat.js';
import type { TlsMaterial } from './tls.js';
import { buildSecureContext } from './tls.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the Bastion relay server. */
export interface RelayConfig {
  /** Port to listen on. Default: 9443. */
  readonly port?: number;
  /** Hostname to bind to. Default: '0.0.0.0'. */
  readonly host?: string;
  /** TLS certificate and key material. */
  readonly tls: TlsMaterial;
  /** Heartbeat monitoring configuration. */
  readonly heartbeat?: HeartbeatConfig;
  /** Maximum message size in bytes. Default: 5MB (5 * 1024 * 1024). */
  readonly maxMessageSize?: number;
  /** Optional audit logger for connection lifecycle events. */
  readonly auditLogger?: AuditLogger;
}

/** Information about a connected client. */
export interface ConnectionInfo {
  /** Unique connection identifier (UUID v4). */
  readonly id: string;
  /** Remote IP address. */
  readonly remoteAddress: string;
  /** Timestamp of connection establishment. */
  readonly connectedAt: string;
}

/** Events emitted by the BastionRelay (argument tuples for EventEmitter). */
export interface RelayEvents {
  /** A new client connected and completed TLS handshake. */
  connection: [ws: WebSocket, info: ConnectionInfo];
  /** A client disconnected (clean or error). */
  disconnection: [info: ConnectionInfo, code: number, reason: string];
  /** A message was received from a client. */
  message: [data: string, info: ConnectionInfo];
  /** A client's heartbeat timed out. */
  heartbeatTimeout: [info: ConnectionInfo];
  /** The server encountered an error. */
  error: [error: Error];
  /** The server started listening. */
  listening: [port: number, host: string];
  /** The server shut down. */
  close: [];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PORT = 9443;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_MAX_MESSAGE_SIZE = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// BastionRelay
// ---------------------------------------------------------------------------

/**
 * The Bastion WebSocket relay server.
 *
 * Provides WSS (WebSocket over TLS) with:
 *   - TLS termination for all client connections
 *   - Connection lifecycle management with unique IDs
 *   - Heartbeat monitoring (ping/pong) for dead connection detection
 *   - Clean shutdown with client notification
 *   - Event-based API for connection, message, and error handling
 *
 * Usage:
 *   1. Create: `const relay = new BastionRelay(config)`
 *   2. Listen for events: `relay.on('connection', ...)`
 *   3. Start: `await relay.start()`
 *   4. Send to clients: `relay.send(connectionId, data)`
 *   5. Shutdown: `await relay.shutdown()`
 */
export class BastionRelay extends EventEmitter<RelayEvents> {
  private readonly config: Required<Pick<RelayConfig, 'port' | 'host' | 'maxMessageSize'>> & RelayConfig;
  private httpsServer: HttpsServer | null;
  private wss: WebSocketServer | null;
  private heartbeatMonitor: HeartbeatMonitor | null;
  private readonly connections: Map<string, { ws: WebSocket; info: ConnectionInfo }>;
  private running: boolean;

  constructor(config: RelayConfig) {
    super();
    this.config = {
      ...config,
      port: config.port ?? DEFAULT_PORT,
      host: config.host ?? DEFAULT_HOST,
      maxMessageSize: config.maxMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE,
    };
    this.httpsServer = null;
    this.wss = null;
    this.heartbeatMonitor = null;
    this.connections = new Map();
    this.running = false;
  }

  /** Whether the server is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Number of active connections. */
  get connectionCount(): number {
    return this.connections.size;
  }

  /** Get information about a specific connection. */
  getConnection(connectionId: string): ConnectionInfo | undefined {
    return this.connections.get(connectionId)?.info;
  }

  /** Get all active connection IDs. */
  getConnectionIds(): readonly string[] {
    return [...this.connections.keys()];
  }

  /**
   * Start the relay server.
   *
   * Creates an HTTPS server with the configured TLS material,
   * attaches a WebSocket server, starts heartbeat monitoring,
   * and begins accepting connections.
   *
   * @returns Promise that resolves when the server is listening
   * @throws Error if the server is already running
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Relay is already running');
    }

    // Create HTTPS server with TLS
    const secureContext = buildSecureContext(this.config.tls);
    this.httpsServer = createServer(secureContext);

    // Create WebSocket server attached to HTTPS server
    this.wss = new WebSocketServer({
      server: this.httpsServer,
      maxPayload: this.config.maxMessageSize,
    });

    // Create heartbeat monitor
    this.heartbeatMonitor = new HeartbeatMonitor(this.config.heartbeat ?? {}, (ws, connectionId) =>
      this.handleHeartbeatTimeout(ws, connectionId),
    );

    // Handle new connections
    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });

    // Handle server errors
    this.wss.on('error', (err) => {
      this.emit('error', err);
    });

    this.httpsServer.on('error', (err) => {
      this.emit('error', err);
    });

    // Start listening
    return new Promise<void>((resolve, reject) => {
      const server = this.httpsServer!;

      const onError = (err: Error): void => {
        server.removeListener('error', onError);
        reject(err);
      };

      server.once('error', onError);

      server.listen(this.config.port, this.config.host, () => {
        server.removeListener('error', onError);
        this.running = true;
        this.emit('listening', this.config.port, this.config.host);
        resolve();
      });
    });
  }

  /**
   * Send data to a specific connected client.
   *
   * @param connectionId — the target connection's ID
   * @param data — string data to send
   * @returns true if the message was sent, false if the connection was not found
   */
  send(connectionId: string, data: string): boolean {
    const entry = this.connections.get(connectionId);
    if (!entry || entry.ws.readyState !== entry.ws.OPEN) {
      return false;
    }

    try {
      entry.ws.send(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Disconnect a specific client with an optional close code and reason.
   *
   * @param connectionId — the connection to close
   * @param code — WebSocket close code (default: 1000 Normal Closure)
   * @param reason — close reason string
   */
  disconnect(connectionId: string, code = 1000, reason = ''): void {
    const entry = this.connections.get(connectionId);
    if (!entry) return;

    try {
      entry.ws.close(code, reason);
    } catch {
      // Connection may already be closing
      entry.ws.terminate();
    }
  }

  /**
   * Gracefully shut down the relay server.
   *
   * 1. Stop accepting new connections
   * 2. Close all existing connections with 1001 (Going Away)
   * 3. Stop heartbeat monitoring
   * 4. Close the HTTPS server
   *
   * @param timeoutMs — maximum time to wait for shutdown (default: 5000ms)
   * @returns Promise that resolves when shutdown is complete
   */
  async shutdown(timeoutMs = 5000): Promise<void> {
    if (!this.running) return;

    this.running = false;

    // Close all client connections
    for (const [, entry] of this.connections) {
      try {
        entry.ws.close(1001, 'Server shutting down');
      } catch {
        entry.ws.terminate();
      }
    }

    // Destroy heartbeat monitor
    if (this.heartbeatMonitor) {
      this.heartbeatMonitor.destroy();
      this.heartbeatMonitor = null;
    }

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTPS server
    await new Promise<void>((resolve) => {
      if (!this.httpsServer) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        this.httpsServer?.closeAllConnections();
        resolve();
      }, timeoutMs);
      timer.unref();

      this.httpsServer.close(() => {
        clearTimeout(timer);
        resolve();
      });

      this.httpsServer = null;
    });

    this.connections.clear();
    this.emit('close');
  }

  // -------------------------------------------------------------------------
  // Internal: Connection handling
  // -------------------------------------------------------------------------

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const connectionId = randomUUID();
    const remoteAddress = req.socket.remoteAddress ?? 'unknown';

    const info: ConnectionInfo = {
      id: connectionId,
      remoteAddress,
      connectedAt: new Date().toISOString(),
    };

    // Store the connection
    this.connections.set(connectionId, { ws, info });

    // Start heartbeat tracking
    this.heartbeatMonitor?.track(ws, connectionId);

    // Emit connection event
    this.emit('connection', ws, info);

    // Audit log: connection established
    this.config.auditLogger?.logEvent(AUDIT_EVENT_TYPES.SESSION_STARTED, connectionId, { remoteAddress, connectionId });

    // Handle messages
    ws.on('message', (rawData) => {
      // Only handle text frames (string messages)
      const data =
        typeof rawData === 'string' ? rawData : rawData instanceof Buffer ? rawData.toString('utf-8') : String(rawData);

      this.emit('message', data, info);
    });

    // Handle close
    ws.on('close', (code, reason) => {
      this.heartbeatMonitor?.untrack(connectionId);
      this.connections.delete(connectionId);
      const reasonStr = reason.toString('utf-8');
      this.emit('disconnection', info, code, reasonStr);

      // Audit log: disconnection
      this.config.auditLogger?.logEvent(AUDIT_EVENT_TYPES.SESSION_ENDED, connectionId, {
        connectionId,
        code,
        reason: reasonStr,
      });
    });

    // Handle errors
    ws.on('error', (err) => {
      this.emit('error', err);
      // Error is followed by close, so cleanup happens there
    });
  }

  private handleHeartbeatTimeout(_ws: WebSocket, connectionId: string): void {
    const entry = this.connections.get(connectionId);
    if (!entry) return;

    this.emit('heartbeatTimeout', entry.info);

    // Audit log: heartbeat timeout
    this.config.auditLogger?.logEvent(AUDIT_EVENT_TYPES.SESSION_TIMEOUT, connectionId, {
      connectionId,
      remoteAddress: entry.info.remoteAddress,
    });

    // Terminate the dead connection
    try {
      entry.ws.terminate();
    } catch {
      // Already closed
    }

    this.connections.delete(connectionId);
  }
}
