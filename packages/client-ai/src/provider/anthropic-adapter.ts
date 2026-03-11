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

import type { CostMetadata, TaskPayload } from '@bastion/protocol';
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

/** Successful adapter response. */
export interface AdapterResponse {
  readonly textContent: string;
  readonly toolCalls: readonly ValidatedToolCall[];
  readonly rejectedToolCalls: readonly RejectedToolCall[];
  readonly stopReason: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly cost: CostMetadata;
  readonly model: string;
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

/** Configuration for the Anthropic adapter. */
export interface AnthropicAdapterConfig {
  readonly model: string;
  readonly maxTokens: number;
  readonly apiBaseUrl?: string;
  readonly apiVersion?: string;
  readonly requestTimeoutMs?: number;
  readonly systemPrompt?: string;
  /** USD per input token. Defaults to Claude 3.5 Sonnet pricing ($3/MTok). */
  readonly pricingPerInputToken?: number;
  /** USD per output token. Defaults to Claude 3.5 Sonnet pricing ($15/MTok). */
  readonly pricingPerOutputToken?: number;
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

/** The Anthropic adapter interface. */
export interface AnthropicAdapter {
  /** Execute a task via the Anthropic Messages API. */
  executeTask(task: TaskPayload): Promise<AdapterResult>;
  /**
   * Test API connectivity with the given key (or the current key).
   * Used during key rotation to validate a new key before installing it.
   */
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

// Default pricing: Claude 3.5 Sonnet ($3/MTok input, $15/MTok output)
const DEFAULT_INPUT_RATE = 3 / 1_000_000;
const DEFAULT_OUTPUT_RATE = 15 / 1_000_000;

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
  const inputRate = config.pricingPerInputToken ?? DEFAULT_INPUT_RATE;
  const outputRate = config.pricingPerOutputToken ?? DEFAULT_OUTPUT_RATE;

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

  return {
    async executeTask(task: TaskPayload): Promise<AdapterResult> {
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
      const requestBody: Record<string, unknown> = {
        model: config.model,
        max_tokens: config.maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: formatTaskMessage(task) }],
      };

      if (tools.length > 0) {
        requestBody.tools = tools;
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
