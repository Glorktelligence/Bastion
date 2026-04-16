// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * ViolationTracker — aggregates security violations across time windows.
 *
 * Guardian Phase 3 runtime monitoring. Distinguishes attack patterns from
 * one-off bugs: 5 sender-type mismatches in 60s from the same connection
 * is an attack, one is a client bug. Crossing a threshold feeds into
 * Guardian.trigger() for appropriate escalation.
 *
 * Thresholds are scoped to (type, connectionId). A wildcard type ('*')
 * matches violations of ANY type from the same connection — useful for
 * catching sustained pressure across mixed violation kinds.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A sliding window of violations for a single (type, connection) pair. */
export interface ViolationWindow {
  /** Violation type (e.g. 'sender_type_mismatch', 'schema_violation'). */
  type: string;
  /** Source connection ID. */
  connectionId: string;
  /** Count of violations recorded in the current window. */
  count: number;
  /** Timestamp (ms since epoch) of the first violation in the window. */
  firstAt: number;
  /** Timestamp (ms since epoch) of the most recent violation. */
  lastAt: number;
}

/** A rule describing when a violation window becomes a Guardian event. */
export interface ViolationThreshold {
  /** Type to match. Use '*' to match ANY violation type from the same connection. */
  type: string;
  /** Maximum count in the window before the threshold fires. */
  maxCount: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Guardian severity when the threshold fires. */
  severity: 'critical' | 'severe' | 'warning';
  /** BASTION error code to feed into Guardian.trigger. */
  code: string;
}

/** Callback invoked when a threshold is breached. */
export type ViolationThresholdCallback = (threshold: ViolationThreshold, window: ViolationWindow) => void;

/** Per-type stats used by getStats() for status reporting. */
export interface ViolationStats {
  /** Total count across all windows of this type. */
  count: number;
  /** Distinct connections that have contributed to this type. */
  connections: Set<string>;
}

// ---------------------------------------------------------------------------
// ViolationTracker
// ---------------------------------------------------------------------------

/**
 * Records security violations and triggers a callback when thresholds are crossed.
 *
 * Usage:
 *   const tracker = new ViolationTracker(DEFAULT_THRESHOLDS, onBreached);
 *   tracker.record('sender_type_mismatch', connId);
 *   tracker.cleanup();        // periodic hygiene
 *   tracker.getStats();       // for status reporting
 */
export class ViolationTracker {
  /** Keyed by `${type}|${connectionId}`. */
  private readonly windows: Map<string, ViolationWindow> = new Map();
  private readonly thresholds: readonly ViolationThreshold[];
  private readonly onThresholdBreached: ViolationThresholdCallback;
  /** Thresholds that have already fired for a given window — suppresses duplicate firings. */
  private readonly firedThresholds: Set<string> = new Set();
  /** Cached max windowMs across all thresholds — used for window reset + cleanup. */
  private readonly globalMaxWindowMs: number;

  constructor(thresholds: readonly ViolationThreshold[], onThresholdBreached: ViolationThresholdCallback) {
    this.thresholds = thresholds;
    this.onThresholdBreached = onThresholdBreached;
    this.globalMaxWindowMs = thresholds.reduce((max, t) => Math.max(max, t.windowMs), 0);
  }

  /**
   * Record a violation. Updates the per-type window and the '*' wildcard window
   * for this connection, then checks thresholds. If a threshold is crossed for
   * the first time in the current window, `onThresholdBreached` is called once.
   */
  record(type: string, connectionId: string): void {
    const now = Date.now();

    // Update the per-type window and the wildcard window for this connection.
    // The wildcard window aggregates ALL violation types for sustained-attack detection.
    this.updateWindow(type, connectionId, now);
    this.updateWindow('*', connectionId, now);

    // Check every threshold. Fire at most once per (threshold, window) pair.
    for (const threshold of this.thresholds) {
      // A wildcard threshold applies to every recorded type.
      // A specific threshold only applies when its type matches the recorded type.
      const applies = threshold.type === '*' || threshold.type === type;
      if (!applies) continue;

      const windowKey = `${threshold.type}|${connectionId}`;
      const window = this.windows.get(windowKey);
      if (!window) continue;

      // Skip if the window is older than this threshold cares about.
      if (now - window.firstAt > threshold.windowMs) continue;

      if (window.count >= threshold.maxCount) {
        const firedKey = this.makeFiredKey(threshold, connectionId, window.firstAt);
        if (!this.firedThresholds.has(firedKey)) {
          this.firedThresholds.add(firedKey);
          this.onThresholdBreached(threshold, { ...window });
        }
      }
    }
  }

  /**
   * Remove expired windows. Thresholds' `windowMs` are bounded, so any window
   * older than the longest configured windowMs is unreachable for every threshold.
   */
  cleanup(): void {
    const now = Date.now();
    const cutoff = this.globalMaxWindowMs;

    for (const [key, window] of this.windows) {
      if (now - window.firstAt > cutoff) {
        this.windows.delete(key);
      }
    }

    // Prune fired-threshold markers that reference windows older than any threshold cares about.
    for (const firedKey of this.firedThresholds) {
      const parts = firedKey.split('|');
      const firstAt = Number(parts[parts.length - 1]);
      if (Number.isFinite(firstAt) && now - firstAt > cutoff) {
        this.firedThresholds.delete(firedKey);
      }
    }
  }

  /**
   * Remove all tracking for a disconnected connection.
   * Safe to call during the disconnect handler.
   */
  removeConnection(connectionId: string): void {
    for (const key of this.windows.keys()) {
      if (key.endsWith(`|${connectionId}`)) {
        this.windows.delete(key);
      }
    }
    // firedKey pattern: `${type}|${maxCount}|${windowMs}|${connectionId}|${firstAt}`
    for (const firedKey of this.firedThresholds) {
      const parts = firedKey.split('|');
      if (parts.length >= 5 && parts[3] === connectionId) {
        this.firedThresholds.delete(firedKey);
      }
    }
  }

  /**
   * Current stats keyed by violation type.
   * Used by Guardian.getStatus() for runtime monitoring reporting.
   */
  getStats(): Map<string, ViolationStats> {
    const stats = new Map<string, ViolationStats>();
    for (const window of this.windows.values()) {
      const existing = stats.get(window.type);
      if (existing) {
        existing.count += window.count;
        existing.connections.add(window.connectionId);
      } else {
        stats.set(window.type, {
          count: window.count,
          connections: new Set([window.connectionId]),
        });
      }
    }
    return stats;
  }

  /** Total number of active violation windows (for status reporting). */
  get activeWindowCount(): number {
    return this.windows.size;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Add to an active window, or create a new window if the existing one has
   * aged past every threshold that cares about this type.
   */
  private updateWindow(type: string, connectionId: string, now: number): void {
    const key = `${type}|${connectionId}`;
    const existing = this.windows.get(key);

    const typeSpecificMax = this.thresholds
      .filter((t) => t.type === type)
      .reduce((max, t) => Math.max(max, t.windowMs), 0);
    // Unknown types fall back to the global max so they still eventually reset.
    const resetBoundary = typeSpecificMax > 0 ? typeSpecificMax : this.globalMaxWindowMs;

    if (existing && now - existing.firstAt <= resetBoundary) {
      existing.count += 1;
      existing.lastAt = now;
    } else {
      this.windows.set(key, {
        type,
        connectionId,
        count: 1,
        firstAt: now,
        lastAt: now,
      });
    }
  }

  private makeFiredKey(threshold: ViolationThreshold, connectionId: string, firstAt: number): string {
    return `${threshold.type}|${threshold.maxCount}|${threshold.windowMs}|${connectionId}|${firstAt}`;
  }
}

// ---------------------------------------------------------------------------
// Default thresholds
// ---------------------------------------------------------------------------

/**
 * Default thresholds — tuned to distinguish attacks from benign client bugs.
 *
 * - sender_type_mismatch: 5+ in 60s = coordinated attempt to send messages
 *   as a role the client is not. BASTION-9007 (severe — Guardian alert).
 * - schema_violation: 3+ in 60s = malformed client or injection probing.
 *   BASTION-9009 (warning — audit + alert).
 * - '*' wildcard: 10+ of ANY type in 5 min = sustained pressure.
 *   BASTION-9007 (critical — cascade shutdown).
 */
export const DEFAULT_VIOLATION_THRESHOLDS: readonly ViolationThreshold[] = [
  {
    type: 'sender_type_mismatch',
    maxCount: 5,
    windowMs: 60_000,
    severity: 'severe',
    code: 'BASTION-9007',
  },
  {
    type: 'schema_violation',
    maxCount: 3,
    windowMs: 60_000,
    severity: 'warning',
    code: 'BASTION-9009',
  },
  {
    type: '*',
    maxCount: 10,
    windowMs: 300_000,
    severity: 'critical',
    code: 'BASTION-9007',
  },
];
