// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Dream cycle store for the human client.
 * Manages dream cycle state: proposals, batch approval, and history.
 * Persists to localStorage for crash recovery and session continuity.
 */

import type { Writable } from '../store.js';
import { writable } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DreamProposal {
  readonly proposalId: string;
  readonly content: string;
  readonly category: string;
  readonly reason: string;
  readonly isUpdate: boolean;
  readonly existingMemoryContent: string | null;
  selected: boolean;
}

export interface MemoryBatch {
  readonly batchId: string;
  readonly source: string;
  readonly conversationId: string | null;
  readonly proposals: readonly DreamProposal[];
  readonly receivedAt: string;
}

export interface DreamCycleState {
  readonly status: 'idle' | 'running' | 'reviewing' | 'complete';
  readonly conversationId: string | null;
  readonly proposals: readonly DreamProposal[];
  readonly lastResult: DreamCycleCompleteInfo | null;
  readonly history: readonly DreamCycleCompleteInfo[];
  readonly pendingBatches: readonly MemoryBatch[];
}

export interface DreamCycleCompleteInfo {
  readonly conversationId: string;
  readonly candidateCount: number;
  readonly tokensUsed: { readonly input: number; readonly output: number };
  readonly estimatedCost: number;
  readonly durationMs: number;
  readonly completedAt: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_STATE: DreamCycleState = {
  status: 'idle',
  conversationId: null,
  proposals: [],
  lastResult: null,
  history: [],
  pendingBatches: [],
};

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'bastion-dream-state';

function persistState(state: DreamCycleState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (file:// protocol, SSR, etc.)
  }
}

function loadPersistedState(): DreamCycleState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const raw_data = JSON.parse(raw) as Partial<DreamCycleState>;
    // Migration: ensure pendingBatches exists (added in v0.8.2)
    const data: DreamCycleState = {
      ...DEFAULT_STATE,
      ...raw_data,
      pendingBatches: Array.isArray(raw_data.pendingBatches) ? raw_data.pendingBatches : [],
    };
    // Crash recovery: if status was 'running' when browser died, reset to idle
    if (data.status === 'running') {
      return { ...data, status: 'idle' };
    }
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createDreamCyclesStore(): {
  store: Writable<DreamCycleState>;
  startDreamCycle(conversationId: string): void;
  addProposal(
    proposalId: string,
    content: string,
    category: string,
    reason: string,
    isUpdate: boolean,
    existingMemoryContent: string | null,
  ): void;
  completeDreamCycle(info: DreamCycleCompleteInfo): void;
  toggleProposal(proposalId: string): void;
  getSelectedProposals(): DreamProposal[];
  addBatch(batch: MemoryBatch): void;
  removeBatch(batchId: string): void;
  toggleBatchProposal(batchId: string, proposalId: string): void;
  editBatchProposal(batchId: string, proposalId: string, editedContent: string): void;
  getBatchDecisions(
    batchId: string,
  ): Array<{ proposalId: string; decision: 'approved' | 'rejected' | 'edited'; editedContent: string | null }>;
  dismissAll(): void;
  clearHistory(): void;
  reset(): void;
} {
  const initial = loadPersistedState() ?? DEFAULT_STATE;
  const store = writable<DreamCycleState>(initial);

  /** Persist current state after every mutation. */
  function persist(): void {
    persistState(store.get());
  }

  function startDreamCycle(conversationId: string): void {
    store.update((s) => ({
      ...s,
      status: 'running' as const,
      conversationId,
      proposals: [],
    }));
    persist();
  }

  function addProposal(
    proposalId: string,
    content: string,
    category: string,
    reason: string,
    isUpdate: boolean,
    existingMemoryContent: string | null,
  ): void {
    const proposal: DreamProposal = {
      proposalId,
      content,
      category,
      reason,
      isUpdate,
      existingMemoryContent,
      selected: true,
    };

    store.update((s) => ({
      ...s,
      proposals: [...s.proposals, proposal],
    }));
    persist();
  }

  function completeDreamCycle(info: DreamCycleCompleteInfo): void {
    store.update((s) => ({
      ...s,
      status: s.proposals.length > 0 ? ('reviewing' as const) : ('complete' as const),
      lastResult: info,
      history: [...s.history, info],
    }));
    persist();
  }

  function toggleProposal(proposalId: string): void {
    store.update((s) => ({
      ...s,
      proposals: s.proposals.map((p) => (p.proposalId === proposalId ? { ...p, selected: !p.selected } : p)),
    }));
    persist();
  }

  function getSelectedProposals(): DreamProposal[] {
    return store.get().proposals.filter((p) => p.selected);
  }

  function addBatch(batch: MemoryBatch): void {
    store.update((s) => ({
      ...s,
      pendingBatches: [...s.pendingBatches, batch],
    }));
    persist();
  }

  function removeBatch(batchId: string): void {
    store.update((s) => ({
      ...s,
      pendingBatches: s.pendingBatches.filter((b) => b.batchId !== batchId),
    }));
    persist();
  }

  function toggleBatchProposal(batchId: string, proposalId: string): void {
    store.update((s) => ({
      ...s,
      pendingBatches: s.pendingBatches.map((b) =>
        b.batchId === batchId
          ? {
              ...b,
              proposals: b.proposals.map((p) => (p.proposalId === proposalId ? { ...p, selected: !p.selected } : p)),
            }
          : b,
      ),
    }));
    persist();
  }

  function editBatchProposal(batchId: string, proposalId: string, editedContent: string): void {
    store.update((s) => ({
      ...s,
      pendingBatches: s.pendingBatches.map((b) =>
        b.batchId === batchId
          ? {
              ...b,
              proposals: b.proposals.map((p) =>
                p.proposalId === proposalId ? { ...p, content: editedContent, selected: true } : p,
              ),
            }
          : b,
      ),
    }));
    persist();
  }

  function getBatchDecisions(
    batchId: string,
  ): Array<{ proposalId: string; decision: 'approved' | 'rejected' | 'edited'; editedContent: string | null }> {
    const batch = store.get().pendingBatches.find((b) => b.batchId === batchId);
    if (!batch) return [];
    return batch.proposals.map((p) => ({
      proposalId: p.proposalId,
      decision: p.selected ? ('approved' as const) : ('rejected' as const),
      editedContent: null,
    }));
  }

  function dismissAll(): void {
    store.update((s) => ({
      ...s,
      status: 'idle' as const,
      proposals: [],
      conversationId: null,
    }));
    persist();
  }

  function clearHistory(): void {
    store.update((s) => ({
      ...s,
      history: [],
      lastResult: null,
    }));
    persist();
  }

  function reset(): void {
    store.set(DEFAULT_STATE);
    persist();
  }

  return {
    store,
    startDreamCycle,
    addProposal,
    completeDreamCycle,
    toggleProposal,
    getSelectedProposals,
    addBatch,
    removeBatch,
    toggleBatchProposal,
    editBatchProposal,
    getBatchDecisions,
    dismissAll,
    clearHistory,
    reset,
  };
}
