// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * File transfer types for the secure airlock workflow (Section 7).
 *
 * File transfers are the most security-critical operation because they
 * represent data crossing the isolation boundary. Every transfer follows
 * a strict airlock workflow.
 */

import type { FileTransferId, MessageId, Timestamp } from './common.js';

/** State of a file transfer through the quarantine pipeline. */
export type FileTransferState =
  | 'pending_manifest'
  | 'quarantined'
  | 'offered'
  | 'accepted'
  | 'rejected'
  | 'delivering'
  | 'delivered'
  | 'hash_mismatch'
  | 'purged'
  | 'timed_out';

/** Direction of a file transfer. */
export type FileTransferDirection = 'human_to_ai' | 'ai_to_human';

/** Complete chain of custody record for a file transfer (Section 7.4). */
export interface FileChainOfCustody {
  readonly transferId: FileTransferId;
  readonly direction: FileTransferDirection;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly events: readonly CustodyEvent[];
}

/** Individual event in the file chain of custody. */
export interface CustodyEvent {
  readonly event: CustodyEventType;
  readonly timestamp: Timestamp;
  readonly actor: string;
  readonly hash?: string;
  readonly detail?: string;
}

export type CustodyEventType =
  | 'submitted'
  | 'quarantined'
  | 'hash_verified_receipt'
  | 'manifest_sent'
  | 'offered'
  | 'accepted'
  | 'rejected'
  | 'hash_verified_delivery'
  | 'delivered'
  | 'hash_mismatch'
  | 'purged'
  | 'timed_out';

/** Quarantine entry metadata stored by the relay. */
export interface QuarantineEntry {
  readonly transferId: FileTransferId;
  readonly direction: FileTransferDirection;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly hashAtReceipt: string;
  readonly hashAlgorithm: 'sha256';
  readonly quarantinedAt: Timestamp;
  readonly manifestMessageId: MessageId;
  readonly state: FileTransferState;
  /** Auto-purge deadline. */
  readonly purgeAt: Timestamp;
}
