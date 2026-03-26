// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Shared Bastion session — singleton stores and client management.
 *
 * All stores are module-level singletons that survive SvelteKit route
 * transitions. The main messaging page calls connect()/disconnect();
 * other routes subscribe to the same store instances to display tasks,
 * challenges, audit entries, and settings.
 */

import { BastionHumanClient } from './services/connection.js';
import type { Writable } from './store.js';
import { writable } from './store.js';
import { type AuditLogEntry, createAuditLogStore } from './stores/audit-log.js';
import { type ChallengeStats, createChallengeStatsStore } from './stores/challenge-stats.js';
import { type ActiveChallenge, createChallengesStore } from './stores/challenges.js';
import { type ConnectionStoreState, createConnectionStore } from './stores/connection.js';
import { type MemoryEntry, createMemoriesStore } from './stores/memories.js';
import { type DisplayMessage, createMessagesStore } from './stores/messages.js';
import { SAFETY_FLOOR_VALUES, createSettingsStore } from './stores/settings.js';
import { type TrackedTask, createTasksStore } from './stores/tasks.js';
import { type ApprovedTool, type PendingToolRequest, type ToolResult, createToolsStore } from './stores/tools.js';

import { getConfigStore } from './config/config-store.js';

// ---------------------------------------------------------------------------
// Constants — read from ConfigStore (persisted across sessions)
// ---------------------------------------------------------------------------

const cfg = getConfigStore();

/** Relay URL from ConfigStore. Call getRelayUrl() for latest value after config changes. */
export function getRelayUrl(): string {
  return cfg.get('relayUrl') || 'wss://10.0.30.10:9443';
}

/** User identity from ConfigStore. Call getIdentity() for latest value after config changes. */
export function getIdentity(): { type: 'human'; id: string; displayName: string } {
  return {
    type: 'human',
    id: cfg.get('userId') || 'user-default',
    displayName: cfg.get('displayName') || 'User',
  };
}

// Stable references for components that read once at import time
export const RELAY_URL = getRelayUrl();
export const IDENTITY = getIdentity();

// ---------------------------------------------------------------------------
// Shared store instances (survive route changes)
// ---------------------------------------------------------------------------

export const messages = createMessagesStore();
export const challenges = createChallengesStore();
export const tasks = createTasksStore();
export const auditLog = createAuditLogStore();
export const settings = createSettingsStore();
export const challengeStats = createChallengeStatsStore(challenges.store);
export const memories = createMemoriesStore();
export const tools = createToolsStore();

/** Challenge Me More status — driven by AI VM server clock. */
export const challengeStatus: Writable<{
  active: boolean;
  timezone: string;
  periodEnd: string | null;
  restrictions: string[];
}> = writable({ active: false, timezone: '', periodEnd: null, restrictions: [] });

/** Connection state — plain writable, populated by createConnectionStore when connected. */
export const connection: Writable<ConnectionStoreState> = writable<ConnectionStoreState>({
  status: 'disconnected',
  jwt: null,
  sessionId: null,
  peerStatus: 'unknown',
  reconnectAttempt: 0,
  lastError: null,
});

// ---------------------------------------------------------------------------
// Client management
// ---------------------------------------------------------------------------

let client: BastionHumanClient | null = null;
let connSub: (() => void) | null = null;

export function getClient(): BastionHumanClient | null {
  return client;
}

export async function connect(): Promise<void> {
  if (client) return;

  const currentRelayUrl = getRelayUrl();
  const currentIdentity = getIdentity();

  client = new BastionHumanClient({
    relayUrl: currentRelayUrl,
    identity: currentIdentity,
    WebSocketImpl: WebSocket,
  });

  // Wire connection store → shared connection writable
  const connStore = createConnectionStore(client);
  connSub = connStore.subscribe((v) => connection.set(v));

  // Route incoming relay messages to the appropriate stores
  client.on('message', handleRelayMessage);

  // Token refresh
  client.on('tokenRefreshNeeded', () => {
    if (!client) return;
    const jwt = client.jwt;
    if (jwt) {
      client.send(
        JSON.stringify({
          type: 'token_refresh',
          jwt,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  });

  await client.connect();

  // Send session_init to start the handshake
  if (client) {
    client.send(
      JSON.stringify({
        type: 'session_init',
        identity: currentIdentity,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}

export async function disconnect(): Promise<void> {
  if (!client) return;
  await client.disconnect();
  if (connSub) connSub();
  connSub = null;
  client = null;
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

function handleRelayMessage(data: string): void {
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(data);
  } catch {
    messages.addIncoming(
      'conversation',
      { content: data },
      { type: 'system', displayName: 'Relay' },
      crypto.randomUUID(),
      new Date().toISOString(),
    );
    return;
  }

  const type = String(envelope.type ?? 'conversation');

  // Session handshake
  if (type === 'session_established' && client) {
    client.setToken(String(envelope.jwt), String(envelope.expiresAt));
    console.log('[Bastion] Authenticated with relay');
    return;
  }

  // Peer status notifications
  if (type === 'peer_status' && client) {
    client.emit('peerStatus', String(envelope.status ?? 'unknown'));
    return;
  }

  // Relay errors
  if (type === 'error') {
    console.error('[Bastion] Relay error:', envelope.message);
    return;
  }

  const payload = envelope.payload ?? envelope;
  const sender = (envelope.sender ?? { type: 'system', displayName: 'Relay' }) as {
    type: string;
    displayName: string;
  };
  const id = String(envelope.id ?? crypto.randomUUID());
  const timestamp = String(envelope.timestamp ?? new Date().toISOString());

  // Challenge messages → challenges store + tasks store
  if (type === 'challenge') {
    const p = payload as Record<string, unknown>;
    const taskId = String(p.taskId ?? '');
    challenges.receiveChallenge(id, taskId, payload as never);
    if (taskId) {
      tasks.setChallenge(taskId, String(p.reason ?? ''), Number(p.layer ?? 0));
    }
    return;
  }

  // Task results → tasks store + messages
  if (type === 'task_result') {
    const p = payload as Record<string, unknown>;
    const taskId = String(p.taskId ?? '');
    if (taskId) {
      tasks.setResult(
        taskId,
        String(p.summary ?? ''),
        (p.actionsTaken as readonly string[]) ?? [],
        p.cost as { inputTokens: number; outputTokens: number; estimatedCostUsd: number } | undefined,
      );
    }
    messages.addIncoming(type, payload, sender, id, timestamp);
    return;
  }

  // Task status updates → tasks store
  if (type === 'task_status') {
    const p = payload as Record<string, unknown>;
    const taskId = String(p.taskId ?? '');
    if (taskId) {
      tasks.updateStatus(
        taskId,
        String(p.status ?? 'in_progress') as
          | 'submitted'
          | 'in_progress'
          | 'completed'
          | 'denied'
          | 'cancelled'
          | 'challenged',
        Number(p.completionPercentage ?? 0),
        p.currentAction ? String(p.currentAction) : undefined,
      );
    }
    return;
  }

  // Denials → tasks store + messages
  if (type === 'denial') {
    const p = payload as Record<string, unknown>;
    const taskId = String(p.taskId ?? '');
    if (taskId) {
      tasks.setDenial(taskId, String(p.reason ?? ''), Number(p.layer ?? 0));
    }
    messages.addIncoming(type, payload, sender, id, timestamp);
    return;
  }

  // Audit query response → populate audit log store
  if (type === 'audit_response') {
    const p = payload as Record<string, unknown>;
    auditLog.handleAuditResponse({
      entries:
        (p.entries as Array<{
          index?: number;
          timestamp?: string;
          eventType: string;
          sessionId: string;
          detail: Record<string, unknown>;
          chainHash: string;
        }>) ?? [],
      totalCount: Number(p.totalCount ?? 0),
      integrity: (p.integrity as { chainValid: boolean; entriesChecked: number; lastVerifiedAt: string }) ?? null,
    });
    return;
  }

  // Challenge status — update temporal governance indicator
  if (type === 'challenge_status') {
    const p = payload as Record<string, unknown>;
    challengeStatus.set({
      active: Boolean(p.active),
      timezone: String(p.timezone ?? ''),
      periodEnd: p.periodEnd ? String(p.periodEnd) : null,
      restrictions: Array.isArray(p.restrictions) ? (p.restrictions as string[]) : [],
    });
    return;
  }

  // Challenge config ack
  if (type === 'challenge_config_ack') {
    return; // Handled by settings page
  }

  // Tool request — AI wants to use a tool, show approval dialog
  if (type === 'tool_request') {
    const p = payload as Record<string, unknown>;
    tools.setPendingRequest({
      requestId: String(p.requestId ?? ''),
      toolId: String(p.toolId ?? ''),
      action: String(p.action ?? ''),
      parameters: (p.parameters as Record<string, unknown>) ?? {},
      mode: (p.mode as 'conversation' | 'task') ?? 'conversation',
      dangerous: Boolean(p.dangerous),
      category: (p.category as 'read' | 'write' | 'destructive') ?? 'read',
      receivedAt: timestamp,
    });
    return;
  }

  // Tool result — display in message stream
  if (type === 'tool_result') {
    const p = payload as Record<string, unknown>;
    tools.addResult({
      requestId: String(p.requestId ?? ''),
      toolId: String(p.toolId ?? ''),
      result: p.result,
      durationMs: Number(p.durationMs ?? 0),
      success: Boolean(p.success),
      error: p.error ? String(p.error) : undefined,
      receivedAt: timestamp,
    });
    // Also add to message stream
    messages.addIncoming(type, payload, sender, id, timestamp);
    return;
  }

  // Memory decision — AI confirmed a memory save
  if (type === 'memory_decision') {
    const p = payload as Record<string, unknown>;
    memories.setNotification(`Memory saved (${String(p.memoryId ?? '').slice(0, 8)})`);
    // Refresh the memory list
    if (client) {
      client.send(
        JSON.stringify({
          type: 'memory_list',
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          sender: IDENTITY,
          payload: {},
        }),
      );
    }
    return;
  }

  // Memory list response — populate memories store
  if (type === 'memory_list_response') {
    const p = payload as Record<string, unknown>;
    const mems =
      (p.memories as Array<{ id: string; content: string; category: string; createdAt: string; updatedAt: string }>) ??
      [];
    memories.setMemories(
      mems.map((m) => ({
        id: m.id,
        content: m.content,
        category: m.category as MemoryEntry['category'],
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
    );
    return;
  }

  // Audit events from relay → audit log store
  if (type === 'audit_event') {
    const p = payload as Record<string, unknown>;
    auditLog.addEntry({
      index: Number(p.index ?? auditLog.store.get().entries.length),
      timestamp: String(p.timestamp ?? timestamp),
      eventType: String(p.eventType ?? 'unknown'),
      sessionId: String(p.sessionId ?? ''),
      detail: (p.detail as Record<string, unknown>) ?? {},
      chainHash: String(p.chainHash ?? ''),
    });
    return;
  }

  // Default: conversation messages → messages store
  messages.addIncoming(type, payload, sender, id, timestamp);
}

// Re-export types that routes commonly need
export type {
  DisplayMessage,
  ActiveChallenge,
  TrackedTask,
  AuditLogEntry,
  ChallengeStats,
  MemoryEntry,
  PendingToolRequest,
  ApprovedTool,
  ToolResult,
};
export { SAFETY_FLOOR_VALUES };
export { getConfigStore, generateUserId } from './config/config-store.js';
export type { BastionConfig, ConfigStore } from './config/config-store.js';
