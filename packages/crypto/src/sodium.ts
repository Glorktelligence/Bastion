// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Shared sodium initialisation helper — works in both Node.js and browser.
 *
 * Loading strategy (ordered by preference):
 *   1. Node.js CJS via createRequire — works under PNPM's strict symlinks
 *      (the ESM build of libsodium-wrappers-sumo has a broken relative
 *      import for its WASM module that fails with PNPM)
 *   2. Dynamic ESM import — works in browser/Vite (Vite resolves and
 *      bundles the WASM correctly)
 *
 * Call `ensureSodium()` (or `initCrypto()`) before any crypto operation.
 * Both are idempotent and safe to call multiple times.
 */

// ---------------------------------------------------------------------------
// SodiumLibrary interface (subset of libsodium-wrappers-sumo API)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let sodium: SodiumLibrary | null = null;
let initialised = false;

// ---------------------------------------------------------------------------
// Loading strategies
// ---------------------------------------------------------------------------

/**
 * Strategy 1: Node.js CJS via createRequire.
 * Works under PNPM's strict symlink layout where the ESM build fails.
 * Uses dynamic import of 'node:module' which is available in Node.js ESM.
 */
async function loadViaCjs(): Promise<SodiumLibrary | null> {
  try {
    // Dynamic import of node:module — only available in Node.js
    const nodeModule = await import('node:module');
    const req = nodeModule.createRequire(import.meta.url);
    return req('libsodium-wrappers-sumo') as SodiumLibrary;
  } catch {
    return null;
  }
}

/**
 * Strategy 2: Dynamic ESM import.
 * Works in browser (Vite/webpack resolve and bundle the WASM correctly).
 * May fail in Node.js with PNPM due to broken relative import in ESM build.
 */
async function loadViaEsm(): Promise<SodiumLibrary | null> {
  try {
    const mod = await import('libsodium-wrappers-sumo');
    return (mod.default ?? mod) as SodiumLibrary;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the crypto subsystem. Must be called (and awaited) before
 * any crypto operation. Idempotent — safe to call multiple times.
 *
 * Call this once at application startup:
 *   - AI client: top of start-ai-client.mjs
 *   - Human client: in session.ts before connect()
 */
export async function initCrypto(): Promise<void> {
  if (initialised) return;

  // Try CJS first (Node.js + PNPM), then ESM (browser)
  sodium = await loadViaCjs();
  if (!sodium) {
    sodium = await loadViaEsm();
  }

  if (!sodium) {
    throw new Error(
      'Failed to load libsodium-wrappers-sumo. ' + 'Ensure the package is installed: pnpm add libsodium-wrappers-sumo',
    );
  }

  await sodium.ready;
  initialised = true;
}

/**
 * Get the initialised sodium instance.
 * Calls initCrypto() automatically if not yet initialised.
 *
 * @throws Error if sodium cannot be loaded
 */
export async function ensureSodium(): Promise<SodiumLibrary> {
  if (!initialised || !sodium) {
    await initCrypto();
  }
  return sodium!;
}

export type { SodiumLibrary };
