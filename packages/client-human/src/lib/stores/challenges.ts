// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Challenge store for the human client.
 * Manages active safety challenges that require human review.
 */

import type { ChallengePayload } from '@bastion/protocol';
import type { Writable } from '../store.js';
import { writable } from '../store.js';

export interface ActiveChallenge {
  readonly messageId: string;
  readonly taskId: string;
  readonly payload: ChallengePayload;
  readonly receivedAt: string;
  readonly decision?: 'approve' | 'modify' | 'cancel';
  readonly resolvedAt?: string;
}

/** AI-issued challenge stored in history alongside task challenges. */
export interface AiChallengeEntry {
  readonly challengeId: string;
  readonly reason: string;
  readonly severity: string;
  readonly suggested: string;
  readonly context?: { action?: string; target?: string };
  readonly receivedAt: string;
  readonly decision?: 'accept' | 'override' | 'cancel';
  readonly resolvedAt?: string;
  readonly source: 'ai';
}

export type ChallengeHistoryEntry = ActiveChallenge | AiChallengeEntry;

export interface ChallengesStoreState {
  readonly active: ActiveChallenge | null;
  readonly history: readonly ChallengeHistoryEntry[];
}

export function createChallengesStore(): {
  store: Writable<ChallengesStoreState>;
  receiveChallenge(messageId: string, taskId: string, payload: ChallengePayload): void;
  receiveAiChallenge(entry: Omit<AiChallengeEntry, 'source'>): void;
  resolveAiChallenge(challengeId: string, decision: 'accept' | 'override' | 'cancel'): void;
  resolve(decision: 'approve' | 'modify' | 'cancel'): ActiveChallenge | null;
  clear(): void;
} {
  const store = writable<ChallengesStoreState>({
    active: null,
    history: [],
  });

  function receiveChallenge(messageId: string, taskId: string, payload: ChallengePayload): void {
    const challenge: ActiveChallenge = {
      messageId,
      taskId,
      payload,
      receivedAt: new Date().toISOString(),
    };

    store.update((s) => ({
      active: challenge,
      history: [...s.history, challenge],
    }));
  }

  function resolve(decision: 'approve' | 'modify' | 'cancel'): ActiveChallenge | null {
    const current = store.get();
    const resolved = current.active;
    const resolvedAt = new Date().toISOString();

    store.update((s) => ({
      active: null,
      history: s.history.map((h) =>
        'messageId' in h && h.messageId === resolved?.messageId ? { ...h, decision, resolvedAt } : h,
      ),
    }));

    return resolved ? { ...resolved, decision, resolvedAt } : null;
  }

  function receiveAiChallenge(entry: Omit<AiChallengeEntry, 'source'>): void {
    store.update((s) => ({
      ...s,
      history: [...s.history, { ...entry, source: 'ai' as const }],
    }));
  }

  function resolveAiChallenge(challengeId: string, decision: 'accept' | 'override' | 'cancel'): void {
    const resolvedAt = new Date().toISOString();
    store.update((s) => ({
      ...s,
      history: s.history.map(
        (h): ChallengeHistoryEntry =>
          'challengeId' in h && h.source === 'ai' && h.challengeId === challengeId ? { ...h, decision, resolvedAt } : h,
      ),
    }));
  }

  function clear(): void {
    store.set({ active: null, history: [] });
  }

  return { store, receiveChallenge, receiveAiChallenge, resolveAiChallenge, resolve, clear };
}
