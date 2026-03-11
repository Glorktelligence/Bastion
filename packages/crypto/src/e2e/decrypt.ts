// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Message envelope decryption for E2E zero-knowledge relay.
 *
 * Decrypts an EncryptedEnvelope back to a validated MessageEnvelope,
 * verifying both the XSalsa20-Poly1305 MAC (tamper detection) and
 * the SHA-256 integrity hash embedded in the wire format, then
 * checking that plaintext routing metadata matches the decrypted
 * original (relay tampering detection).
 */

import type { EncryptedEnvelope, MessageEnvelope } from '@bastion/protocol';
import { deserialise } from '@bastion/protocol';
import { ensureSodium } from '../sodium.js';
import type { SessionCipher } from './session-keys.js';
import { CryptoError } from './session-keys.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of decrypting an EncryptedEnvelope. */
export interface DecryptionResult {
  /** The fully validated original MessageEnvelope. */
  readonly envelope: MessageEnvelope;
  /** The verified SHA-256 integrity hash (`sha256:<hex>`). */
  readonly integrity: string;
  /** Message counter for ordering. */
  readonly counter: number;
}

// ---------------------------------------------------------------------------
// Metadata consistency fields
// ---------------------------------------------------------------------------

/** Fields that must match between the EncryptedEnvelope and decrypted original. */
const METADATA_FIELDS = ['id', 'type', 'timestamp', 'sender', 'correlationId', 'version'] as const;

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

/**
 * Decrypt an EncryptedEnvelope back to a validated MessageEnvelope.
 *
 * Flow:
 *   1. cipher.nextReceiveKey() → per-message key + counter
 *   2. Decode base64 nonce and ciphertext
 *   3. XSalsa20-Poly1305 authenticated decryption (throws on tamper)
 *   4. Zeroize message key
 *   5. Decode plaintext bytes to wire string, zeroize plaintext
 *   6. deserialise(wire) → verify SHA-256 integrity + Zod validation
 *   7. Verify metadata consistency (relay tampering detection)
 *   8. Return DecryptionResult
 *
 * @param encrypted — the EncryptedEnvelope received from the relay
 * @param cipher — the session's cipher (advances receive chain)
 * @returns DecryptionResult with the validated original envelope
 * @throws CryptoError if MAC verification fails, integrity check fails,
 *         Zod validation fails, or metadata is inconsistent
 */
export async function decryptEnvelope(encrypted: EncryptedEnvelope, cipher: SessionCipher): Promise<DecryptionResult> {
  const sodium = await ensureSodium();

  // 1. Get the next per-message key from the KDF ratchet
  const { key, counter } = cipher.nextReceiveKey();

  let wire: string;
  try {
    // 2. Decode base64 nonce and ciphertext
    const nonce = sodium.from_base64(encrypted.nonce);
    const ciphertext = sodium.from_base64(encrypted.encryptedPayload);

    // 3. Authenticated decryption — throws if MAC verification fails
    let plaintext: Uint8Array;
    try {
      plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
    } catch {
      throw new CryptoError('Decryption failed — ciphertext has been tampered with or wrong key');
    }

    // 5. Decode plaintext to wire string, then zeroize
    wire = new TextDecoder().decode(plaintext);
    sodium.memzero(plaintext);
  } finally {
    // 4. Zeroize message key — forward secrecy
    sodium.memzero(key);
  }

  // 6. Deserialise: verify SHA-256 integrity + Zod validation
  const result = deserialise(wire);
  if (!result.success) {
    const msgs = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new CryptoError(`Decrypted envelope failed validation: ${msgs}`);
  }

  // 7. Verify metadata consistency — detect relay tampering
  const envelope = result.envelope as MessageEnvelope & Record<string, unknown>;
  const enc = encrypted as unknown as Record<string, unknown>;

  for (const field of METADATA_FIELDS) {
    const original = envelope[field];
    const routing = enc[field];

    // Deep compare for sender (object) vs simple string compare
    const originalStr = typeof original === 'object' ? JSON.stringify(original) : String(original);
    const routingStr = typeof routing === 'object' ? JSON.stringify(routing) : String(routing);

    if (originalStr !== routingStr) {
      throw new CryptoError(
        `Metadata tampering detected: "${field}" in EncryptedEnvelope does not match decrypted original`,
      );
    }
  }

  return {
    envelope: result.envelope,
    integrity: result.integrity,
    counter,
  };
}
