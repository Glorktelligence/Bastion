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
  AnthropicTextBlock,
  AnthropicToolUseBlock,
  AnthropicContentBlock,
  AdapterResult,
  AdapterResponse,
  ValidatedToolCall,
  RejectedToolCall,
  FetchFn,
} from './anthropic-adapter.js';

// Conversation Manager
export { ConversationManager } from './conversation-manager.js';
export type { ConversationMessage, ConversationManagerConfig } from './conversation-manager.js';

// Memory Store
export { MemoryStore } from './memory-store.js';
export type { Memory, MemoryStoreConfig } from './memory-store.js';

// Project Store
export { ProjectStore, validatePath } from './project-store.js';

// Tool Registry Manager
export { ToolRegistryManager } from './tool-registry-manager.js';
export type { RegisteredTool, ToolProvider, SessionTrust } from './tool-registry-manager.js';
export type { ProjectFile, ProjectConfig, ProjectStoreConfig, ProjectSaveResult } from './project-store.js';
