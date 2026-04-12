// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Zod schemas for all 93 message type payloads.
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

export const ErrorCodeSchema = z.string().regex(/^BASTION-[1-8]\d{3}$/, 'Must match format BASTION-CXXX');

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

export const ProviderRegisterPayloadSchema = z.object({
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  capabilities: z.object({
    conversation: z.boolean(),
    taskExecution: z.boolean(),
    fileTransfer: z.boolean(),
  }),
});

export const ContextUpdatePayloadSchema = z.object({
  content: z.string(),
});

export const MemoryProposalPayloadSchema = z.object({
  proposalId: z.string().min(1),
  content: z.string().min(1),
  category: z.enum(['preference', 'fact', 'workflow', 'project']),
  sourceMessageId: z.string().min(1),
  conversationId: z.string().optional(),
});

export const MemoryDecisionPayloadSchema = z.object({
  proposalId: z.string().min(1),
  decision: z.enum(['approve', 'edit', 'reject']),
  editedContent: z.string().optional(),
  memoryId: z.string().optional(),
});

export const MemoryListPayloadSchema = z.object({
  category: z.enum(['preference', 'fact', 'workflow', 'project']).optional(),
  conversationId: z.string().nullable().optional(),
});

export const MemoryListResponsePayloadSchema = z.object({
  memories: z.array(
    z.object({
      id: z.string().min(1),
      content: z.string().min(1),
      category: z.enum(['preference', 'fact', 'workflow', 'project']),
      createdAt: z.string(),
      updatedAt: z.string(),
      conversationId: z.string().nullable().optional(),
    }),
  ),
  totalCount: z.number().int().nonnegative(),
});

export const MemoryUpdatePayloadSchema = z.object({
  memoryId: z.string().min(1),
  content: z.string().min(1),
});

export const MemoryDeletePayloadSchema = z.object({
  memoryId: z.string().min(1),
});

// Tool Integration schemas
const ToolDefSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  category: z.enum(['read', 'write', 'destructive']),
  readOnly: z.boolean(),
  dangerous: z.boolean(),
  modes: z.array(z.enum(['conversation', 'task'])),
});

const ToolProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  endpoint: z.string(),
  authType: z.enum(['api_key', 'custom_header', 'no_auth']),
  tools: z.array(ToolDefSchema),
});

export const ToolRegistrySyncPayloadSchema = z.object({
  providers: z.array(ToolProviderSchema),
  registryHash: z.string().min(1),
});

export const ToolRegistryAckPayloadSchema = z.object({
  registryHash: z.string().min(1),
  toolCount: z.number().int().nonnegative(),
});

export const ToolRequestPayloadSchema = z.object({
  requestId: z.string().min(1),
  toolId: z.string().min(1),
  action: z.string().min(1),
  parameters: z.record(z.unknown()),
  mode: z.enum(['conversation', 'task']),
  dangerous: z.boolean(),
  category: z.enum(['read', 'write', 'destructive']),
});

export const ToolApprovedPayloadSchema = z.object({
  requestId: z.string().min(1),
  toolId: z.string().min(1),
  trustLevel: z.number().int().min(1).max(10),
  reason: z.string().min(1),
  scope: z.enum(['this_call', 'session']),
});

export const ToolDeniedPayloadSchema = z.object({
  requestId: z.string().min(1),
  toolId: z.string().min(1),
  reason: z.string().min(1),
});

export const ToolResultPayloadSchema = z.object({
  requestId: z.string().min(1),
  toolId: z.string().min(1),
  result: z.unknown(),
  durationMs: z.number().nonnegative(),
  success: z.boolean(),
  error: z.string().optional(),
});

export const ToolRevokePayloadSchema = z.object({
  toolId: z.string().min(1),
  reason: z.string().min(1),
});

export const ToolAlertPayloadSchema = z.object({
  alertType: z.enum(['new_tool_detected', 'lost_tool', 'changed_tool']),
  severity: z.enum(['info', 'warning', 'critical']),
  toolName: z.string().min(1),
  providerId: z.string().min(1),
  fullId: z.string().min(1),
  source: z.enum(['mcp', 'provider']),
  detectedAt: z.string().min(1),
  description: z.string(),
  message: z.string().min(1),
});

export const ToolAlertResponsePayloadSchema = z.object({
  toolId: z.string().min(1),
  decision: z.enum(['accept', 'decline']),
});

export const ToolRegisterPayloadSchema = z.object({
  providerId: z.string().min(1),
  tool: z.object({
    name: z.string().min(1),
    description: z.string(),
    category: z.enum(['read', 'write', 'destructive']),
    readOnly: z.boolean(),
    dangerous: z.boolean(),
    modes: z.array(z.enum(['conversation', 'task'])),
  }),
  action: z.enum(['approve', 'reject']),
});

// Challenge Me More schemas
export const ChallengeStatusPayloadSchema = z.object({
  active: z.boolean(),
  timezone: z.string().min(1),
  currentTime: z.string(),
  periodEnd: z.string().nullable(),
  restrictions: z.array(z.string()),
});

export const ChallengeConfigPayloadSchema = z.object({
  schedule: z.object({
    weekdays: z.object({ start: z.string(), end: z.string() }),
    weekends: z.object({ start: z.string(), end: z.string() }),
  }),
  cooldowns: z.object({
    budgetChangeDays: z.number().int().nonnegative(),
    scheduleChangeDays: z.number().int().nonnegative(),
    toolRegistrationDays: z.number().int().nonnegative(),
  }),
});

export const ChallengeConfigAckPayloadSchema = z.object({
  accepted: z.boolean(),
  reason: z.string(),
  cooldownExpires: z.string().nullable(),
});

export const ExtensionQueryPayloadSchema = z.object({
  includeSchemas: z.boolean().optional(),
});

export const ExtensionConversationRendererSchema = z.object({
  html: z.string(),
  style: z.enum(['compact', 'full']).optional(),
  markdown: z.boolean().optional(),
});

export const ExtensionStateUpdatePayloadSchema = z.object({
  namespace: z.string().min(1),
  state: z.record(z.string(), z.unknown()),
});

export const ExtensionStateRequestPayloadSchema = z.object({
  namespace: z.string().min(1),
});

export const ExtensionStateResponsePayloadSchema = z.object({
  namespace: z.string().min(1),
  state: z.record(z.string(), z.unknown()).nullable(),
});

export const ExtensionListResponsePayloadSchema = z.object({
  extensions: z.array(
    z.object({
      namespace: z.string().min(1),
      name: z.string().min(1),
      version: z.string().min(1),
      messageTypes: z.array(z.string()),
      conversationRenderers: z.record(z.string(), ExtensionConversationRendererSchema).optional(),
    }),
  ),
  totalCount: z.number().int().nonnegative(),
});

// --- Skills System (Layer 5) ---

export const SkillListResponsePayloadSchema = z.object({
  skills: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string(),
      version: z.string(),
      author: z.string(),
      triggers: z.array(z.string()),
      modes: z.array(z.string()),
      alwaysLoad: z.boolean().optional(),
      estimatedTokens: z.number().int().nonnegative(),
    }),
  ),
  totalCount: z.number().int().nonnegative(),
  totalEstimatedTokens: z.number().int().nonnegative(),
});

export const SkillScanResultPayloadSchema = z.object({
  skillId: z.string().min(1),
  passed: z.boolean(),
  checks: z.array(
    z.object({
      name: z.string().min(1),
      passed: z.boolean(),
      detail: z.string().optional(),
    }),
  ),
  hash: z.string().min(1),
  fileSize: z.number().int().nonnegative(),
  action: z.literal('pending_review'),
});

export const ProjectSyncPayloadSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  mimeType: z.string().min(1),
});

export const ProjectSyncAckPayloadSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  timestamp: z.string(),
});

export const ProjectListPayloadSchema = z.object({
  directory: z.string().optional(),
});

export const ProjectListResponsePayloadSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      size: z.number().int().nonnegative(),
      mimeType: z.string(),
      lastModified: z.string(),
    }),
  ),
  totalSize: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
});

export const ProjectDeletePayloadSchema = z.object({
  path: z.string().min(1),
});

export const ProjectConfigPayloadSchema = z.object({
  alwaysLoaded: z.array(z.string()),
  available: z.array(z.string()),
});

export const ProjectConfigAckPayloadSchema = z.object({
  alwaysLoaded: z.array(z.string()),
  available: z.array(z.string()),
  timestamp: z.string(),
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

export const SessionRestoredPayloadSchema = z.object({
  sessionId: SessionIdSchema,
  queuedMessageCount: z.number().int().nonnegative(),
});

export const ConfigUpdateTypeSchema = z.enum(['api_key_rotation', 'tool_registry', 'safety_config']);

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

export const BudgetAlertLevelSchema = z.enum([
  'warning_50',
  'urgent_80',
  'session_limit',
  'daily_limit',
  'monthly_exhausted',
]);

export const BudgetAlertPayloadSchema = z.object({
  alertLevel: BudgetAlertLevelSchema,
  message: z.string().min(1),
  budgetRemaining: z.number(),
  searchesRemaining: z.number().int(),
});

export const BudgetStatusPayloadSchema = z.object({
  searchesThisSession: z.number().int().nonnegative(),
  searchesThisDay: z.number().int().nonnegative(),
  searchesThisMonth: z.number().int().nonnegative(),
  costThisMonth: z.number().nonnegative(),
  budgetRemaining: z.number(),
  percentUsed: z.number().min(0).max(100),
  monthlyCapUsd: z.number().nonnegative(),
  alertLevel: z.enum(['none', 'warning', 'urgent', 'exhausted']),
});

export const BudgetConfigPayloadSchema = z.object({
  monthlyCapUsd: z.number().positive(),
  maxPerMonth: z.number().int().positive(),
  maxPerDay: z.number().int().positive(),
  maxPerSession: z.number().int().positive(),
  maxPerCall: z.number().int().positive(),
  alertAtPercent: z.number().min(1).max(99),
});

const UsageSummaryShape = z.object({
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});

export const UsageStatusPayloadSchema = z.object({
  today: UsageSummaryShape,
  thisMonth: UsageSummaryShape,
  byAdapter: z.record(z.object({ calls: z.number().int().nonnegative(), costUsd: z.number().nonnegative() })),
  budget: z.object({
    monthlyCapUsd: z.number().nonnegative(),
    remaining: z.number(),
    percentUsed: z.number().nonnegative(),
    alertLevel: z.string().min(1),
  }),
});

export const KeyExchangePayloadSchema = z.object({
  publicKey: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Multi-Conversation Persistence schemas
// ---------------------------------------------------------------------------

const ConversationSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['normal', 'game']),
  updatedAt: z.string().min(1),
  messageCount: z.number().int().nonnegative(),
  lastMessagePreview: z.string(),
  archived: z.boolean(),
  preferredAdapter: z.string().nullable().optional(),
});

const StoredMessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  type: z.string().min(1),
  content: z.string(),
  timestamp: z.string().min(1),
  hash: z.string().min(1),
  previousHash: z.string().nullable(),
  pinned: z.boolean(),
  metadata: z.record(z.unknown()).optional(),
});

export const ConversationListPayloadSchema = z.object({
  includeArchived: z.boolean().optional(),
});

export const ConversationListResponsePayloadSchema = z.object({
  conversations: z.array(ConversationSummarySchema).readonly(),
  totalCount: z.number().int().nonnegative(),
});

export const ConversationCreatePayloadSchema = z.object({
  name: z.string().optional(),
  type: z.enum(['normal', 'game']).optional(),
  preferredAdapter: z.string().optional(),
});

export const ConversationCreateAckPayloadSchema = z.object({
  conversationId: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['normal', 'game']),
  createdAt: z.string().min(1),
  preferredAdapter: z.string().nullable().optional(),
});

export const ConversationSwitchPayloadSchema = z.object({
  conversationId: z.string().min(1),
});

export const ConversationSwitchAckPayloadSchema = z.object({
  conversationId: z.string().min(1),
  name: z.string().min(1),
  recentMessages: z.array(StoredMessageSchema).readonly(),
  memories: z.array(z.object({ id: z.string(), content: z.string(), category: z.string() })).readonly(),
  preferredAdapter: z.string().nullable().optional(),
});

export const ConversationHistoryPayloadSchema = z.object({
  conversationId: z.string().min(1),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  direction: z.enum(['older', 'newer']).optional(),
});

export const ConversationHistoryResponsePayloadSchema = z.object({
  conversationId: z.string().min(1),
  messages: z.array(StoredMessageSchema).readonly(),
  hasMore: z.boolean(),
  totalCount: z.number().int().nonnegative(),
});

export const ConversationArchivePayloadSchema = z.object({
  conversationId: z.string().min(1),
});

export const ConversationDeletePayloadSchema = z.object({
  conversationId: z.string().min(1),
});

export const ConversationCompactPayloadSchema = z.object({
  conversationId: z.string().min(1),
});

export const ConversationStreamPayloadSchema = z.object({
  conversationId: z.string().min(1),
  chunk: z.string(),
  index: z.number().int().nonnegative(),
  final: z.boolean(),
});

export const ConversationCompactAckPayloadSchema = z.object({
  conversationId: z.string().min(1),
  summaryPreview: z.string(),
  messagesCovered: z.number().int().nonnegative(),
  tokensSaved: z.number().int().nonnegative(),
});

export const AiDisclosurePayloadSchema = z.object({
  text: z.string().min(1),
  style: z.enum(['info', 'legal', 'warning']),
  position: z.enum(['banner', 'footer']),
  dismissible: z.boolean(),
  link: z.string().url().optional(),
  linkText: z.string().optional(),
  jurisdiction: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Data Portability (GDPR Article 20)
// ---------------------------------------------------------------------------

export const DataExportRequestPayloadSchema = z.object({
  format: z.literal('bdp'),
});

export const DataExportProgressPayloadSchema = z.object({
  percentage: z.number().int().min(0).max(100),
  phase: z.string().min(1),
});

export const DataExportReadyPayloadSchema = z.object({
  transferId: z.string().min(1),
  filename: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  hash: z.string().min(1),
  contentCounts: z.object({
    conversations: z.number().int().nonnegative(),
    memories: z.number().int().nonnegative(),
    projectFiles: z.number().int().nonnegative(),
    skills: z.number().int().nonnegative(),
  }),
});

export const DataImportValidatePayloadSchema = z.object({
  valid: z.boolean(),
  format: z.string().min(1),
  version: z.string().min(1),
  exportedAt: z.string().min(1),
  contents: z.object({
    conversations: z.number().int().nonnegative(),
    memories: z.number().int().nonnegative(),
    projectFiles: z.number().int().nonnegative(),
    skills: z.number().int().nonnegative(),
    hasConfig: z.boolean(),
  }),
  conflicts: z
    .array(
      z.object({
        type: z.enum(['project_file', 'skill', 'memory']),
        path: z.string().min(1),
        detail: z.string().min(1),
      }),
    )
    .readonly(),
  errors: z.array(z.string()).readonly(),
});

export const DataImportConfirmPayloadSchema = z.object({
  importConversations: z.boolean(),
  importMemories: z.boolean(),
  importProjectFiles: z.boolean(),
  importSkills: z.boolean(),
  importConfig: z.boolean(),
  conflictResolutions: z
    .array(
      z.object({
        type: z.enum(['project_file', 'skill', 'memory']),
        path: z.string().min(1),
        action: z.enum(['keep', 'replace', 'skip']),
      }),
    )
    .readonly(),
});

export const DataImportCompletePayloadSchema = z.object({
  imported: z.object({
    conversations: z.number().int().nonnegative(),
    memories: z.number().int().nonnegative(),
    projectFiles: z.number().int().nonnegative(),
    skills: z.number().int().nonnegative(),
    configSections: z.number().int().nonnegative(),
  }),
  skipped: z.object({
    conversations: z.number().int().nonnegative(),
    memories: z.number().int().nonnegative(),
    projectFiles: z.number().int().nonnegative(),
    skills: z.number().int().nonnegative(),
  }),
  errors: z.array(z.string()).readonly(),
});

// ---------------------------------------------------------------------------
// Data Erasure (GDPR Article 17 — Right to Erasure)
// ---------------------------------------------------------------------------

export const DataErasureRequestPayloadSchema = z.object({
  reason: z.string().optional(),
});

export const DataErasurePreviewPayloadSchema = z.object({
  conversations: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  memories: z.number().int().nonnegative(),
  projectFiles: z.number().int().nonnegative(),
  skills: z.number().int().nonnegative(),
  usageRecords: z.number().int().nonnegative(),
  softDeleteDays: z.number().int().positive(),
  hardDeleteAt: z.string().min(1),
  auditNote: z.string().min(1),
});

export const DataErasureConfirmPayloadSchema = z.object({
  confirmed: z.literal(true),
  reason: z.string().optional(),
});

export const DataErasureCompletePayloadSchema = z.object({
  erasureId: z.string().min(1),
  softDeleted: z.object({
    conversations: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    memories: z.number().int().nonnegative(),
    projectFiles: z.number().int().nonnegative(),
    usageRecords: z.number().int().nonnegative(),
  }),
  hardDeleteScheduledAt: z.string().min(1),
  receipt: z.string().min(1),
});

export const DataErasureCancelPayloadSchema = z.object({
  erasureId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// AI Native Actions
// ---------------------------------------------------------------------------

export const AiChallengePayloadSchema = z.object({
  challengeId: z.string().min(1),
  reason: z.string().min(1),
  severity: z.enum(['info', 'warning', 'critical']),
  suggestedAction: z.string().min(1),
  waitSeconds: z.number().int().nonnegative(),
  context: z.object({
    challengeHoursActive: z.boolean(),
    requestedAction: z.string(),
  }),
});

export const AiChallengeResponsePayloadSchema = z.object({
  challengeId: z.string().min(1),
  decision: z.enum(['accept', 'override', 'cancel']),
});

export const AiMemoryProposalPayloadSchema = z.object({
  proposalId: z.string().min(1),
  content: z.string().min(1),
  category: z.enum(['fact', 'preference', 'workflow', 'project']),
  reason: z.string().min(1),
  sourceMessageId: z.string().min(1),
  conversationId: z.string().min(1),
});

// --- Bulk Memory Proposals (Atomic Queue) ---

export const AiMemoryProposalBatchPayloadSchema = z.object({
  batchId: z.string().min(1),
  source: z.enum(['dream_cycle', 'recall_analysis', 'session_summary']),
  conversationId: z.string().nullable(),
  proposals: z
    .array(
      z.object({
        proposalId: z.string().min(1),
        content: z.string().min(1),
        category: z.enum(['fact', 'preference', 'workflow', 'project']),
        reason: z.string().min(1),
        isUpdate: z.boolean(),
        existingMemoryContent: z.string().nullable(),
      }),
    )
    .min(1)
    .max(50),
});

export const MemoryBatchDecisionPayloadSchema = z.object({
  batchId: z.string().min(1),
  decisions: z
    .array(
      z.object({
        proposalId: z.string().min(1),
        decision: z.enum(['approved', 'rejected', 'edited']),
        editedContent: z.string().nullable(),
      }),
    )
    .min(1),
});

// --- Dream Cycle (Layer 6) ---

export const DreamCycleRequestPayloadSchema = z.object({
  conversationId: z.string().min(1),
  scope: z.enum(['conversation', 'all']),
});

export const DreamCycleCompletePayloadSchema = z.object({
  conversationId: z.string().min(1),
  candidateCount: z.number().int().min(0),
  tokensUsed: z.object({
    input: z.number().int().min(0),
    output: z.number().int().min(0),
  }),
  estimatedCost: z.number().min(0),
  durationMs: z.number().int().min(0),
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
  [MESSAGE_TYPES.FILE_MANIFEST]: FileManifestPayloadSchema,
  [MESSAGE_TYPES.FILE_OFFER]: FileOfferPayloadSchema,
  [MESSAGE_TYPES.FILE_REQUEST]: FileRequestPayloadSchema,
  [MESSAGE_TYPES.HEARTBEAT]: HeartbeatPayloadSchema,
  [MESSAGE_TYPES.SESSION_END]: SessionEndPayloadSchema,
  [MESSAGE_TYPES.SESSION_CONFLICT]: SessionConflictPayloadSchema,
  [MESSAGE_TYPES.SESSION_SUPERSEDED]: SessionSupersededPayloadSchema,
  [MESSAGE_TYPES.RECONNECT]: ReconnectPayloadSchema,
  [MESSAGE_TYPES.SESSION_RESTORED]: SessionRestoredPayloadSchema,
  [MESSAGE_TYPES.CONFIG_ACK]: ConfigAckPayloadSchema,
  [MESSAGE_TYPES.CONFIG_NACK]: ConfigNackPayloadSchema,
  [MESSAGE_TYPES.TOKEN_REFRESH]: TokenRefreshPayloadSchema,
  [MESSAGE_TYPES.PROVIDER_STATUS]: ProviderStatusPayloadSchema,
  [MESSAGE_TYPES.BUDGET_ALERT]: BudgetAlertPayloadSchema,
  [MESSAGE_TYPES.AUDIT_QUERY]: AuditQueryPayloadSchema,
  [MESSAGE_TYPES.AUDIT_RESPONSE]: AuditResponsePayloadSchema,
  [MESSAGE_TYPES.PROVIDER_REGISTER]: ProviderRegisterPayloadSchema,
  [MESSAGE_TYPES.CONTEXT_UPDATE]: ContextUpdatePayloadSchema,
  [MESSAGE_TYPES.MEMORY_PROPOSAL]: MemoryProposalPayloadSchema,
  [MESSAGE_TYPES.MEMORY_DECISION]: MemoryDecisionPayloadSchema,
  [MESSAGE_TYPES.MEMORY_LIST]: MemoryListPayloadSchema,
  [MESSAGE_TYPES.MEMORY_LIST_RESPONSE]: MemoryListResponsePayloadSchema,
  [MESSAGE_TYPES.MEMORY_UPDATE]: MemoryUpdatePayloadSchema,
  [MESSAGE_TYPES.MEMORY_DELETE]: MemoryDeletePayloadSchema,
  [MESSAGE_TYPES.EXTENSION_QUERY]: ExtensionQueryPayloadSchema,
  [MESSAGE_TYPES.EXTENSION_LIST_RESPONSE]: ExtensionListResponsePayloadSchema,
  [MESSAGE_TYPES.EXTENSION_STATE_UPDATE]: ExtensionStateUpdatePayloadSchema,
  [MESSAGE_TYPES.EXTENSION_STATE_REQUEST]: ExtensionStateRequestPayloadSchema,
  [MESSAGE_TYPES.EXTENSION_STATE_RESPONSE]: ExtensionStateResponsePayloadSchema,
  [MESSAGE_TYPES.SKILL_LIST_RESPONSE]: SkillListResponsePayloadSchema,
  [MESSAGE_TYPES.SKILL_SCAN_RESULT]: SkillScanResultPayloadSchema,
  [MESSAGE_TYPES.PROJECT_SYNC]: ProjectSyncPayloadSchema,
  [MESSAGE_TYPES.PROJECT_SYNC_ACK]: ProjectSyncAckPayloadSchema,
  [MESSAGE_TYPES.PROJECT_LIST]: ProjectListPayloadSchema,
  [MESSAGE_TYPES.PROJECT_LIST_RESPONSE]: ProjectListResponsePayloadSchema,
  [MESSAGE_TYPES.PROJECT_DELETE]: ProjectDeletePayloadSchema,
  [MESSAGE_TYPES.PROJECT_CONFIG]: ProjectConfigPayloadSchema,
  [MESSAGE_TYPES.PROJECT_CONFIG_ACK]: ProjectConfigAckPayloadSchema,
  [MESSAGE_TYPES.TOOL_REGISTRY_SYNC]: ToolRegistrySyncPayloadSchema,
  [MESSAGE_TYPES.TOOL_REGISTRY_ACK]: ToolRegistryAckPayloadSchema,
  [MESSAGE_TYPES.TOOL_REQUEST]: ToolRequestPayloadSchema,
  [MESSAGE_TYPES.TOOL_APPROVED]: ToolApprovedPayloadSchema,
  [MESSAGE_TYPES.TOOL_DENIED]: ToolDeniedPayloadSchema,
  [MESSAGE_TYPES.TOOL_RESULT]: ToolResultPayloadSchema,
  [MESSAGE_TYPES.TOOL_REVOKE]: ToolRevokePayloadSchema,
  [MESSAGE_TYPES.TOOL_ALERT]: ToolAlertPayloadSchema,
  [MESSAGE_TYPES.TOOL_ALERT_RESPONSE]: ToolAlertResponsePayloadSchema,
  [MESSAGE_TYPES.TOOL_REGISTER]: ToolRegisterPayloadSchema,
  [MESSAGE_TYPES.CHALLENGE_STATUS]: ChallengeStatusPayloadSchema,
  [MESSAGE_TYPES.CHALLENGE_CONFIG]: ChallengeConfigPayloadSchema,
  [MESSAGE_TYPES.CHALLENGE_CONFIG_ACK]: ChallengeConfigAckPayloadSchema,
  [MESSAGE_TYPES.BUDGET_STATUS]: BudgetStatusPayloadSchema,
  [MESSAGE_TYPES.BUDGET_CONFIG]: BudgetConfigPayloadSchema,
  [MESSAGE_TYPES.USAGE_STATUS]: UsageStatusPayloadSchema,
  [MESSAGE_TYPES.KEY_EXCHANGE]: KeyExchangePayloadSchema,
  [MESSAGE_TYPES.CONVERSATION_LIST]: ConversationListPayloadSchema,
  [MESSAGE_TYPES.CONVERSATION_LIST_RESPONSE]: ConversationListResponsePayloadSchema,
  [MESSAGE_TYPES.CONVERSATION_CREATE]: ConversationCreatePayloadSchema,
  [MESSAGE_TYPES.CONVERSATION_CREATE_ACK]: ConversationCreateAckPayloadSchema,
  [MESSAGE_TYPES.CONVERSATION_SWITCH]: ConversationSwitchPayloadSchema,
  [MESSAGE_TYPES.CONVERSATION_SWITCH_ACK]: ConversationSwitchAckPayloadSchema,
  [MESSAGE_TYPES.CONVERSATION_HISTORY]: ConversationHistoryPayloadSchema,
  [MESSAGE_TYPES.CONVERSATION_HISTORY_RESPONSE]: ConversationHistoryResponsePayloadSchema,
  [MESSAGE_TYPES.CONVERSATION_ARCHIVE]: ConversationArchivePayloadSchema,
  [MESSAGE_TYPES.CONVERSATION_DELETE]: ConversationDeletePayloadSchema,
  [MESSAGE_TYPES.CONVERSATION_COMPACT]: ConversationCompactPayloadSchema,
  [MESSAGE_TYPES.CONVERSATION_COMPACT_ACK]: ConversationCompactAckPayloadSchema,
  [MESSAGE_TYPES.CONVERSATION_STREAM]: ConversationStreamPayloadSchema,
  [MESSAGE_TYPES.AI_DISCLOSURE]: AiDisclosurePayloadSchema,
  [MESSAGE_TYPES.DATA_EXPORT_REQUEST]: DataExportRequestPayloadSchema,
  [MESSAGE_TYPES.DATA_EXPORT_PROGRESS]: DataExportProgressPayloadSchema,
  [MESSAGE_TYPES.DATA_EXPORT_READY]: DataExportReadyPayloadSchema,
  [MESSAGE_TYPES.DATA_IMPORT_VALIDATE]: DataImportValidatePayloadSchema,
  [MESSAGE_TYPES.DATA_IMPORT_CONFIRM]: DataImportConfirmPayloadSchema,
  [MESSAGE_TYPES.DATA_IMPORT_COMPLETE]: DataImportCompletePayloadSchema,
  [MESSAGE_TYPES.DATA_ERASURE_REQUEST]: DataErasureRequestPayloadSchema,
  [MESSAGE_TYPES.DATA_ERASURE_PREVIEW]: DataErasurePreviewPayloadSchema,
  [MESSAGE_TYPES.DATA_ERASURE_CONFIRM]: DataErasureConfirmPayloadSchema,
  [MESSAGE_TYPES.DATA_ERASURE_COMPLETE]: DataErasureCompletePayloadSchema,
  [MESSAGE_TYPES.DATA_ERASURE_CANCEL]: DataErasureCancelPayloadSchema,
  [MESSAGE_TYPES.AI_CHALLENGE]: AiChallengePayloadSchema,
  [MESSAGE_TYPES.AI_CHALLENGE_RESPONSE]: AiChallengeResponsePayloadSchema,
  [MESSAGE_TYPES.AI_MEMORY_PROPOSAL]: AiMemoryProposalPayloadSchema,
  [MESSAGE_TYPES.AI_MEMORY_PROPOSAL_BATCH]: AiMemoryProposalBatchPayloadSchema,
  [MESSAGE_TYPES.MEMORY_BATCH_DECISION]: MemoryBatchDecisionPayloadSchema,
  [MESSAGE_TYPES.DREAM_CYCLE_REQUEST]: DreamCycleRequestPayloadSchema,
  [MESSAGE_TYPES.DREAM_CYCLE_COMPLETE]: DreamCycleCompletePayloadSchema,
} as const;
