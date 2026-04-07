// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * ToolRegistryManager — manages the authorised tool registry for the AI client.
 *
 * Receives tool_registry_sync from relay, stores as source of truth.
 * Provides mode-filtered tool lists and session trust tracking.
 *
 * Trust model (revised from security review):
 * - Trust level 1-10 affects review depth, NOT visibility
 * - Read-only tools with trustLevel >= 4 and scope=session: auto-approve
 * - Write/destructive tools: ALWAYS require per-call approval
 * - Dangerous tools: ALWAYS require per-call approval, stripped from
 *   conversation mode entirely
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisteredTool {
  readonly providerId: string;
  readonly providerName: string;
  readonly name: string;
  readonly fullId: string; // provider:tool_name
  readonly description: string;
  readonly category: 'read' | 'write' | 'destructive';
  readonly readOnly: boolean;
  readonly dangerous: boolean;
  readonly modes: readonly ('conversation' | 'task')[];
}

export interface ToolProvider {
  readonly id: string;
  readonly name: string;
  readonly endpoint: string;
  readonly authType: 'api_key' | 'custom_header' | 'no_auth';
  readonly tools: readonly RegisteredTool[];
}

export interface SessionTrust {
  readonly toolId: string;
  readonly trustLevel: number;
  readonly scope: 'this_call' | 'session';
  readonly readOnly: boolean;
  readonly grantedAt: string;
}

// ---------------------------------------------------------------------------
// ToolRegistryManager
// ---------------------------------------------------------------------------

export interface RegistryViolation {
  readonly type: 'REGISTRY_VIOLATION';
  readonly action: string;
  readonly source: string;
  readonly count: number;
  readonly timestamp: string;
  readonly escalation: 'warn' | 'alert' | 'shutdown';
}

export class ToolRegistryManager {
  private providers: Map<string, ToolProvider> = new Map();
  private allTools: Map<string, RegisteredTool> = new Map();
  /** Per-conversation trust: conversationId → Map<toolId, SessionTrust>. */
  private conversationTrusts: Map<string, Map<string, SessionTrust>> = new Map();
  /** Active conversation ID for trust lookups. */
  private activeConversationId: string | null = null;
  private _registryHash = '';
  private locked = false;
  private lockedAt: string | null = null;
  private violationCount = 0;

  /** Current registry hash (SHA-256 of serialised registry). */
  get registryHash(): string {
    return this._registryHash;
  }

  /** Total number of registered tools across all providers. */
  get toolCount(): number {
    return this.allTools.size;
  }

  /** Number of registered providers. */
  get providerCount(): number {
    return this.providers.size;
  }

  /** Whether the registry is locked (sole authority mode). */
  get isLocked(): boolean {
    return this.locked;
  }

  /** Timestamp when the registry was locked, or null if unlocked. */
  get lockTimestamp(): string | null {
    return this.lockedAt;
  }

  /**
   * Lock the registry. After locking, only authorised methods can modify it.
   * Called once after initial registry sync completes.
   */
  lock(): void {
    this.locked = true;
    this.lockedAt = new Date().toISOString();
  }

  /**
   * Add a tool to the registry (human-approved hot reload).
   * Only works after lock. Requires explicit authority flag.
   * Returns false if tool already exists or registry is not locked.
   */
  addTool(providerId: string, tool: RegisteredTool, _authority: 'admin_approved'): boolean {
    if (!this.locked) return false;
    if (this.allTools.has(tool.fullId)) return false;
    this.allTools.set(tool.fullId, tool);
    // Update provider's tool list if provider exists
    const existing = this.providers.get(providerId);
    if (existing) {
      this.providers.set(providerId, {
        ...existing,
        tools: [...existing.tools, tool],
      });
    }
    this._registryHash = this.computeHash();
    return true;
  }

  /**
   * Remove a tool from the registry (admin action).
   * Only works after lock. Requires explicit authority flag.
   */
  removeTool(fullId: string, _authority: 'admin_approved'): boolean {
    if (!this.locked) return false;
    const tool = this.allTools.get(fullId);
    const result = this.allTools.delete(fullId);
    if (result && tool) {
      // Update provider's tool list
      const provider = this.providers.get(tool.providerId);
      if (provider) {
        this.providers.set(tool.providerId, {
          ...provider,
          tools: provider.tools.filter((t) => t.fullId !== fullId),
        });
      }
      this._registryHash = this.computeHash();
    }
    return result;
  }

  /**
   * Report a registry modification attempt outside authorised methods.
   * Returns a violation record for audit logging.
   */
  reportViolation(attemptedAction: string, source: string): RegistryViolation {
    this.violationCount++;
    return {
      type: 'REGISTRY_VIOLATION',
      action: attemptedAction,
      source,
      count: this.violationCount,
      timestamp: new Date().toISOString(),
      escalation: this.violationCount >= 3 ? 'shutdown' : this.violationCount >= 2 ? 'alert' : 'warn',
    };
  }

  /**
   * Load registry from a tool_registry_sync payload.
   * Replaces any existing registry.
   */
  /**
   * Load registry from a tool_registry_sync payload.
   * Replaces any existing registry.
   * Rejected when registry is locked — use addTool/removeTool instead.
   */
  loadFromSync(payload: {
    providers: readonly {
      id: string;
      name: string;
      endpoint: string;
      authType: 'api_key' | 'custom_header' | 'no_auth';
      tools: readonly {
        name: string;
        description: string;
        category: 'read' | 'write' | 'destructive';
        readOnly: boolean;
        dangerous: boolean;
        modes: readonly ('conversation' | 'task')[];
      }[];
    }[];
    registryHash: string;
  }): void {
    if (this.locked) return; // Reject when locked
    this.providers.clear();
    this.allTools.clear();

    for (const p of payload.providers) {
      const tools: RegisteredTool[] = p.tools.map((t) => ({
        providerId: p.id,
        providerName: p.name,
        name: t.name,
        fullId: `${p.id}:${t.name}`,
        description: t.description,
        category: t.category,
        readOnly: t.readOnly,
        dangerous: t.dangerous,
        modes: [...t.modes],
      }));

      this.providers.set(p.id, {
        id: p.id,
        name: p.name,
        endpoint: p.endpoint,
        authType: p.authType,
        tools,
      });

      for (const tool of tools) {
        this.allTools.set(tool.fullId, tool);
      }
    }

    this._registryHash = payload.registryHash;
  }

  /** Compute registry hash from current state. */
  computeHash(): string {
    const data = JSON.stringify([...this.providers.values()]);
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Get tools filtered by mode.
   *
   * In conversation mode: dangerous tools STRIPPED entirely.
   * In task mode: all tools returned, dangerous ones marked.
   */
  getToolsForMode(mode: 'conversation' | 'task'): readonly RegisteredTool[] {
    const result: RegisteredTool[] = [];
    for (const tool of this.allTools.values()) {
      if (!tool.modes.includes(mode)) continue;
      if (mode === 'conversation' && tool.dangerous) continue; // Strip dangerous from conversation
      result.push(tool);
    }
    return result;
  }

  /**
   * Get formatted tool list for system prompt injection.
   */
  getToolPromptSection(mode: 'conversation' | 'task'): string {
    const tools = this.getToolsForMode(mode);
    if (tools.length === 0) return '';

    const lines = tools.map((t) => {
      const flags: string[] = [];
      if (t.readOnly) flags.push('read-only');
      else flags.push(t.category);
      if (t.dangerous) flags.push('DANGEROUS');
      return `- ${t.fullId} — ${t.description} [${flags.join(', ')}]`;
    });

    return `--- Available Tools (${tools.length}) ---\n${lines.join('\n')}`;
  }

  /** Get a specific tool by full ID (provider:name). */
  getTool(fullId: string): RegisteredTool | undefined {
    return this.allTools.get(fullId);
  }

  /** Get a provider by ID. */
  getProvider(id: string): ToolProvider | undefined {
    return this.providers.get(id);
  }

  /** Get all providers. */
  getAllProviders(): readonly ToolProvider[] {
    return [...this.providers.values()];
  }

  // -----------------------------------------------------------------------
  // Conversation-scoped session trust
  // -----------------------------------------------------------------------

  /** Set the active conversation for trust lookups. */
  setActiveConversation(conversationId: string | null): void {
    this.activeConversationId = conversationId;
  }

  /** Get the active conversation ID. */
  getActiveConversation(): string | null {
    return this.activeConversationId;
  }

  /** Get or create the trust map for a conversation. */
  private getTrustMap(conversationId?: string | null): Map<string, SessionTrust> {
    const id = conversationId ?? this.activeConversationId ?? '__global__';
    let map = this.conversationTrusts.get(id);
    if (!map) {
      map = new Map();
      this.conversationTrusts.set(id, map);
    }
    return map;
  }

  /**
   * Check if a tool call should be auto-approved based on session trust.
   *
   * Auto-approve rules:
   * - Read-only tools with trustLevel >= 4 and scope=session: auto-approve
   * - Write/destructive tools: NEVER auto-approve (always per-call)
   * - Dangerous tools: NEVER auto-approve (always per-call)
   *
   * Trust is scoped to the active conversation.
   */
  shouldAutoApprove(toolId: string): boolean {
    const trust = this.getTrustMap().get(toolId);
    if (!trust) return false;
    if (trust.scope !== 'session') return false;
    if (trust.trustLevel < 4) return false;
    if (!trust.readOnly) return false;
    // Dangerous tools NEVER auto-approve — always per-call, regardless of other flags
    const tool = this.allTools.get(toolId);
    if (tool?.dangerous) return false;
    return true;
  }

  /** Grant session trust for a tool in the active conversation. */
  grantTrust(toolId: string, trustLevel: number, scope: 'this_call' | 'session'): void {
    const tool = this.allTools.get(toolId);
    this.getTrustMap().set(toolId, {
      toolId,
      trustLevel,
      scope,
      readOnly: tool?.readOnly ?? false,
      grantedAt: new Date().toISOString(),
    });
  }

  /** Revoke session trust for a tool in the active conversation. */
  revokeTrust(toolId: string): boolean {
    return this.getTrustMap().delete(toolId);
  }

  /** Get all current session trusts for the active conversation. */
  getSessionTrusts(): readonly SessionTrust[] {
    return [...this.getTrustMap().values()];
  }

  /** Clear session trusts for the active conversation only. */
  clearSessionTrusts(): void {
    const id = this.activeConversationId ?? '__global__';
    this.conversationTrusts.delete(id);
  }

  /** Clear ALL session trusts across all conversations (e.g. on disconnect). */
  clearAllSessionTrusts(): void {
    this.conversationTrusts.clear();
  }
}
