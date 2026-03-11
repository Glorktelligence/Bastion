// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Heartbeat monitoring for WebSocket connections.
 *
 * Uses WebSocket protocol-level ping/pong frames (not application-level
 * heartbeat messages) to detect dead connections. Each tracked connection
 * receives periodic pings; if no pong is received before the next ping
 * cycle, the connection is considered dead.
 *
 * Application-level heartbeat messages (HeartbeatPayload) are separate —
 * they carry system metrics and peer status information. This module
 * handles only the transport-level keepalive.
 *
 * From the supplementary spec Section 2.3:
 *   - Disconnected peer's counterpart receives heartbeat with suspended status
 *   - 5-minute grace period before session termination
 *   - Deduplication within 5-minute window prevents alert fatigue
 */

import type { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the heartbeat monitor. */
export interface HeartbeatConfig {
  /** Interval between ping frames in milliseconds. Default: 30000 (30s). */
  readonly pingIntervalMs?: number;
  /** Maximum time to wait for a pong before considering the connection dead.
   *  Default: 10000 (10s). */
  readonly pongTimeoutMs?: number;
}

/** Callback invoked when a connection is detected as dead. */
export type HeartbeatTimeoutCallback = (ws: WebSocket, connectionId: string) => void;

/** Internal state tracked per connection. */
interface ConnectionState {
  /** Whether a pong has been received since the last ping. */
  alive: boolean;
  /** Timer for the pong timeout. */
  pongTimer: ReturnType<typeof setTimeout> | null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PING_INTERVAL_MS = 30_000;
const DEFAULT_PONG_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// HeartbeatMonitor
// ---------------------------------------------------------------------------

/**
 * Monitors WebSocket connections using ping/pong frames.
 *
 * Usage:
 *   1. Create with `new HeartbeatMonitor(config, onTimeout)`
 *   2. Call `track(ws, connectionId)` for each new connection
 *   3. Call `untrack(connectionId)` when a connection closes
 *   4. Call `destroy()` to stop monitoring and clean up all timers
 *
 * The monitor sends periodic WebSocket pings. If a connection fails
 * to respond with a pong within the timeout window, the onTimeout
 * callback is invoked and the connection is untracked.
 */
export class HeartbeatMonitor {
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly onTimeout: HeartbeatTimeoutCallback;
  private readonly connections: Map<string, { ws: WebSocket; state: ConnectionState }>;
  private pingTimer: ReturnType<typeof setInterval> | null;
  private destroyed: boolean;

  constructor(config: HeartbeatConfig, onTimeout: HeartbeatTimeoutCallback) {
    this.pingIntervalMs = config.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.pongTimeoutMs = config.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
    this.onTimeout = onTimeout;
    this.connections = new Map();
    this.pingTimer = null;
    this.destroyed = false;
  }

  /** Number of connections currently being tracked. */
  get size(): number {
    return this.connections.size;
  }

  /** Whether the monitor has been destroyed. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Start tracking a WebSocket connection.
   *
   * Attaches a pong listener and includes the connection in the
   * periodic ping cycle. If this is the first connection, the
   * ping interval timer is started.
   *
   * @param ws — the WebSocket connection to monitor
   * @param connectionId — unique identifier for this connection
   */
  track(ws: WebSocket, connectionId: string): void {
    if (this.destroyed) return;

    // Clean up any existing tracking for this ID
    this.untrack(connectionId);

    const state: ConnectionState = {
      alive: true,
      pongTimer: null,
    };

    // Listen for pong frames
    const onPong = (): void => {
      state.alive = true;
      if (state.pongTimer !== null) {
        clearTimeout(state.pongTimer);
        state.pongTimer = null;
      }
    };

    ws.on('pong', onPong);

    this.connections.set(connectionId, { ws, state });

    // Start the ping interval if this is the first connection
    if (this.pingTimer === null) {
      this.startPingInterval();
    }
  }

  /**
   * Stop tracking a connection.
   *
   * Cleans up timers and listeners. If no connections remain,
   * the ping interval timer is stopped.
   *
   * @param connectionId — the connection to stop tracking
   */
  untrack(connectionId: string): void {
    const entry = this.connections.get(connectionId);
    if (!entry) return;

    if (entry.state.pongTimer !== null) {
      clearTimeout(entry.state.pongTimer);
      entry.state.pongTimer = null;
    }

    entry.ws.removeAllListeners('pong');
    this.connections.delete(connectionId);

    // Stop the interval if no connections remain
    if (this.connections.size === 0 && this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Check if a connection is currently being tracked.
   */
  isTracking(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }

  /**
   * Stop all monitoring and clean up resources.
   * The monitor cannot be reused after this call.
   */
  destroy(): void {
    if (this.destroyed) return;

    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    for (const [id, entry] of this.connections) {
      if (entry.state.pongTimer !== null) {
        clearTimeout(entry.state.pongTimer);
      }
      entry.ws.removeAllListeners('pong');
      this.connections.delete(id);
    }

    this.destroyed = true;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private startPingInterval(): void {
    this.pingTimer = setInterval(() => {
      this.pingAll();
    }, this.pingIntervalMs);

    // Don't let the timer prevent process exit
    if (this.pingTimer.unref) {
      this.pingTimer.unref();
    }
  }

  /** Send a ping to all tracked connections and start pong timers. */
  private pingAll(): void {
    for (const [connectionId, entry] of this.connections) {
      const { ws, state } = entry;

      // If the WebSocket is not open, skip (it will be cleaned up on close)
      if (ws.readyState !== ws.OPEN) {
        continue;
      }

      // Reset alive flag and send ping
      state.alive = false;

      try {
        ws.ping();
      } catch {
        // Connection may have closed between readyState check and ping
        this.handleTimeout(connectionId);
        continue;
      }

      // Start pong timeout
      state.pongTimer = setTimeout(() => {
        if (!state.alive) {
          this.handleTimeout(connectionId);
        }
      }, this.pongTimeoutMs);

      // Don't let pong timers prevent process exit
      if (state.pongTimer.unref) {
        state.pongTimer.unref();
      }
    }
  }

  private handleTimeout(connectionId: string): void {
    const entry = this.connections.get(connectionId);
    if (!entry) return;

    // Invoke the callback before untracking
    this.onTimeout(entry.ws, connectionId);
    this.untrack(connectionId);
  }
}
