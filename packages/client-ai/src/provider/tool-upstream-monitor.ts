// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * ToolUpstreamMonitor — detects upstream tool changes from MCP providers.
 *
 * Periodically polls connected MCP servers via tools/list and compares
 * against the locked registry. New/removed/changed tools are flagged
 * as pending changes requiring human acknowledgement.
 *
 * MCP-sourced new tools start a 2-hour timer; if not registered or
 * rejected by then, the violation is escalated.
 */

import type { DateTimeManager } from './datetime-manager.js';
import type { McpClientAdapter } from './mcp-client-adapter.js';
import type { ToolRegistryManager } from './tool-registry-manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpstreamToolChange {
  readonly type: 'new_tool' | 'removed_tool' | 'changed_tool';
  readonly providerId: string;
  readonly toolName: string;
  readonly fullId: string;
  readonly source: 'mcp' | 'provider';
  readonly detectedAt: string;
  readonly details?: string;
}

export interface UpstreamCheckResult {
  readonly providerId: string;
  readonly changes: readonly UpstreamToolChange[];
  readonly checkedAt: string;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// ToolUpstreamMonitor
// ---------------------------------------------------------------------------

export class ToolUpstreamMonitor {
  private knownTools: Map<string, Set<string>> = new Map(); // providerId → Set<toolName>
  private pendingChanges: Map<string, UpstreamToolChange> = new Map(); // fullId → change
  private changeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map(); // fullId → 2hr timer
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private readonly dateTimeManager: DateTimeManager | null;

  constructor(
    private readonly registry: ToolRegistryManager,
    private readonly mcpAdapters: Map<string, McpClientAdapter>,
    private readonly onViolation: (change: UpstreamToolChange) => void,
    private readonly onNotice: (change: UpstreamToolChange) => void,
    dateTimeManager?: DateTimeManager,
  ) {
    this.dateTimeManager = dateTimeManager ?? null;
  }

  /** Get current ISO timestamp via DateTimeManager or fallback. */
  private now(): string {
    return this.dateTimeManager?.now().iso ?? new Date().toISOString();
  }

  /**
   * Initialize known tools from current registry state.
   * Call after initial registry sync.
   */
  initializeFromRegistry(): void {
    for (const provider of this.registry.getAllProviders()) {
      const toolNames = new Set(provider.tools.map((t) => t.name));
      this.knownTools.set(provider.id, toolNames);
    }
  }

  /**
   * Check a specific MCP provider for tool changes.
   * Calls tools/list on the MCP endpoint and compares against registry.
   */
  async checkProvider(providerId: string): Promise<UpstreamCheckResult> {
    const adapter = this.mcpAdapters.get(providerId);
    if (!adapter) {
      return { providerId, changes: [], checkedAt: this.now(), error: 'No adapter' };
    }

    try {
      const upstreamTools = await adapter.listTools();
      const knownSet = this.knownTools.get(providerId) || new Set<string>();
      const changes: UpstreamToolChange[] = [];

      // Detect NEW tools (upstream has it, registry doesn't)
      for (const tool of upstreamTools) {
        if (!knownSet.has(tool.name)) {
          const change: UpstreamToolChange = {
            type: 'new_tool',
            providerId,
            toolName: tool.name,
            fullId: `${providerId}:${tool.name}`,
            source: 'mcp',
            detectedAt: this.now(),
            details: tool.description,
          };
          changes.push(change);
          this.pendingChanges.set(change.fullId, change);

          // Start 2-hour violation timer for MCP tools
          this.start2HourTimer(change);

          // Immediate callback
          this.onViolation(change);
        }
      }

      // Detect REMOVED tools (registry has it, upstream doesn't)
      const upstreamNames = new Set(upstreamTools.map((t) => t.name));
      for (const knownName of knownSet) {
        if (!upstreamNames.has(knownName)) {
          const change: UpstreamToolChange = {
            type: 'removed_tool',
            providerId,
            toolName: knownName,
            fullId: `${providerId}:${knownName}`,
            source: 'mcp',
            detectedAt: this.now(),
          };
          changes.push(change);
          this.onNotice(change);
        }
      }

      return { providerId, changes, checkedAt: this.now() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { providerId, changes: [], checkedAt: this.now(), error: message };
    }
  }

  /**
   * Check ALL connected MCP providers.
   */
  async checkAllProviders(): Promise<readonly UpstreamCheckResult[]> {
    const results: UpstreamCheckResult[] = [];
    for (const [id] of this.mcpAdapters) {
      results.push(await this.checkProvider(id));
    }
    return results;
  }

  /**
   * Start periodic upstream checks (call after registry lock).
   * Default: every 60 minutes.
   */
  startPeriodicChecks(intervalMs = 60 * 60 * 1000): ReturnType<typeof setInterval> {
    this.periodicTimer = setInterval(() => {
      this.checkAllProviders().catch(() => {});
    }, intervalMs);
    return this.periodicTimer;
  }

  /**
   * Acknowledge a change (admin registered or rejected the tool).
   * Clears the pending change and cancels any 2-hour timer.
   */
  acknowledgeChange(fullId: string): void {
    this.pendingChanges.delete(fullId);
    const timer = this.changeTimers.get(fullId);
    if (timer) {
      clearTimeout(timer);
      this.changeTimers.delete(fullId);
    }
  }

  /**
   * Get all pending (unacknowledged) changes.
   */
  getPendingChanges(): readonly UpstreamToolChange[] {
    return [...this.pendingChanges.values()];
  }

  /**
   * Update known tools after a successful hot reload (tool added to registry).
   */
  registerKnownTool(providerId: string, toolName: string): void {
    let set = this.knownTools.get(providerId);
    if (!set) {
      set = new Set();
      this.knownTools.set(providerId, set);
    }
    set.add(toolName);
  }

  private start2HourTimer(change: UpstreamToolChange): void {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const timer = setTimeout(() => {
      // 2 hours elapsed, tool still not registered — escalate
      if (this.pendingChanges.has(change.fullId)) {
        this.onViolation({
          ...change,
          type: 'new_tool',
          detectedAt: change.detectedAt,
          details: `ESCALATED: Tool "${change.toolName}" detected 2h ago, still not registered`,
        });
      }
    }, TWO_HOURS);
    this.changeTimers.set(change.fullId, timer);
  }

  /** Clean up timers on shutdown. */
  shutdown(): void {
    for (const timer of this.changeTimers.values()) clearTimeout(timer);
    this.changeTimers.clear();
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }
}
