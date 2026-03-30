// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Update system store.
 *
 * Tracks self-update status: current phase, connected agents,
 * build progress, and error state. Polled from /api/update/status.
 */

import { type Readable, type Writable, derived, writable } from '../store.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'preparing'
  | 'building'
  | 'restarting'
  | 'verifying'
  | 'complete'
  | 'failed';

export interface UpdateAgent {
  readonly connectionId: string;
  readonly component: string;
  readonly agentId: string;
  readonly connectedAt: string;
}

export interface UpdateState {
  readonly phase: UpdatePhase;
  readonly targetVersion: string | null;
  readonly startedAt: string | null;
  readonly agents: readonly UpdateAgent[];
  readonly buildResults: Record<string, { status: string; duration?: number; error?: string }>;
  readonly error: string | null;
  readonly loading: boolean;
  readonly lastPolled: string | null;
}

function initialState(): UpdateState {
  return {
    phase: 'idle',
    targetVersion: null,
    startedAt: null,
    agents: [],
    buildResults: {},
    error: null,
    loading: false,
    lastPolled: null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface UpdateStore {
  readonly store: Writable<UpdateState>;
  readonly isActive: Readable<boolean>;
  readonly agentCount: Readable<number>;
  setStatus(status: Partial<UpdateState>): void;
  setAgents(agents: readonly UpdateAgent[]): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

export function createUpdateStore(): UpdateStore {
  const store = writable<UpdateState>(initialState());

  const isActive = derived([store], ([state]) => {
    return state.phase !== 'idle' && state.phase !== 'complete' && state.phase !== 'failed';
  });

  const agentCount = derived([store], ([state]) => state.agents.length);

  return {
    store,
    isActive,
    agentCount,
    setStatus(status) {
      store.update((s) => ({ ...s, ...status, lastPolled: new Date().toISOString() }));
    },
    setAgents(agents) {
      store.update((s) => ({ ...s, agents }));
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
