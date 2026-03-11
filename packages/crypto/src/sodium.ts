// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Shared sodium initialisation helper.
 *
 * libsodium-wrappers-sumo v0.7.x has a broken ESM build that uses a
 * relative import for its WASM module. Under PNPM's strict symlink
 * layout this import fails. We use createRequire to load the working
 * CJS build instead.
 */

import { createRequire } from 'node:module';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const require = createRequire(import.meta.url);

interface SodiumLibrary {
  readonly ready: Promise<void>;
  readonly crypto_kx_PUBLICKEYBYTES: number;
  readonly crypto_kx_SECRETKEYBYTES: number;
  readonly crypto_kx_SESSIONKEYBYTES: number;
  readonly crypto_secretbox_KEYBYTES: number;
  readonly crypto_secretbox_NONCEBYTES: number;
  readonly crypto_secretbox_MACBYTES: number;
  readonly crypto_pwhash_SALTBYTES: number;
  readonly crypto_pwhash_ALG_ARGON2ID13: number;
  readonly crypto_pwhash_OPSLIMIT_MODERATE: number;
  readonly crypto_pwhash_MEMLIMIT_MODERATE: number;
  crypto_kx_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  crypto_kx_client_session_keys(
    clientPk: Uint8Array,
    clientSk: Uint8Array,
    serverPk: Uint8Array,
  ): { sharedRx: Uint8Array; sharedTx: Uint8Array };
  crypto_kx_server_session_keys(
    serverPk: Uint8Array,
    serverSk: Uint8Array,
    clientPk: Uint8Array,
  ): { sharedRx: Uint8Array; sharedTx: Uint8Array };
  crypto_generichash(len: number, msg: Uint8Array | string, key?: Uint8Array | null): Uint8Array;
  crypto_secretbox_easy(msg: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  crypto_secretbox_open_easy(ct: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  crypto_pwhash(
    keyLen: number,
    pw: Uint8Array | string,
    salt: Uint8Array,
    ops: number,
    mem: number,
    alg: number,
  ): Uint8Array;
  randombytes_buf(len: number): Uint8Array;
  memzero(buf: Uint8Array): void;
  to_base64(data: Uint8Array): string;
  from_base64(encoded: string): Uint8Array;
  to_hex(data: Uint8Array): string;
  from_hex(encoded: string): Uint8Array;
}

// Load the CJS build which works correctly under PNPM
const sodium: SodiumLibrary = require('libsodium-wrappers-sumo') as SodiumLibrary;

let ready = false;

/**
 * Ensure sodium is initialised. Idempotent — safe to call multiple times.
 * Must be awaited before any sodium function call.
 */
export async function ensureSodium(): Promise<SodiumLibrary> {
  if (!ready) {
    await sodium.ready;
    ready = true;
  }
  return sodium;
}

export type { SodiumLibrary };
