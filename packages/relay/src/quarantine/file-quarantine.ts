// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * File quarantine store for inbound and outbound file transfers.
 *
 * Every file entering the relay — regardless of direction — goes into
 * quarantine with full metadata. Files remain quarantined until
 * explicitly released by the transfer workflow or purged by timeout.
 *
 * The quarantine is an in-memory store backed by audit logging.
 * Persistent storage is intentionally omitted: quarantined file data
 * is ephemeral and should not survive relay restarts.
 */

import type {
  CustodyEvent,
  CustodyEventType,
  FileChainOfCustody,
  FileTransferDirection,
  FileTransferId,
  FileTransferState,
  MessageId,
  QuarantineEntry,
  Timestamp,
} from '@bastion/protocol';
import type { AuditLogger } from '../audit/audit-logger.js';
import { AUDIT_EVENT_TYPES } from '../audit/audit-logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the quarantine store. */
export interface QuarantineConfig {
  /** Maximum number of concurrent quarantined files. Default: 100. */
  readonly maxEntries?: number;
  /** Default quarantine timeout in milliseconds. Default: 3_600_000 (1 hour). */
  readonly defaultTimeoutMs?: number;
  /** Optional audit logger for chain-of-custody tracking. */
  readonly auditLogger?: AuditLogger;
  /** Session ID for audit log entries. */
  readonly sessionId?: string;
}

/** Submission request for quarantining a file. */
export interface QuarantineSubmission {
  readonly transferId: FileTransferId;
  readonly direction: FileTransferDirection;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly hashAtReceipt: string;
  readonly manifestMessageId: MessageId;
  /** File data (raw bytes). */
  readonly data: Uint8Array;
}

/** Result of a quarantine operation. */
export type QuarantineResult =
  | { readonly status: 'quarantined'; readonly entry: QuarantineEntry }
  | { readonly status: 'full'; readonly maxEntries: number }
  | { readonly status: 'duplicate'; readonly transferId: FileTransferId };

/** Result of releasing a file from quarantine. */
export type ReleaseResult =
  | { readonly status: 'released'; readonly entry: QuarantineEntry; readonly data: Uint8Array }
  | { readonly status: 'not_found'; readonly transferId: FileTransferId }
  | { readonly status: 'wrong_state'; readonly transferId: FileTransferId; readonly currentState: FileTransferState };

/** Result of a purge operation on a single entry. */
export type PurgeResult =
  | { readonly status: 'purged'; readonly transferId: FileTransferId }
  | { readonly status: 'not_found'; readonly transferId: FileTransferId };

// ---------------------------------------------------------------------------
// Internal storage types
// ---------------------------------------------------------------------------

interface StoredFile {
  entry: QuarantineEntry;
  data: Uint8Array;
  custody: CustodyEvent[];
}

// ---------------------------------------------------------------------------
// FileQuarantine
// ---------------------------------------------------------------------------

/**
 * In-memory quarantine store for file transfers.
 *
 * Lifecycle:
 *   1. submit() — file enters quarantine with metadata + hash
 *   2. updateState() — workflow transitions (offered, accepted, etc.)
 *   3. release() — file exits quarantine for delivery
 *   4. purge() — file removed (timeout, rejection, or explicit)
 */
export class FileQuarantine {
  private readonly files = new Map<FileTransferId, StoredFile>();
  private readonly maxEntries: number;
  private readonly defaultTimeoutMs: number;
  private readonly auditLogger: AuditLogger | undefined;
  private readonly sessionId: string;
  private destroyed = false;

  constructor(config: QuarantineConfig = {}) {
    this.maxEntries = config.maxEntries ?? 100;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 3_600_000;
    this.auditLogger = config.auditLogger;
    this.sessionId = config.sessionId ?? 'quarantine';
  }

  /** Number of files currently in quarantine. */
  get count(): number {
    return this.files.size;
  }

  /** Whether the quarantine is full. */
  get isFull(): boolean {
    return this.files.size >= this.maxEntries;
  }

  /** Whether the quarantine has been destroyed. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Submit a file into quarantine.
   *
   * The file is stored with its metadata and a custody chain is started.
   * The purge deadline is set to now + defaultTimeoutMs.
   */
  submit(submission: QuarantineSubmission): QuarantineResult {
    this.assertNotDestroyed();

    if (this.files.has(submission.transferId)) {
      return { status: 'duplicate', transferId: submission.transferId };
    }

    if (this.isFull) {
      return { status: 'full', maxEntries: this.maxEntries };
    }

    const now = new Date();
    const purgeAt = new Date(now.getTime() + this.defaultTimeoutMs);

    const entry: QuarantineEntry = {
      transferId: submission.transferId,
      direction: submission.direction,
      filename: submission.filename,
      sizeBytes: submission.sizeBytes,
      mimeType: submission.mimeType,
      hashAtReceipt: submission.hashAtReceipt,
      hashAlgorithm: 'sha256',
      quarantinedAt: toTimestamp(now),
      manifestMessageId: submission.manifestMessageId,
      state: 'quarantined',
      purgeAt: toTimestamp(purgeAt),
    };

    const custody: CustodyEvent[] = [
      {
        event: 'submitted',
        timestamp: toTimestamp(now),
        actor: submission.direction === 'human_to_ai' ? 'human' : 'ai',
        hash: submission.hashAtReceipt,
        detail: `File "${submission.filename}" submitted for quarantine`,
      },
      {
        event: 'quarantined',
        timestamp: toTimestamp(now),
        actor: 'relay',
        hash: submission.hashAtReceipt,
        detail: `Quarantined until ${entry.purgeAt}`,
      },
    ];

    this.files.set(submission.transferId, {
      entry,
      data: submission.data,
      custody,
    });

    this.auditLog(AUDIT_EVENT_TYPES.FILE_QUARANTINE, {
      transferId: submission.transferId,
      filename: submission.filename,
      direction: submission.direction,
      sizeBytes: submission.sizeBytes,
      mimeType: submission.mimeType,
      hashAtReceipt: submission.hashAtReceipt,
      purgeAt: entry.purgeAt,
    });

    return { status: 'quarantined', entry };
  }

  /**
   * Update the state of a quarantined file.
   *
   * Returns the updated entry, or undefined if the transfer is not found.
   * Appends a custody event for the state transition.
   */
  updateState(
    transferId: FileTransferId,
    newState: FileTransferState,
    actor: string,
    detail?: string,
  ): QuarantineEntry | undefined {
    this.assertNotDestroyed();

    const stored = this.files.get(transferId);
    if (!stored) return undefined;

    const now = toTimestamp(new Date());

    // Map state to custody event type
    const custodyEventType = stateToCustodyEvent(newState);
    if (custodyEventType) {
      stored.custody.push({
        event: custodyEventType,
        timestamp: now,
        actor,
        hash: stored.entry.hashAtReceipt,
        detail,
      });
    }

    // Update entry (immutable replace)
    const updated: QuarantineEntry = { ...stored.entry, state: newState };
    stored.entry = updated;

    return updated;
  }

  /**
   * Release a file from quarantine for delivery.
   *
   * Only files in 'accepted' state can be released. Returns the file
   * data along with the final quarantine entry.
   */
  release(transferId: FileTransferId): ReleaseResult {
    this.assertNotDestroyed();

    const stored = this.files.get(transferId);
    if (!stored) {
      return { status: 'not_found', transferId };
    }

    if (stored.entry.state !== 'accepted') {
      return { status: 'wrong_state', transferId, currentState: stored.entry.state };
    }

    const now = toTimestamp(new Date());
    stored.custody.push({
      event: 'delivered',
      timestamp: now,
      actor: 'relay',
      hash: stored.entry.hashAtReceipt,
      detail: 'File released from quarantine for delivery',
    });

    const updated: QuarantineEntry = { ...stored.entry, state: 'delivered' };
    const data = stored.data;

    this.files.delete(transferId);

    this.auditLog(AUDIT_EVENT_TYPES.FILE_DELIVERED, {
      transferId,
      filename: updated.filename,
      direction: updated.direction,
      sizeBytes: updated.sizeBytes,
      hashAtReceipt: updated.hashAtReceipt,
    });

    return { status: 'released', entry: updated, data };
  }

  /**
   * Purge a file from quarantine (timeout, rejection, or explicit).
   *
   * Removes the file data and records the purge in the custody chain.
   */
  purge(transferId: FileTransferId, reason: 'timed_out' | 'purged' = 'purged'): PurgeResult {
    this.assertNotDestroyed();

    const stored = this.files.get(transferId);
    if (!stored) {
      return { status: 'not_found', transferId };
    }

    const now = toTimestamp(new Date());
    stored.custody.push({
      event: reason,
      timestamp: now,
      actor: 'relay',
      detail:
        reason === 'timed_out'
          ? `Quarantine timeout expired (purgeAt: ${stored.entry.purgeAt})`
          : 'Explicitly purged from quarantine',
    });

    this.auditLog(AUDIT_EVENT_TYPES.FILE_REJECTED, {
      transferId,
      filename: stored.entry.filename,
      reason,
      direction: stored.entry.direction,
    });

    this.files.delete(transferId);

    return { status: 'purged', transferId };
  }

  /**
   * Get a quarantine entry by transfer ID.
   */
  get(transferId: FileTransferId): QuarantineEntry | undefined {
    return this.files.get(transferId)?.entry;
  }

  /**
   * Get the raw file data for a quarantined file.
   */
  getData(transferId: FileTransferId): Uint8Array | undefined {
    return this.files.get(transferId)?.data;
  }

  /**
   * Get the chain of custody for a quarantined file.
   */
  getCustody(transferId: FileTransferId): FileChainOfCustody | undefined {
    const stored = this.files.get(transferId);
    if (!stored) return undefined;

    return {
      transferId: stored.entry.transferId,
      direction: stored.entry.direction,
      filename: stored.entry.filename,
      sizeBytes: stored.entry.sizeBytes,
      mimeType: stored.entry.mimeType,
      events: [...stored.custody],
    };
  }

  /**
   * Get all entries that have exceeded their purge deadline.
   */
  getExpired(now: Date = new Date()): readonly QuarantineEntry[] {
    const expired: QuarantineEntry[] = [];
    for (const stored of this.files.values()) {
      if (new Date(stored.entry.purgeAt) <= now) {
        expired.push(stored.entry);
      }
    }
    return expired;
  }

  /**
   * Get all quarantined entries.
   */
  getAll(): readonly QuarantineEntry[] {
    return [...this.files.values()].map((s) => s.entry);
  }

  /**
   * Destroy the quarantine store. Clears all file data.
   */
  destroy(): void {
    this.files.clear();
    this.destroyed = true;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new QuarantineError('Quarantine store has been destroyed');
    }
  }

  private auditLog(eventType: string, detail: Record<string, unknown>): void {
    if (this.auditLogger) {
      this.auditLogger.logFileTransfer(eventType, this.sessionId, {
        transferId: String(detail.transferId),
        ...detail,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toTimestamp(date: Date): Timestamp {
  return date.toISOString() as Timestamp;
}

function stateToCustodyEvent(state: FileTransferState): CustodyEventType | undefined {
  const map: Partial<Record<FileTransferState, CustodyEventType>> = {
    offered: 'offered',
    accepted: 'accepted',
    rejected: 'rejected',
    delivered: 'delivered',
    hash_mismatch: 'hash_mismatch',
    purged: 'purged',
    timed_out: 'timed_out',
  };
  return map[state];
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class QuarantineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuarantineError';
  }
}
