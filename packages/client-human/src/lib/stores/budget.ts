// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Budget store — tracks web search budget status and alerts.
 *
 * Populated by budget_status and budget_alert messages from the AI client.
 * The Budget Guard is immutable enforcement — same tier as MaliClaw.
 */

import type { Writable } from '../store.js';
import { writable } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BudgetAlertLevel = 'none' | 'warning' | 'urgent' | 'exhausted';

export interface BudgetStatusData {
  readonly searchesThisSession: number;
  readonly searchesThisDay: number;
  readonly searchesThisMonth: number;
  readonly costThisMonth: number;
  readonly budgetRemaining: number;
  readonly percentUsed: number;
  readonly monthlyCapUsd: number;
  readonly alertLevel: BudgetAlertLevel;
}

export interface BudgetAlert {
  readonly alertLevel: string;
  readonly message: string;
  readonly budgetRemaining: number;
  readonly searchesRemaining: number;
  readonly receivedAt: string;
}

export interface BudgetStoreState {
  status: BudgetStatusData | null;
  alerts: readonly BudgetAlert[];
  lastAlert: BudgetAlert | null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const INITIAL_STATE: BudgetStoreState = {
  status: null,
  alerts: [],
  lastAlert: null,
};

export interface BudgetStore {
  readonly store: Writable<BudgetStoreState>;
  setStatus(status: BudgetStatusData): void;
  addAlert(alert: Omit<BudgetAlert, 'receivedAt'>): void;
  clearLastAlert(): void;
  clear(): void;
}

export function createBudgetStore(): BudgetStore {
  const store = writable<BudgetStoreState>({ ...INITIAL_STATE });

  return {
    store,
    setStatus(status: BudgetStatusData): void {
      store.update((s) => ({ ...s, status }));
    },
    addAlert(alert: Omit<BudgetAlert, 'receivedAt'>): void {
      const fullAlert: BudgetAlert = { ...alert, receivedAt: new Date().toISOString() };
      store.update((s) => ({
        ...s,
        alerts: [...s.alerts, fullAlert],
        lastAlert: fullAlert,
      }));
    },
    clearLastAlert(): void {
      store.update((s) => ({ ...s, lastAlert: null }));
    },
    clear(): void {
      store.set({ ...INITIAL_STATE });
    },
  };
}
