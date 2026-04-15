// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * @bastion/client-ai — Headless AI client for Project Bastion.
 *
 * Connects to the Bastion relay over WSS, authenticates via JWT,
 * and handles the AI side of human-AI messaging sessions.
 */

// ---------------------------------------------------------------------------
// AI Client
// ---------------------------------------------------------------------------
export { BastionAiClient, AiClientError } from './client.js';
export type {
  AiClientConfig,
  AiClientEvents,
  AiClientState,
} from './client.js';

// ---------------------------------------------------------------------------
// Safety Engine
// ---------------------------------------------------------------------------
export {
  defaultSafetyConfig,
  validateSafetyConfig,
  evaluateLayer1,
  evaluateLayer2,
  createPatternHistory,
  evaluateLayer3,
  evaluateSafety,
  generateSafetyResponse,
} from './safety/index.js';
export type {
  FloorViolation,
  PatternHistory,
  PatternEntry,
  SafetyPipelineOptions,
  SafetyResponse,
} from './safety/index.js';

// ---------------------------------------------------------------------------
// Provider Adapter
// ---------------------------------------------------------------------------
export {
  createToolRegistry,
  createApiKeyManager,
  createAnthropicAdapter,
  ConversationManager,
  ConversationStore,
  CompactionManager,
  AdapterRegistry,
  MemoryStore,
  ProjectStore,
  validatePath,
  scanContent,
  ToolRegistryManager,
  ToolUpstreamMonitor,
  McpClientAdapter,
  ChallengeManager,
  BudgetGuard,
  SkillStore,
  SkillsManager,
  validateParameters,
  DataExporter,
  DataEraser,
  ImportRegistry,
  UsageTracker,
  BastionImportAdapter,
  ImportExecutor,
  ExtensionDispatcher,
  loadExtensionHandlers,
  DreamCycleManager,
  DateTimeManager,
  RecallHandler,
  BastionBash,
  AiClientAuditLogger,
  AiClientAuditLoggerError,
  AI_AUDIT_EVENT_TYPES,
} from './provider/index.js';
export type {
  ToolRegistry,
  ToolDefinition,
  ToolCategory,
  ToolValidationResult,
  AnthropicToolDef,
  ApiKeyManager,
  KeyRotationResult,
  AnthropicAdapter,
  AnthropicAdapterConfig,
  ValidatedToolCall,
  RejectedToolCall,
  FetchFn,
  ConversationMessage,
  ConversationManagerConfig,
  PromptZone,
  PromptBudgetReport,
  ConversationRecord,
  MessageRecord,
  ChainVerification,
  ConversationStoreConfig,
  CompactionSummary,
  CompactionCheck,
  CompactionResult,
  CompactionManagerConfig,
  SummariseFn,
  AdapterRole,
  OperationType,
  RegisteredAdapter,
  AdapterSelection,
  Memory,
  MemoryStoreConfig,
  ProjectFile,
  ProjectConfig,
  ProjectStoreConfig,
  ProjectSaveResult,
  RegisteredTool,
  ToolProvider,
  SessionTrust,
  RegistryViolation,
  UpstreamToolChange,
  UpstreamCheckResult,
  McpTool,
  McpCallResult,
  McpClientConfig,
  ChallengeConfig,
  ChallengeSchedule,
  ChallengeCooldowns,
  ChallengeResult,
  SkillManifest,
  LoadedSkill,
  SkillStoreConfig,
  SkillMode,
  SkillScanResult,
  SkillScanCheck,
  PendingSkill,
  SkillsManagerConfig,
  BudgetLimits,
  BudgetGuardConfig,
  BudgetCheckResult,
  BudgetStatus,
  BudgetGuardOptions,
  ExportManifest,
  ExportProgress,
  DataExporterConfig,
  DataEraserConfig,
  ErasurePreview,
  ErasureResult,
  ImportAdapter,
  ImportValidation,
  ImportConflict,
  ImportData,
  ImportSelections,
  ImportResult,
  ImportStoreRefs,
  UsageRecord,
  UsageSummary,
  DailyUsage,
  AdapterUsageSummary,
  UsageTrackerConfig,
  ExtensionContext,
  ExtensionHandler,
  ExtensionHandlerContext,
  DreamCycleConfig,
  DreamCycleResult,
  MemoryCandidate,
  DateTimeInfo,
  DateTimeManagerConfig,
  AuditEvent,
  AiClientAuditLoggerConfig,
  RecallRequest,
  RecallMatch,
  RecallResult,
  BastionBashConfig,
  CommandResult,
  BashAuditLogger,
} from './provider/index.js';

// ---------------------------------------------------------------------------
// BastionGuardian Phase 1 — Identity Announcement
// ---------------------------------------------------------------------------
export {
  getBastionVersion,
  getIdentityHeaders,
  verifyIdentityHeaders,
  detectForeignHarness,
  enforceForeignHarnessCheck,
  FOREIGN_HARNESS_VARS,
} from './provider/index.js';
export type { BastionIdentityHeaders } from './provider/index.js';

// ---------------------------------------------------------------------------
// File Handling
// ---------------------------------------------------------------------------
export {
  IntakeDirectory,
  IntakeError,
  OutboundStaging,
  OutboundError,
  FilePurgeManager,
  PurgeError,
} from './files/index.js';
export type {
  IntakeConfig,
  IntakeFileMetadata,
  IntakeReceiveResult,
  OutboundConfig,
  StagedFileMetadata,
  StagedFileState,
  StageResult,
  SubmitResult,
  FilePurgeConfig,
  FileDeletionResult,
  PurgeViolation,
  TrackedTask,
  TaskPurgeResult,
  PurgeReason,
  PurgeCallback,
  ViolationCallback,
} from './files/index.js';
