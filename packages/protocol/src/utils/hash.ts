// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * SHA-256 hashing utilities for integrity checks.
 *
 * Used by the serialisation layer to produce message integrity hashes,
 * and by the audit log to build the tamper-evident hash chain.
 */

import { createHash } from 'node:crypto';

/**
 * Compute the SHA-256 hash of the input, returned as a lowercase hex string.
 *
 * @param data — string or binary data to hash
 * @returns 64-character lowercase hex string
 */
export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute the SHA-256 hash of the input, returned as raw bytes.
 * Useful for chaining hashes in the audit log.
 *
 * @param data — string or binary data to hash
 * @returns 32-byte Uint8Array
 */
export function sha256Bytes(data: string | Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}
