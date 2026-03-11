// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * File handling module for the AI client.
 *
 * Provides:
 *   - IntakeDirectory: read-only store for received files
 *   - OutboundStaging: write-only store for outbound files
 *   - FilePurgeManager: automatic cleanup on task completion/timeout
 */

export { IntakeDirectory, IntakeError } from './intake.js';
export type {
  IntakeConfig,
  IntakeFileMetadata,
  IntakeReceiveResult,
} from './intake.js';

export { OutboundStaging, OutboundError } from './outbound.js';
export type {
  OutboundConfig,
  StagedFileMetadata,
  StagedFileState,
  StageResult,
  SubmitResult,
} from './outbound.js';

export { FilePurgeManager, PurgeError } from './purge.js';
export type {
  FilePurgeConfig,
  TrackedTask,
  TaskPurgeResult,
  PurgeReason,
  PurgeCallback,
} from './purge.js';
