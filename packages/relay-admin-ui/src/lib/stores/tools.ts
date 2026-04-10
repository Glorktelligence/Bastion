// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Tools store.
 *
 * Tracks registered tools from MCP providers — names, categories,
 * trust levels, and dangerous flags. Read-only admin view.
 */

import { type Readable, type Writable, derived, writable } from '../store.js';
import type { ToolProviderEntry, ToolsResponse } from '../types.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ToolsState {
  readonly providers: readonly ToolProviderEntry[];
  readonly totalTools: number;
  readonly message: string;
  readonly loading: boolean;
  readonly error: string | null;
}

function initialState(): ToolsState {
  return {
    providers: [],
    totalTools: 0,
    message: '',
    loading: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface ToolsStore {
  readonly store: Writable<ToolsState>;
  readonly providerCount: Readable<number>;
  readonly dangerousToolCount: Readable<number>;
  setToolsResponse(response: ToolsResponse): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

export function createToolsStore(): ToolsStore {
  const store = writable<ToolsState>(initialState());

  const providerCount = derived([store], ([s]) => s.providers.length);

  const dangerousToolCount = derived([store], ([s]) =>
    s.providers.reduce((sum, p) => sum + p.tools.filter((t) => t.dangerous).length, 0),
  );

  return {
    store,
    providerCount,
    dangerousToolCount,
    setToolsResponse(response) {
      store.update((s) => ({
        ...s,
        providers: response.providers,
        totalTools: response.totalTools,
        message: response.message,
        error: null,
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
