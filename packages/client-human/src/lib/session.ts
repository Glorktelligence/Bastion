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
 *
 * Auto-connect: if ConfigStore has setupComplete=true and autoConnect=true,
 * calling autoConnect() from the layout will initiate connection immediately.
 * After reconnection, state is re-hydrated by querying extension_query,
 * memory_list, and project_list.
 */

import { BastionHumanClient } from './services/connection.js';
import type { Writable } from './store.js';
import { writable } from './store.js';
import { type AuditLogEntry, createAuditLogStore } from './stores/audit-log.js';
import { type BudgetStatusData, createBudgetStore } from './stores/budget.js';
import { type ChallengeStats, createChallengeStatsStore } from './stores/challenge-stats.js';
import { type ActiveChallenge, createChallengesStore } from './stores/challenges.js';
import { type ConnectionStoreState, createConnectionStore } from './stores/connection.js';
import { type ConversationEntry, type ConversationMessage, createConversationsStore } from './stores/conversations.js';
import { type ExtensionInfo, createExtensionsStore } from './stores/extensions.js';
import { type MemoryEntry, createMemoriesStore } from './stores/memories.js';
import { type DisplayMessage, createMessagesStore } from './stores/messages.js';
import { type LoadingMode, type ProjectConfig, type ProjectFile, createProjectsStore } from './stores/projects.js';
import { type ProviderCapabilities, type ProviderInfo, createProviderStore } from './stores/provider.js';
import { SAFETY_FLOOR_VALUES, createSettingsStore } from './stores/settings.js';
import { type TrackedTask, createTasksStore } from './stores/tasks.js';
import { type ApprovedTool, type PendingToolRequest, type ToolResult, createToolsStore } from './stores/tools.js';

import { getConfigStore } from './config/config-store.js';
import {
  createSessionCipher,
  decodeBase64,
  decryptPayload,
  deriveSessionKeys,
  encodeBase64,
  encryptPayload,
  generateKeyPair,
} from './crypto/browser-crypto.js';
import type { BrowserKeyPair, BrowserSessionCipher } from './crypto/browser-crypto.js';

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
export const budget = createBudgetStore();
export const projects = createProjectsStore();
export const provider = createProviderStore();
export const extensions = createExtensionsStore();
export const conversations = createConversationsStore();

/** General-purpose toast notifications (cross-cutting — not owned by a single store). */
export interface ToastNotification {
  readonly id: string;
  readonly message: string;
  readonly level: 'info' | 'success' | 'warning' | 'error';
  readonly timestamp: string;
}
export const notifications: Writable<readonly ToastNotification[]> = writable([]);

export function addNotification(message: string, level: ToastNotification['level'] = 'info'): void {
  const n: ToastNotification = { id: crypto.randomUUID(), message, level, timestamp: new Date().toISOString() };
  notifications.update((list) => [n, ...list].slice(0, 10));
}

export function dismissNotification(id: string): void {
  notifications.update((list) => list.filter((n) => n.id !== id));
}

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

// Store client on globalThis to survive HMR module re-evaluation in dev mode.
// Without this, SvelteKit HMR re-creates session.ts module scope, orphaning the WebSocket.
const _g = globalThis as unknown as Record<string, unknown>;
let client: BastionHumanClient | null = (_g.__bastionClient as BastionHumanClient) ?? null;
let connSub: (() => void) | null = (_g.__bastionConnSub as () => void) ?? null;

export function getClient(): BastionHumanClient | null {
  return client;
}

export async function connect(): Promise<void> {
  if (client) {
    console.log('[Bastion] connect() called but client already exists — skipping');
    return;
  }
  console.log('[Bastion] connect() — creating new WebSocket client');

  // Initialise crypto subsystem and generate X25519 keypair
  await initE2E();

  const currentRelayUrl = getRelayUrl();
  const currentIdentity = getIdentity();

  client = new BastionHumanClient({
    relayUrl: currentRelayUrl,
    identity: currentIdentity,
    reconnect: cfg.get('autoReconnect'),
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

  // Log disconnection reasons for debugging
  client.on('disconnected', (code, reason) => {
    console.log(`[Bastion] WebSocket disconnected: code=${code}, reason=${reason}`);
  });

  // Re-hydrate state after reconnection
  client.on('reconnected', () => {
    hydrateState();
  });

  await client.connect();

  // Persist client reference on globalThis for HMR survival
  _g.__bastionClient = client;
  _g.__bastionConnSub = connSub;

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
  console.log('[Bastion] disconnect() called — closing WebSocket');
  console.trace('[Bastion] disconnect() call stack');
  await client.disconnect();
  if (connSub) connSub();
  connSub = null;
  client = null;
  _g.__bastionClient = null;
  _g.__bastionConnSub = null;
  // Destroy cipher on disconnect — new session needs new key exchange
  if (sessionCipher) {
    sessionCipher.destroy();
    sessionCipher = null;
  }
  e2eStatus.set({ available: e2eAvailable, active: false });
}

// ---------------------------------------------------------------------------
// E2E Encryption — X25519 key exchange + KDF ratchet
// ---------------------------------------------------------------------------

let ownKeyPair: BrowserKeyPair | null = (_g.__bastionKeyPair as BrowserKeyPair) ?? null;
let sessionCipher: BrowserSessionCipher | null = (_g.__bastionCipher as BrowserSessionCipher) ?? null;
let e2eAvailable = (_g.__bastionE2eAvailable as boolean) ?? false;

/** Whether E2E encryption is active (session cipher established). */
export const e2eStatus: Writable<{ available: boolean; active: boolean }> = writable({
  available: false,
  active: false,
});

/** Messages that must stay plaintext — relay control or pre-key-exchange. */
const PLAINTEXT_TYPES = new Set([
  'session_init',
  'session_established',
  'key_exchange',
  'token_refresh',
  'ping',
  'pong',
  'peer_status',
  'error',
  'config_ack',
  'config_nack',
]);

/**
 * Initialise crypto and generate keypair. Called before connect.
 * Gracefully optional — if sodium can't load (browser compat issue),
 * the client operates without E2E encryption (degraded mode).
 */
async function initE2E(): Promise<void> {
  try {
    ownKeyPair = generateKeyPair();
    e2eAvailable = true;
    _g.__bastionKeyPair = ownKeyPair;
    _g.__bastionE2eAvailable = true;
    e2eStatus.set({ available: true, active: false });
    console.log('[Bastion] X25519 keypair generated (tweetnacl) — E2E available');
  } catch (err) {
    e2eAvailable = false;
    ownKeyPair = null;
    e2eStatus.set({ available: false, active: false });
    console.warn('[Bastion] E2E unavailable:', err instanceof Error ? err.message : String(err));
  }
}

/** Send key_exchange message to peer. No-op if E2E unavailable. */
function sendKeyExchange(): void {
  if (!client || !ownKeyPair || !e2eAvailable) return;
  const pubKeyB64 = encodeBase64(ownKeyPair.publicKey);
  client.send(
    JSON.stringify({
      type: 'key_exchange',
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      sender: getIdentity(),
      payload: { publicKey: pubKeyB64 },
    }),
  );
  console.log('[Bastion] Key exchange: public key sent to peer');
}

/** Handle incoming key_exchange — derive session keys and create cipher. */
function handlePeerKeyExchange(peerPublicKeyB64: string): void {
  if (!ownKeyPair || !e2eAvailable) return;

  const peerPublicKey = decodeBase64(peerPublicKeyB64);

  // Human client is the 'initiator' role (AI is 'responder')
  const sessionKeys = deriveSessionKeys('initiator', ownKeyPair, peerPublicKey);
  sessionCipher = createSessionCipher(sessionKeys);
  _g.__bastionCipher = sessionCipher;
  e2eStatus.set({ available: true, active: true });
  console.log('[Bastion] E2E session established — interoperable ratchet active');
}

/**
 * Send a message, encrypting the payload if session cipher is active.
 * Metadata stays plaintext for relay routing. Payload is encrypted.
 */
export function sendSecure(envelope: Record<string, unknown>): boolean {
  if (!client) return false;

  const msgType = String(envelope.type ?? '');
  if (!sessionCipher || PLAINTEXT_TYPES.has(msgType)) {
    return client.send(JSON.stringify(envelope));
  }

  try {
    const { encryptedPayload, nonce } = encryptPayload(JSON.stringify(envelope.payload ?? {}), sessionCipher);
    const encrypted = {
      id: envelope.id,
      type: envelope.type,
      timestamp: envelope.timestamp,
      sender: envelope.sender,
      encryptedPayload,
      nonce,
    };
    return client.send(JSON.stringify(encrypted));
  } catch (err) {
    console.error('[Bastion] Encryption failed:', err instanceof Error ? err.message : String(err));
    return client.send(JSON.stringify(envelope));
  }
}

/**
 * Attempt to decrypt an incoming message envelope.
 * Returns the envelope with decrypted payload, or the original if not encrypted.
 */
function tryDecrypt(msg: Record<string, unknown>): Record<string, unknown> {
  if (!msg.encryptedPayload || !sessionCipher) return msg;

  try {
    const payload = decryptPayload(String(msg.encryptedPayload), String(msg.nonce), sessionCipher);
    if (!payload) {
      console.error('[Bastion] Decryption failed — MAC verification error');
      return msg;
    }
    const { encryptedPayload: _ep, nonce: _n, ...rest } = msg;
    return { ...rest, payload };
  } catch (err) {
    console.error('[Bastion] Decryption failed:', err instanceof Error ? err.message : String(err));
    return msg;
  }
}

// ---------------------------------------------------------------------------
// Auto-connect — called from layout on app open
// ---------------------------------------------------------------------------

let autoConnectAttempted = (_g.__bastionAutoConnectAttempted as boolean) ?? false;

/** Whether auto-connect is currently in progress. Subscribe from UI to avoid showing manual connect screen. */
export const autoConnecting: Writable<boolean> = writable(false);

/**
 * Attempt auto-connection if config is complete.
 * Safe to call multiple times — only runs once per session.
 */
export async function tryAutoConnect(): Promise<void> {
  if (autoConnectAttempted) return;
  autoConnectAttempted = true;
  _g.__bastionAutoConnectAttempted = true;

  if (!cfg.get('setupComplete')) return;
  if (!cfg.get('autoConnect')) return;

  autoConnecting.set(true);
  try {
    await connect();
  } catch (err) {
    console.warn('[Bastion] Auto-connect failed:', err instanceof Error ? err.message : String(err));
    // Connection failure will trigger reconnection via BastionHumanClient
  } finally {
    autoConnecting.set(false);
  }
}

/**
 * Reset auto-connect flag (e.g. after config reset).
 */
export function resetAutoConnect(): void {
  autoConnectAttempted = false;
}

// ---------------------------------------------------------------------------
// State re-hydration — after auth or reconnect
// ---------------------------------------------------------------------------

/**
 * Send queries to re-hydrate all store state from the relay/AI client.
 * Called after initial authentication and after reconnection.
 */
function hydrateState(): void {
  if (!client || !client.isConnected) return;

  const identity = getIdentity();
  const ts = new Date().toISOString();

  // Re-send session_init for reconnect (relay needs to re-authenticate)
  client.send(
    JSON.stringify({
      type: 'session_init',
      identity,
      timestamp: ts,
    }),
  );
}

/**
 * Send data queries to populate stores. Called after successful authentication.
 */
function sendHydrationQueries(): void {
  if (!client || !client.isConnected) return;

  const identity = getIdentity();
  const ts = new Date().toISOString();

  // Request extension list
  client.send(
    JSON.stringify({
      type: 'extension_query',
      id: crypto.randomUUID(),
      timestamp: ts,
      sender: identity,
    }),
  );

  // Request memory list
  client.send(
    JSON.stringify({
      type: 'memory_list',
      id: crypto.randomUUID(),
      timestamp: ts,
      sender: identity,
      payload: {},
    }),
  );

  // Request project file list
  client.send(
    JSON.stringify({
      type: 'project_list',
      id: crypto.randomUUID(),
      timestamp: ts,
      sender: identity,
      payload: {},
    }),
  );

  // Request conversation list (multi-conversation persistence)
  client.send(
    JSON.stringify({
      type: 'conversation_list',
      id: crypto.randomUUID(),
      timestamp: ts,
      sender: identity,
      payload: { includeArchived: true },
    }),
  );
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

  // Decrypt if this is an encrypted envelope
  envelope = tryDecrypt(envelope);

  const type = String(envelope.type ?? 'conversation');

  // Session handshake
  if (type === 'session_established' && client) {
    client.setToken(String(envelope.jwt), String(envelope.expiresAt));
    console.log('[Bastion] Authenticated with relay');
    cfg.set('lastConnected', new Date().toISOString());
    // Hydrate stores after authentication
    sendHydrationQueries();
    return;
  }

  // Peer status notifications
  if (type === 'peer_status' && client) {
    const peerStatus = String(envelope.status ?? 'unknown');
    client.emit('peerStatus', peerStatus);

    // When peer connects, initiate E2E key exchange
    if (peerStatus === 'active') {
      sendKeyExchange();
    }
    return;
  }

  // Relay errors
  if (type === 'error') {
    console.error('[Bastion] Relay error:', envelope.message);
    return;
  }

  // Key exchange — derive session keys and create cipher
  if (type === 'key_exchange') {
    const pubKey = (envelope.payload as Record<string, unknown>)?.publicKey ?? envelope.publicKey;
    if (pubKey && typeof pubKey === 'string') {
      try {
        handlePeerKeyExchange(pubKey);
      } catch (err) {
        console.error('[Bastion] Key exchange failed:', err instanceof Error ? err.message : String(err));
      }
    }
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
      (p.memories as Array<{
        id: string;
        content: string;
        category: string;
        createdAt: string;
        updatedAt: string;
        conversationId?: string | null;
      }>) ?? [];
    memories.setMemories(
      mems.map((m) => ({
        id: m.id,
        content: m.content,
        category: m.category as MemoryEntry['category'],
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        conversationId: m.conversationId ?? null,
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

  // Budget status → budget store
  if (type === 'budget_status') {
    budget.setStatus(payload as unknown as BudgetStatusData);
    return;
  }

  // Budget alert → budget store
  if (type === 'budget_alert') {
    const p = payload as Record<string, unknown>;
    budget.addAlert({
      alertLevel: String(p.alertLevel ?? 'warning_50'),
      message: String(p.message ?? ''),
      budgetRemaining: Number(p.budgetRemaining ?? 0),
      searchesRemaining: Number(p.searchesRemaining ?? 0),
    });
    return;
  }

  // Project list response → populate projects store
  if (type === 'project_list_response') {
    const p = payload as Record<string, unknown>;
    const files =
      (p.files as Array<{
        path: string;
        size?: number;
        sizeBytes?: number;
        mimeType?: string;
        lastModified?: string;
      }>) ?? [];
    projects.setFiles(
      files.map((f) => ({
        path: f.path,
        size: f.size ?? f.sizeBytes ?? 0,
        mimeType: f.mimeType ?? 'text/plain',
        lastModified: f.lastModified,
      })),
      Number(p.totalSize ?? 0),
      Number(p.totalCount ?? files.length),
    );
    return;
  }

  // Project sync ack → update local file list + toast
  if (type === 'project_sync_ack') {
    const p = payload as Record<string, unknown>;
    const path = String(p.path ?? '');
    const size = Number(p.size ?? 0);
    if (path) {
      projects.upsertFile(path, size);
      projects.setNotification(`File synced: ${path}`);
    }
    return;
  }

  // Project config ack → toast
  if (type === 'project_config_ack') {
    projects.setNotification('Project config updated');
    return;
  }

  // Config ack → success toast
  if (type === 'config_ack') {
    addNotification('Settings saved', 'success');
    return;
  }

  // Config nack → error toast with reason
  if (type === 'config_nack') {
    const p = payload as Record<string, unknown>;
    const reason = String(p.reason ?? 'Unknown reason');
    addNotification(`Settings rejected: ${reason}`, 'error');
    return;
  }

  // Session conflict — another client connecting with same identity
  if (type === 'session_conflict') {
    addNotification('Session conflict — another client is connecting with your identity', 'warning');
    return;
  }

  // Session superseded — disconnected by another client
  if (type === 'session_superseded') {
    addNotification('Your session was superseded by another client. You have been disconnected.', 'error');
    // Auto-disconnect since our session is no longer valid
    disconnect();
    return;
  }

  // Tool alert — new/lost/changed tool notifications
  if (type === 'tool_alert') {
    const p = payload as Record<string, unknown>;
    const alertType = String(p.alertType ?? p.type ?? 'info');
    const toolId = String(p.toolId ?? '');
    if (alertType === 'new_tool') {
      addNotification(`New tool detected: ${toolId}. Accept or decline in Settings.`, 'info');
    } else if (alertType === 'lost_tool') {
      addNotification(`Tool unavailable: ${toolId}. Previously registered but no longer reported.`, 'warning');
    } else if (alertType === 'changed_tool') {
      addNotification(`Tool changed: ${toolId}. Capabilities have been updated.`, 'info');
    } else {
      addNotification(`Tool alert: ${toolId} — ${String(p.message ?? alertType)}`, 'info');
    }
    return;
  }

  // Conversation list response → populate conversations store
  if (type === 'conversation_list_response') {
    const p = payload as Record<string, unknown>;
    const convs =
      (p.conversations as Array<{
        id: string;
        name: string;
        type: 'normal' | 'game';
        updatedAt: string;
        messageCount: number;
        lastMessagePreview: string;
        archived: boolean;
      }>) ?? [];
    conversations.setConversations(convs);
    // Auto-switch to most recent non-archived if no active conversation
    const state = conversations.store.get();
    if (!state.activeConversationId && convs.length > 0) {
      const firstActive = convs.find((c) => !c.archived);
      if (firstActive && client) {
        client.send(
          JSON.stringify({
            type: 'conversation_switch',
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            sender: getIdentity(),
            payload: { conversationId: firstActive.id },
          }),
        );
      }
    }
    return;
  }

  // Conversation create ack → add to list and switch
  if (type === 'conversation_create_ack') {
    const p = payload as Record<string, unknown>;
    conversations.createConversation({
      id: String(p.conversationId ?? ''),
      name: String(p.name ?? 'New Conversation'),
      type: (p.type as 'normal' | 'game') ?? 'normal',
      updatedAt: String(p.createdAt ?? new Date().toISOString()),
      messageCount: 0,
      lastMessagePreview: '',
      archived: false,
      preferredAdapter: p.preferredAdapter ? String(p.preferredAdapter) : null,
    });
    conversations.setActiveConversation(String(p.conversationId ?? ''), []);
    addNotification(`Conversation created: ${String(p.name ?? 'New Conversation')}`, 'success');
    return;
  }

  // Conversation switch ack → load messages
  if (type === 'conversation_switch_ack') {
    const p = payload as Record<string, unknown>;
    const convId = String(p.conversationId ?? '');
    const msgs =
      (p.recentMessages as Array<{
        id: string;
        conversationId: string;
        role: 'user' | 'assistant';
        type: string;
        content: string;
        timestamp: string;
        hash: string;
        previousHash: string | null;
        pinned: boolean;
      }>) ?? [];
    conversations.setActiveConversation(
      convId,
      msgs.map((m) => ({
        ...m,
        senderName: m.role === 'user' ? getIdentity().displayName : 'Claude',
        direction: m.role === 'user' ? ('outgoing' as const) : ('incoming' as const),
      })),
    );
    // Clear approved tools display — trust is per-conversation on AI side
    tools.clear();
    return;
  }

  // Conversation history response → prepend older messages
  if (type === 'conversation_history_response') {
    const p = payload as Record<string, unknown>;
    const msgs =
      (p.messages as Array<{
        id: string;
        conversationId: string;
        role: 'user' | 'assistant';
        type: string;
        content: string;
        timestamp: string;
        hash: string;
        previousHash: string | null;
        pinned: boolean;
      }>) ?? [];
    // History comes newest-first — reverse for display order
    const ordered = [...msgs].reverse();
    conversations.prependMessages(
      ordered.map((m) => ({
        ...m,
        senderName: m.role === 'user' ? getIdentity().displayName : 'Claude',
        direction: m.role === 'user' ? ('outgoing' as const) : ('incoming' as const),
      })),
      Boolean(p.hasMore),
    );
    return;
  }

  // Conversation stream → append streaming chunk to conversations store
  if (type === 'conversation_stream') {
    const p = payload as Record<string, unknown>;
    const convId = String(p.conversationId ?? '');
    const chunk = String(p.chunk ?? '');
    const isFinal = Boolean(p.final);

    if (isFinal) {
      // Final marker — clear streaming, the complete message follows
      conversations.clearStreaming();
    } else if (chunk && convId) {
      conversations.appendStreamChunk(convId, chunk);
    }
    return;
  }

  // Conversation compact ack → toast notification
  if (type === 'conversation_compact_ack') {
    const p = payload as Record<string, unknown>;
    const covered = Number(p.messagesCovered ?? 0);
    const saved = Number(p.tokensSaved ?? 0);
    addNotification(`Conversation compacted: ${covered} messages summarised, ~${saved} tokens saved`, 'success');
    return;
  }

  // Provider status → provider store
  if (type === 'provider_status') {
    const p = payload as Record<string, unknown>;
    const caps = (p.capabilities ?? {}) as Record<string, unknown>;
    const adapterList = (p.adapters as Array<{ id: string; name: string; model: string; roles: string[] }>) ?? [];
    provider.setProvider({
      providerId: String(p.providerId ?? ''),
      providerName: String(p.providerName ?? p.name ?? ''),
      model: p.model ? String(p.model) : null,
      status: String(p.status ?? 'active') as ProviderInfo['status'],
      capabilities: {
        conversation: Boolean(caps.conversation ?? true),
        taskExecution: Boolean(caps.taskExecution ?? true),
        fileTransfer: Boolean(caps.fileTransfer ?? false),
        streaming: caps.streaming != null ? Boolean(caps.streaming) : undefined,
        webSearch: caps.webSearch != null ? Boolean(caps.webSearch) : undefined,
        toolUse: caps.toolUse != null ? Boolean(caps.toolUse) : undefined,
        vision: caps.vision != null ? Boolean(caps.vision) : undefined,
        maxContextTokens: caps.maxContextTokens != null ? Number(caps.maxContextTokens) : undefined,
      },
      adapters: adapterList.map((a) => ({ id: a.id, name: a.name, model: a.model, roles: a.roles })),
      lastUpdated: new Date().toISOString(),
    });
    return;
  }

  // Extension list response → extensions store
  if (type === 'extension_list_response') {
    const p = payload as Record<string, unknown>;
    const exts =
      (p.extensions as Array<{
        namespace: string;
        name: string;
        version: string;
        messageTypes?: readonly string[];
        ui?: Record<string, unknown> | null;
      }>) ?? [];
    extensions.setExtensions(
      exts.map((e) => ({
        namespace: e.namespace,
        name: e.name,
        version: e.version,
        messageTypes: e.messageTypes ?? [],
        ui: (e.ui as ExtensionInfo['ui']) ?? null,
      })),
    );
    return;
  }

  // System/store-only messages — consume silently, never show in chat
  if (
    type === 'tool_registry_sync' ||
    type === 'tool_registry_ack' ||
    type === 'tool_denied' ||
    type === 'tool_revoke' ||
    type === 'tool_alert_response' ||
    type === 'heartbeat' ||
    type === 'session_end' ||
    type === 'reconnect' ||
    type === 'pong'
  ) {
    return;
  }

  // Default: conversation, task_submission, and other user-facing messages → messages store + conversations store
  messages.addIncoming(type, payload, sender, id, timestamp);

  // Also add to active conversation (multi-conversation persistence)
  const activeConvId = conversations.store.get().activeConversationId;
  if (activeConvId) {
    const p = payload as Record<string, unknown>;
    const content =
      typeof p.content === 'string'
        ? p.content
        : typeof p.summary === 'string'
          ? p.summary
          : typeof p.reason === 'string'
            ? p.reason
            : JSON.stringify(p);
    conversations.addMessage({
      id,
      conversationId: activeConvId,
      role: sender.type === 'human' ? 'user' : 'assistant',
      type,
      content,
      timestamp,
      hash: '',
      previousHash: null,
      pinned: false,
      senderName: sender.displayName,
      direction: 'incoming',
      payload,
    });
  }
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
  ProjectFile,
  ProjectConfig,
  LoadingMode,
  ProviderInfo,
  ProviderCapabilities,
  ExtensionInfo,
  ConversationEntry,
  ConversationMessage,
};
export { SAFETY_FLOOR_VALUES };
export { getConfigStore, generateUserId } from './config/config-store.js';
export type { BastionConfig, ConfigStore } from './config/config-store.js';
