// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * File decryption for E2E zero-knowledge relay.
 *
 * Decrypts an encrypted file blob, extracts the metadata header,
 * and verifies the SHA-256 hash of the decrypted file content.
 *
 * Verification layers:
 *   1. XSalsa20-Poly1305 MAC — detects any ciphertext tampering
 *   2. SHA-256 hash — verifies file content integrity against header
 *   3. Size check — ensures declared size matches actual data length
 *
 * Optionally verifies metadata consistency against expected values
 * (e.g. from a previously received FileManifestPayload).
 */

import { createHash } from 'node:crypto';
import { ensureSodium } from '../sodium.js';
import type { FileEncryptionHeader, FileMetadata } from './file-encrypt.js';
import type { SessionCipher } from './session-keys.js';
import { CryptoError } from './session-keys.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of decrypting a file. */
export interface DecryptedFileResult {
  /** The decrypted raw file content. */
  readonly data: Uint8Array;
  /** Verified metadata from the encryption header. */
  readonly metadata: FileMetadata;
  /** Verified SHA-256 hash of the file content (`sha256:<hex>`). */
  readonly plaintextHash: string;
  /** Original file size in bytes. */
  readonly sizeBytes: number;
  /** Message counter from the KDF ratchet. */
  readonly counter: number;
}

// ---------------------------------------------------------------------------
// Minimum combined plaintext size
// ---------------------------------------------------------------------------

/** 4 bytes header length + at least 2 bytes header ("{}") + 1 byte file data. */
const MIN_PLAINTEXT_SIZE = 7;

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

/**
 * Decrypt an encrypted file blob and verify its integrity.
 *
 * Flow:
 *   1. cipher.nextReceiveKey() → per-file key + counter
 *   2. XSalsa20-Poly1305 authenticated decryption (throws on tamper)
 *   3. Zeroize key
 *   4. Extract header length (first 4 bytes, big-endian)
 *   5. Parse JSON metadata header
 *   6. Extract file data (remaining bytes)
 *   7. Verify size matches header
 *   8. Compute and verify SHA-256 of file data against header hash
 *   9. If expectedMetadata provided, verify consistency
 *  10. Return DecryptedFileResult
 *
 * @param ciphertext — the encrypted blob from encryptFile()
 * @param nonce — the 24-byte nonce from encryptFile()
 * @param cipher — the session's cipher (advances receive chain)
 * @param expectedMetadata — optional metadata to verify against (e.g. from FileManifestPayload)
 * @returns DecryptedFileResult with verified file data and metadata
 * @throws CryptoError on MAC failure, hash mismatch, size mismatch,
 *         corrupted header, or metadata inconsistency
 */
export async function decryptFile(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  cipher: SessionCipher,
  expectedMetadata?: FileMetadata,
): Promise<DecryptedFileResult> {
  const sodium = await ensureSodium();

  // 1. Get the next per-file key from the KDF ratchet
  const { key, counter } = cipher.nextReceiveKey();

  let combined: Uint8Array;
  try {
    // 2. Authenticated decryption — throws if MAC verification fails
    try {
      combined = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
    } catch {
      throw new CryptoError('File decryption failed — ciphertext has been tampered with or wrong key');
    }
  } finally {
    // 3. Zeroize key — forward secrecy
    sodium.memzero(key);
  }

  try {
    // 4. Validate minimum size and extract header length
    if (combined.length < MIN_PLAINTEXT_SIZE) {
      throw new CryptoError('Decrypted file blob is too small to contain header and data');
    }

    const view = new DataView(combined.buffer, combined.byteOffset, combined.byteLength);
    const headerLength = view.getUint32(0, false); // big-endian

    if (headerLength === 0) {
      throw new CryptoError('File metadata header length is zero');
    }

    if (4 + headerLength >= combined.length) {
      throw new CryptoError('File metadata header length exceeds available data');
    }

    // 5. Parse the JSON metadata header
    const headerBytes = combined.subarray(4, 4 + headerLength);
    let header: FileEncryptionHeader;
    try {
      const headerJson = new TextDecoder().decode(headerBytes);
      header = JSON.parse(headerJson) as FileEncryptionHeader;
    } catch {
      throw new CryptoError('Failed to parse file metadata header — corrupted data');
    }

    // Validate header fields exist
    if (
      typeof header.filename !== 'string' ||
      typeof header.sizeBytes !== 'number' ||
      typeof header.mimeType !== 'string' ||
      typeof header.plaintextHash !== 'string'
    ) {
      throw new CryptoError('File metadata header has missing or invalid fields');
    }

    // 6. Extract file data
    const fileData = combined.subarray(4 + headerLength);

    // 7. Verify size matches header
    if (fileData.length !== header.sizeBytes) {
      throw new CryptoError(`File size mismatch: header declares ${header.sizeBytes} bytes, got ${fileData.length}`);
    }

    // 8. Compute SHA-256 and verify against header hash
    const hashHex = createHash('sha256').update(fileData).digest('hex');
    const computedHash = `sha256:${hashHex}`;

    if (computedHash !== header.plaintextHash) {
      throw new CryptoError('File integrity check failed: SHA-256 hash does not match header');
    }

    // 9. Verify against expected metadata if provided
    if (expectedMetadata) {
      if (expectedMetadata.filename !== header.filename) {
        throw new CryptoError(
          `Metadata mismatch: expected filename "${expectedMetadata.filename}", got "${header.filename}"`,
        );
      }
      if (expectedMetadata.mimeType !== header.mimeType) {
        throw new CryptoError(
          `Metadata mismatch: expected MIME type "${expectedMetadata.mimeType}", got "${header.mimeType}"`,
        );
      }
    }

    // 10. Copy file data out before zeroizing combined buffer
    const result = new Uint8Array(fileData.length);
    result.set(fileData);

    return {
      data: result,
      metadata: {
        filename: header.filename,
        mimeType: header.mimeType,
      },
      plaintextHash: header.plaintextHash,
      sizeBytes: header.sizeBytes,
      counter,
    };
  } finally {
    // Zeroize the combined plaintext buffer
    sodium.memzero(combined);
  }
}
