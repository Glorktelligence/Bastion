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

/** AI → Relay: Register as a provider with capabilities. */
export interface ProviderRegisterPayload {
  readonly providerId: string;
  readonly providerName: string;
  readonly capabilities: {
    readonly conversation: boolean;
    readonly taskExecution: boolean;
    readonly fileTransfer: boolean;
  };
}

/** Human → AI (via Relay): Update user context for system prompt. */
export interface ContextUpdatePayload {
  readonly content: string;
}

/** Human → AI (via Relay): Propose a memory to save. Human-initiated via "Remember" button. */
export interface MemoryProposalPayload {
  readonly proposalId: string;
  readonly content: string;
  readonly category: 'preference' | 'fact' | 'workflow' | 'project';
  readonly sourceMessageId: string;
  /** Optional: scope memory to a specific conversation. Null/absent = global. */
  readonly conversationId?: string;
}

/** AI → Human (via Relay): Decision on a memory proposal. */
export interface MemoryDecisionPayload {
  readonly proposalId: string;
  readonly decision: 'approve' | 'edit' | 'reject';
  readonly editedContent?: string;
  readonly memoryId?: string;
}

/** Human → AI (via Relay): Request all memories. */
export interface MemoryListPayload {
  readonly category?: 'preference' | 'fact' | 'workflow' | 'project';
  /** Optional: filter by conversation. Null = global only. Absent = all. */
  readonly conversationId?: string | null;
}

/** AI → Human (via Relay): Full memory list response. */
export interface MemoryListResponsePayload {
  readonly memories: readonly {
    readonly id: string;
    readonly content: string;
    readonly category: 'preference' | 'fact' | 'workflow' | 'project';
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly conversationId?: string | null;
  }[];
  readonly totalCount: number;
}

/** Human → AI (via Relay): Edit an existing memory. */
export interface MemoryUpdatePayload {
  readonly memoryId: string;
  readonly content: string;
}

/** Human → AI (via Relay): Delete a memory. */
export interface MemoryDeletePayload {
  readonly memoryId: string;
}

/** Human → AI: Upload a project file. */
export interface ProjectSyncPayload {
  readonly path: string;
  readonly content: string;
  readonly mimeType: string;
}

/** AI → Human: Confirm project file received. */
export interface ProjectSyncAckPayload {
  readonly path: string;
  readonly size: number;
  readonly timestamp: string;
}

/** Human → AI: Request list of all project files. */
export interface ProjectListPayload {
  readonly directory?: string;
}

/** AI → Human: Project file list. */
export interface ProjectListResponsePayload {
  readonly files: readonly {
    readonly path: string;
    readonly size: number;
    readonly mimeType: string;
    readonly lastModified: string;
  }[];
  readonly totalSize: number;
  readonly totalCount: number;
}

/** Human → AI: Delete a project file. */
export interface ProjectDeletePayload {
  readonly path: string;
}

/** Human → AI: Set project loading rules. */
export interface ProjectConfigPayload {
  readonly alwaysLoaded: readonly string[];
  readonly available: readonly string[];
}

/** AI → Human: Confirm project config saved. */
export interface ProjectConfigAckPayload {
  readonly alwaysLoaded: readonly string[];
  readonly available: readonly string[];
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Tool Integration Payloads (Layer 4)
// ---------------------------------------------------------------------------

/** Relay → AI: Send authorised tool registry on connect. */
export interface ToolRegistrySyncPayload {
  readonly providers: readonly {
    readonly id: string;
    readonly name: string;
    readonly endpoint: string;
    readonly authType: 'api_key' | 'custom_header' | 'no_auth';
    readonly tools: readonly {
      readonly name: string;
      readonly description: string;
      readonly category: 'read' | 'write' | 'destructive';
      readonly readOnly: boolean;
      readonly dangerous: boolean;
      readonly modes: readonly ('conversation' | 'task')[];
    }[];
  }[];
  readonly registryHash: string;
}

/** AI → Relay: Confirm registry received with hash. */
export interface ToolRegistryAckPayload {
  readonly registryHash: string;
  readonly toolCount: number;
}

/** AI → Human (via Relay): AI wants to use a tool, requests approval. */
export interface ToolRequestPayload {
  readonly requestId: string;
  readonly toolId: string;
  readonly action: string;
  readonly parameters: Record<string, unknown>;
  readonly mode: 'conversation' | 'task';
  readonly dangerous: boolean;
  readonly category: 'read' | 'write' | 'destructive';
}

/**
 * Human → AI (via Relay): Approve tool use.
 *
 * Trust level affects review depth, not visibility.
 * Write/destructive tools ALWAYS require per-call approval regardless of trust.
 * Read-only tools with trustLevel >= 4 and scope=session auto-approve subsequent calls.
 */
export interface ToolApprovedPayload {
  readonly requestId: string;
  readonly toolId: string;
  readonly trustLevel: number;
  readonly reason: string;
  readonly scope: 'this_call' | 'session';
}

/** Human → AI (via Relay): Deny tool use. */
export interface ToolDeniedPayload {
  readonly requestId: string;
  readonly toolId: string;
  readonly reason: string;
}

/** AI → Human (via Relay): Result of tool execution. */
export interface ToolResultPayload {
  readonly requestId: string;
  readonly toolId: string;
  readonly result: unknown;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: string;
}

/** Human → AI (via Relay): Revoke session trust for a tool. */
export interface ToolRevokePayload {
  readonly toolId: string;
  readonly reason: string;
}

/** AI → Human (via Relay): Tool change alert. */
export interface ToolAlertPayload {
  readonly toolId: string;
  readonly alertType: 'new_tool' | 'lost_tool' | 'changed_tool';
  readonly details: string;
}

/** Human → AI (via Relay): Accept or decline tool alert. */
export interface ToolAlertResponsePayload {
  readonly toolId: string;
  readonly decision: 'accept' | 'decline';
}

// ---------------------------------------------------------------------------
// Challenge Me More (Temporal Governance)
// ---------------------------------------------------------------------------

/** AI → Human: Challenge hours status update. */
export interface ChallengeStatusPayload {
  readonly active: boolean;
  readonly timezone: string;
  readonly currentTime: string;
  readonly periodEnd: string | null;
  readonly restrictions: readonly string[];
}

/** Human → AI: Update challenge schedule/cooldowns. */
export interface ChallengeConfigPayload {
  readonly schedule: {
    readonly weekdays: { readonly start: string; readonly end: string };
    readonly weekends: { readonly start: string; readonly end: string };
  };
  readonly cooldowns: {
    readonly budgetChangeDays: number;
    readonly scheduleChangeDays: number;
    readonly toolRegistrationDays: number;
  };
}

/** AI → Human: Confirm or reject challenge config update. */
export interface ChallengeConfigAckPayload {
  readonly accepted: boolean;
  readonly reason: string;
  readonly cooldownExpires: string | null;
}

/** Client → Relay: Request list of loaded protocol extensions. */
export interface ExtensionQueryPayload {
  readonly includeSchemas?: boolean;
}

/** Relay → Client: Loaded extensions with namespaces and message types. */
export interface ExtensionListResponsePayload {
  readonly extensions: readonly {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly messageTypes: readonly string[];
  }[];
  readonly totalCount: number;
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

/** AI → Human (via Relay): Budget threshold crossed. */
export interface BudgetAlertPayload {
  readonly alertLevel: BudgetAlertLevel;
  readonly message: string;
  readonly budgetRemaining: number;
  readonly searchesRemaining: number;
}

/** Alert level for budget threshold events. */
export type BudgetAlertLevel = 'warning_50' | 'urgent_80' | 'session_limit' | 'daily_limit' | 'monthly_exhausted';

/** AI → Human (via Relay): Current budget usage status. Sent on connect and after each search. */
export interface BudgetStatusPayload {
  readonly searchesThisSession: number;
  readonly searchesThisDay: number;
  readonly searchesThisMonth: number;
  readonly costThisMonth: number;
  readonly budgetRemaining: number;
  readonly percentUsed: number;
  readonly monthlyCapUsd: number;
  readonly alertLevel: 'none' | 'warning' | 'urgent' | 'exhausted';
}

/** Human → AI (via Admin): Configure budget limits. Tighten-only mid-month. */
export interface BudgetConfigPayload {
  readonly monthlyCapUsd: number;
  readonly maxPerMonth: number;
  readonly maxPerDay: number;
  readonly maxPerSession: number;
  readonly maxPerCall: number;
  readonly alertAtPercent: number;
}

/** AI → Human: Comprehensive usage tracking status with cost breakdown. */
export interface UsageStatusPayload {
  readonly today: {
    readonly calls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd: number;
  };
  readonly thisMonth: {
    readonly calls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd: number;
  };
  readonly byAdapter: Record<string, { readonly calls: number; readonly costUsd: number }>;
  readonly budget: {
    readonly monthlyCapUsd: number;
    readonly remaining: number;
    readonly percentUsed: number;
    readonly alertLevel: string;
  };
}

/** Bidirectional: E2E key exchange — X25519 public key for session cipher derivation. */
export interface KeyExchangePayload {
  readonly publicKey: string;
}

// ---------------------------------------------------------------------------
// Multi-Conversation Persistence
// ---------------------------------------------------------------------------

/** Conversation summary for list display. */
export interface ConversationSummary {
  readonly id: string;
  readonly name: string;
  readonly type: 'normal' | 'game';
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly lastMessagePreview: string;
  readonly archived: boolean;
  readonly preferredAdapter?: string | null;
}

/** Stored message with hash chain data. */
export interface StoredMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly role: 'user' | 'assistant';
  readonly type: string;
  readonly content: string;
  readonly timestamp: string;
  readonly hash: string;
  readonly previousHash: string | null;
  readonly pinned: boolean;
  readonly metadata?: Record<string, unknown>;
}

/** Human → AI: Request all conversations. */
export interface ConversationListPayload {
  readonly includeArchived?: boolean;
}

/** AI → Human: Array of conversation summaries. */
export interface ConversationListResponsePayload {
  readonly conversations: readonly ConversationSummary[];
  readonly totalCount: number;
}

/** Human → AI: Create a new conversation. */
export interface ConversationCreatePayload {
  readonly name?: string;
  readonly type?: 'normal' | 'game';
  readonly preferredAdapter?: string;
}

/** AI → Human: Confirm creation with assigned ID. */
export interface ConversationCreateAckPayload {
  readonly conversationId: string;
  readonly name: string;
  readonly type: 'normal' | 'game';
  readonly createdAt: string;
  readonly preferredAdapter?: string | null;
}

/** Human → AI: Switch active conversation. */
export interface ConversationSwitchPayload {
  readonly conversationId: string;
}

/** AI → Human: Confirm switch + recent messages + scoped memories. */
export interface ConversationSwitchAckPayload {
  readonly conversationId: string;
  readonly name: string;
  readonly recentMessages: readonly StoredMessage[];
  readonly memories: readonly { id: string; content: string; category: string }[];
  readonly preferredAdapter?: string | null;
}

/** Human → AI: Request message page for a conversation. */
export interface ConversationHistoryPayload {
  readonly conversationId: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly direction?: 'older' | 'newer';
}

/** AI → Human: Paginated messages with hash chain data. */
export interface ConversationHistoryResponsePayload {
  readonly conversationId: string;
  readonly messages: readonly StoredMessage[];
  readonly hasMore: boolean;
  readonly totalCount: number;
}

/** Human → AI: Archive a conversation (read-only). */
export interface ConversationArchivePayload {
  readonly conversationId: string;
}

/** Human → AI: Delete a conversation and all its messages. */
export interface ConversationDeletePayload {
  readonly conversationId: string;
}

/** AI → Human: Streaming text chunk during response generation. */
export interface ConversationStreamPayload {
  readonly conversationId: string;
  readonly chunk: string;
  readonly index: number;
  readonly final: boolean;
}

/** Human → AI: Manual compaction trigger. */
export interface ConversationCompactPayload {
  readonly conversationId: string;
}

/** AI → Human: Confirms compaction with results. */
export interface ConversationCompactAckPayload {
  readonly conversationId: string;
  readonly summaryPreview: string;
  readonly messagesCovered: number;
  readonly tokensSaved: number;
}

/** Relay → Human: AI disclosure banner for regulatory transparency (EU AI Act etc.). */
export interface AiDisclosurePayload {
  readonly text: string;
  readonly style: 'info' | 'legal' | 'warning';
  readonly position: 'banner' | 'footer';
  readonly dismissible: boolean;
  readonly link?: string;
  readonly linkText?: string;
  readonly jurisdiction?: string;
}

// ---------------------------------------------------------------------------
// Self-Update System Payloads
// ---------------------------------------------------------------------------

/** Updater → Admin: Check for new version from source. */
export interface UpdateCheckPayload {
  readonly source: 'github';
  readonly repo: string;
  readonly currentVersion: string;
}

/** Admin → Updater: Version information and changelog. */
export interface UpdateAvailablePayload {
  readonly currentVersion: string;
  readonly availableVersion: string;
  readonly commitHash: string;
  readonly changelog: readonly string[];
  readonly components: readonly string[];
  readonly estimatedBuildTime?: number;
}

/** Admin → Components: Prepare for update — save state. */
export interface UpdatePreparePayload {
  readonly targetVersion: string;
  readonly commitHash: string;
  readonly reason: string;
}

/** Component → Admin: Acknowledges preparation, state saved. */
export interface UpdatePrepareAckPayload {
  readonly component: string;
  readonly stateSaved: boolean;
  readonly currentVersion: string;
}

/** Admin → Updater: Execute build commands (E2E encrypted payload). */
export interface UpdateExecutePayload {
  readonly targetComponent: 'relay' | 'ai-client' | 'admin-ui';
  readonly commands: readonly UpdateCommand[];
  readonly version: string;
  readonly commitHash: string;
}

/** Whitelisted update command — no arbitrary shell strings. */
export type UpdateCommand =
  | { readonly type: 'git_pull'; readonly repo?: string }
  | { readonly type: 'pnpm_install' }
  | { readonly type: 'pnpm_build'; readonly filter?: string };

/** Updater → Admin: Build progress report (E2E encrypted). */
export interface UpdateBuildStatusPayload {
  readonly component: string;
  readonly phase: 'pulling' | 'installing' | 'building' | 'complete' | 'failed';
  readonly progress?: number;
  readonly duration?: number;
  readonly error?: string;
}

/** Admin → Updater: Restart a service (E2E encrypted). */
export interface UpdateRestartPayload {
  readonly targetComponent: string;
  readonly service: string;
  readonly timeout: number;
}

/** Component → Admin: Reconnected on new version after restart. */
export interface UpdateReconnectedPayload {
  readonly component: string;
  readonly version: string;
  readonly previousVersion: string;
}

/** Admin → All: Update completed successfully. */
export interface UpdateCompletePayload {
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly duration: number;
  readonly components: readonly {
    readonly name: string;
    readonly buildTime: number;
    readonly restartTime: number;
  }[];
}

/** Any → Admin: Update failed at a specific phase. */
export interface UpdateFailedPayload {
  readonly phase: 'check' | 'prepare' | 'build' | 'restart' | 'verify';
  readonly component?: string;
  readonly error: string;
  readonly recoverable: boolean;
}

// ---------------------------------------------------------------------------
// Data Portability (GDPR Article 20)
// ---------------------------------------------------------------------------

/** Human → AI: Request a full data export (.bdp file). */
export interface DataExportRequestPayload {
  readonly format: 'bdp';
}

/** AI → Human: Export progress update. */
export interface DataExportProgressPayload {
  readonly percentage: number;
  readonly phase: string;
}

/** AI → Human: Export file is ready for download via file airlock. */
export interface DataExportReadyPayload {
  readonly transferId: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly hash: string;
  readonly contentCounts: {
    readonly conversations: number;
    readonly memories: number;
    readonly projectFiles: number;
    readonly skills: number;
  };
}

/** AI → Human: Validation result after import file received via airlock. */
export interface DataImportValidatePayload {
  readonly valid: boolean;
  readonly format: string;
  readonly version: string;
  readonly exportedAt: string;
  readonly contents: {
    readonly conversations: number;
    readonly memories: number;
    readonly projectFiles: number;
    readonly skills: number;
    readonly hasConfig: boolean;
  };
  readonly conflicts: readonly {
    readonly type: 'project_file' | 'skill' | 'memory';
    readonly path: string;
    readonly detail: string;
  }[];
  readonly errors: readonly string[];
}

/** Human → AI: Confirm which data to import. */
export interface DataImportConfirmPayload {
  readonly importConversations: boolean;
  readonly importMemories: boolean;
  readonly importProjectFiles: boolean;
  readonly importSkills: boolean;
  readonly importConfig: boolean;
  readonly conflictResolutions: readonly {
    readonly type: 'project_file' | 'skill' | 'memory';
    readonly path: string;
    readonly action: 'keep' | 'replace' | 'skip';
  }[];
}

/** AI → Human: Import complete with summary. */
export interface DataImportCompletePayload {
  readonly imported: {
    readonly conversations: number;
    readonly memories: number;
    readonly projectFiles: number;
    readonly skills: number;
    readonly configSections: number;
  };
  readonly skipped: {
    readonly conversations: number;
    readonly memories: number;
    readonly projectFiles: number;
    readonly skills: number;
  };
  readonly errors: readonly string[];
}

// ---------------------------------------------------------------------------
// Data Erasure (GDPR Article 17 — Right to Erasure)
// ---------------------------------------------------------------------------

/** Human → AI: Request data erasure with optional reason. */
export interface DataErasureRequestPayload {
  readonly reason?: string;
}

/** AI → Human: Preview of what will be deleted. */
export interface DataErasurePreviewPayload {
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

/** Human → AI: Confirm erasure after preview. */
export interface DataErasureConfirmPayload {
  readonly confirmed: true;
  readonly reason?: string;
}

/** AI → Human: Erasure complete receipt. */
export interface DataErasureCompletePayload {
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

/** Human → AI: Cancel erasure during 30-day window. */
export interface DataErasureCancelPayload {
  readonly erasureId: string;
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
  | { type: 'audit_response'; payload: AuditResponsePayload }
  | { type: 'provider_register'; payload: ProviderRegisterPayload }
  | { type: 'context_update'; payload: ContextUpdatePayload }
  | { type: 'memory_proposal'; payload: MemoryProposalPayload }
  | { type: 'memory_decision'; payload: MemoryDecisionPayload }
  | { type: 'memory_list'; payload: MemoryListPayload }
  | { type: 'memory_list_response'; payload: MemoryListResponsePayload }
  | { type: 'memory_update'; payload: MemoryUpdatePayload }
  | { type: 'memory_delete'; payload: MemoryDeletePayload }
  | { type: 'extension_query'; payload: ExtensionQueryPayload }
  | { type: 'extension_list_response'; payload: ExtensionListResponsePayload }
  | { type: 'project_sync'; payload: ProjectSyncPayload }
  | { type: 'project_sync_ack'; payload: ProjectSyncAckPayload }
  | { type: 'project_list'; payload: ProjectListPayload }
  | { type: 'project_list_response'; payload: ProjectListResponsePayload }
  | { type: 'project_delete'; payload: ProjectDeletePayload }
  | { type: 'project_config'; payload: ProjectConfigPayload }
  | { type: 'project_config_ack'; payload: ProjectConfigAckPayload }
  | { type: 'tool_registry_sync'; payload: ToolRegistrySyncPayload }
  | { type: 'tool_registry_ack'; payload: ToolRegistryAckPayload }
  | { type: 'tool_request'; payload: ToolRequestPayload }
  | { type: 'tool_approved'; payload: ToolApprovedPayload }
  | { type: 'tool_denied'; payload: ToolDeniedPayload }
  | { type: 'tool_result'; payload: ToolResultPayload }
  | { type: 'tool_revoke'; payload: ToolRevokePayload }
  | { type: 'tool_alert'; payload: ToolAlertPayload }
  | { type: 'tool_alert_response'; payload: ToolAlertResponsePayload }
  | { type: 'challenge_status'; payload: ChallengeStatusPayload }
  | { type: 'challenge_config'; payload: ChallengeConfigPayload }
  | { type: 'challenge_config_ack'; payload: ChallengeConfigAckPayload }
  | { type: 'budget_status'; payload: BudgetStatusPayload }
  | { type: 'budget_config'; payload: BudgetConfigPayload }
  | { type: 'usage_status'; payload: UsageStatusPayload }
  | { type: 'key_exchange'; payload: KeyExchangePayload }
  | { type: 'conversation_list'; payload: ConversationListPayload }
  | { type: 'conversation_list_response'; payload: ConversationListResponsePayload }
  | { type: 'conversation_create'; payload: ConversationCreatePayload }
  | { type: 'conversation_create_ack'; payload: ConversationCreateAckPayload }
  | { type: 'conversation_switch'; payload: ConversationSwitchPayload }
  | { type: 'conversation_switch_ack'; payload: ConversationSwitchAckPayload }
  | { type: 'conversation_history'; payload: ConversationHistoryPayload }
  | { type: 'conversation_history_response'; payload: ConversationHistoryResponsePayload }
  | { type: 'conversation_archive'; payload: ConversationArchivePayload }
  | { type: 'conversation_delete'; payload: ConversationDeletePayload }
  | { type: 'conversation_compact'; payload: ConversationCompactPayload }
  | { type: 'conversation_compact_ack'; payload: ConversationCompactAckPayload }
  | { type: 'conversation_stream'; payload: ConversationStreamPayload }
  | { type: 'ai_disclosure'; payload: AiDisclosurePayload }
  | { type: 'update_check'; payload: UpdateCheckPayload }
  | { type: 'update_available'; payload: UpdateAvailablePayload }
  | { type: 'update_prepare'; payload: UpdatePreparePayload }
  | { type: 'update_prepare_ack'; payload: UpdatePrepareAckPayload }
  | { type: 'update_execute'; payload: UpdateExecutePayload }
  | { type: 'update_build_status'; payload: UpdateBuildStatusPayload }
  | { type: 'update_restart'; payload: UpdateRestartPayload }
  | { type: 'update_reconnected'; payload: UpdateReconnectedPayload }
  | { type: 'update_complete'; payload: UpdateCompletePayload }
  | { type: 'update_failed'; payload: UpdateFailedPayload }
  | { type: 'data_export_request'; payload: DataExportRequestPayload }
  | { type: 'data_export_progress'; payload: DataExportProgressPayload }
  | { type: 'data_export_ready'; payload: DataExportReadyPayload }
  | { type: 'data_import_validate'; payload: DataImportValidatePayload }
  | { type: 'data_import_confirm'; payload: DataImportConfirmPayload }
  | { type: 'data_import_complete'; payload: DataImportCompletePayload }
  | { type: 'data_erasure_request'; payload: DataErasureRequestPayload }
  | { type: 'data_erasure_preview'; payload: DataErasurePreviewPayload }
  | { type: 'data_erasure_confirm'; payload: DataErasureConfirmPayload }
  | { type: 'data_erasure_complete'; payload: DataErasureCompletePayload }
  | { type: 'data_erasure_cancel'; payload: DataErasureCancelPayload };
