// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Extensions store for the human client.
 *
 * Tracks protocol extensions loaded by the relay. Populated by
 * extension_list_response messages. Read-only display — extension
 * management requires relay restart.
 */

import type { Readable, Writable } from '../store.js';
import { derived, writable } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtensionInfo {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly messageTypes: readonly string[];
}

export interface ExtensionsStoreState {
  readonly extensions: readonly ExtensionInfo[];
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export interface ExtensionsStore {
  readonly store: Writable<ExtensionsStoreState>;
  readonly totalCount: Readable<number>;
  readonly totalMessageTypes: Readable<number>;
  setExtensions(exts: readonly ExtensionInfo[]): void;
  clear(): void;
}

export function createExtensionsStore(): ExtensionsStore {
  const store = writable<ExtensionsStoreState>({ extensions: [] });

  const totalCount = derived([store], ([s]) => s.extensions.length);
  const totalMessageTypes = derived([store], ([s]) => s.extensions.reduce((sum, e) => sum + e.messageTypes.length, 0));

  return {
    store,
    totalCount,
    totalMessageTypes,
    setExtensions(exts: readonly ExtensionInfo[]): void {
      store.set({ extensions: exts });
    },
    clear(): void {
      store.set({ extensions: [] });
    },
  };
}
