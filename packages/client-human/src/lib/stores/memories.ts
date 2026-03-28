// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Memory store for the human client.
 *
 * Holds the current list of AI-side memories received via
 * memory_list_response. Supports reactive display in the Settings page.
 */

import type { Readable, Writable } from '../store.js';
import { derived, writable } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  readonly id: string;
  readonly content: string;
  readonly category: 'preference' | 'fact' | 'workflow' | 'project';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly conversationId?: string | null;
}

export interface MemoriesState {
  readonly memories: readonly MemoryEntry[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly lastNotification: string | null;
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createMemoriesStore(): {
  store: Writable<MemoriesState>;
  byCategory: Readable<Record<string, readonly MemoryEntry[]>>;
  totalCount: Readable<number>;
  setMemories(memories: readonly MemoryEntry[]): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  setNotification(msg: string): void;
  clear(): void;
} {
  const store = writable<MemoriesState>({
    memories: [],
    loading: false,
    error: null,
    lastNotification: null,
  });

  const byCategory = derived([store], ([s]) => {
    const groups: Record<string, MemoryEntry[]> = {};
    for (const m of s.memories) {
      if (!groups[m.category]) groups[m.category] = [];
      groups[m.category]!.push(m);
    }
    return groups;
  });

  const totalCount = derived([store], ([s]) => s.memories.length);

  return {
    store,
    byCategory,
    totalCount,
    setMemories(memories) {
      store.update((s) => ({ ...s, memories, loading: false, error: null }));
    },
    setLoading(loading) {
      store.update((s) => ({ ...s, loading }));
    },
    setError(error) {
      store.update((s) => ({ ...s, error }));
    },
    setNotification(msg) {
      store.update((s) => ({ ...s, lastNotification: msg }));
      // Auto-clear after 3 seconds
      setTimeout(() => {
        store.update((s) => (s.lastNotification === msg ? { ...s, lastNotification: null } : s));
      }, 3000);
    },
    clear() {
      store.set({ memories: [], loading: false, error: null, lastNotification: null });
    },
  };
}
