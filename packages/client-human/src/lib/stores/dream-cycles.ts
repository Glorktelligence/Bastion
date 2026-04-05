// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Dream cycle store for the human client.
 * Manages dream cycle state: proposals, batch approval, and history.
 */

import type { Writable } from '../store.js';
import { writable } from '../store.js';

export interface DreamProposal {
  readonly proposalId: string;
  readonly content: string;
  readonly category: string;
  readonly reason: string;
  readonly isUpdate: boolean;
  readonly existingMemoryContent: string | null;
  selected: boolean;
}

export interface DreamCycleState {
  readonly status: 'idle' | 'running' | 'reviewing' | 'complete';
  readonly conversationId: string | null;
  readonly proposals: readonly DreamProposal[];
  readonly lastResult: DreamCycleCompleteInfo | null;
  readonly history: readonly DreamCycleCompleteInfo[];
}

export interface DreamCycleCompleteInfo {
  readonly conversationId: string;
  readonly candidateCount: number;
  readonly tokensUsed: { readonly input: number; readonly output: number };
  readonly estimatedCost: number;
  readonly durationMs: number;
  readonly completedAt: string;
}

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
  dismissAll(): void;
  reset(): void;
} {
  const store = writable<DreamCycleState>({
    status: 'idle',
    conversationId: null,
    proposals: [],
    lastResult: null,
    history: [],
  });

  function startDreamCycle(conversationId: string): void {
    store.update((s) => ({
      ...s,
      status: 'running' as const,
      conversationId,
      proposals: [],
    }));
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
  }

  function completeDreamCycle(info: DreamCycleCompleteInfo): void {
    store.update((s) => ({
      ...s,
      status: s.proposals.length > 0 ? ('reviewing' as const) : ('complete' as const),
      lastResult: info,
      history: [...s.history, info],
    }));
  }

  function toggleProposal(proposalId: string): void {
    store.update((s) => ({
      ...s,
      proposals: s.proposals.map((p) => (p.proposalId === proposalId ? { ...p, selected: !p.selected } : p)),
    }));
  }

  function getSelectedProposals(): DreamProposal[] {
    return store.get().proposals.filter((p) => p.selected);
  }

  function dismissAll(): void {
    store.update((s) => ({
      ...s,
      status: 'idle' as const,
      proposals: [],
      conversationId: null,
    }));
  }

  function reset(): void {
    store.set({
      status: 'idle',
      conversationId: null,
      proposals: [],
      lastResult: null,
      history: [],
    });
  }

  return {
    store,
    startDreamCycle,
    addProposal,
    completeDreamCycle,
    toggleProposal,
    getSelectedProposals,
    dismissAll,
    reset,
  };
}
