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

import { conversationRendererRegistry } from './extensions/conversation-renderer-registry.js';
import { BastionHumanClient } from './services/connection.js';
import type { Writable } from './store.js';
import { writable } from './store.js';
import { type AiDisclosureData, createAiDisclosureStore } from './stores/ai-disclosure.js';
import { type AuditLogEntry, createAuditLogStore } from './stores/audit-log.js';
import { type BudgetStatusData, createBudgetStore } from './stores/budget.js';
import { type ChallengeStats, createChallengeStatsStore } from './stores/challenge-stats.js';
import { type ActiveChallenge, createChallengesStore } from './stores/challenges.js';
import { type ConnectionStoreState, createConnectionStore } from './stores/connection.js';
import { type ConversationEntry, type ConversationMessage, createConversationsStore } from './stores/conversations.js';
import { createDreamCyclesStore } from './stores/dream-cycles.js';
import { type ExtensionInfo, createExtensionsStore } from './stores/extensions.js';
import { type FileTransferStore, createFileTransferStore } from './stores/file-transfers.js';
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
// Browser download helper (DOM types not in tsconfig lib)
// ---------------------------------------------------------------------------

/** Trigger a file download in the browser via a temporary anchor element. */
function triggerBrowserDownload(data: Uint8Array, filename: string): void {
  // All DOM access through globalThis to avoid TypeScript DOM lib dependency.
  // We are in a browser-only code path (called from async hash verification
  // inside a WebSocket message handler that only runs client-side).
  const w = globalThis as unknown as Record<string, unknown>;
  if (!w.Blob || !w.URL || !w.document) return;
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any -- unavoidable for DOM without lib:dom */
    const BlobCtor = w.Blob as new (parts: unknown[], opts: { type: string }) => unknown;
    const blob = new BlobCtor([data], { type: 'application/octet-stream' });
    const UrlObj = w.URL as { createObjectURL(b: unknown): string; revokeObjectURL(u: string): void };
    const url = UrlObj.createObjectURL(blob);
    const doc = w.document as {
      createElement(t: string): any;
      body: { appendChild(e: any): void; removeChild(e: any): void };
    };
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    UrlObj.revokeObjectURL(url);
    /* eslint-enable */
  } catch {
    console.error('[Bastion] triggerBrowserDownload failed');
  }
}

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

// Extension message forwarding — set by ExtensionUIHost to forward messages to bridge iframes
let extensionMessageHandler: ((type: string, payload: unknown) => void) | null = null;
export function setExtensionMessageHandler(handler: ((type: string, payload: unknown) => void) | null): void {
  extensionMessageHandler = handler;
}

// ---------------------------------------------------------------------------
// Shared store instances (survive route changes AND Vite HMR)
//
// All stores are pinned on globalThis so that HMR module re-evaluation
// reuses existing instances instead of creating orphaned duplicates.
// Same pattern already used for the BastionHumanClient.
// ---------------------------------------------------------------------------

const _g = globalThis as unknown as Record<string, unknown>;

function hmrStore<T>(key: string, create: () => T): T {
  if (!_g[key]) _g[key] = create();
  return _g[key] as T;
}

export const messages = hmrStore('__bastionMessages', createMessagesStore);
export const challenges = hmrStore('__bastionChallenges', createChallengesStore);
export const tasks = hmrStore('__bastionTasks', createTasksStore);
export const auditLog = hmrStore('__bastionAuditLog', createAuditLogStore);
export const settings = hmrStore('__bastionSettings', createSettingsStore);
export const challengeStats = hmrStore('__bastionChallengeStats', () => createChallengeStatsStore(challenges.store));
export const memories = hmrStore('__bastionMemories', createMemoriesStore);
export const tools = hmrStore('__bastionTools', createToolsStore);
export const budget = hmrStore('__bastionBudget', createBudgetStore);
export const projects = hmrStore('__bastionProjects', createProjectsStore);
export const provider = hmrStore('__bastionProvider', createProviderStore);
export const extensions = hmrStore('__bastionExtensions', createExtensionsStore);
export const conversations = hmrStore('__bastionConversations', createConversationsStore);
export const aiDisclosure = hmrStore('__bastionAiDisclosure', createAiDisclosureStore);
export const fileTransfers: FileTransferStore = hmrStore('__bastionFileTransfers', createFileTransferStore);
export const dreamCycles = hmrStore('__bastionDreamCycles', createDreamCyclesStore);

/** Data portability state (GDPR Article 20). */
export interface ErasurePreviewState {
  readonly conversations: number;
  readonly messages: number;
  readonly memories: number;
  readonly projectFiles: number;
  readonly skills: number;
  readonly usageRecords: number;
  readonly softDeleteDays: number;
  readonly hardDeleteAt: string;
  readonly auditNote: string;
}

export interface ErasureCompleteState {
  readonly erasureId: string;
  readonly softDeleted: {
    readonly conversations: number;
    readonly messages: number;
    readonly memories: number;
    readonly projectFiles: number;
    readonly usageRecords: number;
  };
  readonly hardDeleteScheduledAt: string;
  readonly receipt: string;
}

export interface DataPortabilityState {
  readonly exporting: boolean;
  readonly exportProgress: number;
  readonly exportPhase: string;
  readonly exportReady: boolean;
  readonly exportFilename: string | null;
  readonly exportTransferId: string | null;
  readonly exportSizeBytes: number;
  readonly exportCounts: { conversations: number; memories: number; projectFiles: number; skills: number } | null;
  readonly importing: boolean;
  readonly importValidation: {
    readonly valid: boolean;
    readonly format: string;
    readonly version: string;
    readonly exportedAt: string;
    readonly contents: {
      conversations: number;
      memories: number;
      projectFiles: number;
      skills: number;
      hasConfig: boolean;
    };
    readonly conflicts: readonly { type: string; path: string; detail: string }[];
    readonly errors: readonly string[];
  } | null;
  readonly importComplete: {
    readonly imported: {
      conversations: number;
      memories: number;
      projectFiles: number;
      skills: number;
      configSections: number;
    };
    readonly skipped: { conversations: number; memories: number; projectFiles: number; skills: number };
    readonly errors: readonly string[];
  } | null;
  readonly erasureRequesting: boolean;
  readonly erasurePreview: ErasurePreviewState | null;
  readonly erasureComplete: ErasureCompleteState | null;
}

export const dataPortability: Writable<DataPortabilityState> = hmrStore('__bastionDataPortability', () =>
  writable<DataPortabilityState>({
    exporting: false,
    exportProgress: 0,
    exportPhase: '',
    exportReady: false,
    exportFilename: null,
    exportTransferId: null,
    exportSizeBytes: 0,
    exportCounts: null,
    importing: false,
    importValidation: null,
    importComplete: null,
    erasureRequesting: false,
    erasurePreview: null,
    erasureComplete: null,
  }),
);

/** AI-issued challenge state. */
export interface AiChallengeState {
  readonly challengeId: string;
  readonly reason: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly suggestedAction: string;
  readonly waitSeconds: number;
  readonly challengeHoursActive: boolean;
  readonly requestedAction: string;
  readonly receivedAt: number;
}
export const activeAiChallenge: Writable<AiChallengeState | null> = hmrStore('__bastionAiChallenge', () =>
  writable<AiChallengeState | null>(null),
);

/** AI-initiated memory proposal state. */
export interface AiMemoryProposalState {
  readonly proposalId: string;
  readonly content: string;
  readonly category: string;
  readonly reason: string;
}
export const activeAiMemoryProposal: Writable<AiMemoryProposalState | null> = hmrStore(
  '__bastionAiMemoryProposal',
  () => writable<AiMemoryProposalState | null>(null),
);

/** Prompt budget zone — mirrors PromptZone from ConversationManager. */
export interface PromptBudgetZone {
  readonly name: 'system' | 'operator' | 'user' | 'dynamic';
  readonly budget: number;
  readonly tokenCount: number;
  readonly truncated: boolean;
  readonly components: readonly string[];
}

/** Prompt budget report — context window utilization. */
export interface PromptBudgetState {
  readonly zones: readonly PromptBudgetZone[];
  readonly totalTokens: number;
  readonly maxContextTokens: number;
  readonly available: number;
  readonly utilizationPercent: number;
}

/** Usage status — token tracking and budget from AI client. */
export interface UsageStatusState {
  readonly today: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  readonly thisMonth: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  readonly byAdapter: Record<string, { calls: number; costUsd: number }>;
  readonly budget: { monthlyCapUsd: number; remaining: number; percentUsed: number; alertLevel: string };
  readonly promptBudget: PromptBudgetState | null;
}
export const usageStatus: Writable<UsageStatusState> = hmrStore('__bastionUsageStatus', () =>
  writable<UsageStatusState>({
    today: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    thisMonth: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    byAdapter: {},
    budget: { monthlyCapUsd: 10, remaining: 10, percentUsed: 0, alertLevel: 'none' },
    promptBudget: null,
  }),
);

/** General-purpose toast notifications (cross-cutting — not owned by a single store). */
export interface ToastNotification {
  readonly id: string;
  readonly message: string;
  readonly level: 'info' | 'success' | 'warning' | 'error';
  readonly timestamp: string;
}
export const notifications: Writable<readonly ToastNotification[]> = hmrStore('__bastionNotifications', () =>
  writable<readonly ToastNotification[]>([]),
);

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
}> = hmrStore('__bastionChallengeStatus', () =>
  writable({ active: false, timezone: '', periodEnd: null, restrictions: [] }),
);

/** Connection state — plain writable, populated by createConnectionStore when connected. */
export const connection: Writable<ConnectionStoreState> = hmrStore('__bastionConnection', () =>
  writable<ConnectionStoreState>({
    status: 'disconnected',
    jwt: null,
    sessionId: null,
    peerStatus: 'unknown',
    reconnectAttempt: 0,
    lastError: null,
  }),
);

// ---------------------------------------------------------------------------
// Client management (also on globalThis — see _g above)
// ---------------------------------------------------------------------------

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

/** Messages that must stay plaintext — relay control, pre-key-exchange, or relay-routed file transfers. */
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
  'file_manifest',
  'file_offer',
  'file_request',
  'file_reject',
  'file_data',
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

/** Send a dream cycle request for the active conversation. */
export function sendDreamCycleRequest(): void {
  const convId = conversations.store.get().activeConversationId;
  if (!convId) return;
  dreamCycles.startDreamCycle(convId);
  sendSecure({
    type: 'dream_cycle_request',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: getIdentity(),
    payload: { conversationId: convId, scope: 'conversation' },
  });
}

/** Send a memory decision (approve/reject) for a proposal. */
export function sendMemoryDecision(proposalId: string, decision: 'approve' | 'reject'): void {
  sendSecure({
    type: 'memory_decision',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender: getIdentity(),
    payload: { proposalId, decision },
  });
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

  // Relay-originated control messages (file_offer, file_data, etc.) encode
  // the payload as base64 JSON in encryptedPayload — NOT actual encryption,
  // just the relay's buildRelayEnvelope() wrapper. Decode it here so all
  // downstream handlers see the real payload fields.
  let payload = envelope.payload as Record<string, unknown> | undefined;
  if (!payload && typeof envelope.encryptedPayload === 'string') {
    try {
      const decoded = atob(envelope.encryptedPayload as string);
      payload = JSON.parse(decoded) as Record<string, unknown>;
    } catch {
      payload = undefined;
    }
  }
  if (!payload) payload = envelope as Record<string, unknown>;

  const sender = (envelope.sender ?? { type: 'system', displayName: 'Relay' }) as {
    type: string;
    displayName: string;
  };
  const id = String(envelope.id ?? crypto.randomUUID());
  const timestamp = String(envelope.timestamp ?? new Date().toISOString());

  // -----------------------------------------------------------------------
  // File transfer messages — airlock UI
  // -----------------------------------------------------------------------

  // file_offer: relay sends this when a peer has a file for us (AI→human)
  if (type === 'file_offer') {
    const p = payload as Record<string, unknown>;
    fileTransfers.receiveOffer(
      id,
      {
        transferId: String(p.transferId ?? ''),
        filename: String(p.filename ?? ''),
        sizeBytes: Number(p.sizeBytes ?? 0),
        hash: String(p.hash ?? ''),
        mimeType: String(p.mimeType ?? ''),
        purpose: String(p.purpose ?? ''),
        taskId: p.taskId ? String(p.taskId) : undefined,
      } as never,
      sender.displayName,
    );
    addNotification(`File offer: ${String(p.filename ?? 'unknown')}`, 'info');
    return;
  }

  // file_data: relay delivers actual file bytes (base64) after we accepted
  if (type === 'file_data') {
    const transferId = String(envelope.transferId ?? (payload as Record<string, unknown>).transferId ?? '');
    const fileDataB64 = String(envelope.fileData ?? (payload as Record<string, unknown>).fileData ?? '');
    const filename = String(envelope.filename ?? (payload as Record<string, unknown>).filename ?? 'download');
    const declaredHash = String(envelope.hash ?? (payload as Record<string, unknown>).hash ?? '');

    console.log(`[Bastion] file_data received: ${transferId.slice(0, 8)}, ${fileDataB64.length} chars base64`);

    if (!fileDataB64 || !transferId) {
      console.error('[Bastion] file_data missing transferId or fileData');
      return;
    }

    // Decode base64 → Uint8Array
    const binaryStr = atob(fileDataB64);
    const fileBytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      fileBytes[i] = binaryStr.charCodeAt(i);
    }

    // Verify hash at delivery (3rd stage of custody chain)
    globalThis.crypto.subtle
      .digest('SHA-256', fileBytes)
      .then((hashBuf) => {
        const actualHash = Array.from(new Uint8Array(hashBuf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        if (declaredHash && actualHash !== declaredHash) {
          console.error(
            `[Bastion] BASTION-5001: Hash mismatch — expected ${declaredHash.slice(0, 12)}, got ${actualHash.slice(0, 12)}`,
          );
          addNotification('File delivery failed: hash verification error', 'error');
          fileTransfers.updateUploadPhase(transferId, 'failed', 'Hash mismatch at delivery');
          return;
        }

        // Trigger browser download (DOM types not in tsconfig lib)
        triggerBrowserDownload(fileBytes, filename);
        console.log(`[Bastion] File download triggered: ${filename} (${fileBytes.length} bytes)`);

        addNotification(`File downloaded: ${filename}`, 'success');

        // Update history
        fileTransfers.appendCustodyEvent(transferId, {
          event: 'delivered',
          timestamp: new Date().toISOString(),
          actor: 'relay',
          hash: actualHash,
          detail: `File delivered and verified (${fileBytes.length} bytes)`,
        });
      })
      .catch((err) => {
        console.error('[Bastion] Hash verification failed:', err);
      });

    return;
  }

  // Challenge messages → challenges store + tasks store
  if (type === 'challenge') {
    const p = payload as Record<string, unknown>;
    const taskId = String(p.taskId ?? p.challengedTaskId ?? '');
    challenges.receiveChallenge(id, taskId, payload as never);
    if (taskId) {
      const factors = Array.isArray(p.factors)
        ? (p.factors as Array<{ name: string; triggered: boolean; weight: number; detail: string }>)
        : undefined;
      const riskScore = typeof p.riskScore === 'number' ? p.riskScore : undefined;
      const threshold = typeof p.challengeThreshold === 'number' ? p.challengeThreshold : undefined;
      const alternatives = Array.isArray(p.suggestedAlternatives) ? (p.suggestedAlternatives as string[]) : undefined;
      tasks.setChallenge(
        taskId,
        String(p.reason ?? ''),
        Number(p.layer ?? 0),
        factors,
        riskScore,
        threshold,
        alternatives,
      );
    }
    return;
  }

  // Task results → tasks store + messages
  if (type === 'result') {
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
  if (type === 'status') {
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
    const taskId = String(p.taskId ?? p.deniedTaskId ?? '');
    if (taskId) {
      tasks.setDenial(taskId, String(p.reason ?? ''), Number(p.layer ?? 0), p.detail ? String(p.detail) : undefined);
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
    const decision = String(p.decision ?? 'approve');
    if (decision === 'approve') {
      memories.setNotification(`Memory saved (${String(p.memoryId ?? '').slice(0, 8)})`);
      addNotification('Memory saved', 'success');
    } else if (decision === 'reject') {
      memories.setNotification('Memory proposal rejected');
      addNotification('Memory proposal rejected', 'warning');
    } else {
      memories.setNotification(`Memory ${decision} (${String(p.memoryId ?? '').slice(0, 8)})`);
    }
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

  // Usage status → update usage store
  if (type === 'usage_status') {
    const p = payload as Record<string, unknown>;
    usageStatus.set({
      today: (p.today as UsageStatusState['today']) ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      thisMonth: (p.thisMonth as UsageStatusState['thisMonth']) ?? {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
      byAdapter: (p.byAdapter as Record<string, { calls: number; costUsd: number }>) ?? {},
      budget: (p.budget as UsageStatusState['budget']) ?? {
        monthlyCapUsd: 10,
        remaining: 10,
        percentUsed: 0,
        alertLevel: 'none',
      },
      promptBudget: (p.promptBudget as PromptBudgetState) ?? null,
    });
    return;
  }

  // Data export progress → update portability state
  if (type === 'data_export_progress') {
    const p = payload as Record<string, unknown>;
    dataPortability.update((s) => ({
      ...s,
      exporting: true,
      exportProgress: Number(p.percentage ?? 0),
      exportPhase: String(p.phase ?? ''),
    }));
    return;
  }

  // Data export ready → mark export as complete
  if (type === 'data_export_ready') {
    const p = payload as Record<string, unknown>;
    const counts = p.contentCounts as
      | { conversations: number; memories: number; projectFiles: number; skills: number }
      | undefined;
    dataPortability.update((s) => ({
      ...s,
      exporting: false,
      exportProgress: 100,
      exportPhase: 'Export complete',
      exportReady: true,
      exportFilename: String(p.filename ?? 'export.bdp'),
      exportTransferId: String(p.transferId ?? ''),
      exportSizeBytes: Number(p.sizeBytes ?? 0),
      exportCounts: counts ?? null,
    }));
    addNotification('Data export ready for download', 'success');
    return;
  }

  // Data import validation result
  if (type === 'data_import_validate') {
    const p = payload as Record<string, unknown>;
    dataPortability.update((s) => ({
      ...s,
      importing: false,
      importValidation: {
        valid: Boolean(p.valid),
        format: String(p.format ?? 'unknown'),
        version: String(p.version ?? 'unknown'),
        exportedAt: String(p.exportedAt ?? 'unknown'),
        contents: (p.contents as {
          conversations: number;
          memories: number;
          projectFiles: number;
          skills: number;
          hasConfig: boolean;
        }) ?? { conversations: 0, memories: 0, projectFiles: 0, skills: 0, hasConfig: false },
        conflicts: (p.conflicts as readonly { type: string; path: string; detail: string }[]) ?? [],
        errors: (p.errors as readonly string[]) ?? [],
      },
      importComplete: null,
    }));
    if (!(p.valid as boolean)) {
      addNotification('Import validation failed', 'error');
    } else {
      addNotification('Import file validated — review and confirm', 'info');
    }
    return;
  }

  // Data import complete
  if (type === 'data_import_complete') {
    const p = payload as Record<string, unknown>;
    dataPortability.update((s) => ({
      ...s,
      importing: false,
      importValidation: null,
      importComplete: {
        imported: (p.imported as {
          conversations: number;
          memories: number;
          projectFiles: number;
          skills: number;
          configSections: number;
        }) ?? { conversations: 0, memories: 0, projectFiles: 0, skills: 0, configSections: 0 },
        skipped: (p.skipped as { conversations: number; memories: number; projectFiles: number; skills: number }) ?? {
          conversations: 0,
          memories: 0,
          projectFiles: 0,
          skills: 0,
        },
        errors: (p.errors as readonly string[]) ?? [],
      },
    }));
    addNotification('Data import complete', 'success');
    return;
  }

  // Data erasure preview → show deletion counts
  if (type === 'data_erasure_preview') {
    const p = payload as Record<string, unknown>;
    dataPortability.update((s) => ({
      ...s,
      erasureRequesting: false,
      erasurePreview: {
        conversations: Number(p.conversations ?? 0),
        messages: Number(p.messages ?? 0),
        memories: Number(p.memories ?? 0),
        projectFiles: Number(p.projectFiles ?? 0),
        skills: Number(p.skills ?? 0),
        usageRecords: Number(p.usageRecords ?? 0),
        softDeleteDays: Number(p.softDeleteDays ?? 30),
        hardDeleteAt: String(p.hardDeleteAt ?? ''),
        auditNote: String(p.auditNote ?? ''),
      },
    }));
    return;
  }

  // Data erasure complete → show receipt
  if (type === 'data_erasure_complete') {
    const p = payload as Record<string, unknown>;
    const sd = p.softDeleted as Record<string, number> | undefined;
    dataPortability.update((s) => ({
      ...s,
      erasurePreview: null,
      erasureComplete: {
        erasureId: String(p.erasureId ?? ''),
        softDeleted: {
          conversations: sd?.conversations ?? 0,
          messages: sd?.messages ?? 0,
          memories: sd?.memories ?? 0,
          projectFiles: sd?.projectFiles ?? 0,
          usageRecords: sd?.usageRecords ?? 0,
        },
        hardDeleteScheduledAt: String(p.hardDeleteScheduledAt ?? ''),
        receipt: String(p.receipt ?? ''),
      },
    }));
    addNotification('Data erasure initiated — 30-day cancellation window active', 'warning');
    return;
  }

  // AI-issued challenge → show challenge dialog
  if (type === 'ai_challenge') {
    const p = payload as Record<string, unknown>;
    const ctx = p.context as Record<string, unknown> | undefined;
    activeAiChallenge.set({
      challengeId: String(p.challengeId ?? ''),
      reason: String(p.reason ?? ''),
      severity: (['info', 'warning', 'critical'].includes(String(p.severity)) ? String(p.severity) : 'warning') as
        | 'info'
        | 'warning'
        | 'critical',
      suggestedAction: String(p.suggestedAction ?? ''),
      waitSeconds: Number(p.waitSeconds ?? 10),
      challengeHoursActive: Boolean(ctx?.challengeHoursActive),
      requestedAction: String(ctx?.requestedAction ?? ''),
      receivedAt: Date.now(),
    });
    return;
  }

  // AI memory proposal → show approval UI or route to dream store
  if (type === 'ai_memory_proposal') {
    const p = payload as Record<string, unknown>;
    if (p.isDreamCandidate) {
      // Dream cycle candidate → batch into dream store
      dreamCycles.addProposal(
        String(p.proposalId ?? ''),
        String(p.content ?? ''),
        String(p.category ?? 'fact'),
        String(p.reason ?? ''),
        Boolean(p.isUpdate),
        p.existingMemoryContent ? String(p.existingMemoryContent) : null,
      );
    } else {
      // Normal AI-initiated proposal → single toast
      activeAiMemoryProposal.set({
        proposalId: String(p.proposalId ?? ''),
        content: String(p.content ?? ''),
        category: String(p.category ?? 'fact'),
        reason: String(p.reason ?? ''),
      });
    }
    return;
  }

  // Dream cycle complete → update dream store with summary
  if (type === 'dream_cycle_complete') {
    const p = payload as Record<string, unknown>;
    const tokensUsed = (p.tokensUsed as { input?: number; output?: number }) ?? {};
    dreamCycles.completeDreamCycle({
      conversationId: String(p.conversationId ?? ''),
      candidateCount: Number(p.candidateCount ?? 0),
      tokensUsed: { input: Number(tokensUsed.input ?? 0), output: Number(tokensUsed.output ?? 0) },
      estimatedCost: Number(p.estimatedCost ?? 0),
      durationMs: Number(p.durationMs ?? 0),
      completedAt: new Date().toISOString(),
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

  // AI disclosure banner → ai disclosure store
  if (type === 'ai_disclosure') {
    const p = payload as Record<string, unknown>;
    aiDisclosure.setDisclosure({
      text: String(p.text ?? ''),
      style: (p.style === 'info' || p.style === 'legal' || p.style === 'warning'
        ? p.style
        : 'info') as AiDisclosureData['style'],
      position: (p.position === 'banner' || p.position === 'footer'
        ? p.position
        : 'banner') as AiDisclosureData['position'],
      dismissible: Boolean(p.dismissible ?? true),
      link: p.link ? String(p.link) : undefined,
      linkText: p.linkText ? String(p.linkText) : undefined,
      jurisdiction: p.jurisdiction ? String(p.jurisdiction) : undefined,
    });
    return;
  }

  // Extension list response → extensions store + conversation renderer registry
  if (type === 'extension_list_response') {
    const p = payload as Record<string, unknown>;
    const exts =
      (p.extensions as Array<{
        namespace: string;
        name: string;
        version: string;
        messageTypes?: readonly string[];
        ui?: Record<string, unknown> | null;
        conversationRenderers?: Record<string, { html: string; style?: string; markdown?: boolean }>;
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
    // Load conversation renderers into the global registry
    conversationRendererRegistry.loadFromExtensions(exts);
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

  // Extension-namespaced messages → forward to bridge iframes
  // If a conversation renderer is registered, also add to messages store for display
  if (type.includes(':')) {
    extensionMessageHandler?.(type, payload);
    if (!conversationRendererRegistry.has(type)) return;
    // Fall through to add to messages store + conversations store
  }

  // Default: conversation, task, and other user-facing messages → messages store + conversations store
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
