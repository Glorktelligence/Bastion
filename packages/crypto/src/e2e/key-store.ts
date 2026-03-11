// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Local key storage encrypted at rest.
 *
 * Stores identity key pairs and session cipher state on disk, encrypted
 * with XSalsa20-Poly1305. The encryption key is derived from a passphrase
 * using Argon2id, or provided directly for programmatic use.
 *
 * File format (JSON):
 *   {
 *     "version": 1,
 *     "salt": "<base64>",        — Argon2id salt (16 bytes)
 *     "nonce": "<base64>",       — XSalsa20-Poly1305 nonce (24 bytes)
 *     "ciphertext": "<base64>"   — encrypted JSON blob
 *   }
 *
 * The decrypted blob contains:
 *   {
 *     "identityKeyPair": { "publicKey": "<b64>", "secretKey": "<b64>" } | null,
 *     "sessions": { "<sessionId>": SerialisedCipherState, ... }
 *   }
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type SodiumLibrary, ensureSodium } from '../sodium.js';
import type { CryptoKeyPair, SerialisedCipherState } from './session-keys.js';
import { CryptoError } from './session-keys.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for creating a key store. */
export interface KeyStoreConfig {
  /** Absolute file path for the encrypted key store file. */
  readonly storagePath: string;
  /**
   * If provided, used directly as the encryption key (32 bytes).
   * Mutually exclusive with passphrase-based derivation.
   * Useful for testing and programmatic key management.
   */
  readonly masterKey?: Uint8Array;
}

/** The on-disk file format (JSON-serialisable). */
interface KeyStoreFile {
  readonly version: 1;
  readonly salt: string;
  readonly nonce: string;
  readonly ciphertext: string;
}

/** The decrypted contents of the key store. */
interface KeyStoreData {
  identityKeyPair: SerialisedKeyPair | null;
  sessions: Record<string, SerialisedCipherState>;
}

/** JSON-safe representation of a CryptoKeyPair. */
export interface SerialisedKeyPair {
  readonly publicKey: string;
  readonly secretKey: string;
}

// ---------------------------------------------------------------------------
// KeyStore
// ---------------------------------------------------------------------------

/**
 * Encrypted key store for persisting cryptographic material at rest.
 *
 * Usage:
 *   1. Create with `await KeyStore.create(config)`
 *   2. Initialise with `await store.initialise(passphrase)` (or omit
 *      passphrase if masterKey was provided in config)
 *   3. Use store/load methods for key pairs and session state
 *   4. Call `store.destroy()` when done to zeroize in-memory keys
 *
 * All mutations (store/delete) are immediately flushed to disk.
 */
export class KeyStore {
  private readonly storagePath: string;
  private sodium: SodiumLibrary | null;
  private encryptionKey: Uint8Array | null;
  private salt: Uint8Array | null;
  private data: KeyStoreData | null;
  private destroyed: boolean;

  private constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.sodium = null;
    this.encryptionKey = null;
    this.salt = null;
    this.data = null;
    this.destroyed = false;
  }

  /**
   * Create a new KeyStore instance.
   * Call initialise() before using any store/load methods.
   */
  static async create(config: KeyStoreConfig): Promise<KeyStore> {
    const sodium = await ensureSodium();
    const store = new KeyStore(config.storagePath);
    store.sodium = sodium;

    if (config.masterKey) {
      if (config.masterKey.length !== sodium.crypto_secretbox_KEYBYTES) {
        throw new CryptoError(
          `masterKey must be ${sodium.crypto_secretbox_KEYBYTES} bytes, got ${config.masterKey.length}`,
        );
      }
      store.encryptionKey = new Uint8Array(config.masterKey);
      store.salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
    }

    return store;
  }

  /**
   * Initialise the key store. If a file exists on disk, it is decrypted
   * and loaded. Otherwise, an empty store is created.
   *
   * @param passphrase — required if no masterKey was provided in config
   */
  async initialise(passphrase?: string): Promise<void> {
    this.assertNotDestroyed();
    const sodium = this.sodium!;

    // Derive encryption key from passphrase if needed
    if (!this.encryptionKey) {
      if (!passphrase) {
        throw new CryptoError('A passphrase is required when no masterKey is provided');
      }

      // Try to load existing file for its salt
      const existing = await this.readFileFromDisk();
      if (existing) {
        this.salt = sodium.from_base64(existing.salt);
      } else {
        this.salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
      }

      this.encryptionKey = sodium.crypto_pwhash(
        sodium.crypto_secretbox_KEYBYTES,
        passphrase,
        this.salt,
        sodium.crypto_pwhash_OPSLIMIT_MODERATE,
        sodium.crypto_pwhash_MEMLIMIT_MODERATE,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      );

      if (existing) {
        this.data = this.decryptData(existing);
        return;
      }
    } else {
      // masterKey was provided — try loading existing file
      const existing = await this.readFileFromDisk();
      if (existing) {
        this.salt = sodium.from_base64(existing.salt);
        this.data = this.decryptData(existing);
        return;
      }
    }

    // No existing file — start empty
    this.data = { identityKeyPair: null, sessions: {} };
    await this.flush();
  }

  // -------------------------------------------------------------------------
  // Identity key pair
  // -------------------------------------------------------------------------

  /** Store the long-term identity key pair. Flushes to disk immediately. */
  async storeIdentityKeyPair(keyPair: CryptoKeyPair): Promise<void> {
    this.assertReady();
    const sodium = this.sodium!;
    this.data!.identityKeyPair = {
      publicKey: sodium.to_base64(keyPair.publicKey),
      secretKey: sodium.to_base64(keyPair.secretKey),
    };
    await this.flush();
  }

  /** Load the identity key pair, or null if not stored. */
  loadIdentityKeyPair(): CryptoKeyPair | null {
    this.assertReady();
    const sodium = this.sodium!;
    const kp = this.data!.identityKeyPair;
    if (!kp) return null;
    return {
      publicKey: sodium.from_base64(kp.publicKey),
      secretKey: sodium.from_base64(kp.secretKey),
    };
  }

  // -------------------------------------------------------------------------
  // Session cipher state
  // -------------------------------------------------------------------------

  /** Persist a session cipher's state. Flushes to disk immediately. */
  async storeSession(sessionId: string, state: SerialisedCipherState): Promise<void> {
    this.assertReady();
    this.data!.sessions[sessionId] = state;
    await this.flush();
  }

  /** Load a session's cipher state, or null if not found. */
  loadSession(sessionId: string): SerialisedCipherState | null {
    this.assertReady();
    return this.data!.sessions[sessionId] ?? null;
  }

  /** Delete a session's cipher state. Flushes to disk immediately. */
  async deleteSession(sessionId: string): Promise<void> {
    this.assertReady();
    delete this.data!.sessions[sessionId];
    await this.flush();
  }

  /** List all stored session IDs. */
  listSessions(): readonly string[] {
    this.assertReady();
    return Object.keys(this.data!.sessions);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Zeroize all in-memory key material and mark the store as destroyed.
   * The on-disk file is NOT deleted — call this when shutting down.
   */
  destroy(): void {
    if (!this.destroyed) {
      if (this.encryptionKey) {
        this.sodium!.memzero(this.encryptionKey);
        this.encryptionKey = null;
      }
      this.sodium = null;
      this.salt = null;
      this.data = null;
      this.destroyed = true;
    }
  }

  // -------------------------------------------------------------------------
  // Internal: encryption / decryption / persistence
  // -------------------------------------------------------------------------

  private decryptData(file: KeyStoreFile): KeyStoreData {
    const sodium = this.sodium!;
    const nonce = sodium.from_base64(file.nonce);
    const ciphertext = sodium.from_base64(file.ciphertext);

    let plaintext: Uint8Array;
    try {
      plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, this.encryptionKey!);
    } catch {
      throw new CryptoError('Failed to decrypt key store — wrong passphrase or corrupted file');
    }

    const jsonStr = new TextDecoder().decode(plaintext);
    sodium.memzero(plaintext);

    try {
      return JSON.parse(jsonStr) as KeyStoreData;
    } catch {
      throw new CryptoError('Decrypted key store contains invalid JSON');
    }
  }

  private encryptData(): KeyStoreFile {
    const sodium = this.sodium!;
    const jsonStr = JSON.stringify(this.data);
    const plaintext = new TextEncoder().encode(jsonStr);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);

    const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, this.encryptionKey!);

    return {
      version: 1,
      salt: sodium.to_base64(this.salt!),
      nonce: sodium.to_base64(nonce),
      ciphertext: sodium.to_base64(ciphertext),
    };
  }

  private async flush(): Promise<void> {
    const fileData = this.encryptData();
    const json = JSON.stringify(fileData, null, 2);

    // Ensure the directory exists
    await mkdir(dirname(this.storagePath), { recursive: true });
    await writeFile(this.storagePath, json, 'utf-8');
  }

  private async readFileFromDisk(): Promise<KeyStoreFile | null> {
    try {
      const content = await readFile(this.storagePath, 'utf-8');
      const parsed = JSON.parse(content) as KeyStoreFile;
      if (parsed.version !== 1) {
        throw new CryptoError(`Unsupported key store version: ${String(parsed.version)}`);
      }
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      if (err instanceof CryptoError) throw err;
      throw new CryptoError(`Failed to read key store: ${String(err)}`);
    }
  }

  private assertReady(): void {
    this.assertNotDestroyed();
    if (!this.data || !this.encryptionKey) {
      throw new CryptoError('KeyStore not initialised — call initialise() first');
    }
  }

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new CryptoError('KeyStore has been destroyed');
    }
  }
}
