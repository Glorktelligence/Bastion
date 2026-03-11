// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Write-only outbound staging for files the AI produces.
 *
 * The AI stages files here for submission to the relay. Once staged,
 * files cannot be read back or modified — they can only be submitted
 * (which extracts the data for relay transport) or purged on task
 * completion/timeout.
 *
 * This enforces the write-only constraint: the AI writes once, then
 * the file moves forward through the transfer pipeline. No read-back
 * prevents the AI from using staging as a scratchpad or side-channel.
 *
 * This is an in-memory store — files do not survive process restarts.
 */

import { randomUUID } from 'node:crypto';
import type { FileTransferId, Timestamp } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** State of a staged file. */
export type StagedFileState = 'staged' | 'submitted';

/** Metadata for a file in the staging directory. */
export interface StagedFileMetadata {
  readonly transferId: FileTransferId;
  readonly taskId: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly purpose: string;
  readonly stagedAt: Timestamp;
  readonly state: StagedFileState;
}

/** Internal staged file record. */
interface StagedFile {
  metadata: StagedFileMetadata;
  data: Uint8Array | null; // null after submission (data extracted)
}

/** Result of staging a file. */
export type StageResult =
  | { readonly status: 'staged'; readonly metadata: StagedFileMetadata }
  | { readonly status: 'full'; readonly maxFiles: number };

/** Result of submitting a staged file for relay transport. */
export type SubmitResult =
  | {
      readonly status: 'submitted';
      readonly transferId: FileTransferId;
      readonly data: Uint8Array;
      readonly metadata: StagedFileMetadata;
    }
  | { readonly status: 'not_found'; readonly transferId: FileTransferId }
  | { readonly status: 'already_submitted'; readonly transferId: FileTransferId };

/** Configuration for the outbound staging directory. */
export interface OutboundConfig {
  /** Maximum number of files in staging. Default: 50. */
  readonly maxFiles?: number;
}

// ---------------------------------------------------------------------------
// OutboundStaging
// ---------------------------------------------------------------------------

/**
 * Write-only outbound staging directory.
 *
 * The AI may:
 *   - stage() — write a new file into staging
 *   - getMetadata() — check staging metadata (filename, size, state)
 *   - listByTask() — list staged files for a task
 *
 * The AI may NOT:
 *   - read back file data after staging
 *   - modify a staged file
 *   - delete a staged file
 *
 * The transport layer may:
 *   - submit() — extract file data for relay submission (one-time operation)
 *
 * Only the purge system may remove files via purgeByTask() or purgeFile().
 */
export class OutboundStaging {
  private readonly files = new Map<FileTransferId, StagedFile>();
  private readonly taskIndex = new Map<string, Set<FileTransferId>>();
  private readonly maxFiles: number;
  private destroyed = false;

  constructor(config: OutboundConfig = {}) {
    this.maxFiles = config.maxFiles ?? 50;
  }

  /** Number of files in staging. */
  get count(): number {
    return this.files.size;
  }

  /** Whether the staging is full. */
  get isFull(): boolean {
    return this.files.size >= this.maxFiles;
  }

  /**
   * Stage a file for outbound submission.
   *
   * The file data is stored once and cannot be read back by the AI.
   * A unique transferId is generated for tracking.
   */
  stage(taskId: string, filename: string, data: Uint8Array, mimeType: string, purpose: string): StageResult {
    this.assertNotDestroyed();

    if (this.isFull) {
      return { status: 'full', maxFiles: this.maxFiles };
    }

    const transferId = randomUUID() as FileTransferId;

    const metadata: StagedFileMetadata = {
      transferId,
      taskId,
      filename,
      sizeBytes: data.length,
      mimeType,
      purpose,
      stagedAt: new Date().toISOString() as Timestamp,
      state: 'staged',
    };

    // Store a copy of the data to prevent external mutation
    this.files.set(transferId, {
      metadata,
      data: new Uint8Array(data),
    });

    // Update task index
    let taskFiles = this.taskIndex.get(taskId);
    if (!taskFiles) {
      taskFiles = new Set();
      this.taskIndex.set(taskId, taskFiles);
    }
    taskFiles.add(transferId);

    return { status: 'staged', metadata };
  }

  /**
   * Submit a staged file for relay transport.
   *
   * Extracts the file data and transitions state to 'submitted'.
   * After submission, the data is cleared from staging — only
   * metadata remains for tracking. This is a one-time operation.
   */
  submit(transferId: FileTransferId): SubmitResult {
    this.assertNotDestroyed();

    const file = this.files.get(transferId);
    if (!file) {
      return { status: 'not_found', transferId };
    }

    if (file.metadata.state === 'submitted' || file.data === null) {
      return { status: 'already_submitted', transferId };
    }

    // Extract data (one-time) and clear from staging
    const data = file.data;
    const updatedMetadata: StagedFileMetadata = { ...file.metadata, state: 'submitted' };
    file.metadata = updatedMetadata;
    file.data = null; // Data extracted — cannot be read again

    return { status: 'submitted', transferId, data, metadata: updatedMetadata };
  }

  /**
   * Get metadata for a staged file.
   *
   * Note: this returns metadata only — file data is NOT accessible
   * after staging (write-only constraint).
   */
  getMetadata(transferId: FileTransferId): StagedFileMetadata | undefined {
    this.assertNotDestroyed();
    return this.files.get(transferId)?.metadata;
  }

  /**
   * Check if a file exists in staging.
   */
  has(transferId: FileTransferId): boolean {
    return this.files.has(transferId);
  }

  /**
   * List all file metadata for a given task.
   */
  listByTask(taskId: string): readonly StagedFileMetadata[] {
    this.assertNotDestroyed();

    const ids = this.taskIndex.get(taskId);
    if (!ids) return [];

    const result: StagedFileMetadata[] = [];
    for (const id of ids) {
      const file = this.files.get(id);
      if (file) result.push(file.metadata);
    }
    return result;
  }

  /**
   * Purge all files associated with a task.
   *
   * This is NOT exposed to the AI — only the FilePurgeManager calls this.
   * Returns the number of files purged.
   */
  purgeByTask(taskId: string): number {
    this.assertNotDestroyed();

    const ids = this.taskIndex.get(taskId);
    if (!ids) return 0;

    let purged = 0;
    for (const id of ids) {
      if (this.files.delete(id)) {
        purged++;
      }
    }
    this.taskIndex.delete(taskId);
    return purged;
  }

  /**
   * Purge a single file by transfer ID.
   *
   * This is NOT exposed to the AI — only the FilePurgeManager calls this.
   */
  purgeFile(transferId: FileTransferId): boolean {
    this.assertNotDestroyed();

    const file = this.files.get(transferId);
    if (!file) return false;

    this.files.delete(transferId);

    // Update task index
    const taskFiles = this.taskIndex.get(file.metadata.taskId);
    if (taskFiles) {
      taskFiles.delete(transferId);
      if (taskFiles.size === 0) {
        this.taskIndex.delete(file.metadata.taskId);
      }
    }

    return true;
  }

  /**
   * Get all task IDs that have files in staging.
   */
  getTaskIds(): readonly string[] {
    return [...this.taskIndex.keys()];
  }

  /**
   * Destroy the staging directory. Clears all file data.
   */
  destroy(): void {
    this.files.clear();
    this.taskIndex.clear();
    this.destroyed = true;
  }

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new OutboundError('Outbound staging has been destroyed');
    }
  }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class OutboundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundError';
  }
}
