// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * RateMonitor — per-connection message rate tracking with burst detection.
 *
 * Guardian Phase 3 runtime monitoring. Two detectors:
 *
 * 1. Sustained rate: messages per rolling window (default 120/min).
 *    Flags a client that sends steadily too fast.
 *
 * 2. Burst: messages in rapid succession (default 20 in 5s).
 *    Flags a client that dumps a flood before pacing out.
 *
 * Streaming chunks (conversation_stream) are NOT rate-limited here — they're
 * rapid by design. The caller is responsible for filtering those out before
 * calling `recordMessage`. See `RATE_EXEMPT_TYPES` for the expected filter.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A sliding window tracking sustained message rate for a connection. */
export interface RateWindow {
  connectionId: string;
  /** Message count inside the current window. */
  messageCount: number;
  /** Timestamp (ms) when the current window began. */
  windowStart: number;
  /** Timestamp (ms) of the most recent message. */
  lastMessageAt: number;
}

/** Configuration for a RateMonitor. */
export interface RateConfig {
  /** Max messages allowed per sustained window before triggering. Default: 120. */
  maxMessagesPerWindow: number;
  /** Sustained window duration in ms. Default: 60_000. */
  windowMs: number;
  /** Messages allowed in a burst window. Exceeding triggers burst detection. Default: 20. */
  burstThreshold: number;
  /** Burst window duration in ms. Default: 5_000. */
  burstWindowMs: number;
  /**
   * Callback invoked when a rate is exceeded.
   * `rate` is the observed count in the corresponding window.
   * `window` identifies which detector fired.
   */
  onRateExceeded: (connectionId: string, rate: number, window: 'sustained' | 'burst') => void;
}

/** Snapshot of a connection's current rate state. */
export interface RateSnapshot {
  messagesPerMinute: number;
  burstDetected: boolean;
}

// ---------------------------------------------------------------------------
// RateMonitor
// ---------------------------------------------------------------------------

/**
 * Records messages per connection and fires callbacks on anomalous rates.
 *
 * Usage:
 *   const monitor = new RateMonitor({ maxMessagesPerWindow, windowMs, burstThreshold, burstWindowMs, onRateExceeded });
 *   monitor.recordMessage(connId);
 *   monitor.removeConnection(connId);  // on disconnect
 *   monitor.cleanup();                  // periodic hygiene
 *   monitor.getRates();                 // for status reporting
 */
export class RateMonitor {
  private readonly config: RateConfig;
  private readonly windows: Map<string, RateWindow> = new Map();
  /** Rolling buffer of recent message timestamps per connection — used for burst detection. */
  private readonly bursts: Map<string, number[]> = new Map();
  /** Connections that are currently in a burst state (suppresses re-firing until burst clears). */
  private readonly burstFlagged: Set<string> = new Set();
  /** Connections that are currently over sustained rate (suppresses re-firing until rate drops). */
  private readonly sustainedFlagged: Set<string> = new Set();

  constructor(config: RateConfig) {
    this.config = config;
  }

  /**
   * Record a message from a connection. Checks both sustained rate and burst.
   * The caller is responsible for excluding rate-exempt message types
   * (streaming chunks, keepalives, handshake) before calling this.
   */
  recordMessage(connectionId: string): void {
    const now = Date.now();

    // --- Sustained window ---
    const existing = this.windows.get(connectionId);
    if (!existing || now - existing.windowStart >= this.config.windowMs) {
      // Start a fresh window — and clear the sustained-flag if we'd flagged them previously.
      this.windows.set(connectionId, {
        connectionId,
        messageCount: 1,
        windowStart: now,
        lastMessageAt: now,
      });
      this.sustainedFlagged.delete(connectionId);
    } else {
      existing.messageCount += 1;
      existing.lastMessageAt = now;
      if (existing.messageCount > this.config.maxMessagesPerWindow && !this.sustainedFlagged.has(connectionId)) {
        this.sustainedFlagged.add(connectionId);
        this.config.onRateExceeded(connectionId, existing.messageCount, 'sustained');
      }
    }

    // --- Burst detection ---
    let timestamps = this.bursts.get(connectionId);
    if (!timestamps) {
      timestamps = [];
      this.bursts.set(connectionId, timestamps);
    }
    timestamps.push(now);
    // Prune timestamps outside the burst window
    const burstCutoff = now - this.config.burstWindowMs;
    while (timestamps.length > 0 && timestamps[0]! < burstCutoff) {
      timestamps.shift();
    }

    if (timestamps.length > this.config.burstThreshold) {
      if (!this.burstFlagged.has(connectionId)) {
        this.burstFlagged.add(connectionId);
        this.config.onRateExceeded(connectionId, timestamps.length, 'burst');
      }
    } else {
      // Rate has dropped — clear the burst flag so the next burst can fire.
      this.burstFlagged.delete(connectionId);
    }
  }

  /**
   * Remove all tracking for a disconnected connection.
   * Safe to call during the disconnect handler.
   */
  removeConnection(connectionId: string): void {
    this.windows.delete(connectionId);
    this.bursts.delete(connectionId);
    this.burstFlagged.delete(connectionId);
    this.sustainedFlagged.delete(connectionId);
  }

  /**
   * Current rate snapshot per connection.
   * Used by Guardian.getStatus() for runtime monitoring reporting.
   */
  getRates(): Map<string, RateSnapshot> {
    const result = new Map<string, RateSnapshot>();
    const now = Date.now();

    for (const [connId, window] of this.windows) {
      // Scale messageCount into messages-per-minute based on the current elapsed portion of the window.
      const elapsedMs = Math.max(now - window.windowStart, 1);
      const normalisedMpm = (window.messageCount * 60_000) / Math.min(elapsedMs, this.config.windowMs);
      result.set(connId, {
        messagesPerMinute: Math.round(normalisedMpm),
        burstDetected: this.burstFlagged.has(connId),
      });
    }

    // Include connections that are burst-flagged but without a sustained window (edge case).
    for (const connId of this.burstFlagged) {
      if (!result.has(connId)) {
        result.set(connId, { messagesPerMinute: 0, burstDetected: true });
      }
    }

    return result;
  }

  /**
   * Remove stale windows for connections that have not sent a message recently.
   * Call periodically to bound memory.
   */
  cleanup(): void {
    const now = Date.now();
    const staleCutoff = now - this.config.windowMs - this.config.burstWindowMs;

    for (const [connId, window] of this.windows) {
      if (window.lastMessageAt < staleCutoff) {
        this.windows.delete(connId);
      }
    }
    for (const [connId, timestamps] of this.bursts) {
      if (timestamps.length === 0) {
        this.bursts.delete(connId);
        continue;
      }
      const newest = timestamps[timestamps.length - 1] ?? 0;
      if (newest < staleCutoff) {
        this.bursts.delete(connId);
      }
    }
  }

  /** Total number of tracked connections (for status reporting). */
  get trackedConnectionCount(): number {
    // Union of sustained-window and burst tracking keys
    const keys = new Set<string>();
    for (const key of this.windows.keys()) keys.add(key);
    for (const key of this.bursts.keys()) keys.add(key);
    return keys.size;
  }
}

// ---------------------------------------------------------------------------
// Rate-exempt message types
// ---------------------------------------------------------------------------

/**
 * Message types that MUST NOT be counted toward rate limits.
 *
 * - `conversation_stream`: streaming chunks are rapid by design (one per token).
 * - `ping`/`pong`: WebSocket keepalive.
 * - `key_exchange`: crypto handshake — brief burst on pairing is expected.
 * - `session_init`: connection setup.
 */
export const RATE_EXEMPT_TYPES: ReadonlySet<string> = new Set([
  'conversation_stream',
  'ping',
  'pong',
  'key_exchange',
  'session_init',
]);
