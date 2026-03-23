// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Blocklist manager store.
 *
 * Manages the view of blocked identifiers. MaliClaw entries are
 * HARDCODED and immutable — they cannot be removed or modified
 * through the admin UI.
 */

import { type Readable, type Writable, derived, writable } from '../store.js';
import type { BlocklistEntry } from '../types.js';

// ---------------------------------------------------------------------------
// MaliClaw Clause — HARDCODED, mirrors relay allowlist.ts
// ---------------------------------------------------------------------------

/**
 * MaliClaw patterns — mirrors relay allowlist.ts.
 * Case-insensitive partial matching + /claw/i catch-all.
 *
 * Claw family tree:
 *   Clawdbot → Moltbot → OpenClaw
 *                           ├── Copaw, NanoClaw, ZeroClaw
 *                           ├── ClawHub (marketplace)
 *                           └── HiClaw → Tuwunel (IM server)
 */
const MALICLAW_PATTERNS: readonly string[] = Object.freeze([
  'openclaw',
  'clawdbot',
  'moltbot',
  'copaw',
  'nanoclaw',
  'zeroclaw',
  'clawhub',
  'hiclaw',
  'tuwunel',
  'lobster',
  'ai.openclaw.client',
  'openclaw.ai',
  'docs.openclaw.ai',
]);

const CLAW_CATCHALL = /claw/i;

/** Check if an identifier matches any MaliClaw pattern or the catch-all. */
function isMaliClawMatch(identifier: string): boolean {
  const lower = identifier.toLowerCase();
  if (MALICLAW_PATTERNS.some((pattern) => lower.includes(pattern))) return true;
  return CLAW_CATCHALL.test(identifier);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface BlocklistState {
  readonly maliClawEntries: readonly string[];
  readonly customEntries: readonly BlocklistEntry[];
  readonly loading: boolean;
  readonly error: string | null;
}

function initialState(): BlocklistState {
  return {
    maliClawEntries: MALICLAW_PATTERNS,
    customEntries: [],
    loading: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface BlocklistStore {
  readonly store: Writable<BlocklistState>;
  readonly allEntries: Readable<readonly { id: string; source: 'maliclaw' | 'custom'; removable: boolean }[]>;
  readonly totalCount: Readable<number>;
  readonly maliClawCount: Readable<number>;
  setCustomEntries(entries: readonly BlocklistEntry[]): void;
  addCustomEntry(entry: BlocklistEntry): boolean;
  removeCustomEntry(id: string): boolean;
  isMaliClaw(id: string): boolean;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

export function createBlocklistStore(): BlocklistStore {
  const store = writable<BlocklistState>(initialState());

  const allEntries = derived([store], ([s]) => {
    const maliClaw = s.maliClawEntries.map((id) => ({
      id,
      source: 'maliclaw' as const,
      removable: false,
    }));
    const custom = s.customEntries.map((e) => ({
      id: e.id,
      source: 'custom' as const,
      removable: true,
    }));
    return [...maliClaw, ...custom];
  });

  const totalCount = derived([store], ([s]) => s.maliClawEntries.length + s.customEntries.length);

  const maliClawCount = derived([store], ([s]) => s.maliClawEntries.length);

  return {
    store,
    allEntries,
    totalCount,
    maliClawCount,
    setCustomEntries(entries) {
      // Filter out any that collide with MaliClaw
      const safe = entries.filter((e) => !isMaliClawMatch(e.id));
      store.update((s) => ({ ...s, customEntries: safe, error: null }));
    },
    addCustomEntry(entry) {
      // Cannot add MaliClaw IDs as custom entries
      if (isMaliClawMatch(entry.id)) return false;
      store.update((s) => {
        if (s.customEntries.some((e) => e.id === entry.id)) return s;
        return { ...s, customEntries: [...s.customEntries, entry] };
      });
      return true;
    },
    removeCustomEntry(id) {
      // Cannot remove MaliClaw entries
      if (isMaliClawMatch(id)) return false;
      let removed = false;
      store.update((s) => {
        const filtered = s.customEntries.filter((e) => e.id !== id);
        removed = filtered.length < s.customEntries.length;
        return { ...s, customEntries: filtered };
      });
      return removed;
    },
    isMaliClaw(id) {
      return isMaliClawMatch(id);
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
