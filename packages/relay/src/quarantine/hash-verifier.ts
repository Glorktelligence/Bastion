// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Hash verification at every file transfer stage.
 *
 * SHA-256 integrity is verified at three points:
 *   1. Submission — hash of received data must match sender's declared hash
 *   2. Quarantine — hash is re-verified while file sits in quarantine
 *   3. Delivery — hash is verified one final time before releasing to recipient
 *
 * Any mismatch at any stage rejects the transfer, logs an alert via the
 * audit logger, and updates the quarantine entry state to 'hash_mismatch'.
 */

import type { FileTransferDirection, FileTransferId } from '@bastion/protocol';
import { sha256 } from '@bastion/protocol';
import type { AuditLogger } from '../audit/audit-logger.js';
import { AUDIT_EVENT_TYPES } from '../audit/audit-logger.js';
import type { FileQuarantine } from './file-quarantine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a hash verification check. */
export type HashVerificationResult =
  | { readonly valid: true; readonly hash: string }
  | { readonly valid: false; readonly expected: string; readonly actual: string; readonly stage: VerificationStage };

/** The three stages where hashes are verified. */
export type VerificationStage = 'submission' | 'quarantine' | 'delivery';

/** Configuration for the hash verifier. */
export interface HashVerifierConfig {
  /** The quarantine store to update on mismatch. */
  readonly quarantine: FileQuarantine;
  /** Optional audit logger for hash mismatch alerts. */
  readonly auditLogger?: AuditLogger;
  /** Session ID for audit log entries. */
  readonly sessionId?: string;
}

// ---------------------------------------------------------------------------
// HashVerifier
// ---------------------------------------------------------------------------

/**
 * Stateless hash verifier for file transfer integrity.
 *
 * All methods are synchronous — SHA-256 is computed over the raw file
 * data using node:crypto (via @bastion/protocol's sha256 helper).
 */
export class HashVerifier {
  private readonly quarantine: FileQuarantine;
  private readonly auditLogger: AuditLogger | undefined;
  private readonly sessionId: string;

  constructor(config: HashVerifierConfig) {
    this.quarantine = config.quarantine;
    this.auditLogger = config.auditLogger;
    this.sessionId = config.sessionId ?? 'hash-verifier';
  }

  /**
   * Verify hash at submission — before the file enters quarantine.
   *
   * Computes SHA-256 of the raw data and compares it to the declared hash
   * from the file manifest. If mismatched, logs an alert.
   *
   * @param data — the raw file bytes
   * @param declaredHash — the hash declared by the sender (from manifest)
   * @param transferId — for audit logging
   * @param direction — for audit logging
   * @returns verification result
   */
  verifyAtSubmission(
    data: Uint8Array,
    declaredHash: string,
    transferId: FileTransferId,
    direction: FileTransferDirection,
  ): HashVerificationResult {
    const actualHash = sha256(data);

    if (actualHash === declaredHash) {
      return { valid: true, hash: actualHash };
    }

    this.logMismatch('submission', transferId, declaredHash, actualHash, direction);

    return {
      valid: false,
      expected: declaredHash,
      actual: actualHash,
      stage: 'submission',
    };
  }

  /**
   * Verify hash while file is in quarantine — detect tampering at rest.
   *
   * Re-computes SHA-256 of the stored data and compares it to the hash
   * recorded at receipt. If mismatched, marks the entry as 'hash_mismatch'.
   *
   * @param transferId — the quarantined file to verify
   * @returns verification result, or undefined if the file is not in quarantine
   */
  verifyInQuarantine(transferId: FileTransferId): HashVerificationResult | undefined {
    const entry = this.quarantine.get(transferId);
    const data = this.quarantine.getData(transferId);

    if (!entry || !data) return undefined;

    const actualHash = sha256(data);

    if (actualHash === entry.hashAtReceipt) {
      return { valid: true, hash: actualHash };
    }

    // Mark the quarantine entry as hash_mismatch
    this.quarantine.updateState(transferId, 'hash_mismatch', 'hash-verifier', 'Hash mismatch detected in quarantine');

    this.logMismatch('quarantine', transferId, entry.hashAtReceipt, actualHash, entry.direction);

    return {
      valid: false,
      expected: entry.hashAtReceipt,
      actual: actualHash,
      stage: 'quarantine',
    };
  }

  /**
   * Verify hash at delivery — final check before releasing to recipient.
   *
   * Re-computes SHA-256 of the stored data and compares it to the hash
   * recorded at receipt. If mismatched, marks the entry as 'hash_mismatch'
   * and blocks release.
   *
   * @param transferId — the quarantined file to verify
   * @returns verification result, or undefined if the file is not in quarantine
   */
  verifyAtDelivery(transferId: FileTransferId): HashVerificationResult | undefined {
    const entry = this.quarantine.get(transferId);
    const data = this.quarantine.getData(transferId);

    if (!entry || !data) return undefined;

    const actualHash = sha256(data);

    if (actualHash === entry.hashAtReceipt) {
      // Record the delivery-side hash verification in the custody chain
      this.quarantine.updateState(
        transferId,
        entry.state, // don't change the state — just record the verification
        'hash-verifier',
        'Hash verified at delivery stage',
      );

      return { valid: true, hash: actualHash };
    }

    // Mark as hash_mismatch and block release
    this.quarantine.updateState(transferId, 'hash_mismatch', 'hash-verifier', 'Hash mismatch at delivery stage');

    this.logMismatch('delivery', transferId, entry.hashAtReceipt, actualHash, entry.direction);

    return {
      valid: false,
      expected: entry.hashAtReceipt,
      actual: actualHash,
      stage: 'delivery',
    };
  }

  /**
   * Compute SHA-256 hash of raw data.
   *
   * Convenience wrapper — callers can also use @bastion/protocol sha256 directly.
   */
  hash(data: Uint8Array): string {
    return sha256(data);
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private logMismatch(
    stage: VerificationStage,
    transferId: FileTransferId,
    expected: string,
    actual: string,
    direction: FileTransferDirection,
  ): void {
    if (this.auditLogger) {
      this.auditLogger.logFileTransfer(AUDIT_EVENT_TYPES.FILE_REJECTED, this.sessionId, {
        transferId,
        direction,
        reason: 'hash_mismatch',
        stage,
        expectedHash: expected,
        actualHash: actual,
      });
    }
  }
}
