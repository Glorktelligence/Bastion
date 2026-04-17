// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * @bastion/client-human — logic layer exports.
 *
 * Re-exports services, stores, and utilities for use by SvelteKit
 * components and by trace-test.mjs.
 */

// Config
export {
  getConfigStore,
  generateUserId,
  BrowserConfigStore,
  TauriConfigStore,
  InMemoryConfigStore,
  migrateConfig,
  CONFIG_VERSION,
  DEFAULT_USER_PREFERENCES,
} from './config/config-store.js';
export type { BastionConfig, ConfigStore, UserPreferences } from './config/config-store.js';

// Utilities
export { TypedEmitter } from './emitter.js';
export { writable, derived } from './store.js';
export type { Readable, Writable } from './store.js';

// Crypto (exported for trace-test.mjs — UI consumers use session.ts helpers)
export {
  generateKeyPair,
  deriveSessionKeys,
  createSessionCipher,
  encryptPayload,
  decryptPayload,
  encodeBase64,
  decodeBase64,
  shouldAttemptDecrypt,
  decryptEnvelope,
  enqueueEncryptedMessage,
} from './crypto/browser-crypto.js';
export type {
  BrowserKeyPair,
  BrowserSessionCipher,
  PeekedReceiveKey,
  DecryptFailureSentinel,
} from './crypto/browser-crypto.js';

// Services
export {
  BastionHumanClient,
  HumanClientError,
} from './services/connection.js';
export type {
  HumanClientState,
  HumanClientConfig,
  HumanClientEvents,
} from './services/connection.js';

export {
  createNotificationService,
  InMemoryNotificationAdapter,
} from './services/notifications.js';
export type {
  NotificationAdapter,
  NotificationOptions,
  NotificationCategory,
  NotificationPreferences,
  NotificationServiceState,
  SentNotification,
} from './services/notifications.js';

export {
  createChatHistoryService,
  InMemoryChatHistory,
} from './services/chat-history.js';
export type {
  ChatHistoryAdapter,
  ChatHistoryQuery,
  ChatHistoryState,
  StoredMessage,
} from './services/chat-history.js';

// Stores
export { createConnectionStore } from './stores/connection.js';
export type { ConnectionStoreState } from './stores/connection.js';

export { createMessagesStore } from './stores/messages.js';
export type { DisplayMessage, MessagesStoreState } from './stores/messages.js';

export { createChallengesStore } from './stores/challenges.js';
export type {
  ActiveChallenge,
  AiChallengeEntry,
  ChallengeHistoryEntry,
  ChallengesStoreState,
} from './stores/challenges.js';

export { createChallengeStatsStore } from './stores/challenge-stats.js';
export type { ChallengeStats, FactorFrequency } from './stores/challenge-stats.js';

export { createFileTransferStore } from './stores/file-transfers.js';
export type {
  FileTransferStore,
  FileTransferStoreState,
  PendingFileOffer,
  FileUploadProgress,
  UploadPhase,
  TransferHistoryEntry,
  DisplayCustodyEvent,
  HashStatus,
} from './stores/file-transfers.js';

export {
  createAuditLogStore,
  AUDIT_EVENT_CATEGORIES,
} from './stores/audit-log.js';
export type {
  AuditLogEntry,
  AuditLogFilter,
  AuditLogState,
} from './stores/audit-log.js';

export {
  createSettingsStore,
  validateSettingChange,
  SAFETY_FLOOR_VALUES,
} from './stores/settings.js';
export type {
  SafetySettings,
  SettingsStoreState,
  SettingUpdateResult,
  PatternSensitivity,
} from './stores/settings.js';

export { createBudgetStore } from './stores/budget.js';
export type {
  BudgetStore,
  BudgetStoreState,
  BudgetStatusData,
  BudgetAlert,
  BudgetAlertLevel,
} from './stores/budget.js';

export { createTasksStore } from './stores/tasks.js';
export type {
  TrackedTask,
  TaskStatus,
  TaskCostInfo,
  TasksStoreState,
} from './stores/tasks.js';

export { createDreamCyclesStore } from './stores/dream-cycles.js';
export type {
  DreamProposal,
  DreamCycleState,
  DreamCycleCompleteInfo,
} from './stores/dream-cycles.js';

// Extension renderers
export {
  ConversationRendererRegistry,
  conversationRendererRegistry,
} from './extensions/conversation-renderer-registry.js';
export type { RendererConfig } from './extensions/conversation-renderer-registry.js';

// Extension bridge
export {
  ExtensionBridgeManager,
  scanExtensionHTML,
  BRIDGE_SCRIPT,
  BLOCKED_UI_PATTERNS,
} from './extensions/bridge.js';
export type { BridgeComponent, BridgeMessage } from './extensions/bridge.js';

// Extension state cache (M14)
export { ExtensionStateCache, extensionStateCache } from './extensions/extension-state-cache.js';
export type { ExtensionTier1, ExtensionStateInfo, ExtensionStateSummary } from './extensions/extension-state-cache.js';

// Guardian lockout (Phase 4)
export {
  GUARDIAN_LOCKOUT_KEY,
  buildLockoutFromShutdown,
  clearGuardianLockout,
  createGuardianLockoutStore,
  createGuardianStatusStore,
  getGuardianLockout,
  incrementRestartCount,
  setGuardianLockout,
} from './stores/guardian-lockout.js';
export type { GuardianLockoutState, GuardianStatusSummary } from './stores/guardian-lockout.js';
