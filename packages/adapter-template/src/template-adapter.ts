// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Template Adapter — reference implementation for community AI provider adapters.
 *
 * INSTRUCTIONS FOR COMMUNITY DEVELOPERS:
 *
 * 1. Copy this file as your starting point
 * 2. Replace the placeholder API calls with your provider's actual API
 * 3. Map your provider's errors to BASTION-XXXX error codes
 * 4. Set accurate pricing in getModelPricing()
 * 5. Format tools in your provider's required format (if supported)
 * 6. Test with testConnection() before deploying
 *
 * The ProviderAdapter interface is the contract. As long as your adapter
 * returns the correct types, it works with the Bastion ecosystem.
 *
 * KEY PRINCIPLE — THE ADAPTER IS A TRANSLATOR, NOT A PROMPT BUILDER:
 *
 * Before your adapter is called, the ConversationManager has already:
 *   - Assembled the system prompt (role context + memories + user context + project files)
 *   - Built the conversation history (trimmed to token budget)
 *   - Evaluated the task through the three-layer safety engine
 *
 * These are injected into task.parameters as two "magic" underscore-prefixed fields:
 *   - task.parameters._systemPrompt        → string (the full assembled system prompt)
 *   - task.parameters._conversationHistory  → Array<{ role, content }> (message history)
 *
 * Your adapter's job: receive these → format for your provider's API → send → parse response.
 * Your adapter does NOT build system prompts, manage memories, or handle conversation state.
 */

import type {
  AdapterCapabilities,
  AdapterOptions,
  AdapterResponse,
  AdapterResult,
  CostMetadata,
  ModelPricing,
  ProviderAdapter,
  TaskPayload,
} from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for your adapter.
 *
 * Community developers: add any provider-specific config fields here.
 * The core fields (providerId, model, pricing) are required by Bastion.
 * Additional fields are your provider's specific settings.
 */
export interface TemplateAdapterConfig {
  /** Unique identifier for this adapter instance. */
  readonly providerId: string;
  /** Human-readable name shown in the UI. */
  readonly providerName: string;
  /** Model ID to use (e.g., 'gpt-4o', 'llama-3-70b', 'my-model-v1'). */
  readonly model: string;
  /** List of all models this adapter supports. */
  readonly supportedModels?: readonly string[];
  /** Maximum output tokens per request. */
  readonly maxTokens: number;
  /** Temperature (0.0 - 2.0 typically). Default: 1.0. */
  readonly temperature?: number;
  /** API base URL for your provider. */
  readonly apiBaseUrl: string;
  /** API key — read from environment variable, NEVER hardcoded. */
  readonly apiKey: string;
  /** Request timeout in milliseconds. Default: 120000 (2 minutes). */
  readonly timeoutMs?: number;
  /** Fallback system prompt if none provided in the task. */
  readonly systemPrompt?: string;
  /** Pricing per million input tokens. */
  readonly pricingInputPerMTok: number;
  /** Pricing per million output tokens. */
  readonly pricingOutputPerMTok: number;
  /** What this adapter can do. */
  readonly capabilities?: Partial<AdapterCapabilities>;
}

// ---------------------------------------------------------------------------
// Types for your provider's API
// ---------------------------------------------------------------------------

/**
 * REPLACE THESE with your provider's actual API types.
 * These are placeholders showing the pattern.
 */

/** Your provider's API request body. */
interface ProviderApiRequest {
  readonly model: string;
  readonly messages: readonly { role: string; content: string }[];
  readonly max_tokens: number;
  readonly temperature: number;
  readonly system?: string;
  readonly tools?: readonly unknown[];
}

/** Your provider's API response. */
interface ProviderApiResponse {
  readonly id: string;
  readonly choices: readonly {
    readonly message: {
      readonly role: string;
      readonly content: string;
    };
    readonly finish_reason: string;
  }[];
  readonly usage: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
  };
  readonly model: string;
}

// ---------------------------------------------------------------------------
// Helper: format task as user message
// ---------------------------------------------------------------------------

/**
 * Convert a Bastion TaskPayload into a user message string.
 * Used when no conversation history is provided.
 */
function formatTaskMessage(task: TaskPayload): string {
  const lines = [`Task: ${task.action}`, `Target: ${task.target}`, `Priority: ${task.priority}`];
  if (Object.keys(task.parameters).length > 0) {
    lines.push(`Parameters: ${JSON.stringify(task.parameters)}`);
  }
  if (task.constraints.length > 0) {
    lines.push(`Constraints: ${task.constraints.join(', ')}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helper: map HTTP errors to Bastion error codes
// ---------------------------------------------------------------------------

/**
 * Map your provider's HTTP error responses to Bastion error codes.
 *
 * BASTION error code categories:
 *   BASTION-6001: PROVIDER_UNAVAILABLE — server down or unreachable
 *   BASTION-6002: PROVIDER_AUTH_FAILED — invalid API key
 *   BASTION-6003: PROVIDER_RATE_LIMITED — too many requests
 *   BASTION-6004: PROVIDER_QUOTA_EXCEEDED — billing limit reached
 *   BASTION-6005: PROVIDER_TIMEOUT — request timed out
 *   BASTION-6006: PROVIDER_ERROR — generic provider error
 */
function mapHttpError(status: number, body: string): AdapterResult {
  if (status === 401 || status === 403) {
    return { ok: false, errorCode: 'BASTION-6002', message: 'API key rejected by provider', retryable: false };
  }
  if (status === 429) {
    return { ok: false, errorCode: 'BASTION-6003', message: 'Rate limited by provider', retryable: true };
  }
  if (status === 402) {
    return { ok: false, errorCode: 'BASTION-6004', message: 'Quota exceeded', retryable: false };
  }
  if (status >= 500) {
    return { ok: false, errorCode: 'BASTION-6001', message: `Server error (${status})`, retryable: true };
  }
  return { ok: false, errorCode: 'BASTION-6006', message: `HTTP ${status}: ${body.slice(0, 200)}`, retryable: false };
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a template adapter instance.
 *
 * COMMUNITY DEVELOPERS: This is your entry point.
 * Replace the placeholder API calls with your provider's actual API.
 *
 * @param config - Your adapter configuration
 * @param fetchFn - Injectable fetch (defaults to global fetch)
 */
export function createTemplateAdapter(config: TemplateAdapterConfig, fetchFn?: typeof fetch): ProviderAdapter {
  const timeoutMs = config.timeoutMs ?? 120_000;
  const temperature = config.temperature ?? 1.0;
  const systemPrompt = config.systemPrompt ?? 'You are a helpful AI assistant.';
  const inputRate = config.pricingInputPerMTok / 1_000_000;
  const outputRate = config.pricingOutputPerMTok / 1_000_000;
  const doFetch = fetchFn ?? globalThis.fetch;

  // -----------------------------------------------------------------------
  // Internal: Make an API call to your provider
  // -----------------------------------------------------------------------

  async function callApi(body: ProviderApiRequest): Promise<AdapterResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      /**
       * REPLACE THIS with your provider's actual API call.
       *
       * Common patterns:
       * - OpenAI-compatible: POST /v1/chat/completions
       * - Anthropic: POST /v1/messages
       * - Local model: POST /api/generate
       * - Custom: whatever your provider requires
       */
      const response = await doFetch(`${config.apiBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          // Add any provider-specific headers here
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        return mapHttpError(response.status, await response.text());
      }

      const data = (await response.json()) as ProviderApiResponse;
      return processResponse(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, errorCode: 'BASTION-6005', message: `Timed out after ${timeoutMs}ms`, retryable: true };
      }
      return {
        ok: false,
        errorCode: 'BASTION-6001',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // -----------------------------------------------------------------------
  // Internal: Process API response into AdapterResult
  // -----------------------------------------------------------------------

  function processResponse(data: ProviderApiResponse): AdapterResult {
    /**
     * REPLACE THIS with your provider's response parsing.
     *
     * You need to extract:
     * - textContent: the assistant's text response
     * - usage: input and output token counts
     * - cost: calculated from usage and your pricing
     * - stopReason: why the response ended
     * - model: which model actually responded
     */
    const choice = data.choices[0];
    if (!choice) {
      return { ok: false, errorCode: 'BASTION-6006', message: 'Empty response from provider', retryable: false };
    }

    const inputTokens = data.usage.prompt_tokens;
    const outputTokens = data.usage.completion_tokens;

    const cost: CostMetadata = {
      inputTokens,
      outputTokens,
      estimatedCostUsd: inputTokens * inputRate + outputTokens * outputRate,
    };

    const response: AdapterResponse = {
      textContent: choice.message.content,
      stopReason: choice.finish_reason,
      usage: { inputTokens, outputTokens },
      cost,
      model: data.model,
    };

    return { ok: true, response };
  }

  // -----------------------------------------------------------------------
  // Return the ProviderAdapter interface
  // -----------------------------------------------------------------------

  return {
    providerId: config.providerId,
    providerName: config.providerName,
    supportedModels: config.supportedModels ?? [config.model],
    activeModel: config.model,

    capabilities: {
      conversation: config.capabilities?.conversation ?? true,
      taskExecution: config.capabilities?.taskExecution ?? true,
      fileTransfer: config.capabilities?.fileTransfer ?? false,
      streaming: config.capabilities?.streaming ?? false,
      webSearch: config.capabilities?.webSearch ?? false,
      toolUse: config.capabilities?.toolUse ?? false,
      vision: config.capabilities?.vision ?? false,
      maxContextTokens: config.capabilities?.maxContextTokens ?? 128_000,
    },

    getModelPricing(_model?: string): ModelPricing {
      /**
       * Return pricing for your models.
       *
       * For multi-model adapters, use the model parameter to look up
       * pricing per model. For single-model adapters, just return
       * the configured pricing.
       */
      return {
        inputPerMTok: config.pricingInputPerMTok,
        outputPerMTok: config.pricingOutputPerMTok,
      };
    },

    async executeTask(task: TaskPayload, options?: AdapterOptions): Promise<AdapterResult> {
      /**
       * Main entry point. The ConversationManager has already assembled
       * the system prompt and conversation history before calling this.
       * Your job: format them for your provider's API, send, parse response.
       */

      // Step 1: Per-call option overrides (from AdapterRegistry/caller, not task.parameters)
      const callModel = options?.model ?? config.model;
      const callMaxTokens = options?.maxTokens ?? config.maxTokens;
      const callTemperature = options?.temperature ?? temperature;

      // Step 2: Extract the pre-assembled system prompt.
      // The ConversationManager builds this from: role context + memories +
      // user context + project files. Your adapter receives the final string.
      // Fallback to config.systemPrompt only if ConversationManager didn't provide one.
      const effectiveSystemPrompt =
        typeof task.parameters._systemPrompt === 'string' ? task.parameters._systemPrompt : systemPrompt;

      // Step 3: Extract conversation history.
      // The ConversationManager provides an array of {role, content} messages,
      // already trimmed to token budget. If absent (e.g. raw task execution
      // without conversation context), fall back to formatting the task itself.
      const history = Array.isArray(task.parameters._conversationHistory)
        ? (task.parameters._conversationHistory as Array<{ role: string; content: string }>)
        : null;

      const messages = history
        ? history.map((m) => ({ role: m.role, content: m.content }))
        : [{ role: 'user', content: formatTaskMessage(task) }];

      // Step 4: Build the API request for your provider.
      // Different providers handle system prompts differently:
      //   - Anthropic: separate `system` field (as shown here)
      //   - OpenAI: first message with role: 'system'
      //   - Others: check your provider's documentation
      const requestBody: ProviderApiRequest = {
        model: callModel,
        messages,
        max_tokens: callMaxTokens,
        temperature: callTemperature,
        system: effectiveSystemPrompt,
        // Step 5: Add tools if your provider supports them
        // tools: formatToolsForMyProvider(task.parameters._tools),
      };

      // Step 6: Make the API call and return the result
      return callApi(requestBody);
    },

    async testConnection(): Promise<boolean> {
      /**
       * Send a minimal request to verify the API key works.
       * Use the cheapest possible call (1 token output).
       */
      try {
        const result = await callApi({
          model: config.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          temperature: 0,
        });
        return result.ok;
      } catch {
        return false;
      }
    },
  };
}
