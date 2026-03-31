// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Anthropic Provider Adapter — maps Bastion task messages to Anthropic
 * Messages API calls and maps responses back to Bastion protocol types.
 *
 * Uses injectable fetch for testability. Enforces tool registry constraints
 * on all tool_use responses from the API.
 */

import type { AdapterOptions, AdapterResult, ModelPricing, ProviderAdapter, TaskPayload } from '@bastion/protocol';
import { ERROR_CODES } from '@bastion/protocol';
import type { ApiKeyManager } from './api-key-manager.js';
import type { ToolDefinition, ToolRegistry } from './tool-registry.js';

// ---------------------------------------------------------------------------
// Anthropic API types (minimal, no SDK dependency)
// ---------------------------------------------------------------------------

/** Anthropic Messages API text content block. */
export interface AnthropicTextBlock {
  readonly type: 'text';
  readonly text: string;
}

/** Anthropic Messages API tool_use content block. */
export interface AnthropicToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** Content block returned by the Anthropic API. */
export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

/** Anthropic Messages API response shape. */
interface AnthropicApiResponse {
  readonly id: string;
  readonly type: 'message';
  readonly role: 'assistant';
  readonly content: readonly AnthropicContentBlock[];
  readonly model: string;
  readonly stop_reason: string;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Adapter types
// ---------------------------------------------------------------------------

/** A tool call that passed registry validation. */
export interface ValidatedToolCall {
  readonly id: string;
  readonly toolId: string;
  readonly input: Record<string, unknown>;
  readonly tool: ToolDefinition;
}

/** A tool call that was rejected by the registry. */
export interface RejectedToolCall {
  readonly id: string;
  readonly toolId: string;
  readonly input: Record<string, unknown>;
  readonly reason: string;
}

// AdapterResponse and AdapterResult are imported from @bastion/protocol.
// Extended response with tool call details (Anthropic-specific).
export type { AdapterResponse, AdapterResult } from '@bastion/protocol';

/** Configuration for the Anthropic adapter. */
export interface AnthropicAdapterConfig {
  readonly providerId?: string;
  readonly providerName?: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly temperature?: number;
  readonly apiBaseUrl?: string;
  readonly apiVersion?: string;
  readonly requestTimeoutMs?: number;
  readonly systemPrompt?: string;
  /** USD per million input tokens. */
  readonly pricingInputPerMTok?: number;
  /** USD per million output tokens. */
  readonly pricingOutputPerMTok?: number;
  /** Backward compat aliases. */
  readonly pricingPerInputToken?: number;
  readonly pricingPerOutputToken?: number;
  /** Supported model IDs. */
  readonly supportedModels?: readonly string[];
  /** Max context window tokens. */
  readonly maxContextTokens?: number;
}

/** Injectable fetch function type for testability. */
export type FetchFn = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

/** Callback for streaming text chunks. */
export type StreamChunkCallback = (chunk: string, index: number) => void;

/** Extended adapter options for Anthropic (adds onChunk for streaming). */
export interface AnthropicAdapterOptions extends AdapterOptions {
  /** Callback for each streaming text chunk. If provided and streaming=true, chunks are emitted. */
  readonly onChunk?: StreamChunkCallback;
}

/** The Anthropic adapter interface — extends ProviderAdapter. */
export interface AnthropicAdapter extends ProviderAdapter {
  /** Execute a task with optional per-call overrides. */
  executeTask(task: TaskPayload, options?: AnthropicAdapterOptions): Promise<AdapterResult>;
  /** Test API connectivity. */
  testConnection(apiKey?: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_API_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_API_VERSION = '2023-06-01';
const DEFAULT_TIMEOUT_MS = 120_000;

const DEFAULT_SYSTEM_PROMPT =
  'You are a Bastion AI assistant operating within a secure, sandboxed environment. ' +
  'Execute tasks precisely as specified. Only use tools that are provided to you. ' +
  'Report results clearly and include any relevant details about actions taken.';

// Default pricing: Claude Sonnet ($3/MTok input, $15/MTok output)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a TaskPayload as a structured user message for Claude. */
function formatTaskMessage(task: TaskPayload): string {
  const lines = [
    `Task ID: ${task.taskId}`,
    `Action: ${task.action}`,
    `Target: ${task.target}`,
    `Priority: ${task.priority}`,
  ];

  const paramEntries = Object.entries(task.parameters);
  if (paramEntries.length > 0) {
    lines.push(`Parameters: ${JSON.stringify(task.parameters)}`);
  }

  if (task.constraints.length > 0) {
    lines.push('Constraints:');
    for (const c of task.constraints) {
      lines.push(`  - ${c}`);
    }
  }

  return lines.join('\n');
}

/** Map an HTTP error status to an AdapterResult. */
function mapHttpError(status: number, body: string): AdapterResult {
  if (status === 401) {
    return {
      ok: false,
      errorCode: ERROR_CODES.PROVIDER_AUTH_FAILED,
      message: 'API key rejected by provider',
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      errorCode: ERROR_CODES.PROVIDER_RATE_LIMITED,
      message: 'Rate limited by provider',
      retryable: true,
    };
  }
  if (status === 529) {
    return {
      ok: false,
      errorCode: ERROR_CODES.PROVIDER_UNAVAILABLE,
      message: 'Anthropic API overloaded',
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      errorCode: ERROR_CODES.PROVIDER_ERROR,
      message: `Server error (${status})`,
      retryable: true,
    };
  }
  return {
    ok: false,
    errorCode: ERROR_CODES.PROVIDER_ERROR,
    message: `HTTP ${status}: ${body.slice(0, 200)}`,
    retryable: false,
  };
}

/** Process a successful API response, validating tool calls against the registry. */
function processResponse(
  data: AnthropicApiResponse,
  registry: ToolRegistry,
  inputRate: number,
  outputRate: number,
): AdapterResult {
  // Separate text and tool_use blocks
  const textParts: string[] = [];
  const validatedToolCalls: ValidatedToolCall[] = [];
  const rejectedToolCalls: RejectedToolCall[] = [];

  for (const block of data.content) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      const validation = registry.validateInvocation(block.name, block.input);
      if (validation.allowed) {
        validatedToolCalls.push({
          id: block.id,
          toolId: block.name,
          input: block.input,
          tool: validation.tool,
        });
      } else {
        rejectedToolCalls.push({
          id: block.id,
          toolId: block.name,
          input: block.input,
          reason: validation.reason,
        });
      }
    }
  }

  const { input_tokens, output_tokens } = data.usage;

  return {
    ok: true,
    response: {
      textContent: textParts.join('\n'),
      toolCalls: validatedToolCalls,
      rejectedToolCalls,
      stopReason: data.stop_reason,
      usage: { inputTokens: input_tokens, outputTokens: output_tokens },
      cost: {
        inputTokens: input_tokens,
        outputTokens: output_tokens,
        estimatedCostUsd: input_tokens * inputRate + output_tokens * outputRate,
      },
      model: data.model,
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an Anthropic provider adapter.
 *
 * @param keyManager - API key manager (provides the current key)
 * @param toolRegistry - Tool registry (enforces tool allowlist)
 * @param config - Adapter configuration (model, pricing, etc.)
 * @param fetchFn - Injectable fetch function (defaults to global fetch)
 */
export function createAnthropicAdapter(
  keyManager: ApiKeyManager,
  toolRegistry: ToolRegistry,
  config: AnthropicAdapterConfig,
  fetchFn?: FetchFn,
): AnthropicAdapter {
  const baseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const version = config.apiVersion ?? DEFAULT_API_VERSION;
  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const defaultTemperature = config.temperature ?? 1.0;
  const inputRatePerMTok =
    config.pricingInputPerMTok ?? (config.pricingPerInputToken ? config.pricingPerInputToken * 1_000_000 : 3);
  const outputRatePerMTok =
    config.pricingOutputPerMTok ?? (config.pricingPerOutputToken ? config.pricingPerOutputToken * 1_000_000 : 15);
  const inputRate = inputRatePerMTok / 1_000_000;
  const outputRate = outputRatePerMTok / 1_000_000;
  const adapterProviderId = config.providerId ?? 'anthropic';
  const adapterProviderName = config.providerName ?? 'Anthropic';
  const models = config.supportedModels ?? [config.model];
  const maxContext = config.maxContextTokens ?? 200_000;

  // Use injected fetch or global fetch
  const doFetch: FetchFn = fetchFn ?? (globalThis.fetch as unknown as FetchFn);

  async function callApi(body: Record<string, unknown>, apiKey: string): Promise<AdapterResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await doFetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': version,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        return mapHttpError(response.status, await response.text());
      }

      const data = (await response.json()) as AnthropicApiResponse;
      return processResponse(data, toolRegistry, inputRate, outputRate);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          ok: false,
          errorCode: ERROR_CODES.PROVIDER_TIMEOUT,
          message: `Request timed out after ${timeoutMs}ms`,
          retryable: true,
        };
      }
      return {
        ok: false,
        errorCode: ERROR_CODES.PROVIDER_UNAVAILABLE,
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Make a streaming API call. Parses Anthropic SSE events and emits text deltas.
   * Returns the final complete AdapterResult.
   */
  async function callApiStreaming(
    body: Record<string, unknown>,
    apiKey: string,
    onChunk: StreamChunkCallback,
  ): Promise<AdapterResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await (globalThis.fetch as (...args: unknown[]) => Promise<Response>)(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': version,
        },
        body: JSON.stringify({ ...body, stream: true }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        return mapHttpError(response.status, errText);
      }

      // Parse SSE stream
      let textContent = '';
      let chunkIndex = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let stopReason = 'end_turn';
      let model = String(body.model ?? config.model);

      const reader = response.body?.getReader();
      if (!reader) {
        return callApi(body, apiKey); // Fallback to non-streaming
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data) as Record<string, unknown>;
            const eventType = String(event.type ?? '');

            if (eventType === 'message_start') {
              const msg = event.message as Record<string, unknown>;
              model = String(msg?.model ?? model);
              const usage = msg?.usage as Record<string, number> | undefined;
              if (usage) inputTokens = usage.input_tokens ?? 0;
            } else if (eventType === 'content_block_delta') {
              const delta = event.delta as Record<string, unknown>;
              if (delta?.type === 'text_delta') {
                const text = String(delta.text ?? '');
                textContent += text;
                onChunk(text, chunkIndex++);
              }
            } else if (eventType === 'message_delta') {
              const delta = event.delta as Record<string, unknown>;
              stopReason = String(delta?.stop_reason ?? stopReason);
              const usage = event.usage as Record<string, number> | undefined;
              if (usage) outputTokens = usage.output_tokens ?? 0;
            }
          } catch {
            // Skip malformed SSE events
          }
        }
      }

      const cost = {
        inputTokens,
        outputTokens,
        estimatedCostUsd: inputTokens * inputRate + outputTokens * outputRate,
      };

      return {
        ok: true,
        response: {
          textContent,
          stopReason,
          usage: { inputTokens, outputTokens },
          cost,
          model,
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          ok: false,
          errorCode: ERROR_CODES.PROVIDER_TIMEOUT,
          message: `Request timed out after ${timeoutMs}ms`,
          retryable: true,
        };
      }
      return {
        ok: false,
        errorCode: ERROR_CODES.PROVIDER_UNAVAILABLE,
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    providerId: adapterProviderId,
    providerName: adapterProviderName,
    supportedModels: models,
    activeModel: config.model,

    capabilities: {
      conversation: true,
      taskExecution: true,
      fileTransfer: true,
      streaming: true,
      webSearch: true,
      toolUse: true,
      vision: true,
      maxContextTokens: maxContext,
    },

    getModelPricing(_model?: string): ModelPricing {
      // Future: per-model pricing lookup. Currently returns configured pricing.
      return { inputPerMTok: inputRatePerMTok, outputPerMTok: outputRatePerMTok };
    },

    async executeTask(task: TaskPayload, options?: AnthropicAdapterOptions): Promise<AdapterResult> {
      const apiKey = keyManager.getKey();
      if (!apiKey) {
        return {
          ok: false,
          errorCode: ERROR_CODES.PROVIDER_AUTH_FAILED,
          message: 'No API key configured',
          retryable: false,
        };
      }

      const tools = toolRegistry.toAnthropicTools();
      const callModel = options?.model ?? config.model;
      const callMaxTokens = options?.maxTokens ?? config.maxTokens;
      const callTemperature = options?.temperature ?? defaultTemperature;

      // Use dynamic system prompt from conversation manager if provided
      const effectiveSystemPrompt =
        typeof task.parameters._systemPrompt === 'string' ? task.parameters._systemPrompt : systemPrompt;

      // Use conversation history if provided, otherwise single-message from task
      const history = Array.isArray(task.parameters._conversationHistory)
        ? (task.parameters._conversationHistory as Array<{ role: string; content: string }>)
        : null;

      const messages = history
        ? [
            ...history
              .map((m) => ({ role: m.role, content: m.content }))
              .filter((m) => m.content && m.content.trim().length > 0),
          ]
        : [{ role: 'user', content: formatTaskMessage(task) }];

      const requestBody: Record<string, unknown> = {
        model: callModel,
        max_tokens: callMaxTokens,
        temperature: callTemperature,
        system: effectiveSystemPrompt,
        messages,
      };

      if (tools.length > 0) {
        requestBody.tools = tools;
      }

      // Use streaming if requested and onChunk callback provided
      if (options?.streaming && options?.onChunk) {
        return callApiStreaming(requestBody, apiKey, options.onChunk);
      }

      return callApi(requestBody, apiKey);
    },

    async testConnection(apiKey?: string): Promise<boolean> {
      const key = apiKey ?? keyManager.getKey();
      if (!key) return false;

      try {
        const result = await callApi(
          {
            model: config.model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          },
          key,
        );
        return result.ok;
      } catch {
        return false;
      }
    },
  };
}
