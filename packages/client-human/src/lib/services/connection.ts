// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Human-side WebSocket client for the Bastion relay.
 *
 * Uses the browser-native WebSocket API (runs in Tauri WebView).
 * Mirrors BastionAiClient patterns with added reconnection logic,
 * exponential backoff, and application-level ping/pong keep-alive.
 *
 * Session lifecycle (human client perspective):
 *   1. Connect to relay via WSS
 *   2. Receive JWT from relay after session initiation
 *   3. Active session — send/receive EncryptedEnvelopes
 *   4. Periodically refresh JWT before 15-minute expiry
 *   5. Ping every 30s — if no pong within 10s, close and reconnect
 *   6. On unexpected drop: reconnect with exponential backoff
 *   7. Graceful disconnect or final failure
 */

import type { SenderIdentity } from '@bastion/protocol';
import { TypedEmitter } from '../emitter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HumanClientState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authenticated'
  | 'reconnecting'
  | 'closing';

export interface HumanClientConfig {
  readonly relayUrl: string;
  readonly identity: SenderIdentity;
  readonly connectTimeoutMs?: number;
  readonly tokenRefreshMs?: number;
  readonly reconnect?: boolean;
  readonly maxReconnectAttempts?: number;
  /** Ping interval in ms. Default: 30_000. Set to 0 to disable. */
  readonly pingIntervalMs?: number;
  /** Pong timeout in ms. Default: 10_000. */
  readonly pongTimeoutMs?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly WebSocketImpl?: any;
}

export interface HumanClientEvents {
  stateChange: [state: HumanClientState];
  connected: [];
  disconnected: [code: number, reason: string];
  message: [data: string];
  authenticated: [jwt: string, expiresAt: string];
  tokenRefreshNeeded: [];
  reconnecting: [attempt: number, delayMs: number];
  reconnected: [];
  peerStatus: [status: string];
  error: [error: Error];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_TOKEN_REFRESH_MS = 13 * 60 * 1000; // 13 minutes
const DEFAULT_PING_INTERVAL_MS = 30_000;
const DEFAULT_PONG_TIMEOUT_MS = 10_000;
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const WS_OPEN = 1;

// ---------------------------------------------------------------------------
// BastionHumanClient
// ---------------------------------------------------------------------------

export class BastionHumanClient extends TypedEmitter<HumanClientEvents> {
  private readonly config: {
    relayUrl: string;
    identity: SenderIdentity;
    connectTimeoutMs: number;
    tokenRefreshMs: number;
    reconnect: boolean;
    maxReconnectAttempts: number;
    pingIntervalMs: number;
    pongTimeoutMs: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    WebSocketImpl: any;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ws: any | null = null;
  private state: HumanClientState = 'disconnected';
  private currentJwt: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingPong = false;
  private currentReconnectAttempt = 0;
  private intentionalClose = false;

  constructor(config: HumanClientConfig) {
    super();
    this.config = {
      relayUrl: config.relayUrl,
      identity: config.identity,
      connectTimeoutMs: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      tokenRefreshMs: config.tokenRefreshMs ?? DEFAULT_TOKEN_REFRESH_MS,
      reconnect: config.reconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? Number.POSITIVE_INFINITY,
      pingIntervalMs: config.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS,
      pongTimeoutMs: config.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS,
      WebSocketImpl: config.WebSocketImpl ?? globalThis.WebSocket,
    };
  }

  // -----------------------------------------------------------------------
  // Public getters
  // -----------------------------------------------------------------------

  get connectionState(): HumanClientState {
    return this.state;
  }

  get isConnected(): boolean {
    return this.state === 'connected' || this.state === 'authenticated';
  }

  get isAuthenticated(): boolean {
    return this.state === 'authenticated' && this.currentJwt !== null;
  }

  get jwt(): string | null {
    return this.currentJwt;
  }

  get reconnectAttempt(): number {
    return this.currentReconnectAttempt;
  }

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.state !== 'disconnected' && this.state !== 'reconnecting') {
      throw new HumanClientError(`Cannot connect: state is ${this.state}`);
    }

    const wasReconnecting = this.state === 'reconnecting';
    this.setState('connecting');
    this.intentionalClose = false;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        this.setState('disconnected');
        reject(new HumanClientError('Connection timeout'));
      }, this.config.connectTimeoutMs);

      try {
        const WsClass = this.config.WebSocketImpl;
        this.ws = new WsClass(this.config.relayUrl);
      } catch (err) {
        clearTimeout(timer);
        this.setState('disconnected');
        reject(new HumanClientError(`Connection failed: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }

      this.ws.onopen = () => {
        clearTimeout(timer);
        this.setState('connected');
        this.emit('connected');
        if (wasReconnecting) {
          this.currentReconnectAttempt = 0;
          this.emit('reconnected');
        }
        this.startPing();
        resolve();
      };

      this.ws.onerror = (ev: unknown) => {
        clearTimeout(timer);
        const msg =
          ev && typeof ev === 'object' && 'message' in ev
            ? String((ev as { message: unknown }).message)
            : 'WebSocket error';
        this.emit('error', new HumanClientError(msg));
      };

      this.ws.onmessage = (ev: unknown) => {
        const data = ev && typeof ev === 'object' && 'data' in ev ? String((ev as { data: unknown }).data) : '';

        // Handle pong response
        if (data === '{"type":"pong"}') {
          this.awaitingPong = false;
          if (this.pongTimer !== null) {
            clearTimeout(this.pongTimer);
            this.pongTimer = null;
          }
          return;
        }

        this.emit('message', data);
      };

      this.ws.onclose = (ev: unknown) => {
        clearTimeout(timer);
        const code = ev && typeof ev === 'object' && 'code' in ev ? Number((ev as { code: unknown }).code) : 1006;
        const reason = ev && typeof ev === 'object' && 'reason' in ev ? String((ev as { reason: unknown }).reason) : '';

        // Diagnostic: full call stack for every WebSocket close
        console.trace(
          `[Bastion] WEBSOCKET CLOSED code=${code} reason="${reason}" state=${this.state} intentional=${this.intentionalClose}`,
        );

        // If we were still connecting, reject the connect promise
        if (this.state === 'connecting') {
          this.setState('disconnected');
          reject(new HumanClientError(`Connection closed during setup: ${code}`));
          return;
        }

        this.handleClose(code, reason);
      };
    });
  }

  async disconnect(code = 1000, reason = 'Client disconnect'): Promise<void> {
    this.intentionalClose = true;
    this.cancelReconnect();
    this.stopRefreshTimer();
    this.stopPing();

    if (this.state === 'disconnected') return;

    this.setState('closing');

    return new Promise<void>((resolve) => {
      if (!this.ws || this.ws.readyState !== WS_OPEN) {
        this.cleanup(code, reason);
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        this.cleanup(code, reason);
        resolve();
      }, 5000);

      const prevOnClose = this.ws.onclose;
      this.ws.onclose = () => {
        clearTimeout(timer);
        if (typeof prevOnClose === 'function') {
          prevOnClose({ code, reason });
        }
        this.cleanup(code, reason);
        resolve();
      };

      this.ws.close(code, reason);
    });
  }

  setToken(jwt: string, expiresAt: string): void {
    this.currentJwt = jwt;

    if (this.state === 'connected') {
      this.setState('authenticated');
    }

    this.emit('authenticated', jwt, expiresAt);
    this.startRefreshTimer();
  }

  send(data: string): boolean {
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      return false;
    }
    try {
      this.ws.send(data);
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Ping/pong keep-alive
  // -----------------------------------------------------------------------

  private startPing(): void {
    this.stopPing();
    if (this.config.pingIntervalMs <= 0) return;

    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WS_OPEN) return;

      // If already awaiting pong and it hasn't arrived, connection is dead
      if (this.awaitingPong) {
        this.handlePongTimeout();
        return;
      }

      this.awaitingPong = true;
      try {
        this.ws.send('{"type":"ping"}');
      } catch {
        // Send failed — connection will close naturally
        return;
      }

      // Start pong timeout
      this.pongTimer = setTimeout(() => {
        if (this.awaitingPong) {
          this.handlePongTimeout();
        }
      }, this.config.pongTimeoutMs);
    }, this.config.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    this.awaitingPong = false;
  }

  private handlePongTimeout(): void {
    this.stopPing();
    // Close the dead connection — this will trigger handleClose → reconnect
    if (this.ws) {
      try {
        this.ws.close(4000, 'Pong timeout');
      } catch {
        // Already closed
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private setState(newState: HumanClientState): void {
    this.state = newState;
    this.emit('stateChange', newState);
  }

  private handleClose(code: number, reason: string): void {
    this.ws = null;
    this.stopRefreshTimer();
    this.stopPing();
    const wasAuthenticated = this.state === 'authenticated' || this.state === 'connected';

    this.currentJwt = null;

    if (this.intentionalClose || !this.config.reconnect) {
      this.setState('disconnected');
      this.emit('disconnected', code, reason);
      return;
    }

    // Unexpected close — attempt reconnection
    if (wasAuthenticated || this.state === 'reconnecting') {
      this.scheduleReconnect();
    } else {
      this.setState('disconnected');
      this.emit('disconnected', code, reason);
    }
  }

  private scheduleReconnect(): void {
    if (this.currentReconnectAttempt >= this.config.maxReconnectAttempts) {
      this.setState('disconnected');
      this.emit('disconnected', 1006, 'Max reconnect attempts exceeded');
      return;
    }

    this.setState('reconnecting');
    this.currentReconnectAttempt++;

    const idx = Math.min(this.currentReconnectAttempt - 1, BACKOFF_SCHEDULE_MS.length - 1);
    const delayMs = BACKOFF_SCHEDULE_MS[idx]!;

    this.emit('reconnecting', this.currentReconnectAttempt, delayMs);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        this.emit('error', err instanceof Error ? err : new HumanClientError(String(err)));
        // connect() failure sets state to disconnected — try again
        this.scheduleReconnect();
      });
    }, delayMs);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.currentReconnectAttempt = 0;
  }

  private cleanup(code: number, reason: string): void {
    this.ws = null;
    this.currentJwt = null;
    this.stopRefreshTimer();
    this.stopPing();
    this.setState('disconnected');
    this.emit('disconnected', code, reason);
  }

  private startRefreshTimer(): void {
    this.stopRefreshTimer();
    this.refreshTimer = setTimeout(() => {
      this.emit('tokenRefreshNeeded');
    }, this.config.tokenRefreshMs);
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

export class HumanClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HumanClientError';
  }
}
