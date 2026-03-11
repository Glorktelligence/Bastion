// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Read-only intake directory for files received from quarantine.
 *
 * When the AI receives a file from the relay (after accepting a file_manifest),
 * the decrypted file data is placed here. The AI can read file contents and
 * metadata but cannot modify or delete files. Only the FilePurgeManager may
 * remove files from intake (on task completion or timeout).
 *
 * This is an in-memory store — files do not survive process restarts.
 */

import type { FileTransferId, Timestamp } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata for a file in the intake directory. */
export interface IntakeFileMetadata {
  readonly transferId: FileTransferId;
  readonly taskId: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly hash: string;
  readonly receivedAt: Timestamp;
}

/** Full intake file record (metadata + data). */
interface IntakeFile {
  readonly metadata: IntakeFileMetadata;
  readonly data: Uint8Array;
}

/** Result of receiving a file into intake. */
export type IntakeReceiveResult =
  | { readonly status: 'received'; readonly metadata: IntakeFileMetadata }
  | { readonly status: 'duplicate'; readonly transferId: FileTransferId }
  | { readonly status: 'full'; readonly maxFiles: number };

/** Configuration for the intake directory. */
export interface IntakeConfig {
  /** Maximum number of files in intake. Default: 50. */
  readonly maxFiles?: number;
}

// ---------------------------------------------------------------------------
// IntakeDirectory
// ---------------------------------------------------------------------------

/**
 * Read-only intake directory for received files.
 *
 * The AI may:
 *   - read() — get file data by transferId
 *   - getMetadata() — get metadata by transferId
 *   - listByTask() — list all files for a task
 *   - has() — check if a file exists
 *
 * The AI may NOT:
 *   - modify file data
 *   - delete individual files
 *   - overwrite existing files
 *
 * Only the purge system may remove files via purgeByTask() or purgeFile().
 */
export class IntakeDirectory {
  private readonly files = new Map<FileTransferId, IntakeFile>();
  private readonly taskIndex = new Map<string, Set<FileTransferId>>();
  private readonly maxFiles: number;
  private destroyed = false;

  constructor(config: IntakeConfig = {}) {
    this.maxFiles = config.maxFiles ?? 50;
  }

  /** Number of files in intake. */
  get count(): number {
    return this.files.size;
  }

  /** Whether the intake is full. */
  get isFull(): boolean {
    return this.files.size >= this.maxFiles;
  }

  /**
   * Receive a file into the intake directory.
   *
   * Called by the file delivery handler when the relay releases a file
   * after the AI accepted a file_manifest. The file becomes read-only
   * immediately upon receipt.
   */
  receive(
    transferId: FileTransferId,
    taskId: string,
    filename: string,
    data: Uint8Array,
    mimeType: string,
    hash: string,
  ): IntakeReceiveResult {
    this.assertNotDestroyed();

    if (this.files.has(transferId)) {
      return { status: 'duplicate', transferId };
    }

    if (this.isFull) {
      return { status: 'full', maxFiles: this.maxFiles };
    }

    const metadata: IntakeFileMetadata = {
      transferId,
      taskId,
      filename,
      sizeBytes: data.length,
      mimeType,
      hash,
      receivedAt: new Date().toISOString() as Timestamp,
    };

    // Store with a copy of the data to prevent external mutation
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

    return { status: 'received', metadata };
  }

  /**
   * Read file data (read-only access).
   *
   * Returns a copy of the file data to prevent external mutation.
   */
  read(transferId: FileTransferId): Uint8Array | undefined {
    this.assertNotDestroyed();

    const file = this.files.get(transferId);
    if (!file) return undefined;

    // Return a copy — the intake directory is read-only
    return new Uint8Array(file.data);
  }

  /**
   * Get file metadata by transfer ID.
   */
  getMetadata(transferId: FileTransferId): IntakeFileMetadata | undefined {
    this.assertNotDestroyed();
    return this.files.get(transferId)?.metadata;
  }

  /**
   * Check if a file exists in intake.
   */
  has(transferId: FileTransferId): boolean {
    return this.files.has(transferId);
  }

  /**
   * List all file metadata for a given task.
   */
  listByTask(taskId: string): readonly IntakeFileMetadata[] {
    this.assertNotDestroyed();

    const ids = this.taskIndex.get(taskId);
    if (!ids) return [];

    const result: IntakeFileMetadata[] = [];
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
   * Get all task IDs that have files in intake.
   */
  getTaskIds(): readonly string[] {
    return [...this.taskIndex.keys()];
  }

  /**
   * Destroy the intake directory. Clears all file data.
   */
  destroy(): void {
    this.files.clear();
    this.taskIndex.clear();
    this.destroyed = true;
  }

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new IntakeError('Intake directory has been destroyed');
    }
  }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class IntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntakeError';
  }
}
