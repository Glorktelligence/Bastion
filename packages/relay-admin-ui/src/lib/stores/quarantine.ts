// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Quarantine viewer store.
 *
 * Tracks quarantined files, their states, custody chains,
 * and hash verification status.
 */

import { type Readable, type Writable, derived, writable } from '../store.js';
import type { QuarantineViewEntry } from '../types.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface QuarantineStoreState {
  readonly entries: readonly QuarantineViewEntry[];
  readonly selectedId: string | null;
  readonly filterState: string | null;
  readonly loading: boolean;
  readonly error: string | null;
}

function initialState(): QuarantineStoreState {
  return {
    entries: [],
    selectedId: null,
    filterState: null,
    loading: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface QuarantineStore {
  readonly store: Writable<QuarantineStoreState>;
  readonly filteredEntries: Readable<readonly QuarantineViewEntry[]>;
  readonly selectedEntry: Readable<QuarantineViewEntry | null>;
  readonly totalCount: Readable<number>;
  readonly stateBreakdown: Readable<Record<string, number>>;
  setEntries(entries: readonly QuarantineViewEntry[]): void;
  addEntry(entry: QuarantineViewEntry): void;
  updateEntry(transferId: string, updates: Partial<QuarantineViewEntry>): void;
  removeEntry(transferId: string): void;
  selectEntry(transferId: string | null): void;
  setFilter(state: string | null): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

export function createQuarantineStore(): QuarantineStore {
  const store = writable<QuarantineStoreState>(initialState());

  const filteredEntries = derived([store], ([s]) => {
    if (!s.filterState) return s.entries;
    return s.entries.filter((e) => e.state === s.filterState);
  });

  const selectedEntry = derived([store], ([s]) => s.entries.find((e) => e.transferId === s.selectedId) ?? null);

  const totalCount = derived([store], ([s]) => s.entries.length);

  const stateBreakdown = derived([store], ([s]) => {
    const counts: Record<string, number> = {};
    for (const entry of s.entries) {
      counts[entry.state] = (counts[entry.state] ?? 0) + 1;
    }
    return counts;
  });

  return {
    store,
    filteredEntries,
    selectedEntry,
    totalCount,
    stateBreakdown,
    setEntries(entries) {
      store.update((s) => ({ ...s, entries, error: null }));
    },
    addEntry(entry) {
      store.update((s) => ({
        ...s,
        entries: [...s.entries, entry],
      }));
    },
    updateEntry(transferId, updates) {
      store.update((s) => ({
        ...s,
        entries: s.entries.map((e) => (e.transferId === transferId ? { ...e, ...updates } : e)),
      }));
    },
    removeEntry(transferId) {
      store.update((s) => ({
        ...s,
        entries: s.entries.filter((e) => e.transferId !== transferId),
        selectedId: s.selectedId === transferId ? null : s.selectedId,
      }));
    },
    selectEntry(transferId) {
      store.update((s) => ({ ...s, selectedId: transferId }));
    },
    setFilter(state) {
      store.update((s) => ({ ...s, filterState: state }));
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
