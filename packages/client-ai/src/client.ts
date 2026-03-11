// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Headless AI client for the Bastion relay.
 *
 * Connects to the relay over WSS, authenticates via JWT, and maintains
 * the connection with automatic heartbeat responses (WebSocket pong).
 *
 * Session lifecycle from the AI client perspective:
 *   1. Connect to relay via WSS
 *   2. Receive JWT from relay after session initiation
 *   3. Active session — send/receive EncryptedEnvelopes
 *   4. Periodically refresh JWT before 15-minute expiry
 *   5. Graceful disconnect or reconnection on error
 *
 * The ws library automatically responds to WebSocket pings with pongs,
 * so heartbeat responses are handled at the transport level without
 * application code.
 */

import { EventEmitter } from 'node:events';
import type { SenderIdentity } from '@bastion/protocol';
import { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the AI client. */
export interface AiClientConfig {
  /** WSS URL of the relay server (e.g., 'wss://127.0.0.1:9443'). */
  readonly relayUrl: string;
  /** AI client identity. */
  readonly identity: SenderIdentity;
  /** Provider ID for session initiation. */
  readonly providerId: string;
  /** If true, accept self-signed TLS certificates (development only). */
  readonly rejectUnauthorized?: boolean;
  /** Connection timeout in milliseconds. Default: 10000 (10s). */
  readonly connectTimeoutMs?: number;
  /** Token refresh interval in milliseconds. Default: 780000 (13 minutes). */
  readonly tokenRefreshMs?: number;
}

/** Events emitted by the AI client (argument tuples for EventEmitter). */
export interface AiClientEvents {
  /** Connection to relay established. */
  connected: [];
  /** Received a message from the relay. */
  message: [data: string];
  /** Connection closed. */
  disconnected: [code: number, reason: string];
  /** JWT received or refreshed. */
  authenticated: [jwt: string, expiresAt: string];
  /** Token refresh requested. */
  tokenRefreshNeeded: [];
  /** Error occurred. */
  error: [error: Error];
  /** WebSocket ping received (heartbeat). */
  ping: [];
}

/** Connection state of the AI client. */
export type AiClientState = 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'closing';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_TOKEN_REFRESH_MS = 13 * 60 * 1000; // 13 minutes (2 min before 15-min expiry)

// ---------------------------------------------------------------------------
// BastionAiClient
// ---------------------------------------------------------------------------

/**
 * Headless AI client for connecting to a Bastion relay.
 *
 * Usage:
 *   1. Create: `const client = new BastionAiClient(config)`
 *   2. Listen: `client.on('message', handler)`
 *   3. Connect: `await client.connect()`
 *   4. Authenticate: `client.setToken(jwt, expiresAt)`
 *   5. Send: `client.send(data)`
 *   6. Disconnect: `await client.disconnect()`
 */
export class BastionAiClient extends EventEmitter<AiClientEvents> {
  private readonly config: Required<Pick<AiClientConfig, 'connectTimeoutMs' | 'tokenRefreshMs'>> & AiClientConfig;
  private ws: WebSocket | null;
  private state: AiClientState;
  private currentJwt: string | null;
  private jwtExpiresAt: string | null;
  private refreshTimer: ReturnType<typeof setTimeout> | null;
  private pingCount: number;

  constructor(config: AiClientConfig) {
    super();
    this.config = {
      ...config,
      connectTimeoutMs: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      tokenRefreshMs: config.tokenRefreshMs ?? DEFAULT_TOKEN_REFRESH_MS,
      rejectUnauthorized: config.rejectUnauthorized ?? true,
    };
    this.ws = null;
    this.state = 'disconnected';
    this.currentJwt = null;
    this.jwtExpiresAt = null;
    this.refreshTimer = null;
    this.pingCount = 0;
  }

  /** Current connection state. */
  get connectionState(): AiClientState {
    return this.state;
  }

  /** Whether the client is connected (may or may not be authenticated). */
  get isConnected(): boolean {
    return this.state === 'connected' || this.state === 'authenticated';
  }

  /** Whether the client has a valid JWT. */
  get isAuthenticated(): boolean {
    return this.state === 'authenticated' && this.currentJwt !== null;
  }

  /** The current JWT token, if authenticated. */
  get jwt(): string | null {
    return this.currentJwt;
  }

  /** The JWT expiry timestamp. */
  get tokenExpiresAt(): string | null {
    return this.jwtExpiresAt;
  }

  /** Number of heartbeat pings received since connection. */
  get heartbeatPingCount(): number {
    return this.pingCount;
  }

  /** The AI client's identity. */
  get identity(): SenderIdentity {
    return this.config.identity;
  }

  /** The provider ID. */
  get providerId(): string {
    return this.config.providerId;
  }

  /**
   * Connect to the relay server.
   *
   * Establishes a WSS connection and waits for it to open.
   * The ws library automatically responds to pings (heartbeat).
   *
   * @returns Promise that resolves when connected
   * @throws Error if already connected or connection fails
   */
  async connect(): Promise<void> {
    if (this.state !== 'disconnected') {
      throw new AiClientError(`Cannot connect: state is ${this.state}`);
    }

    this.state = 'connecting';
    this.pingCount = 0;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws?.terminate();
        this.state = 'disconnected';
        reject(new AiClientError('Connection timeout'));
      }, this.config.connectTimeoutMs);

      this.ws = new WebSocket(this.config.relayUrl, {
        rejectUnauthorized: this.config.rejectUnauthorized,
      });

      this.ws.once('open', () => {
        clearTimeout(timer);
        this.state = 'connected';
        this.attachListeners();
        this.emit('connected');
        resolve();
      });

      this.ws.once('error', (err) => {
        clearTimeout(timer);
        this.state = 'disconnected';
        this.ws = null;
        reject(new AiClientError(`Connection failed: ${err.message}`));
      });
    });
  }

  /**
   * Set the JWT token after authentication.
   *
   * Call this after receiving a JWT from the relay (e.g., via
   * SessionEstablished response). Starts the token refresh timer.
   *
   * @param jwt — the JWT string
   * @param expiresAt — ISO 8601 expiry timestamp
   */
  setToken(jwt: string, expiresAt: string): void {
    this.currentJwt = jwt;
    this.jwtExpiresAt = expiresAt;

    if (this.state === 'connected') {
      this.state = 'authenticated';
    }

    this.emit('authenticated', jwt, expiresAt);
    this.startRefreshTimer();
  }

  /**
   * Send data to the relay.
   *
   * @param data — string data to send (typically a serialised EncryptedEnvelope)
   * @returns true if sent, false if not connected
   */
  send(data: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      this.ws.send(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gracefully disconnect from the relay.
   *
   * @param code — WebSocket close code (default: 1000 Normal Closure)
   * @param reason — close reason string
   * @returns Promise that resolves when disconnected
   */
  async disconnect(code = 1000, reason = 'Client disconnect'): Promise<void> {
    if (this.state === 'disconnected') return;

    this.stopRefreshTimer();
    this.state = 'closing';

    return new Promise<void>((resolve) => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.cleanup(code, reason);
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        this.ws?.terminate();
        this.cleanup(code, reason);
        resolve();
      }, 5000);
      timer.unref();

      this.ws.once('close', () => {
        clearTimeout(timer);
        this.cleanup(code, reason);
        resolve();
      });

      this.ws.close(code, reason);
    });
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private attachListeners(): void {
    if (!this.ws) return;

    this.ws.on('message', (rawData) => {
      const data =
        typeof rawData === 'string' ? rawData : rawData instanceof Buffer ? rawData.toString('utf-8') : String(rawData);

      this.emit('message', data);
    });

    this.ws.on('ping', () => {
      this.pingCount++;
      this.emit('ping');
      // ws library auto-responds with pong — no manual action needed
    });

    this.ws.on('close', (code, reason) => {
      const reasonStr = reason?.toString?.('utf-8') ?? '';
      this.cleanup(code, reasonStr);
    });

    this.ws.on('error', (err) => {
      this.emit('error', err);
    });
  }

  private cleanup(code: number, reason: string): void {
    this.stopRefreshTimer();
    this.ws = null;
    this.currentJwt = null;
    this.jwtExpiresAt = null;
    this.state = 'disconnected';
    this.emit('disconnected', code, reason);
  }

  private startRefreshTimer(): void {
    this.stopRefreshTimer();

    this.refreshTimer = setTimeout(() => {
      this.emit('tokenRefreshNeeded');
    }, this.config.tokenRefreshMs);

    if (this.refreshTimer.unref) {
      this.refreshTimer.unref();
    }
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class AiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiClientError';
  }
}
