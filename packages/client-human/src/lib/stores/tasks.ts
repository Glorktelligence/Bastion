// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Task tracking store for the human client.
 * Tracks submitted tasks, their status, safety evaluation outcomes,
 * and results throughout their lifecycle.
 */

import type { Readable, Writable } from '../store.js';
import { derived, writable } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'submitted' | 'in_progress' | 'completed' | 'denied' | 'cancelled' | 'challenged';

export interface TaskCostInfo {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
}

export interface ChallengeFactorInfo {
  readonly name: string;
  readonly triggered: boolean;
  readonly weight: number;
  readonly detail: string;
}

export interface TrackedTask {
  readonly taskId: string;
  readonly action: string;
  readonly target: string;
  readonly priority: string;
  readonly constraints: readonly string[];
  readonly parameters?: Record<string, unknown>;
  readonly description?: string;
  readonly submittedAt: string;
  readonly status: TaskStatus;
  readonly completionPercentage: number;
  readonly currentAction?: string;
  readonly safetyOutcome?: string;
  readonly decidingLayer?: number;
  readonly resultSummary?: string;
  readonly actionsTaken?: readonly string[];
  readonly cost?: TaskCostInfo;
  readonly denialReason?: string;
  readonly denialLayer?: number;
  readonly denialDetail?: string;
  readonly challengeReason?: string;
  readonly challengeLayer?: number;
  readonly challengeDecision?: string;
  readonly challengeRiskScore?: number;
  readonly challengeThreshold?: number;
  readonly challengeFactors?: readonly ChallengeFactorInfo[];
  readonly challengeSuggestedAlternatives?: readonly string[];
  readonly updatedAt: string;
}

export interface TasksStoreState {
  readonly tasks: readonly TrackedTask[];
  readonly selectedTaskId: string | null;
  readonly loading: boolean;
  readonly error: string | null;
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createTasksStore(): {
  store: Writable<TasksStoreState>;
  activeTasks: Readable<readonly TrackedTask[]>;
  completedTasks: Readable<readonly TrackedTask[]>;
  selectedTask: Readable<TrackedTask | null>;
  taskCount: Readable<number>;
  submitTask(
    taskId: string,
    action: string,
    target: string,
    priority: string,
    constraints: readonly string[],
    params?: Record<string, unknown>,
    description?: string,
  ): void;
  updateStatus(taskId: string, status: TaskStatus, percentage?: number, currentAction?: string): void;
  setResult(taskId: string, summary: string, actionsTaken: readonly string[], cost?: TaskCostInfo): void;
  setDenial(taskId: string, reason: string, layer: number, detail?: string): void;
  setChallenge(
    taskId: string,
    reason: string,
    layer: number,
    factors?: readonly ChallengeFactorInfo[],
    riskScore?: number,
    threshold?: number,
    alternatives?: readonly string[],
  ): void;
  resolveChallenge(taskId: string, decision: string): void;
  setSafetyOutcome(taskId: string, outcome: string, layer: number): void;
  selectTask(taskId: string | null): void;
  cancelTask(taskId: string): void;
  clearCompleted(): void;
  clear(): void;
} {
  const store = writable<TasksStoreState>({
    tasks: [],
    selectedTaskId: null,
    loading: false,
    error: null,
  });

  // -------------------------------------------------------------------------
  // Derived stores
  // -------------------------------------------------------------------------

  const activeTasks = derived([store], ([state]) =>
    state.tasks.filter((t) => t.status === 'submitted' || t.status === 'in_progress' || t.status === 'challenged'),
  );

  const completedTasks = derived([store], ([state]) =>
    state.tasks.filter((t) => t.status === 'completed' || t.status === 'denied' || t.status === 'cancelled'),
  );

  const selectedTask = derived(
    [store],
    ([state]) => state.tasks.find((t) => t.taskId === state.selectedTaskId) ?? null,
  );

  const taskCount = derived([store], ([state]) => state.tasks.length);

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  function updateTask(taskId: string, updates: Partial<TrackedTask>): void {
    store.update((s) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.taskId === taskId ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t)),
    }));
  }

  function submitTask(
    taskId: string,
    action: string,
    target: string,
    priority: string,
    constraints: readonly string[],
    params?: Record<string, unknown>,
    description?: string,
  ): void {
    const now = new Date().toISOString();
    const task: TrackedTask = {
      taskId,
      action,
      target,
      priority,
      constraints,
      parameters: params,
      description,
      submittedAt: now,
      status: 'submitted',
      completionPercentage: 0,
      updatedAt: now,
    };

    store.update((s) => ({
      ...s,
      tasks: [task, ...s.tasks],
    }));
  }

  function updateStatus(taskId: string, status: TaskStatus, percentage?: number, currentAction?: string): void {
    updateTask(taskId, {
      status,
      ...(percentage !== undefined ? { completionPercentage: percentage } : {}),
      ...(currentAction !== undefined ? { currentAction } : {}),
    });
  }

  function setResult(taskId: string, summary: string, actionsTaken: readonly string[], cost?: TaskCostInfo): void {
    updateTask(taskId, {
      status: 'completed',
      completionPercentage: 100,
      resultSummary: summary,
      actionsTaken,
      cost,
    });
  }

  function setDenial(taskId: string, reason: string, layer: number, detail?: string): void {
    updateTask(taskId, {
      status: 'denied',
      denialReason: reason,
      denialLayer: layer,
      denialDetail: detail,
      safetyOutcome: 'deny',
      decidingLayer: layer,
    });
  }

  function setChallenge(
    taskId: string,
    reason: string,
    layer: number,
    factors?: readonly ChallengeFactorInfo[],
    riskScore?: number,
    threshold?: number,
    alternatives?: readonly string[],
  ): void {
    updateTask(taskId, {
      status: 'challenged',
      challengeReason: reason,
      challengeLayer: layer,
      challengeFactors: factors,
      challengeRiskScore: riskScore,
      challengeThreshold: threshold,
      challengeSuggestedAlternatives: alternatives,
      safetyOutcome: 'challenge',
      decidingLayer: layer,
    });
  }

  function resolveChallenge(taskId: string, decision: string): void {
    const task = store.get().tasks.find((t) => t.taskId === taskId);
    if (!task) return;

    const newStatus: TaskStatus = decision === 'cancel' ? 'cancelled' : 'in_progress';
    updateTask(taskId, {
      status: newStatus,
      challengeDecision: decision,
    });
  }

  function setSafetyOutcome(taskId: string, outcome: string, layer: number): void {
    updateTask(taskId, {
      safetyOutcome: outcome,
      decidingLayer: layer,
    });
  }

  function selectTask(taskId: string | null): void {
    store.update((s) => ({ ...s, selectedTaskId: taskId }));
  }

  function cancelTask(taskId: string): void {
    updateTask(taskId, { status: 'cancelled' });
  }

  function clearCompleted(): void {
    store.update((s) => ({
      ...s,
      tasks: s.tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'denied'),
    }));
  }

  function clear(): void {
    store.set({
      tasks: [],
      selectedTaskId: null,
      loading: false,
      error: null,
    });
  }

  return {
    store,
    activeTasks,
    completedTasks,
    selectedTask,
    taskCount,
    submitTask,
    updateStatus,
    setResult,
    setDenial,
    setChallenge,
    resolveChallenge,
    setSafetyOutcome,
    selectTask,
    cancelTask,
    clearCompleted,
    clear,
  };
}
