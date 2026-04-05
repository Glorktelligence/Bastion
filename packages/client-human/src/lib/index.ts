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
} from './config/config-store.js';
export type { BastionConfig, ConfigStore } from './config/config-store.js';

// Utilities
export { TypedEmitter } from './emitter.js';
export { writable, derived } from './store.js';
export type { Readable, Writable } from './store.js';

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
export type { ActiveChallenge, ChallengesStoreState } from './stores/challenges.js';

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
