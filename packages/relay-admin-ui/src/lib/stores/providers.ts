// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Provider management store.
 *
 * CRUD operations on AI providers and their capability matrices.
 * Tracks selection state for the detail view.
 */

import { type Readable, type Writable, derived, writable } from '../store.js';
import type { CapabilityMatrix, ProviderWithCapabilities } from '../types.js';

// ---------------------------------------------------------------------------
// Default capability matrix (mirrors relay's defaultCapabilityMatrix)
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_TYPES = [
  'conversation',
  'challenge',
  'denial',
  'status',
  'result',
  'error',
  'file_offer',
  'heartbeat',
  'provider_status',
  'budget_alert',
  'config_ack',
  'config_nack',
] as const;

export function defaultCapabilityMatrix(): CapabilityMatrix {
  return {
    allowedMessageTypes: [...DEFAULT_ALLOWED_TYPES],
    fileTransfer: {
      canSend: true,
      canReceive: true,
      maxFileSizeBytes: 50 * 1024 * 1024,
      allowedMimeTypes: ['*/*'],
    },
    maxConcurrentTasks: 10,
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ProvidersState {
  readonly providers: readonly ProviderWithCapabilities[];
  readonly selectedId: string | null;
  readonly loading: boolean;
  readonly error: string | null;
}

function initialState(): ProvidersState {
  return {
    providers: [],
    selectedId: null,
    loading: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface ProvidersStore {
  readonly store: Writable<ProvidersState>;
  readonly activeProviders: Readable<readonly ProviderWithCapabilities[]>;
  readonly selectedProvider: Readable<ProviderWithCapabilities | null>;
  readonly activeCount: Readable<number>;
  readonly totalCount: Readable<number>;
  setProviders(providers: readonly ProviderWithCapabilities[]): void;
  addProvider(provider: ProviderWithCapabilities): void;
  updateProvider(id: string, updates: Partial<ProviderWithCapabilities>): void;
  removeProvider(id: string): void;
  selectProvider(id: string | null): void;
  setCapabilities(providerId: string, matrix: CapabilityMatrix): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

export function createProvidersStore(): ProvidersStore {
  const store = writable<ProvidersState>(initialState());

  const activeProviders = derived([store], ([s]) => s.providers.filter((p) => p.active));

  const selectedProvider = derived([store], ([s]) => s.providers.find((p) => p.id === s.selectedId) ?? null);

  const activeCount = derived([store], ([s]) => s.providers.filter((p) => p.active).length);

  const totalCount = derived([store], ([s]) => s.providers.length);

  return {
    store,
    activeProviders,
    selectedProvider,
    activeCount,
    totalCount,
    setProviders(providers) {
      store.update((s) => ({ ...s, providers, error: null }));
    },
    addProvider(provider) {
      store.update((s) => ({
        ...s,
        providers: [...s.providers, provider],
        error: null,
      }));
    },
    updateProvider(id, updates) {
      store.update((s) => ({
        ...s,
        providers: s.providers.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      }));
    },
    removeProvider(id) {
      store.update((s) => ({
        ...s,
        providers: s.providers.filter((p) => p.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
      }));
    },
    selectProvider(id) {
      store.update((s) => ({ ...s, selectedId: id }));
    },
    setCapabilities(providerId, matrix) {
      store.update((s) => ({
        ...s,
        providers: s.providers.map((p) => (p.id === providerId ? { ...p, capabilityMatrix: matrix } : p)),
      }));
    },
    setLoading(loading) {
      store.update((s) => ({ ...s, loading }));
    },
    setError(error) {
      store.update((s) => ({ ...s, error }));
    },
    reset() {
      store.set(initialState());
    },
  };
}
