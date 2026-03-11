// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Periodic chain integrity verification for the audit log.
 *
 * Verifies the tamper-evident hash chain at configurable intervals.
 * Supports full verification (entire chain) and incremental
 * verification (only entries added since the last check).
 *
 * Verification results are emitted via a callback so the relay
 * can take action on integrity failures (alert admin, shutdown, etc.).
 */

import { type ChainVerificationResult, type HashedAuditEntry, verifyChain, verifyRange } from '@bastion/crypto';
import type { AuditLogger } from './audit-logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for chain integrity verification. */
export interface ChainIntegrityConfig {
  /** Interval between periodic verifications in milliseconds. Default: 300_000 (5 min). */
  readonly intervalMs?: number;
  /** If true, run a full verification on start. Default: true. */
  readonly verifyOnStart?: boolean;
}

/** Result of an integrity check including metadata. */
export interface IntegrityCheckResult {
  /** The chain verification result. */
  readonly verification: ChainVerificationResult;
  /** Whether this was a full or incremental check. */
  readonly mode: 'full' | 'incremental';
  /** Number of entries verified. */
  readonly entriesChecked: number;
  /** ISO 8601 timestamp of the check. */
  readonly checkedAt: string;
  /** Time taken for the check in milliseconds. */
  readonly durationMs: number;
}

/** Callback invoked with integrity check results. */
export type IntegrityCallback = (result: IntegrityCheckResult) => void;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// ChainIntegrityMonitor
// ---------------------------------------------------------------------------

/**
 * Monitors audit log chain integrity with periodic verification.
 *
 * Usage:
 *   1. Create: `const monitor = new ChainIntegrityMonitor(logger, callback, config)`
 *   2. Start: `monitor.start()` — begins periodic verification
 *   3. Manual: `monitor.verifyFull()` or `monitor.verifyIncremental()`
 *   4. Stop: `monitor.stop()`
 */
export class ChainIntegrityMonitor {
  private readonly logger: AuditLogger;
  private readonly callback: IntegrityCallback;
  private readonly intervalMs: number;
  private readonly verifyOnStart: boolean;
  private timer: ReturnType<typeof setInterval> | null;
  private lastVerifiedIndex: number;
  private running: boolean;

  constructor(logger: AuditLogger, callback: IntegrityCallback, config: ChainIntegrityConfig = {}) {
    this.logger = logger;
    this.callback = callback;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.verifyOnStart = config.verifyOnStart ?? true;
    this.timer = null;
    this.lastVerifiedIndex = -1;
    this.running = false;
  }

  /** Whether the monitor is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** The index of the last successfully verified entry. */
  get lastVerified(): number {
    return this.lastVerifiedIndex;
  }

  /**
   * Start periodic integrity verification.
   *
   * If `verifyOnStart` is true (default), runs a full verification
   * immediately, then switches to incremental checks at the
   * configured interval.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    if (this.verifyOnStart) {
      this.verifyFull();
    }

    this.timer = setInterval(() => {
      this.verifyIncremental();
    }, this.intervalMs);

    // Don't prevent process exit
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /** Stop periodic verification. */
  stop(): void {
    if (!this.running) return;

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.running = false;
  }

  /**
   * Verify the entire chain from genesis.
   *
   * @returns integrity check result
   */
  verifyFull(): IntegrityCheckResult {
    const start = Date.now();
    const chain = this.logger.getChain();
    const verification = verifyChain(chain as HashedAuditEntry[]);
    const durationMs = Date.now() - start;

    if (verification.valid) {
      this.lastVerifiedIndex = chain.length - 1;
    }

    const result: IntegrityCheckResult = {
      verification,
      mode: 'full',
      entriesChecked: chain.length,
      checkedAt: new Date().toISOString(),
      durationMs,
    };

    this.callback(result);
    return result;
  }

  /**
   * Verify only entries added since the last successful verification.
   *
   * If no previous verification has been done, falls back to a
   * full verification.
   *
   * @returns integrity check result
   */
  verifyIncremental(): IntegrityCheckResult {
    const chain = this.logger.getChain();

    // If no entries or no previous verification, do full
    if (chain.length === 0 || this.lastVerifiedIndex < 0) {
      return this.verifyFull();
    }

    // If no new entries since last check, skip
    if (this.lastVerifiedIndex >= chain.length - 1) {
      const result: IntegrityCheckResult = {
        verification: { valid: true },
        mode: 'incremental',
        entriesChecked: 0,
        checkedAt: new Date().toISOString(),
        durationMs: 0,
      };
      this.callback(result);
      return result;
    }

    const startIndex = this.lastVerifiedIndex;
    const endIndex = chain.length - 1;
    const start = Date.now();

    const verification = verifyRange(chain as HashedAuditEntry[], startIndex, endIndex);

    const durationMs = Date.now() - start;

    if (verification.valid) {
      this.lastVerifiedIndex = endIndex;
    }

    const result: IntegrityCheckResult = {
      verification,
      mode: 'incremental',
      entriesChecked: endIndex - startIndex + 1,
      checkedAt: new Date().toISOString(),
      durationMs,
    };

    this.callback(result);
    return result;
  }
}
