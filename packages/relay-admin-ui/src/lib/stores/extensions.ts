// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Extensions store.
 *
 * Tracks loaded protocol extensions — namespaces, message types,
 * UI components, and conversation renderers. Read-only view.
 */

import { type Readable, type Writable, derived, writable } from '../store.js';
import type { ExtensionDetail, ExtensionSummary } from '../types.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ExtensionsState {
  readonly extensions: readonly ExtensionSummary[];
  readonly selectedNamespace: string | null;
  readonly selectedDetail: ExtensionDetail | null;
  readonly loading: boolean;
  readonly detailLoading: boolean;
  readonly error: string | null;
}

function initialState(): ExtensionsState {
  return {
    extensions: [],
    selectedNamespace: null,
    selectedDetail: null,
    loading: false,
    detailLoading: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface ExtensionsStore {
  readonly store: Writable<ExtensionsState>;
  readonly totalCount: Readable<number>;
  readonly totalMessageTypes: Readable<number>;
  setExtensions(extensions: readonly ExtensionSummary[]): void;
  setSelectedDetail(detail: ExtensionDetail | null): void;
  selectNamespace(namespace: string | null): void;
  setLoading(loading: boolean): void;
  setDetailLoading(loading: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

export function createExtensionsStore(): ExtensionsStore {
  const store = writable<ExtensionsState>(initialState());

  const totalCount = derived([store], ([s]) => s.extensions.length);

  const totalMessageTypes = derived([store], ([s]) => s.extensions.reduce((sum, ext) => sum + ext.messageTypeCount, 0));

  return {
    store,
    totalCount,
    totalMessageTypes,
    setExtensions(extensions) {
      store.update((s) => ({ ...s, extensions, error: null }));
    },
    setSelectedDetail(detail) {
      store.update((s) => ({ ...s, selectedDetail: detail }));
    },
    selectNamespace(namespace) {
      store.update((s) => ({
        ...s,
        selectedNamespace: namespace,
        selectedDetail: namespace === null ? null : s.selectedDetail,
      }));
    },
    setLoading(loading) {
      store.update((s) => ({ ...s, loading }));
    },
    setDetailLoading(loading) {
      store.update((s) => ({ ...s, detailLoading: loading }));
    },
    setError(error) {
      store.update((s) => ({ ...s, error }));
    },
    reset() {
      store.set(initialState());
    },
  };
}
