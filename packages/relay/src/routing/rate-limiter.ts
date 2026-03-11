// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Per-client rate limiting for the relay.
 *
 * Uses a sliding window log to track message timestamps per client.
 * When a client exceeds the configured maximum messages within the
 * window, subsequent messages are rejected until older entries
 * expire.
 *
 * From the spec: BASTION-3006 (RATE_LIMIT_EXCEEDED) is returned
 * when a client sends messages too quickly.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the rate limiter. */
export interface RateLimiterConfig {
  /** Maximum messages allowed per window. Default: 100. */
  readonly maxMessages?: number;
  /** Sliding window size in milliseconds. Default: 60000 (1 minute). */
  readonly windowMs?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_MESSAGES = 100;
const DEFAULT_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

/**
 * Sliding-window rate limiter for per-client message throttling.
 *
 * Usage:
 *   1. Create: `const limiter = new RateLimiter(config)`
 *   2. Check each message: `if (!limiter.check(clientId)) { reject }`
 *   3. Reset on disconnect: `limiter.reset(clientId)`
 *   4. Cleanup: `limiter.destroy()`
 */
export class RateLimiter {
  private readonly maxMessages: number;
  private readonly windowMs: number;
  private readonly windows: Map<string, number[]>;
  private destroyed: boolean;

  constructor(config: RateLimiterConfig = {}) {
    this.maxMessages = config.maxMessages ?? DEFAULT_MAX_MESSAGES;
    this.windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
    this.windows = new Map();
    this.destroyed = false;
  }

  /** Whether the limiter has been destroyed. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Check whether a client is allowed to send a message.
   *
   * Records the current timestamp and prunes expired entries.
   * Returns true if the message is allowed, false if rate-limited.
   *
   * @param clientId — unique identifier for the client
   * @returns true if allowed, false if rate-limited
   */
  check(clientId: string): boolean {
    if (this.destroyed) return false;

    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(clientId);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(clientId, timestamps);
    }

    // Prune expired entries
    while (timestamps.length > 0 && timestamps[0]! <= cutoff) {
      timestamps.shift();
    }

    // Check limit
    if (timestamps.length >= this.maxMessages) {
      return false;
    }

    // Record this message
    timestamps.push(now);
    return true;
  }

  /**
   * Get the number of messages in the current window for a client.
   *
   * @param clientId — unique identifier for the client
   * @returns message count in the current window
   */
  getCount(clientId: string): number {
    if (this.destroyed) return 0;

    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.windows.get(clientId);
    if (!timestamps) return 0;

    // Prune expired entries
    while (timestamps.length > 0 && timestamps[0]! <= cutoff) {
      timestamps.shift();
    }

    return timestamps.length;
  }

  /**
   * Reset the rate limit window for a specific client.
   *
   * @param clientId — the client to reset
   */
  reset(clientId: string): void {
    this.windows.delete(clientId);
  }

  /** Reset all client windows. */
  resetAll(): void {
    this.windows.clear();
  }

  /** Number of clients currently tracked. */
  get clientCount(): number {
    return this.windows.size;
  }

  /** Stop the rate limiter and release all resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.windows.clear();
    this.destroyed = true;
  }
}
