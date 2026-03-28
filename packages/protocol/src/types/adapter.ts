// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Provider adapter interface — the formal contract for AI provider adapters.
 *
 * Any adapter (Anthropic, OpenAI, local model, community) must implement
 * this interface to work with the Bastion AI client.
 */

import type { CostMetadata, TaskPayload } from './messages.js';

// ---------------------------------------------------------------------------
// Adapter options (per-call overrides)
// ---------------------------------------------------------------------------

/** Options to override adapter defaults for a single call. */
export interface AdapterOptions {
  /** Override model for this call. */
  readonly model?: string;
  /** Override max tokens for this call. */
  readonly maxTokens?: number;
  /** Override temperature for this call. */
  readonly temperature?: number;
  /** Future: enable streaming for this call. */
  readonly streaming?: boolean;
}

// ---------------------------------------------------------------------------
// Adapter capabilities and pricing
// ---------------------------------------------------------------------------

/** What an adapter can do. */
export interface AdapterCapabilities {
  readonly conversation: boolean;
  readonly taskExecution: boolean;
  readonly fileTransfer: boolean;
  readonly streaming: boolean;
  readonly webSearch: boolean;
  readonly toolUse: boolean;
  readonly vision: boolean;
  readonly maxContextTokens: number;
}

/** Pricing for a specific model. */
export interface ModelPricing {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  readonly searchPerRequest?: number;
}

// ---------------------------------------------------------------------------
// Adapter result types
// ---------------------------------------------------------------------------

// CostMetadata is imported from messages.ts (already in protocol)

/** Successful adapter response. */
export interface AdapterResponse {
  readonly textContent: string;
  readonly stopReason: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly serverToolUse?: { webSearchRequests?: number };
  };
  readonly cost: CostMetadata;
  readonly model: string;
  /** Tool calls validated against the registry (provider-specific). */
  readonly toolCalls?: readonly unknown[];
  /** Tool calls rejected by the registry. */
  readonly rejectedToolCalls?: readonly unknown[];
}

/** Adapter result — success or failure. */
export type AdapterResult =
  | { readonly ok: true; readonly response: AdapterResponse }
  | {
      readonly ok: false;
      readonly errorCode: string;
      readonly message: string;
      readonly retryable: boolean;
    };

// ---------------------------------------------------------------------------
// Provider adapter interface
// ---------------------------------------------------------------------------

/**
 * The formal contract for AI provider adapters.
 *
 * Implementations: AnthropicAdapter (built-in), future OpenAI, local models.
 */
export interface ProviderAdapter {
  /** Unique provider identifier (e.g., 'anthropic-bastion'). */
  readonly providerId: string;
  /** Human-readable provider name. */
  readonly providerName: string;
  /** List of models this adapter supports. */
  readonly supportedModels: readonly string[];
  /** Currently active model. */
  readonly activeModel: string;

  /** Execute a task. Options can override model, tokens, temperature per-call. */
  executeTask(task: TaskPayload, options?: AdapterOptions): Promise<AdapterResult>;
  /** Test API connectivity. */
  testConnection(): Promise<boolean>;

  /** What this adapter supports. */
  readonly capabilities: AdapterCapabilities;
  /** Get pricing for a model (defaults to active model). */
  getModelPricing(model?: string): ModelPricing;
}
