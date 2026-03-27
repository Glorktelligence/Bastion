// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * @bastion/crypto — E2E encryption, key exchange, and key management
 * for Project Bastion.
 *
 * This package depends on @bastion/protocol for shared types. It uses
 * libsodium-wrappers-sumo (WASM build of libsodium) for all cryptographic
 * operations: X25519 key exchange, BLAKE2b hashing, XSalsa20-Poly1305
 * authenticated encryption, and Argon2id key derivation.
 */

// ---------------------------------------------------------------------------
// Sodium: libsodium initialization
// ---------------------------------------------------------------------------
export { initCrypto, ensureSodium } from './sodium.js';

// ---------------------------------------------------------------------------
// E2E: Session key exchange & ratchet
// ---------------------------------------------------------------------------
export {
  generateKeyPair,
  deriveSessionKeys,
  createSessionCipher,
  SessionCipher,
  CryptoError,
} from './e2e/session-keys.js';
export type {
  KeyExchangeRole,
  CryptoKeyPair,
  DerivedSessionKeys,
  MessageKeyResult,
  SerialisedCipherState,
} from './e2e/session-keys.js';

// ---------------------------------------------------------------------------
// E2E: Message encryption & decryption
// ---------------------------------------------------------------------------
export { encryptEnvelope } from './e2e/encrypt.js';
export type { EncryptionResult } from './e2e/encrypt.js';
export { decryptEnvelope } from './e2e/decrypt.js';
export type { DecryptionResult } from './e2e/decrypt.js';

// ---------------------------------------------------------------------------
// E2E: File encryption & decryption
// ---------------------------------------------------------------------------
export { encryptFile } from './e2e/file-encrypt.js';
export type {
  FileMetadata,
  EncryptedFileResult,
  FileEncryptionHeader,
} from './e2e/file-encrypt.js';
export { decryptFile } from './e2e/file-decrypt.js';
export type { DecryptedFileResult } from './e2e/file-decrypt.js';

// ---------------------------------------------------------------------------
// Integrity: Audit hash chain
// ---------------------------------------------------------------------------
export {
  GENESIS_SEED,
  computeChainHash,
  appendEntry,
  verifyChain,
  verifyRange,
  verifySingleEntry,
  ChainError,
} from './integrity/chain-hash.js';
export type {
  AuditEntry,
  HashedAuditEntry,
  ChainVerificationResult,
} from './integrity/chain-hash.js';

// ---------------------------------------------------------------------------
// E2E: Encrypted key store
// ---------------------------------------------------------------------------
export { KeyStore } from './e2e/key-store.js';
export type {
  KeyStoreConfig,
  SerialisedKeyPair,
} from './e2e/key-store.js';
