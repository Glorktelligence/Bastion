// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Tool Registry — strict allowlist of capabilities the AI client may invoke.
 *
 * Only tools explicitly registered here can be used. The AI itself cannot
 * modify its own registry (hardcoded constraint per spec §4.5).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Categories of tools with different default challenge levels. */
export type ToolCategory =
  | 'read_only'
  | 'config_reading'
  | 'non_destructive_write'
  | 'service_management'
  | 'destructive'
  | 'network'
  | 'system_admin';

/** A registered tool definition (spec §4.2). */
export interface ToolDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** JSON Schema describing the tool's input parameters. */
  readonly inputSchema: Record<string, unknown>;
  readonly permittedHosts?: readonly string[];
  readonly blockedCommands?: readonly string[];
  readonly requiresChallenge: boolean;
  readonly maxExecutionTimeSeconds: number;
  readonly safetyNotes: string;
  readonly category: ToolCategory;
}

/** Result of validating a tool invocation. */
export type ToolValidationResult =
  | { readonly allowed: true; readonly tool: ToolDefinition }
  | { readonly allowed: false; readonly reason: string };

/** Anthropic-compatible tool definition for the Messages API. */
export interface AnthropicToolDef {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

/** The tool registry interface. */
export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  unregister(toolId: string): boolean;
  get(toolId: string): ToolDefinition | undefined;
  has(toolId: string): boolean;
  getAll(): readonly ToolDefinition[];
  /** Validate whether a tool invocation is permitted. */
  validateInvocation(toolId: string, input?: Record<string, unknown>): ToolValidationResult;
  /** Convert registered tools to Anthropic Messages API format. */
  toAnthropicTools(): readonly AnthropicToolDef[];
  readonly size: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a new tool registry.
 *
 * @param initialTools - Optional tools to pre-register
 */
export function createToolRegistry(initialTools?: readonly ToolDefinition[]): ToolRegistry {
  const tools = new Map<string, ToolDefinition>();

  if (initialTools) {
    for (const tool of initialTools) {
      tools.set(tool.id, tool);
    }
  }

  return {
    register(tool: ToolDefinition): void {
      tools.set(tool.id, tool);
    },

    unregister(toolId: string): boolean {
      return tools.delete(toolId);
    },

    get(toolId: string): ToolDefinition | undefined {
      return tools.get(toolId);
    },

    has(toolId: string): boolean {
      return tools.has(toolId);
    },

    getAll(): readonly ToolDefinition[] {
      return [...tools.values()];
    },

    validateInvocation(toolId: string, input?: Record<string, unknown>): ToolValidationResult {
      const tool = tools.get(toolId);
      if (!tool) {
        return { allowed: false, reason: `Tool "${toolId}" is not registered` };
      }

      if (input) {
        // Check permitted hosts
        const host = typeof input.host === 'string' ? input.host : undefined;
        if (host !== undefined && tool.permittedHosts !== undefined && tool.permittedHosts.length > 0) {
          if (!tool.permittedHosts.includes(host)) {
            return {
              allowed: false,
              reason: `Host "${host}" is not permitted for tool "${toolId}"`,
            };
          }
        }

        // Check blocked commands
        const command = typeof input.command === 'string' ? input.command : undefined;
        if (command !== undefined && tool.blockedCommands !== undefined && tool.blockedCommands.length > 0) {
          const cmd = command.toLowerCase();
          for (const blocked of tool.blockedCommands) {
            if (cmd.startsWith(blocked.toLowerCase())) {
              return {
                allowed: false,
                reason: `Command blocked for tool "${toolId}": matches "${blocked}"`,
              };
            }
          }
        }
      }

      return { allowed: true, tool };
    },

    toAnthropicTools(): readonly AnthropicToolDef[] {
      return [...tools.values()].map((t) => ({
        name: t.id,
        description: `${t.name}: ${t.description}`,
        input_schema: t.inputSchema,
      }));
    },

    get size(): number {
      return tools.size;
    },
  };
}
