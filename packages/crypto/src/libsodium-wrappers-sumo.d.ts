// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Minimal type declarations for libsodium-wrappers-sumo.
 * Covers only the functions used by @bastion/crypto.
 */

declare module 'libsodium-wrappers-sumo' {
  interface KeyPair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    keyType: string;
  }

  interface CryptoKX {
    sharedRx: Uint8Array;
    sharedTx: Uint8Array;
  }

  interface StringKeyPair {
    publicKey: string;
    privateKey: string;
    keyType: string;
  }

  const ready: Promise<void>;

  // Key exchange (X25519-based)
  const crypto_kx_PUBLICKEYBYTES: number;
  const crypto_kx_SECRETKEYBYTES: number;
  const crypto_kx_SESSIONKEYBYTES: number;
  function crypto_kx_keypair(): KeyPair;
  function crypto_kx_client_session_keys(
    clientPublicKey: Uint8Array,
    clientSecretKey: Uint8Array,
    serverPublicKey: Uint8Array,
  ): CryptoKX;
  function crypto_kx_server_session_keys(
    serverPublicKey: Uint8Array,
    serverSecretKey: Uint8Array,
    clientPublicKey: Uint8Array,
  ): CryptoKX;

  // Generic hashing (BLAKE2b)
  const crypto_generichash_BYTES: number;
  const crypto_generichash_KEYBYTES: number;
  function crypto_generichash(hash_length: number, message: Uint8Array | string, key?: Uint8Array | null): Uint8Array;

  // Secret-key authenticated encryption (XSalsa20-Poly1305)
  const crypto_secretbox_KEYBYTES: number;
  const crypto_secretbox_NONCEBYTES: number;
  const crypto_secretbox_MACBYTES: number;
  function crypto_secretbox_easy(message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  function crypto_secretbox_open_easy(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;

  // Password hashing (Argon2id)
  const crypto_pwhash_SALTBYTES: number;
  const crypto_pwhash_ALG_ARGON2ID13: number;
  const crypto_pwhash_OPSLIMIT_MODERATE: number;
  const crypto_pwhash_MEMLIMIT_MODERATE: number;
  function crypto_pwhash(
    keyLength: number,
    password: Uint8Array | string,
    salt: Uint8Array,
    opsLimit: number,
    memLimit: number,
    algorithm: number,
  ): Uint8Array;

  // Random bytes
  function randombytes_buf(length: number): Uint8Array;

  // Memory
  function memzero(buffer: Uint8Array): void;

  // Encoding helpers
  function to_base64(data: Uint8Array): string;
  function from_base64(encoded: string): Uint8Array;
  function to_hex(data: Uint8Array): string;
  function from_hex(encoded: string): Uint8Array;
}
