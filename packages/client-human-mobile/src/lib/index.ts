// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * @bastion/client-human-mobile — logic layer exports.
 *
 * Re-exports services, stores, and utilities for use by React Native
 * components and by trace-test.mjs.
 */

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

// Stores
export { createConnectionStore } from './stores/connection.js';
export type { ConnectionStoreState } from './stores/connection.js';

export { createMessagesStore } from './stores/messages.js';
export type { DisplayMessage, MessagesStoreState } from './stores/messages.js';

export { createChallengesStore } from './stores/challenges.js';
export type { ActiveChallenge, ChallengesStoreState } from './stores/challenges.js';

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
