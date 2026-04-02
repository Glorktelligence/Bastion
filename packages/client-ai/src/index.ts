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
  McpClientAdapter,
  ChallengeManager,
  BudgetGuard,
  SkillStore,
  validateParameters,
  DataExporter,
  ImportRegistry,
  UsageTracker,
  BastionImportAdapter,
  ImportExecutor,
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
  BudgetLimits,
  BudgetGuardConfig,
  BudgetCheckResult,
  BudgetStatus,
  BudgetGuardOptions,
  ExportManifest,
  ExportProgress,
  DataExporterConfig,
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
} from './provider/index.js';

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
  TrackedTask,
  TaskPurgeResult,
  PurgeReason,
  PurgeCallback,
} from './files/index.js';
