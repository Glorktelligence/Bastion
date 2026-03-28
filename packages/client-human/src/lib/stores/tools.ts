// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Tool approval store for the human client.
 *
 * Tracks pending tool requests that need human approval,
 * session-approved tools, and tool results.
 */

import type { Readable, Writable } from '../store.js';
import { derived, writable } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingToolRequest {
  readonly requestId: string;
  readonly toolId: string;
  readonly action: string;
  readonly parameters: Record<string, unknown>;
  readonly mode: 'conversation' | 'task';
  readonly dangerous: boolean;
  readonly category: 'read' | 'write' | 'destructive';
  readonly receivedAt: string;
}

export interface ApprovedTool {
  readonly toolId: string;
  readonly trustLevel: number;
  readonly scope: 'this_call' | 'session';
  readonly approvedAt: string;
  readonly conversationId?: string;
}

export interface ToolResult {
  readonly requestId: string;
  readonly toolId: string;
  readonly result: unknown;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: string;
  readonly receivedAt: string;
}

export interface ToolsState {
  readonly pendingRequest: PendingToolRequest | null;
  readonly sessionApproved: readonly ApprovedTool[];
  readonly recentResults: readonly ToolResult[];
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createToolsStore(): {
  store: Writable<ToolsState>;
  hasPending: Readable<boolean>;
  approvedCount: Readable<number>;
  setPendingRequest(req: PendingToolRequest | null): void;
  addApproved(tool: ApprovedTool): void;
  removeApproved(toolId: string): void;
  addResult(result: ToolResult): void;
  clear(): void;
} {
  const store = writable<ToolsState>({
    pendingRequest: null,
    sessionApproved: [],
    recentResults: [],
  });

  const hasPending = derived([store], ([s]) => s.pendingRequest !== null);
  const approvedCount = derived([store], ([s]) => s.sessionApproved.length);

  return {
    store,
    hasPending,
    approvedCount,
    setPendingRequest(req) {
      store.update((s) => ({ ...s, pendingRequest: req }));
    },
    addApproved(tool) {
      store.update((s) => ({
        ...s,
        sessionApproved: [...s.sessionApproved.filter((t) => t.toolId !== tool.toolId), tool],
      }));
    },
    removeApproved(toolId) {
      store.update((s) => ({
        ...s,
        sessionApproved: s.sessionApproved.filter((t) => t.toolId !== toolId),
      }));
    },
    addResult(result) {
      store.update((s) => ({
        ...s,
        recentResults: [result, ...s.recentResults].slice(0, 50),
      }));
    },
    clear() {
      store.set({ pendingRequest: null, sessionApproved: [], recentResults: [] });
    },
  };
}
