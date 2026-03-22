// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Payload interfaces for all 23 Bastion message types.
 *
 * Core spec (13): task, conversation, challenge, confirmation, denial,
 *   status, result, error, audit, file_manifest, file_offer, file_request, heartbeat
 *
 * Supplementary spec (10): session_end, session_conflict, session_superseded,
 *   reconnect, config_update, config_ack, config_nack, token_refresh,
 *   provider_status, budget_alert
 */

import type { ErrorCode } from '../constants/error-codes.js';
import type { SafetyLayer, SafetyOutcome } from '../constants/safety-levels.js';
import type {
  FileTransferId,
  MessageId,
  Priority,
  ProviderStatus,
  SessionId,
  SessionState,
  TaskId,
  Timestamp,
} from './common.js';

// ---------------------------------------------------------------------------
// Core Message Payloads (Section 5.2)
// ---------------------------------------------------------------------------

/** Human → AI: Structured instruction with action, target, parameters. */
export interface TaskPayload {
  readonly taskId: TaskId;
  readonly action: string;
  readonly target: string;
  readonly parameters: Record<string, unknown>;
  readonly priority: Priority;
  readonly constraints: readonly string[];
}

/** Either direction: Freeform dialogue. No automatic execution implications. */
export interface ConversationPayload {
  readonly content: string;
  /** Optional reference to a previous message being replied to. */
  readonly replyTo?: MessageId;
}

/**
 * AI → Human: Task triggered safety evaluation flags.
 * Blocks execution until human sends a confirmation.
 */
export interface ChallengePayload {
  /** ID of the task message that triggered the challenge. */
  readonly challengedMessageId: MessageId;
  readonly challengedTaskId: TaskId;
  /** Which safety layer triggered the challenge. */
  readonly layer: SafetyLayer;
  readonly reason: string;
  readonly riskAssessment: string;
  readonly suggestedAlternatives: readonly string[];
  /** Factors that contributed to the challenge decision. */
  readonly factors: readonly ChallengeFactor[];
}

/** Individual factor contributing to a challenge decision. */
export interface ChallengeFactor {
  readonly name: string;
  readonly description: string;
  readonly weight: number;
}

/** Human → AI: Response to a challenge. */
export interface ConfirmationPayload {
  /** ID of the challenge message being responded to. */
  readonly challengeMessageId: MessageId;
  readonly decision: ConfirmationDecision;
  /** If decision is 'modify', the modified task parameters. */
  readonly modifiedParameters?: Record<string, unknown>;
  readonly reason?: string;
}

export type ConfirmationDecision = 'approve' | 'modify' | 'cancel';

/**
 * AI → Human: Task violates absolute safety boundaries.
 * Non-negotiable. Cannot be overridden.
 */
export interface DenialPayload {
  /** ID of the task message that was denied. */
  readonly deniedMessageId: MessageId;
  readonly deniedTaskId: TaskId;
  readonly layer: SafetyLayer;
  readonly reason: string;
  readonly detail: string;
}

/** AI → Human: Current execution progress report. */
export interface StatusPayload {
  readonly taskId: TaskId;
  readonly completionPercentage: number;
  readonly currentAction: string;
  readonly toolsInUse: readonly string[];
  readonly metadata: Record<string, unknown>;
}

/** AI → Human: Task completion report. */
export interface ResultPayload {
  readonly taskId: TaskId;
  readonly summary: string;
  readonly output: unknown;
  readonly actionsTaken: readonly string[];
  /** File transfer IDs for any generated files. */
  readonly generatedFiles: readonly FileTransferId[];
  /** Cost metadata for this task. */
  readonly cost: CostMetadata;
  /** AI transparency metadata. */
  readonly transparency: TransparencyMetadata;
}

/** Token usage and cost information attached to result messages. */
export interface CostMetadata {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
}

/** AI transparency metadata (Section 9.3). */
export interface TransparencyMetadata {
  readonly confidenceLevel: ConfidenceLevel;
  readonly safetyEvaluation: SafetyOutcome;
  readonly permissionsUsed: readonly string[];
  readonly reasoningNotes: string;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** System or execution error report. */
export interface ErrorPayload {
  readonly code: ErrorCode;
  readonly name: string;
  readonly message: string;
  readonly detail: string;
  readonly recoverable: boolean;
  readonly suggestedAction: string;
  readonly timestamp: Timestamp;
}

/** Relay-generated audit trail entry. */
export interface AuditPayload {
  readonly eventType: string;
  readonly sessionId: SessionId;
  readonly detail: Record<string, unknown>;
  readonly chainHash: string;
}

/** Human → Relay: Query the audit trail. */
export interface AuditQueryPayload {
  readonly startTime?: string;
  readonly endTime?: string;
  readonly eventType?: string;
  readonly sessionId?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly includeIntegrity?: boolean;
}

/** Relay → Human: Audit trail query response. */
export interface AuditResponsePayload {
  readonly entries: readonly AuditPayload[];
  readonly totalCount: number;
  readonly integrity: {
    readonly chainValid: boolean;
    readonly entriesChecked: number;
    readonly lastVerifiedAt: string;
  } | null;
}

/** Periodic keepalive with system health metrics. */
export interface HeartbeatPayload {
  readonly sessionId: SessionId;
  readonly peerStatus: SessionState;
  readonly metrics: HeartbeatMetrics;
}

export interface HeartbeatMetrics {
  readonly uptimeMs: number;
  readonly memoryUsageMb: number;
  readonly cpuPercent: number;
  readonly latencyMs: number;
}

// ---------------------------------------------------------------------------
// File Transfer Payloads (Section 7)
// ---------------------------------------------------------------------------

/** Describes a file submitted for transfer. Precedes any file data. */
export interface FileManifestPayload {
  readonly transferId: FileTransferId;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly hash: string;
  readonly hashAlgorithm: 'sha256';
  readonly mimeType: string;
  readonly purpose: string;
  readonly projectContext: string;
}

/** AI → Human: File delivery notification. Requires human acceptance. */
export interface FileOfferPayload {
  readonly transferId: FileTransferId;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly hash: string;
  readonly mimeType: string;
  readonly purpose: string;
  readonly taskId?: TaskId;
}

/** AI requests access to a quarantined file. */
export interface FileRequestPayload {
  readonly transferId: FileTransferId;
  readonly manifestMessageId: MessageId;
}

// ---------------------------------------------------------------------------
// Supplementary Message Payloads (Supplementary Spec Section 13)
// ---------------------------------------------------------------------------

/** Either → Relay: Clean shutdown notification. */
export interface SessionEndPayload {
  readonly sessionId: SessionId;
  readonly reason: string;
}

/** Relay → Human: Another device is attempting to connect. */
export interface SessionConflictPayload {
  readonly existingSessionId: SessionId;
  readonly newDeviceInfo: string;
}

/** Relay → Human: Session transferred to another device. */
export interface SessionSupersededPayload {
  readonly sessionId: SessionId;
  readonly supersededBy: string;
}

/** Either → Relay: Reconnection request with last-received message ID. */
export interface ReconnectPayload {
  readonly sessionId: SessionId;
  readonly lastReceivedMessageId: MessageId;
  readonly jwt?: string;
}

/** Admin → AI (via Relay): Configuration change. */
export interface ConfigUpdatePayload {
  readonly configType: ConfigUpdateType;
  /** Encrypted configuration payload. */
  readonly encryptedPayload: string;
}

export type ConfigUpdateType = 'api_key_rotation' | 'tool_registry' | 'safety_config';

/** AI → Admin (via Relay): Configuration change applied. */
export interface ConfigAckPayload {
  readonly configType: ConfigUpdateType;
  readonly appliedAt: Timestamp;
}

/** AI → Admin (via Relay): Configuration change failed. */
export interface ConfigNackPayload {
  readonly configType: ConfigUpdateType;
  readonly reason: string;
  readonly errorDetail: string;
}

/** Either → Relay: JWT refresh request. */
export interface TokenRefreshPayload {
  readonly currentJwt: string;
}

/** AI → Human (via Relay): Provider availability status change. */
export interface ProviderStatusPayload {
  readonly providerName: string;
  readonly status: ProviderStatus;
  readonly errorDetail?: string;
  readonly retryAttempt?: number;
  readonly nextRetryMs?: number;
}

/** AI → Human (via Relay): Budget threshold reached. */
export interface BudgetAlertPayload {
  readonly thresholdPercent: number;
  readonly usedAmountUsd: number;
  readonly budgetLimitUsd: number;
  readonly currentPeriod: string;
  readonly estimatedCostForNextTask?: number;
}

// ---------------------------------------------------------------------------
// Discriminated union of all payload types
// ---------------------------------------------------------------------------

export type MessagePayload =
  | { type: 'task'; payload: TaskPayload }
  | { type: 'conversation'; payload: ConversationPayload }
  | { type: 'challenge'; payload: ChallengePayload }
  | { type: 'confirmation'; payload: ConfirmationPayload }
  | { type: 'denial'; payload: DenialPayload }
  | { type: 'status'; payload: StatusPayload }
  | { type: 'result'; payload: ResultPayload }
  | { type: 'error'; payload: ErrorPayload }
  | { type: 'audit'; payload: AuditPayload }
  | { type: 'file_manifest'; payload: FileManifestPayload }
  | { type: 'file_offer'; payload: FileOfferPayload }
  | { type: 'file_request'; payload: FileRequestPayload }
  | { type: 'heartbeat'; payload: HeartbeatPayload }
  | { type: 'session_end'; payload: SessionEndPayload }
  | { type: 'session_conflict'; payload: SessionConflictPayload }
  | { type: 'session_superseded'; payload: SessionSupersededPayload }
  | { type: 'reconnect'; payload: ReconnectPayload }
  | { type: 'config_update'; payload: ConfigUpdatePayload }
  | { type: 'config_ack'; payload: ConfigAckPayload }
  | { type: 'config_nack'; payload: ConfigNackPayload }
  | { type: 'token_refresh'; payload: TokenRefreshPayload }
  | { type: 'provider_status'; payload: ProviderStatusPayload }
  | { type: 'budget_alert'; payload: BudgetAlertPayload }
  | { type: 'audit_query'; payload: AuditQueryPayload }
  | { type: 'audit_response'; payload: AuditResponsePayload };
