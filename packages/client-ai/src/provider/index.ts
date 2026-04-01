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
export type { ConversationMessage, ConversationManagerConfig } from './conversation-manager.js';

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
export type { RegisteredTool, ToolProvider, SessionTrust } from './tool-registry-manager.js';

// Challenge Manager
export { ChallengeManager } from './challenge-manager.js';
export type { ChallengeConfig, ChallengeSchedule, ChallengeCooldowns, ChallengeResult } from './challenge-manager.js';

// MCP Client Adapter
export { McpClientAdapter, validateParameters } from './mcp-client-adapter.js';
export type { McpTool, McpCallResult, McpClientConfig } from './mcp-client-adapter.js';
export type { ProjectFile, ProjectConfig, ProjectStoreConfig, ProjectSaveResult } from './project-store.js';

// Skill Store
export { SkillStore } from './skill-store.js';
export type { SkillManifest, LoadedSkill, SkillStoreConfig, SkillMode } from './skill-store.js';

// Budget Guard
export { BudgetGuard } from './budget-guard.js';
export type {
  BudgetLimits,
  BudgetGuardConfig,
  BudgetCheckResult,
  BudgetStatus,
  BudgetGuardOptions,
} from './budget-guard.js';
