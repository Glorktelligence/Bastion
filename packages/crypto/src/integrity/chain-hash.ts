// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Tamper-evident audit log hash chain.
 *
 * Each audit entry is hashed together with the previous entry's hash,
 * forming an append-only chain. If any entry is modified, reordered,
 * or deleted, the chain breaks on verification.
 *
 * Hash computation:
 *   hash_n = SHA-256( hash_{n-1} || canonical(entry_n) )
 *
 * where `||` is string concatenation and `canonical()` produces
 * deterministic JSON (sorted keys, no whitespace) via @bastion/protocol.
 *
 * The genesis entry (index 0) uses a known seed constant as its
 * "previous hash", ensuring the chain is anchored to a verifiable
 * starting point.
 *
 * This module is intentionally pure and synchronous — it uses node:crypto
 * for SHA-256 (same as @bastion/protocol's hash.ts) and does not depend
 * on libsodium or any async initialisation.
 */

import { canonicalise, sha256 } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Known seed for the genesis entry's "previous hash".
 * This anchors the chain to a verifiable starting point.
 * The value is the SHA-256 of the string "BASTION_AUDIT_GENESIS_v1".
 */
export const GENESIS_SEED: string = sha256('BASTION_AUDIT_GENESIS_v1');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An entry in the audit log before chain hashing. */
export interface AuditEntry {
  /** Monotonically increasing index (0-based). */
  readonly index: number;
  /** ISO 8601 timestamp of the event. */
  readonly timestamp: string;
  /** Type of audit event (e.g. "message_relayed", "session_started"). */
  readonly eventType: string;
  /** Session this event belongs to. */
  readonly sessionId: string;
  /** Arbitrary structured detail about the event. */
  readonly detail: Record<string, unknown>;
}

/** A chain-hashed audit entry, ready for storage. */
export interface HashedAuditEntry extends AuditEntry {
  /** SHA-256 hash linking this entry to the previous one. */
  readonly chainHash: string;
}

/** Result of verifying a chain or range. */
export interface ChainVerificationResult {
  readonly valid: boolean;
  /** If invalid, the index where the chain broke. */
  readonly brokenAtIndex?: number;
  /** Human-readable description of the failure. */
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Compute the chain hash for an entry given the previous hash.
 *
 * hash = SHA-256( previousHash || canonical(entry) )
 *
 * The entry is canonicalised WITHOUT the chainHash field (it hasn't
 * been computed yet). This ensures the hash covers all entry content
 * in a deterministic order.
 *
 * @param entry — the audit entry (index, timestamp, eventType, sessionId, detail)
 * @param previousHash — the chainHash of the preceding entry, or GENESIS_SEED for index 0
 * @returns the computed chain hash as a hex string
 */
export function computeChainHash(entry: AuditEntry, previousHash: string): string {
  const canonical = canonicalise(entry);
  return sha256(previousHash + canonical);
}

/**
 * Append a new entry to the chain, computing its chain hash.
 *
 * @param entry — the audit entry to append (index must equal chain length)
 * @param chain — the existing chain (may be empty for genesis)
 * @returns the new HashedAuditEntry with its chainHash
 * @throws Error if the entry index doesn't match the expected next index
 */
export function appendEntry(entry: AuditEntry, chain: readonly HashedAuditEntry[]): HashedAuditEntry {
  const expectedIndex = chain.length;
  if (entry.index !== expectedIndex) {
    throw new ChainError(`Index mismatch: expected ${expectedIndex}, got ${entry.index}`);
  }

  const previousHash = chain.length === 0 ? GENESIS_SEED : chain[chain.length - 1]!.chainHash;

  const chainHash = computeChainHash(entry, previousHash);

  return { ...entry, chainHash };
}

/**
 * Verify the full hash chain from genesis to the last entry.
 *
 * Checks:
 *   1. Indices are sequential starting from 0
 *   2. Genesis entry's hash matches GENESIS_SEED as previous
 *   3. Every subsequent entry's hash matches recomputation from predecessor
 *
 * @param chain — the full ordered chain to verify
 * @returns ChainVerificationResult
 */
export function verifyChain(chain: readonly HashedAuditEntry[]): ChainVerificationResult {
  if (chain.length === 0) {
    return { valid: true };
  }

  return verifyRange(chain, 0, chain.length - 1);
}

/**
 * Verify a contiguous range of the chain [startIndex, endIndex] inclusive.
 *
 * For startIndex === 0, the genesis seed is used as the initial previous hash.
 * For startIndex > 0, the entry at startIndex is trusted as the anchor and
 * verification begins from startIndex + 1.
 *
 * This is useful for incremental verification — verify only the entries
 * added since the last full verification.
 *
 * @param chain — the full ordered chain (or at least entries covering the range)
 * @param startIndex — first index to verify (inclusive)
 * @param endIndex — last index to verify (inclusive)
 * @returns ChainVerificationResult
 * @throws ChainError if indices are out of bounds
 */
export function verifyRange(
  chain: readonly HashedAuditEntry[],
  startIndex: number,
  endIndex: number,
): ChainVerificationResult {
  if (startIndex < 0 || endIndex < startIndex || endIndex >= chain.length) {
    throw new ChainError(`Invalid range [${startIndex}, ${endIndex}] for chain of length ${chain.length}`);
  }

  for (let i = startIndex; i <= endIndex; i++) {
    const entry = chain[i]!; // bounds validated above

    // Check index continuity
    if (entry.index !== i) {
      return {
        valid: false,
        brokenAtIndex: i,
        error: `Index mismatch at position ${i}: expected index ${i}, found ${entry.index}`,
      };
    }

    // Determine previous hash
    const previousHash = i === 0 ? GENESIS_SEED : chain[i - 1]!.chainHash; // i > 0 and bounds validated

    // Recompute and compare
    const { chainHash: _stored, ...entryWithoutHash } = entry;
    const expected = computeChainHash(entryWithoutHash, previousHash);

    if (entry.chainHash !== expected) {
      return {
        valid: false,
        brokenAtIndex: i,
        error: `Chain hash mismatch at index ${i}: stored hash does not match recomputation`,
      };
    }
  }

  return { valid: true };
}

/**
 * Verify that a single entry's chain hash is consistent with a known
 * previous hash. Useful for validating a newly received entry without
 * re-verifying the entire chain.
 *
 * @param entry — the hashed entry to verify
 * @param previousHash — the expected previous chain hash (or GENESIS_SEED for index 0)
 * @returns true if the entry's chainHash matches recomputation
 */
export function verifySingleEntry(entry: HashedAuditEntry, previousHash: string): boolean {
  const { chainHash: _stored, ...entryWithoutHash } = entry;
  const expected = computeChainHash(entryWithoutHash, previousHash);
  return entry.chainHash === expected;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainError';
  }
}
