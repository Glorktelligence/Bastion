// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * E2E session key exchange — adapted Double Ratchet for human-AI context.
 *
 * The Signal Protocol's Double Ratchet combines:
 *   1. DH ratchet (new DH key pair each turn for "break-in recovery")
 *   2. Symmetric-key ratchet (KDF chain for per-message forward secrecy)
 *
 * Bastion's adaptation for the human-AI context:
 *   - X25519 key exchange via libsodium's crypto_kx for the initial shared
 *     secret. The relay forwards public keys but never sees secret keys or
 *     derived session keys (zero-knowledge relay).
 *   - Symmetric KDF chain ratchet using BLAKE2b for per-message forward
 *     secrecy. Each message key is derived from the chain state, and the
 *     chain advances irreversibly — compromising the current chain key
 *     does not reveal past message keys.
 *   - No per-message DH ratchet. Human-AI sessions have longer messages
 *     and lower frequency than IM. The per-session DH exchange provides
 *     sufficient forward secrecy. The symmetric ratchet prevents key
 *     reuse. This can be enhanced to include DH ratcheting in a future
 *     protocol version if needed.
 *
 * Roles:
 *   - "initiator" (human client) → crypto_kx client role
 *   - "responder" (AI client) → crypto_kx server role
 *
 * Key exchange flow:
 *   1. Both parties call generateKeyPair()
 *   2. Public keys are exchanged through the relay (relay sees only public keys)
 *   3. Both parties call deriveSessionKeys() with their role, own keypair,
 *      and peer's public key
 *   4. Both get matching send/receive keys (human.send = AI.receive, etc.)
 *   5. A SessionCipher is created from the session keys
 *   6. Each message uses a unique key derived from the KDF chain
 */

import { type SodiumLibrary, ensureSodium } from '../sodium.js';

// ---------------------------------------------------------------------------
// KDF chain constants
// ---------------------------------------------------------------------------

/** Derive the next chain key (ratchet forward). */
const KDF_CHAIN_STEP = new Uint8Array([0x01]);

/** Derive a message key from the current chain key. */
const KDF_MESSAGE_KEY = new Uint8Array([0x02]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Role in the key exchange. Human = initiator, AI = responder. */
export type KeyExchangeRole = 'initiator' | 'responder';

/** An X25519 key pair for the key exchange. */
export interface CryptoKeyPair {
  /** 32-byte X25519 public key. Safe to transmit. */
  readonly publicKey: Uint8Array;
  /** 32-byte X25519 secret key. NEVER transmit or log this. */
  readonly secretKey: Uint8Array;
}

/** Session keys derived from the X25519 key exchange. */
export interface DerivedSessionKeys {
  /** Initial chain key for encrypting outbound messages. */
  readonly sendKey: Uint8Array;
  /** Initial chain key for decrypting inbound messages. */
  readonly receiveKey: Uint8Array;
}

/** A message key and its associated counter. */
export interface MessageKeyResult {
  /** 32-byte key for XSalsa20-Poly1305 encryption/decryption. */
  readonly key: Uint8Array;
  /** The message counter this key corresponds to. */
  readonly counter: number;
}

/**
 * Serialisable session cipher state for persistence in the key store.
 * Uses base64 strings instead of Uint8Array for JSON safety.
 */
export interface SerialisedCipherState {
  readonly sessionId: string;
  readonly sendChainKey: string;
  readonly sendCounter: number;
  readonly receiveChainKey: string;
  readonly receiveCounter: number;
}

// ---------------------------------------------------------------------------
// Key generation & exchange
// ---------------------------------------------------------------------------

/**
 * Generate an X25519 key pair for the key exchange handshake.
 *
 * The public key should be sent to the relay for forwarding to the peer.
 * The secret key must NEVER leave the local device.
 */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  const sodium = await ensureSodium();
  const kp = sodium.crypto_kx_keypair();
  return {
    publicKey: kp.publicKey,
    secretKey: kp.privateKey,
  };
}

/**
 * Derive session send/receive keys from own key pair and peer's public key.
 *
 * Uses libsodium's crypto_kx which performs X25519 Diffie-Hellman and
 * derives two directional keys. The relay never sees the secret keys or
 * derived session keys.
 *
 * @param role — 'initiator' (human) or 'responder' (AI)
 * @param ownKeyPair — this party's key pair from generateKeyPair()
 * @param peerPublicKey — the other party's public key (received via relay)
 * @returns DerivedSessionKeys with matching send/receive keys
 */
export async function deriveSessionKeys(
  role: KeyExchangeRole,
  ownKeyPair: CryptoKeyPair,
  peerPublicKey: Uint8Array,
): Promise<DerivedSessionKeys> {
  const sodium = await ensureSodium();

  if (peerPublicKey.length !== sodium.crypto_kx_PUBLICKEYBYTES) {
    throw new CryptoError(
      `Invalid peer public key length: expected ${sodium.crypto_kx_PUBLICKEYBYTES}, got ${peerPublicKey.length}`,
    );
  }

  let keys;
  if (role === 'initiator') {
    keys = sodium.crypto_kx_client_session_keys(ownKeyPair.publicKey, ownKeyPair.secretKey, peerPublicKey);
  } else {
    keys = sodium.crypto_kx_server_session_keys(ownKeyPair.publicKey, ownKeyPair.secretKey, peerPublicKey);
  }

  return {
    sendKey: keys.sharedTx,
    receiveKey: keys.sharedRx,
  };
}

// ---------------------------------------------------------------------------
// Symmetric KDF chain ratchet
// ---------------------------------------------------------------------------

/**
 * Perform one ratchet step: derive the message key and next chain key
 * from the current chain key, then zeroize the current chain key.
 *
 * Chain evolution:
 *   chainKey_n → messageKey_n  (for encrypting/decrypting message n)
 *   chainKey_n → chainKey_{n+1} (irreversible advance)
 *   chainKey_n is zeroized after use (forward secrecy)
 *
 * Uses BLAKE2b keyed hashing:
 *   messageKey = BLAKE2b(key=chainKey, message=0x02)
 *   nextChainKey = BLAKE2b(key=chainKey, message=0x01)
 */
function ratchetStep(
  sodium: SodiumLibrary,
  chainKey: Uint8Array,
): {
  messageKey: Uint8Array;
  nextChainKey: Uint8Array;
} {
  const messageKey = sodium.crypto_generichash(32, KDF_MESSAGE_KEY, chainKey);
  const nextChainKey = sodium.crypto_generichash(32, KDF_CHAIN_STEP, chainKey);
  // Zeroize the consumed chain key — forward secrecy
  sodium.memzero(chainKey);
  return { messageKey, nextChainKey };
}

// ---------------------------------------------------------------------------
// SessionCipher
// ---------------------------------------------------------------------------

/**
 * A session cipher managing the symmetric ratchet state for a single
 * E2E session between a human and AI client.
 *
 * Usage:
 *   1. Create with createSessionCipher() after key exchange
 *   2. Call nextSendKey() before encrypting each outbound message
 *   3. Call nextReceiveKey() before decrypting each inbound message
 *   4. Call exportState() to persist state to the key store
 *   5. Call destroy() when the session ends to zeroize memory
 *
 * The cipher maintains separate send and receive KDF chains. Each chain
 * advances irreversibly on every key derivation, providing forward secrecy.
 * WebSocket guarantees message ordering, so out-of-order delivery is not
 * handled (the relay replays messages in order during reconnection).
 *
 * IMPORTANT: ensureSodium() must be awaited before constructing or using
 * a SessionCipher. The async functions (generateKeyPair, deriveSessionKeys,
 * createSessionCipher) handle this automatically. SessionCipher.restore()
 * requires that sodium was already initialised by a prior async call.
 */
export class SessionCipher {
  private _sodium: SodiumLibrary;
  private _sessionId: string;
  private _sendChainKey: Uint8Array;
  private _sendCounter: number;
  private _receiveChainKey: Uint8Array;
  private _receiveCounter: number;
  private _destroyed: boolean;

  /** @internal Use createSessionCipher() or SessionCipher.restore(). */
  constructor(
    sodium: SodiumLibrary,
    sessionId: string,
    sendChainKey: Uint8Array,
    sendCounter: number,
    receiveChainKey: Uint8Array,
    receiveCounter: number,
  ) {
    this._sodium = sodium;
    this._sessionId = sessionId;
    this._sendChainKey = sendChainKey;
    this._sendCounter = sendCounter;
    this._receiveChainKey = receiveChainKey;
    this._receiveCounter = receiveCounter;
    this._destroyed = false;
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get sendCounter(): number {
    return this._sendCounter;
  }

  get receiveCounter(): number {
    return this._receiveCounter;
  }

  /**
   * Derive the next message key for encrypting an outbound message.
   * Advances the send chain irreversibly (forward secrecy).
   *
   * @returns MessageKeyResult with the 32-byte key and message counter
   * @throws CryptoError if the cipher has been destroyed
   */
  nextSendKey(): MessageKeyResult {
    this.assertNotDestroyed();
    const counter = this._sendCounter;
    const { messageKey, nextChainKey } = ratchetStep(this._sodium, this._sendChainKey);
    this._sendChainKey = nextChainKey;
    this._sendCounter++;
    return { key: messageKey, counter };
  }

  /**
   * Derive the next message key for decrypting an inbound message.
   * Advances the receive chain irreversibly (forward secrecy).
   *
   * @returns MessageKeyResult with the 32-byte key and message counter
   * @throws CryptoError if the cipher has been destroyed
   */
  nextReceiveKey(): MessageKeyResult {
    this.assertNotDestroyed();
    const counter = this._receiveCounter;
    const { messageKey, nextChainKey } = ratchetStep(this._sodium, this._receiveChainKey);
    this._receiveChainKey = nextChainKey;
    this._receiveCounter++;
    return { key: messageKey, counter };
  }

  /**
   * Export the cipher state for persistence in the key store.
   * Chain keys are encoded as base64 for JSON safety.
   */
  exportState(): SerialisedCipherState {
    this.assertNotDestroyed();
    return {
      sessionId: this._sessionId,
      sendChainKey: this._sodium.to_base64(this._sendChainKey),
      sendCounter: this._sendCounter,
      receiveChainKey: this._sodium.to_base64(this._receiveChainKey),
      receiveCounter: this._receiveCounter,
    };
  }

  /**
   * Restore a cipher from previously exported state.
   * Sodium must have been initialised by a prior async call.
   */
  static async restore(state: SerialisedCipherState): Promise<SessionCipher> {
    const sodium = await ensureSodium();
    return new SessionCipher(
      sodium,
      state.sessionId,
      sodium.from_base64(state.sendChainKey),
      state.sendCounter,
      sodium.from_base64(state.receiveChainKey),
      state.receiveCounter,
    );
  }

  /**
   * Zeroize all key material in memory. The cipher cannot be used after
   * this call. Must be called when the session ends.
   */
  destroy(): void {
    if (!this._destroyed) {
      this._sodium.memzero(this._sendChainKey);
      this._sodium.memzero(this._receiveChainKey);
      this._destroyed = true;
    }
  }

  private assertNotDestroyed(): void {
    if (this._destroyed) {
      throw new CryptoError('SessionCipher has been destroyed');
    }
  }
}

/**
 * Create a new SessionCipher from freshly derived session keys.
 *
 * @param sessionId — unique session identifier
 * @param sessionKeys — output from deriveSessionKeys()
 */
export async function createSessionCipher(sessionId: string, sessionKeys: DerivedSessionKeys): Promise<SessionCipher> {
  const sodium = await ensureSodium();
  // Copy the keys so the caller can't mutate our internal state
  return new SessionCipher(
    sodium,
    sessionId,
    new Uint8Array(sessionKeys.sendKey),
    0,
    new Uint8Array(sessionKeys.receiveKey),
    0,
  );
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}
