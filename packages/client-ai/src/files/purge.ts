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

import { rmSync } from 'node:fs';
import type { Timestamp } from '@bastion/protocol';
import type { DateTimeManager } from '../provider/datetime-manager.js';
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

/** Result of a single file deletion request. */
export interface FileDeletionResult {
  readonly path: string;
  readonly deleted: boolean;
  readonly reason: string;
  readonly timestamp: Timestamp;
}

/** Audit event for deletion attempts outside the PurgeManager. */
export interface PurgeViolation {
  readonly type: 'PURGE_VIOLATION';
  readonly caller: string;
  readonly path: string;
  readonly timestamp: Timestamp;
  readonly message: string;
}

/** Callback invoked when a task's files are purged. */
export type PurgeCallback = (result: TaskPurgeResult) => void;

/** Callback invoked when a purge violation is detected. */
export type ViolationCallback = (violation: PurgeViolation) => void;

/** Configuration for the file purge manager. */
export interface FilePurgeConfig {
  /** Default task timeout in milliseconds. Default: 3_600_000 (1 hour). */
  readonly defaultTimeoutMs?: number;
  /** How often to check for timed-out tasks in milliseconds. Default: 30_000 (30 seconds). */
  readonly checkIntervalMs?: number;
  /** Callback invoked when a task's files are purged. */
  readonly onPurge?: PurgeCallback;
  /** Callback invoked when a deletion is attempted outside PurgeManager. */
  readonly onViolation?: ViolationCallback;
  /** Optional DateTimeManager — sole DateTime authority. */
  readonly dateTimeManager?: DateTimeManager;
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
  private readonly onViolation: ViolationCallback | undefined;
  private readonly dateTimeManager: DateTimeManager | null;

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
    this.onViolation = config.onViolation;
    this.dateTimeManager = config.dateTimeManager ?? null;
  }

  /** Current time as ISO string, using DateTimeManager if available. */
  private nowIso(): string {
    return this.dateTimeManager?.now().iso ?? new Date().toISOString();
  }

  /** Current time as epoch ms, using DateTimeManager if available. */
  private nowMs(): number {
    return this.dateTimeManager?.now().unix ?? Date.now();
  }

  /** Current Date object, using DateTimeManager if available. */
  private nowDate(): Date {
    return this.dateTimeManager ? new Date(this.dateTimeManager.now().unix) : new Date();
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
    const nowMs = this.nowMs();

    const task: TrackedTask = {
      taskId,
      registeredAt: this.nowIso() as Timestamp,
      timeoutMs: timeout,
      timeoutAt: new Date(nowMs + timeout).toISOString() as Timestamp,
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
  checkTimeouts(now?: Date): readonly TaskPurgeResult[] {
    const effectiveNow = now ?? this.nowDate();
    this.assertNotDestroyed();

    const results: TaskPurgeResult[] = [];

    for (const [taskId, task] of this.tasks) {
      if (new Date(task.timeoutAt) <= effectiveNow) {
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

  /**
   * Delete a single file from disk. This is the SOLE authorised path for
   * file deletion in Bastion. All other components MUST use this method
   * instead of calling fs.rmSync/fs.unlinkSync directly.
   */
  deleteFile(filePath: string, reason: string): FileDeletionResult {
    this.assertNotDestroyed();
    try {
      rmSync(filePath, { force: true });
      return {
        path: filePath,
        deleted: true,
        reason,
        timestamp: this.nowIso() as Timestamp,
      };
    } catch (err) {
      return {
        path: filePath,
        deleted: false,
        reason: `${reason} — failed: ${(err as Error).message}`,
        timestamp: this.nowIso() as Timestamp,
      };
    }
  }

  /**
   * Delete a directory recursively. Sole authorised path for directory
   * deletion in Bastion.
   */
  deleteDirectory(dirPath: string, reason: string): FileDeletionResult {
    this.assertNotDestroyed();
    try {
      rmSync(dirPath, { recursive: true, force: true });
      return {
        path: dirPath,
        deleted: true,
        reason,
        timestamp: this.nowIso() as Timestamp,
      };
    } catch (err) {
      return {
        path: dirPath,
        deleted: false,
        reason: `${reason} — failed: ${(err as Error).message}`,
        timestamp: this.nowIso() as Timestamp,
      };
    }
  }

  /**
   * Report a deletion attempt that occurred outside the PurgeManager.
   * Logs a PURGE_VIOLATION audit event. This is a canary — if these
   * events appear, something bypassed the sole delete authority.
   */
  reportViolation(caller: string, path: string): void {
    const violation: PurgeViolation = {
      type: 'PURGE_VIOLATION',
      caller,
      path,
      timestamp: this.nowIso() as Timestamp,
      message: `Deletion attempted outside PurgeManager by ${caller} on ${path}`,
    };
    console.warn(`[!] PURGE_VIOLATION: ${violation.message}`);
    if (this.onViolation) {
      this.onViolation(violation);
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private purgeTask(taskId: string, reason: PurgeReason): TaskPurgeResult | null {
    this.assertNotDestroyed();

    const intakePurged = this.intake.purgeByTask(taskId);
    const stagingPurged = this.staging.purgeByTask(taskId);
    const totalPurged = intakePurged + stagingPurged;

    // Remove from tracking
    this.tasks.delete(taskId);

    const result: TaskPurgeResult = {
      taskId,
      reason,
      intakePurged,
      stagingPurged,
      totalPurged,
      timestamp: this.nowIso() as Timestamp,
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
