// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * File transfer routing — manifest/offer/request workflow.
 *
 * Orchestrates the secure airlock workflow described in Section 7 of the spec.
 * No file content is ever sent without explicit request/acceptance from the
 * recipient. The relay holds file data in quarantine and only releases it
 * when the recipient has explicitly opted in.
 *
 * Human → AI flow:
 *   1. Human uploads encrypted file data + manifest to relay
 *   2. Relay quarantines file, verifies hash at receipt
 *   3. Relay sends file_manifest (metadata only, NO file content) to AI
 *   4. AI evaluates and sends file_request to accept, or declines
 *   5. Relay verifies hash at delivery, then releases file data to AI
 *
 * AI → Human flow:
 *   1. AI submits file data + offer metadata to relay
 *   2. Relay quarantines file, verifies hash at receipt
 *   3. Relay sends file_offer (metadata only, NO file content) to human
 *   4. Human accepts (file_request) or rejects (ignored / timeout purge)
 *   5. Relay verifies hash at delivery, then releases file data to human
 */

import { randomUUID } from 'node:crypto';
import type {
  FileManifestPayload,
  FileOfferPayload,
  FileTransferDirection,
  FileTransferId,
  MessageId,
  SenderIdentity,
} from '@bastion/protocol';
import { MESSAGE_TYPES, PROTOCOL_VERSION } from '@bastion/protocol';
import type { AuditLogger } from '../audit/audit-logger.js';
import { AUDIT_EVENT_TYPES } from '../audit/audit-logger.js';
import type { SendFn } from '../routing/message-router.js';
import type { FileQuarantine } from './file-quarantine.js';
import type { HashVerifier } from './hash-verifier.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the file transfer router. */
export interface FileTransferRouterConfig {
  /** Quarantine store for holding file data. */
  readonly quarantine: FileQuarantine;
  /** Hash verifier for integrity checks at each stage. */
  readonly hashVerifier: HashVerifier;
  /** Function to send data to a connection. */
  readonly send: SendFn;
  /** Optional audit logger. */
  readonly auditLogger?: AuditLogger;
  /** Session ID for audit log entries. */
  readonly sessionId?: string;
}

/** Request to submit a file into the transfer pipeline. */
export interface FileSubmission {
  /** Unique transfer ID for tracking. */
  readonly transferId: FileTransferId;
  /** Direction of the transfer. */
  readonly direction: FileTransferDirection;
  /** Sender identity (for manifest/offer generation). */
  readonly sender: SenderIdentity;
  /** Filename. */
  readonly filename: string;
  /** File size in bytes. */
  readonly sizeBytes: number;
  /** MIME type. */
  readonly mimeType: string;
  /** SHA-256 hash declared by the sender. */
  readonly declaredHash: string;
  /** Raw file data (encrypted bytes). */
  readonly data: Uint8Array;
  /** Purpose description. */
  readonly purpose: string;
  /** Project context (for manifest only). */
  readonly projectContext?: string;
  /** Related task ID (for offer only). */
  readonly taskId?: string;
  /** Connection ID of the recipient. */
  readonly recipientConnectionId: string;
}

/** Result of a file submission. */
export type FileSubmitResult =
  | { readonly status: 'submitted'; readonly transferId: FileTransferId; readonly manifestMessageId: MessageId }
  | { readonly status: 'hash_mismatch'; readonly expected: string; readonly actual: string }
  | { readonly status: 'quarantine_full' }
  | { readonly status: 'quarantine_duplicate'; readonly transferId: FileTransferId }
  | { readonly status: 'send_failed'; readonly transferId: FileTransferId };

/** Result of processing a file request (acceptance). */
export type FileRequestResult =
  | { readonly status: 'delivered'; readonly transferId: FileTransferId; readonly sizeBytes: number }
  | { readonly status: 'not_found'; readonly transferId: FileTransferId }
  | { readonly status: 'hash_mismatch_at_delivery'; readonly transferId: FileTransferId }
  | { readonly status: 'not_accepted'; readonly transferId: FileTransferId; readonly currentState: string }
  | { readonly status: 'send_failed'; readonly transferId: FileTransferId };

/** Result of rejecting a file transfer. */
export type FileRejectResult =
  | { readonly status: 'rejected'; readonly transferId: FileTransferId }
  | { readonly status: 'not_found'; readonly transferId: FileTransferId };

// ---------------------------------------------------------------------------
// Internal: Pending transfer tracking
// ---------------------------------------------------------------------------

interface PendingTransfer {
  readonly transferId: FileTransferId;
  readonly direction: FileTransferDirection;
  readonly manifestMessageId: MessageId;
  readonly senderConnectionId: string;
  readonly recipientConnectionId: string;
}

// ---------------------------------------------------------------------------
// FileTransferRouter
// ---------------------------------------------------------------------------

/**
 * Orchestrates the file transfer workflow between paired clients.
 *
 * Usage:
 *   1. Create: `const ftr = new FileTransferRouter(config)`
 *   2. Submit: `ftr.submitFile(submission)` — quarantines + notifies peer
 *   3. Request: `ftr.handleFileRequest(transferId, requesterId)` — releases file
 *   4. Reject: `ftr.handleFileReject(transferId)` — purges file
 */
export class FileTransferRouter {
  private readonly quarantine: FileQuarantine;
  private readonly hashVerifier: HashVerifier;
  private readonly sendFn: SendFn;
  private readonly auditLogger: AuditLogger | undefined;
  private readonly sessionId: string;

  /** Maps transferId → pending transfer metadata. */
  private readonly pending = new Map<FileTransferId, PendingTransfer>();

  constructor(config: FileTransferRouterConfig) {
    this.quarantine = config.quarantine;
    this.hashVerifier = config.hashVerifier;
    this.sendFn = config.send;
    this.auditLogger = config.auditLogger;
    this.sessionId = config.sessionId ?? 'file-transfer';
  }

  /** Number of active file transfers. */
  get activeTransferCount(): number {
    return this.pending.size;
  }

  /**
   * Submit a file into the transfer pipeline.
   *
   * Steps:
   *   1. Verify hash at submission (declared hash vs actual data hash)
   *   2. Quarantine the file
   *   3. Send metadata-only message to recipient (manifest or offer)
   *   4. Track as pending transfer
   *
   * The recipient connection ID must be provided — the router does not
   * look up peers. The caller (message router integration) resolves peers.
   */
  submitFile(submission: FileSubmission): FileSubmitResult {
    // Step 1: Verify hash at submission
    const hashCheck = this.hashVerifier.verifyAtSubmission(
      submission.data,
      submission.declaredHash,
      submission.transferId,
      submission.direction,
    );

    if (!hashCheck.valid) {
      return {
        status: 'hash_mismatch',
        expected: hashCheck.expected,
        actual: hashCheck.actual,
      };
    }

    // Step 2: Quarantine the file
    const manifestMessageId = randomUUID() as MessageId;

    const quarantineResult = this.quarantine.submit({
      transferId: submission.transferId,
      direction: submission.direction,
      filename: submission.filename,
      sizeBytes: submission.sizeBytes,
      mimeType: submission.mimeType,
      hashAtReceipt: submission.declaredHash,
      manifestMessageId,
      data: submission.data,
    });

    if (quarantineResult.status === 'full') {
      return { status: 'quarantine_full' };
    }
    if (quarantineResult.status === 'duplicate') {
      return { status: 'quarantine_duplicate', transferId: submission.transferId };
    }

    // Step 3: Send metadata-only notification to recipient
    const notificationEnvelope =
      submission.direction === 'human_to_ai'
        ? this.buildManifestEnvelope(submission, manifestMessageId)
        : this.buildOfferEnvelope(submission, manifestMessageId);

    const sent = this.sendFn(submission.recipientConnectionId, notificationEnvelope);
    if (!sent) {
      // Rollback quarantine
      this.quarantine.purge(submission.transferId);
      return { status: 'send_failed', transferId: submission.transferId };
    }

    // Step 4: Track as pending
    this.pending.set(submission.transferId, {
      transferId: submission.transferId,
      direction: submission.direction,
      manifestMessageId,
      senderConnectionId: '', // Not needed for routing — recipient is tracked
      recipientConnectionId: submission.recipientConnectionId,
    });

    // Update quarantine state to 'offered'
    this.quarantine.updateState(
      submission.transferId,
      'offered',
      'relay',
      `${submission.direction === 'human_to_ai' ? 'Manifest' : 'Offer'} sent to recipient`,
    );

    this.auditLog(AUDIT_EVENT_TYPES.FILE_MANIFEST, {
      transferId: submission.transferId,
      filename: submission.filename,
      direction: submission.direction,
      recipientConnectionId: submission.recipientConnectionId,
      manifestMessageId,
    });

    return { status: 'submitted', transferId: submission.transferId, manifestMessageId };
  }

  /**
   * Handle a file_request — recipient accepts and requests the file data.
   *
   * Steps:
   *   1. Look up pending transfer
   *   2. Accept in quarantine
   *   3. Verify hash at delivery
   *   4. Release and send file data to requester
   */
  handleFileRequest(transferId: FileTransferId, requesterConnectionId: string): FileRequestResult {
    const transfer = this.pending.get(transferId);
    if (!transfer) {
      return { status: 'not_found', transferId };
    }

    // Transition to 'accepted'
    const accepted = this.quarantine.updateState(
      transferId,
      'accepted',
      transfer.direction === 'human_to_ai' ? 'ai' : 'human',
      'Recipient requested file delivery',
    );

    if (!accepted) {
      return { status: 'not_found', transferId };
    }

    // Verify hash at delivery stage
    const deliveryCheck = this.hashVerifier.verifyAtDelivery(transferId);
    if (!deliveryCheck || !deliveryCheck.valid) {
      this.pending.delete(transferId);
      return { status: 'hash_mismatch_at_delivery', transferId };
    }

    // Release from quarantine
    const releaseResult = this.quarantine.release(transferId);
    if (releaseResult.status !== 'released') {
      this.pending.delete(transferId);
      return {
        status: 'not_accepted',
        transferId,
        currentState: releaseResult.status === 'wrong_state' ? releaseResult.currentState : 'unknown',
      };
    }

    // Send file data to requester (as base64 envelope)
    const fileDataEnvelope = this.buildFileDataEnvelope(
      transferId,
      releaseResult.data,
      releaseResult.entry.filename,
      releaseResult.entry.hashAtReceipt,
    );

    const sent = this.sendFn(requesterConnectionId, fileDataEnvelope);
    this.pending.delete(transferId);

    if (!sent) {
      return { status: 'send_failed', transferId };
    }

    this.auditLog(AUDIT_EVENT_TYPES.FILE_DELIVERED, {
      transferId,
      filename: releaseResult.entry.filename,
      direction: transfer.direction,
      sizeBytes: releaseResult.entry.sizeBytes,
      recipientConnectionId: requesterConnectionId,
    });

    return {
      status: 'delivered',
      transferId,
      sizeBytes: releaseResult.entry.sizeBytes,
    };
  }

  /**
   * Handle a file rejection — recipient declines the file.
   *
   * Purges the file from quarantine and cleans up tracking.
   */
  handleFileReject(transferId: FileTransferId): FileRejectResult {
    const transfer = this.pending.get(transferId);
    if (!transfer) {
      return { status: 'not_found', transferId };
    }

    this.quarantine.updateState(transferId, 'rejected', 'recipient', 'Recipient declined file');
    this.quarantine.purge(transferId);
    this.pending.delete(transferId);

    return { status: 'rejected', transferId };
  }

  /**
   * Get a pending transfer by ID.
   */
  getTransfer(transferId: FileTransferId): PendingTransfer | undefined {
    return this.pending.get(transferId);
  }

  /**
   * Clean up all pending transfers.
   */
  destroy(): void {
    this.pending.clear();
  }

  // -----------------------------------------------------------------------
  // Private: Envelope builders (metadata-only — NO file content)
  // -----------------------------------------------------------------------

  /**
   * Build a file_manifest EncryptedEnvelope (human→AI direction).
   * Contains ONLY metadata — no file content.
   */
  private buildManifestEnvelope(submission: FileSubmission, manifestMessageId: MessageId): string {
    const payload: FileManifestPayload = {
      transferId: submission.transferId,
      filename: submission.filename,
      sizeBytes: submission.sizeBytes,
      hash: submission.declaredHash,
      hashAlgorithm: 'sha256',
      mimeType: submission.mimeType,
      purpose: submission.purpose,
      projectContext: submission.projectContext ?? '',
    };

    return this.buildRelayEnvelope(manifestMessageId, MESSAGE_TYPES.FILE_MANIFEST, { ...payload });
  }

  /**
   * Build a file_offer EncryptedEnvelope (AI→human direction).
   * Contains ONLY metadata — no file content.
   */
  private buildOfferEnvelope(submission: FileSubmission, manifestMessageId: MessageId): string {
    const payload: FileOfferPayload = {
      transferId: submission.transferId,
      filename: submission.filename,
      sizeBytes: submission.sizeBytes,
      hash: submission.declaredHash,
      mimeType: submission.mimeType,
      purpose: submission.purpose,
      taskId: submission.taskId,
    };

    return this.buildRelayEnvelope(manifestMessageId, MESSAGE_TYPES.FILE_OFFER, { ...payload });
  }

  /**
   * Build a file data delivery envelope.
   *
   * This is the actual file content, sent only after explicit acceptance.
   * The data is base64-encoded as the encryptedPayload field.
   */
  private buildFileDataEnvelope(transferId: FileTransferId, data: Uint8Array, filename: string, hash: string): string {
    // File data is sent as an EncryptedEnvelope-like structure.
    // The relay wraps the raw file bytes in base64 for WebSocket transport.
    return JSON.stringify({
      id: randomUUID(),
      type: 'file_data',
      timestamp: new Date().toISOString(),
      sender: { id: 'relay', type: 'relay', displayName: 'Bastion Relay' },
      correlationId: transferId,
      version: PROTOCOL_VERSION,
      transferId,
      filename,
      hash,
      sizeBytes: data.length,
      fileData: Buffer.from(data).toString('base64'),
    });
  }

  /**
   * Build a relay-originated EncryptedEnvelope.
   *
   * The relay generates metadata-only messages as cleartext JSON envelopes
   * (not encrypted — these are relay-to-client control messages).
   */
  private buildRelayEnvelope(messageId: MessageId, type: string, payload: Record<string, unknown>): string {
    return JSON.stringify({
      id: messageId,
      type,
      timestamp: new Date().toISOString(),
      sender: { id: 'relay', type: 'relay', displayName: 'Bastion Relay' },
      correlationId: randomUUID(),
      version: PROTOCOL_VERSION,
      // Relay control messages carry payload in clear — they are not
      // E2E-encrypted since they originate from the relay itself.
      encryptedPayload: Buffer.from(JSON.stringify(payload)).toString('base64'),
      nonce: Buffer.from(randomUUID()).toString('base64'),
    });
  }

  // -----------------------------------------------------------------------
  // Private: Audit logging
  // -----------------------------------------------------------------------

  private auditLog(eventType: string, detail: Record<string, unknown>): void {
    if (this.auditLogger) {
      this.auditLogger.logFileTransfer(eventType, this.sessionId, {
        transferId: String(detail.transferId),
        ...detail,
      });
    }
  }
}
