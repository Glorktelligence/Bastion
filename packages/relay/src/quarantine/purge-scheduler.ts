// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Automatic purge scheduler for quarantined files.
 *
 * Periodically scans the quarantine store for files that have exceeded
 * their purge deadline and removes them. Each purge generates an audit
 * log entry with the transfer details.
 *
 * The scheduler runs on a configurable interval (default: 60 seconds)
 * and can also be triggered manually.
 */

import type { FileTransferId } from '@bastion/protocol';
import type { FileQuarantine } from './file-quarantine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the purge scheduler. */
export interface PurgeSchedulerConfig {
  /** The quarantine store to purge from. */
  readonly quarantine: FileQuarantine;
  /** Scan interval in milliseconds. Default: 60_000 (1 minute). */
  readonly intervalMs?: number;
  /** Optional callback invoked after each purge cycle. */
  readonly onPurge?: (result: PurgeCycleResult) => void;
}

/** Result of a single purge cycle. */
export interface PurgeCycleResult {
  /** Transfer IDs that were purged. */
  readonly purged: readonly FileTransferId[];
  /** Transfer IDs that could not be purged (not found — race condition). */
  readonly failed: readonly FileTransferId[];
  /** Timestamp of the purge cycle. */
  readonly timestamp: string;
  /** Number of entries remaining in quarantine. */
  readonly remaining: number;
}

// ---------------------------------------------------------------------------
// PurgeScheduler
// ---------------------------------------------------------------------------

/**
 * Periodic purge scheduler for quarantined files.
 *
 * Usage:
 *   1. Create: `const scheduler = new PurgeScheduler(config)`
 *   2. Start: `scheduler.start()`
 *   3. Manual purge: `scheduler.purgeNow()`
 *   4. Stop: `scheduler.stop()`
 */
export class PurgeScheduler {
  private readonly quarantine: FileQuarantine;
  private readonly intervalMs: number;
  private readonly onPurge: ((result: PurgeCycleResult) => void) | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: PurgeSchedulerConfig) {
    this.quarantine = config.quarantine;
    this.intervalMs = config.intervalMs ?? 60_000;
    this.onPurge = config.onPurge;
  }

  /** Whether the scheduler is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Start the periodic purge scheduler.
   *
   * The timer is unref'd so it doesn't prevent process exit.
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.timer = setInterval(() => {
      this.purgeNow();
    }, this.intervalMs);

    // Don't prevent process exit
    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  /**
   * Stop the periodic purge scheduler.
   */
  stop(): void {
    if (!this.running) return;

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.running = false;
  }

  /**
   * Execute a purge cycle immediately.
   *
   * Finds all expired files in quarantine and purges them. Returns
   * the result of the purge cycle. Can be called whether or not the
   * scheduler timer is running.
   */
  purgeNow(now?: Date): PurgeCycleResult {
    const timestamp = (now ?? new Date()).toISOString();
    const expired = this.quarantine.getExpired(now);

    const purged: FileTransferId[] = [];
    const failed: FileTransferId[] = [];

    for (const entry of expired) {
      const result = this.quarantine.purge(entry.transferId, 'timed_out');
      if (result.status === 'purged') {
        purged.push(entry.transferId);
      } else {
        failed.push(entry.transferId);
      }
    }

    const cycleResult: PurgeCycleResult = {
      purged,
      failed,
      timestamp,
      remaining: this.quarantine.count,
    };

    if (this.onPurge) {
      this.onPurge(cycleResult);
    }

    return cycleResult;
  }
}
