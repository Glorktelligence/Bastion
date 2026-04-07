// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Provider adapter module — Anthropic API integration with tool registry
 * and API key management.
 */

// Tool Registry
export { createToolRegistry } from './tool-registry.js';
export type {
  ToolRegistry,
  ToolDefinition,
  ToolCategory,
  ToolValidationResult,
  AnthropicToolDef,
} from './tool-registry.js';

// API Key Manager
export { createApiKeyManager } from './api-key-manager.js';
export type {
  ApiKeyManager,
  KeyRotationResult,
} from './api-key-manager.js';

// Anthropic Adapter
export { createAnthropicAdapter } from './anthropic-adapter.js';
export type {
  AnthropicAdapter,
  AnthropicAdapterConfig,
  AnthropicAdapterOptions,
  StreamChunkCallback,
  AnthropicTextBlock,
  AnthropicToolUseBlock,
  AnthropicContentBlock,
  ValidatedToolCall,
  RejectedToolCall,
  FetchFn,
} from './anthropic-adapter.js';

// Conversation Manager
export { ConversationManager } from './conversation-manager.js';
export type {
  ConversationMessage,
  ConversationManagerConfig,
  PromptZone,
  PromptBudgetReport,
} from './conversation-manager.js';

// Conversation Store (multi-conversation persistence)
export { ConversationStore } from './conversation-store.js';
export type {
  ConversationRecord,
  MessageRecord,
  ChainVerification,
  CompactionSummary,
  ConversationStoreConfig,
} from './conversation-store.js';

// Adapter Registry
export { AdapterRegistry } from './adapter-registry.js';
export type { AdapterRole, OperationType, RegisteredAdapter, AdapterSelection } from './adapter-registry.js';

// Compaction Manager
export { CompactionManager } from './compaction-manager.js';
export type { CompactionCheck, CompactionResult, CompactionManagerConfig, SummariseFn } from './compaction-manager.js';

// Memory Store
export { MemoryStore } from './memory-store.js';
export type { Memory, MemoryStoreConfig } from './memory-store.js';

// Project Store
export { ProjectStore, validatePath, scanContent } from './project-store.js';

// Tool Registry Manager
export { ToolRegistryManager } from './tool-registry-manager.js';
export type { RegisteredTool, ToolProvider, SessionTrust, RegistryViolation } from './tool-registry-manager.js';

// Challenge Manager
export { ChallengeManager } from './challenge-manager.js';
export type { ChallengeConfig, ChallengeSchedule, ChallengeCooldowns, ChallengeResult } from './challenge-manager.js';

// Tool Upstream Monitor
export { ToolUpstreamMonitor } from './tool-upstream-monitor.js';
export type { UpstreamToolChange, UpstreamCheckResult } from './tool-upstream-monitor.js';

// MCP Client Adapter
export { McpClientAdapter, validateParameters } from './mcp-client-adapter.js';
export type { McpTool, McpCallResult, McpClientConfig } from './mcp-client-adapter.js';
export type { ProjectFile, ProjectConfig, ProjectStoreConfig, ProjectSaveResult } from './project-store.js';

// Skill Store
export { SkillStore } from './skill-store.js';
export type { SkillManifest, LoadedSkill, SkillStoreConfig, SkillMode } from './skill-store.js';

// Skills Manager
export { SkillsManager } from './skills-manager.js';
export type {
  SkillScanResult,
  SkillScanCheck,
  PendingSkill,
  SkillsManagerConfig,
} from './skills-manager.js';

// Budget Guard
export { BudgetGuard } from './budget-guard.js';
export type {
  BudgetLimits,
  BudgetGuardConfig,
  BudgetCheckResult,
  BudgetStatus,
  BudgetGuardOptions,
} from './budget-guard.js';

// Data Portability (GDPR Article 20)
export { DataExporter } from './data-exporter.js';
export type { ExportManifest, ExportProgress, DataExporterConfig } from './data-exporter.js';
export { ImportRegistry, BastionImportAdapter, ImportExecutor } from './data-importer.js';
export type {
  ImportAdapter,
  ImportValidation,
  ImportConflict,
  ImportData,
  ImportSelections,
  ImportResult,
  ImportStoreRefs,
} from './data-importer.js';

// Data Erasure (GDPR Article 17)
export { DataEraser } from './data-eraser.js';
export type { DataEraserConfig, ErasurePreview, ErasureResult } from './data-eraser.js';

// Usage Tracker
export { UsageTracker } from './usage-tracker.js';
export type {
  UsageRecord,
  UsageSummary,
  DailyUsage,
  AdapterUsageSummary,
  UsageTrackerConfig,
} from './usage-tracker.js';

// Extension Dispatcher
export { ExtensionDispatcher } from './extension-dispatcher.js';
export type { ExtensionContext, ExtensionHandler } from './extension-dispatcher.js';

// Extension Handler Loader
export { loadExtensionHandlers } from './extension-handler-loader.js';
export type { ExtensionHandlerContext } from './extension-handler-loader.js';

// DateTime Manager (sole DateTime authority)
export { DateTimeManager } from './datetime-manager.js';
export type { DateTimeInfo, DateTimeManagerConfig } from './datetime-manager.js';

// Recall Handler (conversation history search)
export { RecallHandler } from './recall-handler.js';
export type { RecallRequest, RecallMatch, RecallResult } from './recall-handler.js';

// Dream Cycle Manager (Layer 6)
export { DreamCycleManager } from './dream-cycle-manager.js';
export type { DreamCycleConfig, DreamCycleResult, MemoryCandidate } from './dream-cycle-manager.js';

// Bastion Bash (Governed Execution)
export { BastionBash } from './bastion-bash.js';
export type { BastionBashConfig, CommandResult, AuditLogger as BashAuditLogger } from './bastion-bash.js';
