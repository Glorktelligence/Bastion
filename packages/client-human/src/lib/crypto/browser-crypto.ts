// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Browser-compatible E2E crypto using tweetnacl (pure JavaScript).
 *
 * Interoperable with the AI client's libsodium-based crypto:
 *   - Key exchange: nacl.box.before() = libsodium crypto_box_beforenm()
 *     Both compute HSalsa20(X25519(sk, pk), [0...0])
 *   - Encryption: nacl.secretbox = libsodium crypto_secretbox_easy
 *     Both use XSalsa20-Poly1305 with 24-byte nonce
 *   - KDF ratchet: SHA-256 (SubtleCrypto) on both sides
 *
 * The human client (tweetnacl) and AI client (libsodium) produce
 * identical ciphertext. What one encrypts, the other decrypts.
 */

import nacl from 'tweetnacl';

// Base64 helpers — built-in browser APIs, zero dependencies
function encodeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function decodeBase64(str: string): Uint8Array {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * A peeked receive key that has NOT yet advanced the receive chain.
 * Caller MUST invoke commit() only after successful MAC verification.
 */
export interface PeekedReceiveKey {
  key: Uint8Array;
  counter: number;
  commit(): void;
}

export interface BrowserSessionCipher {
  nextSendKey(): { key: Uint8Array; counter: number };
  /**
   * @deprecated Use peekReceiveKey() — nextReceiveKey() advances the chain
   * BEFORE MAC verification, which causes permanent desync on a single
   * spurious MAC failure. Retained only for test backwards compatibility.
   */
  nextReceiveKey(): { key: Uint8Array; counter: number };
  /**
   * Derive the next receive key WITHOUT advancing the chain. Caller must
   * invoke commit() only after successful MAC verification.
   */
  peekReceiveKey(): PeekedReceiveKey;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Constants — must match AI client's constants
// ---------------------------------------------------------------------------

const KDF_CHAIN_STEP = new Uint8Array([0x01]);
const KDF_MESSAGE_KEY = new Uint8Array([0x02]);
const DIRECTIONAL_SEND = new TextEncoder().encode('bastion-e2e-send');
const DIRECTIONAL_RECV = new TextEncoder().encode('bastion-e2e-recv');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-512 truncated to 32 bytes — matches AI client's sha512_32(). */
function sha512_32(data: Uint8Array): Uint8Array {
  return nacl.hash(data).slice(0, 32);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Key exchange
// ---------------------------------------------------------------------------

/** Generate an X25519 keypair for E2E key exchange. */
export function generateKeyPair(): BrowserKeyPair {
  const kp = nacl.box.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

/**
 * Derive directional session keys from X25519 key exchange.
 *
 * Uses nacl.box.before() for shared secret (HSalsa20(X25519(sk, pk)))
 * then SHA-256 for directional key derivation.
 *
 * @param role - 'initiator' (human) or 'responder' (AI)
 */
export function deriveSessionKeys(
  role: 'initiator' | 'responder',
  ownKeyPair: BrowserKeyPair,
  peerPublicKey: Uint8Array,
): { sendKey: Uint8Array; receiveKey: Uint8Array } {
  // Compute shared secret: HSalsa20(X25519(mySecret, theirPublic), 0)
  const sharedSecret = nacl.box.before(peerPublicKey, ownKeyPair.secretKey);

  // Derive directional keys with SHA-256
  // Both sides compute the same hashes — the role determines which is send vs receive
  const keyA = sha512_32(concat(DIRECTIONAL_SEND, sharedSecret, ownKeyPair.publicKey, peerPublicKey));
  const keyB = sha512_32(concat(DIRECTIONAL_RECV, sharedSecret, ownKeyPair.publicKey, peerPublicKey));

  if (role === 'initiator') {
    return { sendKey: keyA, receiveKey: keyB };
  }
  // Responder swaps — initiator's send = responder's receive
  return { sendKey: keyB, receiveKey: keyA };
}

// ---------------------------------------------------------------------------
// KDF ratchet — must produce same keys as AI client
// ---------------------------------------------------------------------------

/**
 * Create a session cipher from derived session keys.
 * Manages separate send/receive KDF chains.
 */
export function createSessionCipher(sessionKeys: {
  sendKey: Uint8Array;
  receiveKey: Uint8Array;
}): BrowserSessionCipher {
  let sendChainKey = new Uint8Array(sessionKeys.sendKey);
  let sendCounter = 0;
  let receiveChainKey = new Uint8Array(sessionKeys.receiveKey);
  let receiveCounter = 0;
  let destroyed = false;

  // Queue for async ratchet results — nextSendKey/nextReceiveKey are sync
  // but SHA-256 is async. We pre-compute the first key synchronously using
  // a sync SHA-256 fallback, then switch to async.
  // Actually, we'll make them return promises resolved via a queue.

  return {
    nextSendKey(): { key: Uint8Array; counter: number } {
      if (destroyed) throw new Error('Cipher destroyed');
      const counter = sendCounter;
      // Synchronous KDF using tweetnacl's nacl.hash (SHA-512) truncated to 32 bytes
      // This avoids the async SubtleCrypto issue in a sync interface
      const msgHash = nacl.hash(concat(sendChainKey, KDF_MESSAGE_KEY));
      const chainHash = nacl.hash(concat(sendChainKey, KDF_CHAIN_STEP));
      const messageKey = msgHash.slice(0, 32);
      const nextChain = chainHash.slice(0, 32);
      sendChainKey.fill(0);
      sendChainKey = nextChain;
      sendCounter++;
      return { key: messageKey, counter };
    },

    nextReceiveKey(): { key: Uint8Array; counter: number } {
      if (destroyed) throw new Error('Cipher destroyed');
      const counter = receiveCounter;
      const msgHash = nacl.hash(concat(receiveChainKey, KDF_MESSAGE_KEY));
      const chainHash = nacl.hash(concat(receiveChainKey, KDF_CHAIN_STEP));
      const messageKey = msgHash.slice(0, 32);
      const nextChain = chainHash.slice(0, 32);
      receiveChainKey.fill(0);
      receiveChainKey = nextChain;
      receiveCounter++;
      return { key: messageKey, counter };
    },

    peekReceiveKey(): PeekedReceiveKey {
      if (destroyed) throw new Error('Cipher destroyed');
      const counter = receiveCounter;
      // Derive both the message key and the would-be-next chain key, but
      // do NOT mutate receiveChainKey or receiveCounter yet. The chain
      // advances only when commit() is invoked after MAC success.
      const msgHash = nacl.hash(concat(receiveChainKey, KDF_MESSAGE_KEY));
      const chainHash = nacl.hash(concat(receiveChainKey, KDF_CHAIN_STEP));
      const messageKey = msgHash.slice(0, 32);
      const nextChain = chainHash.slice(0, 32);

      let committed = false;
      const commit = (): void => {
        if (committed) return;
        if (destroyed) throw new Error('Cipher destroyed');
        receiveChainKey.fill(0);
        receiveChainKey = nextChain;
        receiveCounter++;
        committed = true;
      };

      return { key: messageKey, counter, commit };
    },

    destroy(): void {
      if (!destroyed) {
        sendChainKey.fill(0);
        receiveChainKey.fill(0);
        destroyed = true;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Encryption / Decryption — XSalsa20-Poly1305 (interoperable)
// ---------------------------------------------------------------------------

/**
 * Encrypt a payload string with the next ratchet key.
 * Returns base64 ciphertext and nonce.
 */
export function encryptPayload(
  payloadJson: string,
  cipher: BrowserSessionCipher,
): { encryptedPayload: string; nonce: string } {
  const { key } = cipher.nextSendKey();
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const messageBytes = new TextEncoder().encode(payloadJson);
  const ciphertext = nacl.secretbox(messageBytes, nonce, key);
  // Zeroize key
  key.fill(0);
  return {
    encryptedPayload: encodeBase64(ciphertext),
    nonce: encodeBase64(nonce),
  };
}

/**
 * Decrypt an encrypted payload with the next ratchet key.
 *
 * Uses the peek/commit pattern: the receive chain ONLY advances on
 * successful MAC verification. On MAC failure the chain is left at its
 * pre-decrypt position, so a single spurious/tampered message can never
 * permanently desync the chain with the peer.
 *
 * Returns the decrypted payload object, or null if decryption fails.
 */
export function decryptPayload(
  encryptedPayloadB64: string,
  nonceB64: string,
  cipher: BrowserSessionCipher,
): Record<string, unknown> | null {
  const peeked = cipher.peekReceiveKey();
  const ciphertext = decodeBase64(encryptedPayloadB64);
  const nonce = decodeBase64(nonceB64);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, peeked.key);
  peeked.key.fill(0);
  if (!plaintext) {
    // MAC verification failed — DO NOT commit. Chain stays at pre-peek.
    return null;
  }
  peeked.commit();
  const json = new TextDecoder().decode(plaintext);
  return JSON.parse(json);
}

// ---------------------------------------------------------------------------
// Base64 helpers for key exchange messages
// ---------------------------------------------------------------------------

export { encodeBase64, decodeBase64 };
