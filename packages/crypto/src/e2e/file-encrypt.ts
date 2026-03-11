// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * File encryption for E2E zero-knowledge relay.
 *
 * Files are encrypted with the same XSalsa20-Poly1305 authenticated
 * encryption as message envelopes, using per-file keys from the
 * SessionCipher KDF ratchet. The relay only ever sees encrypted blobs.
 *
 * Internal wire format (before encryption):
 *   [4 bytes: header length as big-endian uint32]
 *   [N bytes: JSON metadata header]
 *   [remaining bytes: raw file content]
 *
 * The metadata header includes a SHA-256 hash of the plaintext file
 * content, verified on decryption. This hash also feeds into the
 * protocol's FileManifestPayload for quarantine verification.
 */

import { createHash } from 'node:crypto';
import { ensureSodium } from '../sodium.js';
import type { SessionCipher } from './session-keys.js';
import { CryptoError } from './session-keys.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata describing a file for encryption. */
export interface FileMetadata {
  /** Original filename (e.g. "report.pdf"). */
  readonly filename: string;
  /** MIME type (e.g. "application/pdf"). */
  readonly mimeType: string;
}

/** Result of encrypting a file. */
export interface EncryptedFileResult {
  /** The encrypted blob (header + file content, authenticated). */
  readonly ciphertext: Uint8Array;
  /** The 24-byte nonce used for encryption. */
  readonly nonce: Uint8Array;
  /** Message counter from the KDF ratchet. */
  readonly counter: number;
  /**
   * SHA-256 hash of the plaintext file content (`sha256:<hex>`).
   * Use this for FileManifestPayload.hash and quarantine verification.
   */
  readonly plaintextHash: string;
  /** Size of the original file in bytes. */
  readonly sizeBytes: number;
}

/** Internal JSON header embedded in the encrypted blob. */
export interface FileEncryptionHeader {
  readonly filename: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  /** SHA-256 hash of the plaintext file content (`sha256:<hex>`). */
  readonly plaintextHash: string;
}

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a file with E2E authenticated encryption.
 *
 * Flow:
 *   1. Compute SHA-256 hash of plaintext file data
 *   2. Build JSON metadata header (filename, size, MIME, hash)
 *   3. Assemble wire format: [4-byte header length][header JSON][file data]
 *   4. cipher.nextSendKey() → per-file key + counter
 *   5. Random 24-byte nonce
 *   6. XSalsa20-Poly1305 authenticated encryption
 *   7. Zeroize key and combined plaintext buffer
 *
 * @param data — raw file content as Uint8Array
 * @param metadata — filename and MIME type
 * @param cipher — the session's cipher (advances send chain)
 * @returns EncryptedFileResult with ciphertext, nonce, counter, and hash
 * @throws CryptoError if file is empty or cipher is destroyed
 */
export async function encryptFile(
  data: Uint8Array,
  metadata: FileMetadata,
  cipher: SessionCipher,
): Promise<EncryptedFileResult> {
  if (data.length === 0) {
    throw new CryptoError('Cannot encrypt empty file');
  }

  const sodium = await ensureSodium();

  // 1. Compute SHA-256 of plaintext file content
  const hashHex = createHash('sha256').update(data).digest('hex');
  const plaintextHash = `sha256:${hashHex}`;

  // 2. Build the metadata header
  const header: FileEncryptionHeader = {
    filename: metadata.filename,
    sizeBytes: data.length,
    mimeType: metadata.mimeType,
    plaintextHash,
  };
  const headerJson = JSON.stringify(header);
  const headerBytes = new TextEncoder().encode(headerJson);

  if (headerBytes.length > 0xffffffff) {
    throw new CryptoError('File metadata header exceeds maximum size');
  }

  // 3. Assemble: [4-byte header length (big-endian)][header][file data]
  const combined = new Uint8Array(4 + headerBytes.length + data.length);
  const view = new DataView(combined.buffer, combined.byteOffset, combined.byteLength);
  view.setUint32(0, headerBytes.length, false); // big-endian
  combined.set(headerBytes, 4);
  combined.set(data, 4 + headerBytes.length);

  // 4. Get the next per-file key from the KDF ratchet
  const { key, counter } = cipher.nextSendKey();

  try {
    // 5. Random 24-byte nonce
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);

    // 6. XSalsa20-Poly1305 authenticated encryption
    const ciphertext = sodium.crypto_secretbox_easy(combined, nonce, key);

    return {
      ciphertext,
      nonce,
      counter,
      plaintextHash,
      sizeBytes: data.length,
    };
  } finally {
    // 7. Zeroize sensitive material
    sodium.memzero(key);
    sodium.memzero(combined);
  }
}
