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

export interface TrackedTask {
  readonly taskId: string;
  readonly action: string;
  readonly target: string;
  readonly priority: string;
  readonly constraints: readonly string[];
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
  readonly challengeReason?: string;
  readonly challengeLayer?: number;
  readonly challengeDecision?: string;
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
  submitTask(taskId: string, action: string, target: string, priority: string, constraints: readonly string[]): void;
  updateStatus(taskId: string, status: TaskStatus, percentage?: number, currentAction?: string): void;
  setResult(taskId: string, summary: string, actionsTaken: readonly string[], cost?: TaskCostInfo): void;
  setDenial(taskId: string, reason: string, layer: number): void;
  setChallenge(taskId: string, reason: string, layer: number): void;
  resolveChallenge(taskId: string, decision: string): void;
  setSafetyOutcome(taskId: string, outcome: string, layer: number): void;
  selectTask(taskId: string | null): void;
  cancelTask(taskId: string): void;
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
  ): void {
    const now = new Date().toISOString();
    const task: TrackedTask = {
      taskId,
      action,
      target,
      priority,
      constraints,
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

  function setDenial(taskId: string, reason: string, layer: number): void {
    updateTask(taskId, {
      status: 'denied',
      denialReason: reason,
      denialLayer: layer,
      safetyOutcome: 'deny',
      decidingLayer: layer,
    });
  }

  function setChallenge(taskId: string, reason: string, layer: number): void {
    updateTask(taskId, {
      status: 'challenged',
      challengeReason: reason,
      challengeLayer: layer,
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
    clear,
  };
}
