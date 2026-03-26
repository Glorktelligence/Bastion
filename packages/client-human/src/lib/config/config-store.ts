// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * ConfigStore — persistent configuration for the human client.
 *
 * Abstracts storage behind a simple key-value interface.
 * BrowserConfigStore uses localStorage. TauriConfigStore would
 * use Tauri's fs API (falls back to browser if Tauri not detected).
 *
 * The setup wizard writes config on first launch. Session.ts reads
 * relay URL and identity from here instead of globalThis overrides.
 */

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export interface BastionConfig {
  relayUrl: string;
  userId: string;
  displayName: string;
  setupComplete: boolean;
  lastConnected: string;
  theme: 'dark' | 'light';
}

export const DEFAULT_CONFIG: BastionConfig = {
  relayUrl: 'wss://10.0.30.10:9443',
  userId: '',
  displayName: '',
  setupComplete: false,
  lastConnected: '',
  theme: 'dark',
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ConfigStore {
  get<K extends keyof BastionConfig>(key: K): BastionConfig[K];
  set<K extends keyof BastionConfig>(key: K, value: BastionConfig[K]): void;
  getAll(): BastionConfig;
  has(key: keyof BastionConfig): boolean;
  clear(): void;
}

// ---------------------------------------------------------------------------
// BrowserConfigStore (localStorage)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'bastion_config';

export class BrowserConfigStore implements ConfigStore {
  private config: BastionConfig;

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.load();
  }

  get<K extends keyof BastionConfig>(key: K): BastionConfig[K] {
    return this.config[key];
  }

  set<K extends keyof BastionConfig>(key: K, value: BastionConfig[K]): void {
    this.config[key] = value;
    this.save();
  }

  getAll(): BastionConfig {
    return { ...this.config };
  }

  has(key: keyof BastionConfig): boolean {
    return this.config[key] !== undefined && this.config[key] !== '' && this.config[key] !== false;
  }

  clear(): void {
    this.config = { ...DEFAULT_CONFIG };
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable
    }
  }

  private load(): void {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.config = { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch {
      // localStorage unavailable or corrupt — use defaults
    }
  }

  private save(): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch {
      // localStorage unavailable
    }
  }
}

// ---------------------------------------------------------------------------
// InMemoryConfigStore (for testing / SSR)
// ---------------------------------------------------------------------------

export class InMemoryConfigStore implements ConfigStore {
  private config: BastionConfig;

  constructor(initial?: Partial<BastionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...initial };
  }

  get<K extends keyof BastionConfig>(key: K): BastionConfig[K] {
    return this.config[key];
  }

  set<K extends keyof BastionConfig>(key: K, value: BastionConfig[K]): void {
    this.config[key] = value;
  }

  getAll(): BastionConfig {
    return { ...this.config };
  }

  has(key: keyof BastionConfig): boolean {
    return this.config[key] !== undefined && this.config[key] !== '' && this.config[key] !== false;
  }

  clear(): void {
    this.config = { ...DEFAULT_CONFIG };
  }
}

// ---------------------------------------------------------------------------
// Auto-detect and create the appropriate store
// ---------------------------------------------------------------------------

let _instance: ConfigStore | null = null;

export function getConfigStore(): ConfigStore {
  if (!_instance) {
    // In browser/Tauri context, use localStorage-backed store.
    // In SSR/test context (no localStorage), use in-memory.
    try {
      if (typeof globalThis.localStorage !== 'undefined') {
        _instance = new BrowserConfigStore();
      } else {
        _instance = new InMemoryConfigStore();
      }
    } catch {
      _instance = new InMemoryConfigStore();
    }
  }
  return _instance;
}

/** Generate a user ID (UUID v4 format). */
export function generateUserId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    // Fallback for environments without crypto.randomUUID
    return `user-${Math.random().toString(36).slice(2, 10)}`;
  }
}
