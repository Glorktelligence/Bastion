// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Provider store for the human client.
 *
 * Tracks the AI provider registered with the relay — name, ID, status,
 * and capabilities. Populated by provider_status messages.
 */

import type { Writable } from '../store.js';
import { writable } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderCapabilities {
  readonly conversation: boolean;
  readonly taskExecution: boolean;
  readonly fileTransfer: boolean;
  readonly streaming?: boolean;
}

export interface ProviderInfo {
  readonly providerId: string;
  readonly providerName: string;
  readonly status: 'active' | 'inactive' | 'unknown';
  readonly capabilities: ProviderCapabilities;
  readonly lastUpdated: string;
}

export interface ProviderStoreState {
  readonly provider: ProviderInfo | null;
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export interface ProviderStore {
  readonly store: Writable<ProviderStoreState>;
  setProvider(info: ProviderInfo): void;
  setStatus(status: ProviderInfo['status']): void;
  clear(): void;
}

export function createProviderStore(): ProviderStore {
  const store = writable<ProviderStoreState>({ provider: null });

  return {
    store,
    setProvider(info: ProviderInfo): void {
      store.set({ provider: info });
    },
    setStatus(status: ProviderInfo['status']): void {
      store.update((s) =>
        s.provider ? { provider: { ...s.provider, status, lastUpdated: new Date().toISOString() } } : s,
      );
    },
    clear(): void {
      store.set({ provider: null });
    },
  };
}
