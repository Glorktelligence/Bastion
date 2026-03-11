// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Automatic file purge on task completion or timeout.
 *
 * Tracks the association between tasks and files across both the intake
 * directory (received files) and outbound staging (produced files). When
 * a task completes or times out, all associated files in both locations
 * are automatically purged.
 *
 * Also supports configurable task timeout with automatic purge — if a
 * task runs longer than the timeout, all its files are purged.
 */

import type { Timestamp } from '@bastion/protocol';
import type { IntakeDirectory } from './intake.js';
import type { OutboundStaging } from './outbound.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Reason a task's files were purged. */
export type PurgeReason = 'completed' | 'timed_out' | 'cancelled' | 'manual';

/** Result of a task purge operation. */
export interface TaskPurgeResult {
  readonly taskId: string;
  readonly reason: PurgeReason;
  readonly intakePurged: number;
  readonly stagingPurged: number;
  readonly totalPurged: number;
  readonly timestamp: Timestamp;
}

/** State of a tracked task. */
export interface TrackedTask {
  readonly taskId: string;
  readonly registeredAt: Timestamp;
  readonly timeoutMs: number;
  readonly timeoutAt: Timestamp;
}

/** Callback invoked when a task's files are purged. */
export type PurgeCallback = (result: TaskPurgeResult) => void;

/** Configuration for the file purge manager. */
export interface FilePurgeConfig {
  /** Default task timeout in milliseconds. Default: 3_600_000 (1 hour). */
  readonly defaultTimeoutMs?: number;
  /** How often to check for timed-out tasks in milliseconds. Default: 30_000 (30 seconds). */
  readonly checkIntervalMs?: number;
  /** Callback invoked when a task's files are purged. */
  readonly onPurge?: PurgeCallback;
}

// ---------------------------------------------------------------------------
// FilePurgeManager
// ---------------------------------------------------------------------------

/**
 * Manages automatic file purge on task lifecycle events.
 *
 * Usage:
 *   1. Create: `new FilePurgeManager(intake, staging, config)`
 *   2. Register task: `registerTask(taskId)` — starts timeout timer
 *   3. On completion: `onTaskComplete(taskId)` — purges all files
 *   4. On timeout: automatic — checks periodically for expired tasks
 *   5. start()/stop() controls the timeout checker
 */
export class FilePurgeManager {
  private readonly intake: IntakeDirectory;
  private readonly staging: OutboundStaging;
  private readonly defaultTimeoutMs: number;
  private readonly checkIntervalMs: number;
  private readonly onPurge: PurgeCallback | undefined;

  /** Tracked tasks with their timeout deadlines. */
  private readonly tasks = new Map<string, TrackedTask>();
  /** Timer for periodic timeout checks. */
  private timer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(intake: IntakeDirectory, staging: OutboundStaging, config: FilePurgeConfig = {}) {
    this.intake = intake;
    this.staging = staging;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 3_600_000;
    this.checkIntervalMs = config.checkIntervalMs ?? 30_000;
    this.onPurge = config.onPurge;
  }

  /** Number of tracked tasks. */
  get trackedTaskCount(): number {
    return this.tasks.size;
  }

  /** Whether the periodic checker is running. */
  get isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Register a task for file tracking and timeout monitoring.
   *
   * Must be called before files are received/staged for the task.
   * The timeout clock starts from registration.
   */
  registerTask(taskId: string, timeoutMs?: number): TrackedTask {
    this.assertNotDestroyed();

    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    const now = new Date();

    const task: TrackedTask = {
      taskId,
      registeredAt: now.toISOString() as Timestamp,
      timeoutMs: timeout,
      timeoutAt: new Date(now.getTime() + timeout).toISOString() as Timestamp,
    };

    this.tasks.set(taskId, task);
    return task;
  }

  /**
   * Handle task completion — purge all associated files.
   */
  onTaskComplete(taskId: string): TaskPurgeResult | null {
    return this.purgeTask(taskId, 'completed');
  }

  /**
   * Handle task cancellation — purge all associated files.
   */
  onTaskCancelled(taskId: string): TaskPurgeResult | null {
    return this.purgeTask(taskId, 'cancelled');
  }

  /**
   * Manually purge all files for a task.
   */
  purgeManual(taskId: string): TaskPurgeResult | null {
    return this.purgeTask(taskId, 'manual');
  }

  /**
   * Check for and purge timed-out tasks.
   *
   * Called automatically by the periodic checker, or manually.
   * Returns results for all purged tasks.
   */
  checkTimeouts(now: Date = new Date()): readonly TaskPurgeResult[] {
    this.assertNotDestroyed();

    const results: TaskPurgeResult[] = [];

    for (const [taskId, task] of this.tasks) {
      if (new Date(task.timeoutAt) <= now) {
        const result = this.purgeTask(taskId, 'timed_out');
        if (result) results.push(result);
      }
    }

    return results;
  }

  /**
   * Get a tracked task by ID.
   */
  getTask(taskId: string): TrackedTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Check if a task is tracked.
   */
  isTracked(taskId: string): boolean {
    return this.tasks.has(taskId);
  }

  /**
   * Start the periodic timeout checker.
   */
  start(): void {
    this.assertNotDestroyed();

    if (this.timer) return; // Already running

    this.timer = setInterval(() => {
      this.checkTimeouts();
    }, this.checkIntervalMs);

    // Don't prevent process exit
    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  /**
   * Stop the periodic timeout checker.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Destroy the purge manager. Stops timer and clears tracking.
   */
  destroy(): void {
    this.stop();
    this.tasks.clear();
    this.destroyed = true;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private purgeTask(taskId: string, reason: PurgeReason): TaskPurgeResult | null {
    this.assertNotDestroyed();

    if (!this.tasks.has(taskId)) {
      // Task not tracked — still attempt to purge files (they may exist
      // from untracked associations) but don't count as a tracked purge.
      // Actually, if the task isn't tracked, we can try to purge anyway
      // in case files were added without registerTask().
    }

    const intakePurged = this.intake.purgeByTask(taskId);
    const stagingPurged = this.staging.purgeByTask(taskId);
    const totalPurged = intakePurged + stagingPurged;

    // Remove from tracking
    this.tasks.delete(taskId);

    // If nothing was tracked and nothing was purged, report null
    if (totalPurged === 0 && !this.tasks.has(taskId)) {
      // Still report the purge if the task was tracked (even if no files)
      // The task was already deleted above, so check by looking at the result
    }

    const result: TaskPurgeResult = {
      taskId,
      reason,
      intakePurged,
      stagingPurged,
      totalPurged,
      timestamp: new Date().toISOString() as Timestamp,
    };

    if (this.onPurge) {
      this.onPurge(result);
    }

    return result;
  }

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new PurgeError('FilePurgeManager has been destroyed');
    }
  }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class PurgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurgeError';
  }
}
