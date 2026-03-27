// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * ConfigStore — persistent configuration for the human client.
 *
 * Abstracts storage behind a simple key-value interface.
 * BrowserConfigStore uses localStorage. TauriConfigStore uses the
 * Tauri fs API to persist to the app data directory (survives
 * origin/port changes). Falls back to browser if Tauri not detected.
 *
 * The setup wizard writes config on first launch. Session.ts reads
 * relay URL and identity from here instead of globalThis overrides.
 */

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

/** Current config schema version. Bump when fields are added/changed. */
export const CONFIG_VERSION = 2;

export interface BastionConfig {
  /** Schema version for migration. */
  configVersion: number;
  relayUrl: string;
  userId: string;
  displayName: string;
  setupComplete: boolean;
  lastConnected: string;
  theme: 'dark' | 'light';
  /** Auto-connect to relay on app open (default: true after setup). */
  autoConnect: boolean;
  /** Auto-reconnect on unexpected disconnect (default: true). */
  autoReconnect: boolean;
}

export const DEFAULT_CONFIG: BastionConfig = {
  configVersion: CONFIG_VERSION,
  relayUrl: 'wss://10.0.30.10:9443',
  userId: '',
  displayName: '',
  setupComplete: false,
  lastConnected: '',
  theme: 'dark',
  autoConnect: true,
  autoReconnect: true,
};

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Migrate a config object from an older version to the current schema.
 * Returns a new object with missing fields filled from defaults.
 */
export function migrateConfig(raw: Record<string, unknown>): BastionConfig {
  const version = typeof raw.configVersion === 'number' ? raw.configVersion : 1;

  // Start from defaults, overlay saved values
  const config: BastionConfig = { ...DEFAULT_CONFIG };

  // Always carry forward core fields that exist in all versions
  if (typeof raw.relayUrl === 'string') config.relayUrl = raw.relayUrl;
  if (typeof raw.userId === 'string') config.userId = raw.userId;
  if (typeof raw.displayName === 'string') config.displayName = raw.displayName;
  if (typeof raw.setupComplete === 'boolean') config.setupComplete = raw.setupComplete;
  if (typeof raw.lastConnected === 'string') config.lastConnected = raw.lastConnected;
  if (raw.theme === 'dark' || raw.theme === 'light') config.theme = raw.theme;

  // v2 fields — only apply if they were explicitly saved
  if (version >= 2) {
    if (typeof raw.autoConnect === 'boolean') config.autoConnect = raw.autoConnect;
    if (typeof raw.autoReconnect === 'boolean') config.autoReconnect = raw.autoReconnect;
  }
  // v1 → v2: autoConnect and autoReconnect get defaults (true)

  // Stamp current version
  config.configVersion = CONFIG_VERSION;

  return config;
}

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
        this.config = migrateConfig(parsed);
        // Re-save if migration bumped the version
        if (parsed.configVersion !== CONFIG_VERSION) {
          this.save();
        }
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
// TauriConfigStore (app data directory)
// ---------------------------------------------------------------------------

/**
 * Tauri-backed config store. Persists config to a JSON file in the
 * app's data directory (e.g. %APPDATA%/com.glorktelligence.bastion/).
 *
 * This survives origin changes, port changes, and WebView resets.
 * Falls back to localStorage if Tauri APIs are unavailable.
 */
export class TauriConfigStore implements ConfigStore {
  private config: BastionConfig;
  private readonly filePath: string;

  constructor(filePath = 'bastion-config.json') {
    this.config = { ...DEFAULT_CONFIG };
    this.filePath = filePath;
    // Synchronous init: try localStorage first, then async Tauri load will overwrite
    this.loadFromLocalStorage();
    // Kick off async Tauri load
    this.loadFromTauri();
  }

  get<K extends keyof BastionConfig>(key: K): BastionConfig[K] {
    return this.config[key];
  }

  set<K extends keyof BastionConfig>(key: K, value: BastionConfig[K]): void {
    this.config[key] = value;
    this.saveToLocalStorage();
    this.saveToTauri();
  }

  getAll(): BastionConfig {
    return { ...this.config };
  }

  has(key: keyof BastionConfig): boolean {
    return this.config[key] !== undefined && this.config[key] !== '' && this.config[key] !== false;
  }

  clear(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.saveToLocalStorage();
    this.saveToTauri();
  }

  private loadFromLocalStorage(): void {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (raw) {
        this.config = migrateConfig(JSON.parse(raw));
      }
    } catch {
      // Ignore
    }
  }

  private saveToLocalStorage(): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch {
      // Ignore
    }
  }

  private async loadFromTauri(): Promise<void> {
    // Guard: never attempt Tauri imports in browser context.
    // This prevents Vite from statically analyzing the import paths.
    if (!isTauri()) return;

    try {
      // Build module names at runtime so Vite's static analyzer cannot resolve them.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pathMod: any = await importTauriModule('api/path');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fsMod: any = await importTauriModule('plugin-fs');
      const dir: string = await pathMod.appDataDir();
      const raw: string = await fsMod.readTextFile(`${dir}${this.filePath}`);
      const parsed = JSON.parse(raw);
      this.config = migrateConfig(parsed);
      // Sync back to localStorage for fastest reads
      this.saveToLocalStorage();
    } catch {
      // File doesn't exist yet or Tauri API unavailable — use localStorage values
    }
  }

  private async saveToTauri(): Promise<void> {
    if (!isTauri()) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pathMod: any = await importTauriModule('api/path');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fsMod: any = await importTauriModule('plugin-fs');
      const dir: string = await pathMod.appDataDir();
      await fsMod.mkdir(dir, { recursive: true }).catch(() => {});
      await fsMod.writeTextFile(`${dir}${this.filePath}`, JSON.stringify(this.config, null, 2));
    } catch {
      // Tauri not available — localStorage is the fallback
    }
  }
}

// ---------------------------------------------------------------------------
// InMemoryConfigStore (for testing / SSR)
// ---------------------------------------------------------------------------

export class InMemoryConfigStore implements ConfigStore {
  /** Marker for SSR→browser detection in getConfigStore(). */
  readonly _isInMemory = true;
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

/**
 * Dynamically import a Tauri module by suffix (e.g. 'api/path' → '@tauri-apps/api/path').
 * The module name is constructed at runtime so Vite's static analyzer cannot resolve it,
 * preventing build failures when Tauri packages are not installed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importTauriModule(suffix: string): Promise<any> {
  const prefix = '@tauri-apps/';
  const mod = prefix + suffix;
  // Use Function constructor to create a dynamic import that bundlers cannot statically analyze.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function('m', 'return import(m)')(mod);
}

/** Detect whether running inside a Tauri WebView. */
function isTauri(): boolean {
  try {
    // Tauri v2 injects __TAURI_INTERNALS__ on the window object
    return typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis;
  } catch {
    return false;
  }
}

export function getConfigStore(): ConfigStore {
  if (_instance) {
    // If we cached an InMemoryConfigStore during SSR but are now in browser,
    // discard it and create a BrowserConfigStore that reads localStorage.
    // Use marker property instead of instanceof (survives HMR module identity changes).
    const isInMem = (_instance as unknown as Record<string, unknown>)._isInMemory === true;
    if (isInMem && typeof globalThis.localStorage !== 'undefined') {
      _instance = null;
    } else {
      return _instance;
    }
  }

  try {
    if (isTauri()) {
      _instance = new TauriConfigStore();
    } else if (typeof globalThis.localStorage !== 'undefined') {
      _instance = new BrowserConfigStore();
    } else {
      _instance = new InMemoryConfigStore();
    }
  } catch {
    _instance = new InMemoryConfigStore();
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
