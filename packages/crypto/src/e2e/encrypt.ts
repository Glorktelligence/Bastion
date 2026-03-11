// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Message envelope encryption for E2E zero-knowledge relay.
 *
 * Encrypts a full MessageEnvelope into an EncryptedEnvelope that the
 * relay can route (using plaintext metadata) but cannot read (the
 * serialised envelope + integrity hash are encrypted).
 *
 * Encryption scheme: XSalsa20-Poly1305 (authenticated encryption)
 * with per-message keys from the SessionCipher KDF ratchet and
 * random 24-byte nonces.
 */

import type { EncryptedEnvelope, MessageEnvelope } from '@bastion/protocol';
import { serialise } from '@bastion/protocol';
import { ensureSodium } from '../sodium.js';
import type { SessionCipher } from './session-keys.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of encrypting a MessageEnvelope. */
export interface EncryptionResult {
  /** The encrypted envelope, safe for relay transmission. */
  readonly encrypted: EncryptedEnvelope;
  /** Message counter for ordering. */
  readonly counter: number;
}

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a MessageEnvelope into an EncryptedEnvelope.
 *
 * Flow:
 *   1. serialise(envelope) → wire string (includes SHA-256 _integrity)
 *   2. cipher.nextSendKey() → per-message key + counter
 *   3. Random 24-byte nonce
 *   4. XSalsa20-Poly1305 authenticated encryption
 *   5. Zeroize message key
 *   6. Return EncryptedEnvelope with plaintext metadata + encrypted blob
 *
 * The relay sees id, type, timestamp, sender, correlationId, version
 * for routing/audit but cannot decrypt the payload.
 *
 * @param envelope — a valid MessageEnvelope (validated by serialise)
 * @param cipher — the session's cipher (advances send chain)
 * @returns EncryptionResult with the EncryptedEnvelope and counter
 * @throws SerialisationError if the envelope fails schema validation
 * @throws CryptoError if the cipher has been destroyed
 */
export async function encryptEnvelope(envelope: MessageEnvelope, cipher: SessionCipher): Promise<EncryptionResult> {
  const sodium = await ensureSodium();

  // 1. Serialise the full envelope (validates + adds _integrity hash)
  const { wire } = serialise(envelope);

  // 2. Get the next per-message key from the KDF ratchet
  const { key, counter } = cipher.nextSendKey();

  try {
    // 3. Generate a random 24-byte nonce
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);

    // 4. Encrypt the wire string
    const plaintext = new TextEncoder().encode(wire);
    const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);

    // 5. Build the EncryptedEnvelope with plaintext metadata for routing
    const encrypted: EncryptedEnvelope = {
      id: envelope.id,
      type: envelope.type,
      timestamp: envelope.timestamp,
      sender: envelope.sender,
      correlationId: envelope.correlationId,
      version: envelope.version,
      encryptedPayload: sodium.to_base64(ciphertext),
      nonce: sodium.to_base64(nonce),
    };

    return { encrypted, counter };
  } finally {
    // 6. Zeroize message key — forward secrecy
    sodium.memzero(key);
  }
}
