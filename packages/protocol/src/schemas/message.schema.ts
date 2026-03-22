// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Zod schemas for all 23 message type payloads.
 * These provide runtime validation that mirrors the TypeScript interfaces
 * in types/messages.ts.
 */

import { z } from 'zod';
import {
  FileTransferIdSchema,
  MessageIdSchema,
  PrioritySchema,
  ProviderStatusSchema,
  SessionIdSchema,
  SessionStateSchema,
  TaskIdSchema,
  TimestampSchema,
} from './common.schema.js';

// ---------------------------------------------------------------------------
// Core Message Payload Schemas (Section 5.2)
// ---------------------------------------------------------------------------

export const TaskPayloadSchema = z.object({
  taskId: TaskIdSchema,
  action: z.string().min(1),
  target: z.string().min(1),
  parameters: z.record(z.unknown()),
  priority: PrioritySchema,
  constraints: z.array(z.string()).readonly(),
});

export const ConversationPayloadSchema = z.object({
  content: z.string().min(1),
  replyTo: MessageIdSchema.optional(),
});

export const ChallengeFactorSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  weight: z.number().min(0).max(1),
});

export const ChallengePayloadSchema = z.object({
  challengedMessageId: MessageIdSchema,
  challengedTaskId: TaskIdSchema,
  layer: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  reason: z.string().min(1),
  riskAssessment: z.string().min(1),
  suggestedAlternatives: z.array(z.string()).readonly(),
  factors: z.array(ChallengeFactorSchema).readonly(),
});

export const ConfirmationDecisionSchema = z.enum(['approve', 'modify', 'cancel']);

export const ConfirmationPayloadSchema = z.object({
  challengeMessageId: MessageIdSchema,
  decision: ConfirmationDecisionSchema,
  modifiedParameters: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
});

export const DenialPayloadSchema = z.object({
  deniedMessageId: MessageIdSchema,
  deniedTaskId: TaskIdSchema,
  layer: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  reason: z.string().min(1),
  detail: z.string().min(1),
});

export const StatusPayloadSchema = z.object({
  taskId: TaskIdSchema,
  completionPercentage: z.number().min(0).max(100),
  currentAction: z.string().min(1),
  toolsInUse: z.array(z.string()).readonly(),
  metadata: z.record(z.unknown()),
});

export const CostMetadataSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});

export const ConfidenceLevelSchema = z.enum(['high', 'medium', 'low']);

export const SafetyOutcomeSchema = z.enum(['allow', 'challenge', 'deny', 'clarify']);

export const TransparencyMetadataSchema = z.object({
  confidenceLevel: ConfidenceLevelSchema,
  safetyEvaluation: SafetyOutcomeSchema,
  permissionsUsed: z.array(z.string()).readonly(),
  reasoningNotes: z.string(),
});

export const ResultPayloadSchema = z.object({
  taskId: TaskIdSchema,
  summary: z.string().min(1),
  output: z.unknown(),
  actionsTaken: z.array(z.string()).readonly(),
  generatedFiles: z.array(FileTransferIdSchema).readonly(),
  cost: CostMetadataSchema,
  transparency: TransparencyMetadataSchema,
});

export const ErrorCodeSchema = z.string().regex(/^BASTION-[1-7]\d{3}$/, 'Must match format BASTION-CXXX');

export const ErrorPayloadSchema = z.object({
  code: ErrorCodeSchema,
  name: z.string().min(1),
  message: z.string().min(1),
  detail: z.string(),
  recoverable: z.boolean(),
  suggestedAction: z.string(),
  timestamp: TimestampSchema,
});

export const AuditPayloadSchema = z.object({
  eventType: z.string().min(1),
  sessionId: SessionIdSchema,
  detail: z.record(z.unknown()),
  chainHash: z.string().min(1),
});

export const AuditQueryPayloadSchema = z.object({
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  eventType: z.string().optional(),
  sessionId: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  includeIntegrity: z.boolean().optional(),
});

export const AuditResponsePayloadSchema = z.object({
  entries: z.array(AuditPayloadSchema),
  totalCount: z.number().int().nonnegative(),
  integrity: z
    .object({
      chainValid: z.boolean(),
      entriesChecked: z.number().int().nonnegative(),
      lastVerifiedAt: z.string(),
    })
    .nullable(),
});

export const HeartbeatMetricsSchema = z.object({
  uptimeMs: z.number().nonnegative(),
  memoryUsageMb: z.number().nonnegative(),
  cpuPercent: z.number().min(0).max(100),
  latencyMs: z.number().nonnegative(),
});

export const HeartbeatPayloadSchema = z.object({
  sessionId: SessionIdSchema,
  peerStatus: SessionStateSchema,
  metrics: HeartbeatMetricsSchema,
});

// ---------------------------------------------------------------------------
// File Transfer Payload Schemas (Section 7)
// ---------------------------------------------------------------------------

export const FileManifestPayloadSchema = z.object({
  transferId: FileTransferIdSchema,
  filename: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  hash: z.string().min(1),
  hashAlgorithm: z.literal('sha256'),
  mimeType: z.string().min(1),
  purpose: z.string().min(1),
  projectContext: z.string().min(1),
});

export const FileOfferPayloadSchema = z.object({
  transferId: FileTransferIdSchema,
  filename: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  hash: z.string().min(1),
  mimeType: z.string().min(1),
  purpose: z.string().min(1),
  taskId: TaskIdSchema.optional(),
});

export const FileRequestPayloadSchema = z.object({
  transferId: FileTransferIdSchema,
  manifestMessageId: MessageIdSchema,
});

// ---------------------------------------------------------------------------
// Supplementary Message Payload Schemas (Section 13)
// ---------------------------------------------------------------------------

export const SessionEndPayloadSchema = z.object({
  sessionId: SessionIdSchema,
  reason: z.string().min(1),
});

export const SessionConflictPayloadSchema = z.object({
  existingSessionId: SessionIdSchema,
  newDeviceInfo: z.string().min(1),
});

export const SessionSupersededPayloadSchema = z.object({
  sessionId: SessionIdSchema,
  supersededBy: z.string().min(1),
});

export const ReconnectPayloadSchema = z.object({
  sessionId: SessionIdSchema,
  lastReceivedMessageId: MessageIdSchema,
  jwt: z.string().optional(),
});

export const ConfigUpdateTypeSchema = z.enum(['api_key_rotation', 'tool_registry', 'safety_config']);

export const ConfigUpdatePayloadSchema = z.object({
  configType: ConfigUpdateTypeSchema,
  encryptedPayload: z.string().min(1),
});

export const ConfigAckPayloadSchema = z.object({
  configType: ConfigUpdateTypeSchema,
  appliedAt: TimestampSchema,
});

export const ConfigNackPayloadSchema = z.object({
  configType: ConfigUpdateTypeSchema,
  reason: z.string().min(1),
  errorDetail: z.string(),
});

export const TokenRefreshPayloadSchema = z.object({
  currentJwt: z.string().min(1),
});

export const ProviderStatusPayloadSchema = z.object({
  providerName: z.string().min(1),
  status: ProviderStatusSchema,
  errorDetail: z.string().optional(),
  retryAttempt: z.number().int().nonnegative().optional(),
  nextRetryMs: z.number().int().nonnegative().optional(),
});

export const BudgetAlertPayloadSchema = z.object({
  thresholdPercent: z.number().min(0).max(100),
  usedAmountUsd: z.number().nonnegative(),
  budgetLimitUsd: z.number().nonnegative(),
  currentPeriod: z.string().min(1),
  estimatedCostForNextTask: z.number().nonnegative().optional(),
});

// ---------------------------------------------------------------------------
// Payload schema lookup map (message type → Zod schema)
// ---------------------------------------------------------------------------

import { MESSAGE_TYPES } from '../constants/message-types.js';

/**
 * Maps each message type to its corresponding Zod payload schema.
 * Used by the validation utilities to validate payloads by type.
 */
export const PAYLOAD_SCHEMAS = {
  [MESSAGE_TYPES.TASK]: TaskPayloadSchema,
  [MESSAGE_TYPES.CONVERSATION]: ConversationPayloadSchema,
  [MESSAGE_TYPES.CHALLENGE]: ChallengePayloadSchema,
  [MESSAGE_TYPES.CONFIRMATION]: ConfirmationPayloadSchema,
  [MESSAGE_TYPES.DENIAL]: DenialPayloadSchema,
  [MESSAGE_TYPES.STATUS]: StatusPayloadSchema,
  [MESSAGE_TYPES.RESULT]: ResultPayloadSchema,
  [MESSAGE_TYPES.ERROR]: ErrorPayloadSchema,
  [MESSAGE_TYPES.AUDIT]: AuditPayloadSchema,
  [MESSAGE_TYPES.FILE_MANIFEST]: FileManifestPayloadSchema,
  [MESSAGE_TYPES.FILE_OFFER]: FileOfferPayloadSchema,
  [MESSAGE_TYPES.FILE_REQUEST]: FileRequestPayloadSchema,
  [MESSAGE_TYPES.HEARTBEAT]: HeartbeatPayloadSchema,
  [MESSAGE_TYPES.SESSION_END]: SessionEndPayloadSchema,
  [MESSAGE_TYPES.SESSION_CONFLICT]: SessionConflictPayloadSchema,
  [MESSAGE_TYPES.SESSION_SUPERSEDED]: SessionSupersededPayloadSchema,
  [MESSAGE_TYPES.RECONNECT]: ReconnectPayloadSchema,
  [MESSAGE_TYPES.CONFIG_UPDATE]: ConfigUpdatePayloadSchema,
  [MESSAGE_TYPES.CONFIG_ACK]: ConfigAckPayloadSchema,
  [MESSAGE_TYPES.CONFIG_NACK]: ConfigNackPayloadSchema,
  [MESSAGE_TYPES.TOKEN_REFRESH]: TokenRefreshPayloadSchema,
  [MESSAGE_TYPES.PROVIDER_STATUS]: ProviderStatusPayloadSchema,
  [MESSAGE_TYPES.BUDGET_ALERT]: BudgetAlertPayloadSchema,
  [MESSAGE_TYPES.AUDIT_QUERY]: AuditQueryPayloadSchema,
  [MESSAGE_TYPES.AUDIT_RESPONSE]: AuditResponsePayloadSchema,
} as const;
