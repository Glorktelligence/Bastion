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

export interface ChallengesStoreState {
  readonly active: ActiveChallenge | null;
  readonly history: readonly ActiveChallenge[];
}

export function createChallengesStore(): {
  store: Writable<ChallengesStoreState>;
  receiveChallenge(messageId: string, taskId: string, payload: ChallengePayload): void;
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
      history: s.history.map((h) => (h.messageId === resolved?.messageId ? { ...h, decision, resolvedAt } : h)),
    }));

    return resolved ? { ...resolved, decision, resolvedAt } : null;
  }

  function clear(): void {
    store.set({ active: null, history: [] });
  }

  return { store, receiveChallenge, resolve, clear };
}
