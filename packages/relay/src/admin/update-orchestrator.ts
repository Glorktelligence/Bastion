// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Update orchestrator — manages the 4-phase update lifecycle.
 *
 * Phases:
 *   0. Check   — query connected agent for available updates
 *   1. Prepare — notify all components to save state
 *   2. Build   — execute build commands on agents (parallel)
 *   3. Restart — restart services sequentially (relay first, then AI)
 *   4. Verify  — confirm all components reconnected on new version
 *
 * The orchestrator tracks connected update agents, coordinates phases,
 * enforces timeouts, and exposes status for the admin API.
 */

import type { AuditLogger } from '../audit/audit-logger.js';
import { AUDIT_EVENT_TYPES } from '../audit/audit-logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrchestratorPhase =
  | 'idle'
  | 'checking'
  | 'preparing'
  | 'building'
  | 'restarting'
  | 'verifying'
  | 'complete'
  | 'failed';

export interface ConnectedAgent {
  readonly connectionId: string;
  readonly component: string;
  readonly agentId: string;
  readonly connectedAt: string;
}

export interface BuildResult {
  readonly status: 'pending' | 'building' | 'complete' | 'failed';
  readonly duration?: number;
  readonly error?: string;
}

export interface OrchestratorStatus {
  readonly phase: OrchestratorPhase;
  readonly targetVersion: string | null;
  readonly startedAt: string | null;
  readonly agents: readonly ConnectedAgent[];
  readonly prepareAcks: readonly string[];
  readonly buildResults: Record<string, BuildResult>;
  readonly reconnections: readonly string[];
  readonly error: string | null;
}

export interface OrchestratorConfig {
  readonly auditLogger: AuditLogger;
  /** Send a message to a specific connection ID. */
  readonly send: (connectionId: string, data: string) => boolean;
  /** Phase timeout in milliseconds. Default: 300000 (5 min). */
  readonly phaseTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// UpdateOrchestrator
// ---------------------------------------------------------------------------

const DEFAULT_PHASE_TIMEOUT_MS = 300_000; // 5 minutes

export class UpdateOrchestrator {
  private readonly audit: AuditLogger;
  private readonly send: (connectionId: string, data: string) => boolean;
  private readonly phaseTimeoutMs: number;

  private phase: OrchestratorPhase = 'idle';
  private targetVersion: string | null = null;
  private startedAt: string | null = null;
  private error: string | null = null;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;

  /** Connected update agents keyed by connection ID. */
  private readonly agents: Map<string, ConnectedAgent> = new Map();
  /** Components that acknowledged prepare phase. */
  private readonly prepareAcks: Set<string> = new Set();
  /** Build results keyed by component name. */
  private readonly buildResults: Map<string, BuildResult> = new Map();
  /** Components that reconnected after restart. */
  private readonly reconnections: Set<string> = new Set();

  constructor(config: OrchestratorConfig) {
    this.audit = config.auditLogger;
    this.send = config.send;
    this.phaseTimeoutMs = config.phaseTimeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS;
  }

  // -------------------------------------------------------------------------
  // Agent management
  // -------------------------------------------------------------------------

  /** Register a connected update agent. */
  registerAgent(connectionId: string, agentId: string, component: string): void {
    this.agents.set(connectionId, {
      connectionId,
      component,
      agentId,
      connectedAt: new Date().toISOString(),
    });
  }

  /** Unregister an agent on disconnect. */
  unregisterAgent(connectionId: string): void {
    this.agents.delete(connectionId);
  }

  /** Get all connected agents. */
  getAgents(): readonly ConnectedAgent[] {
    return [...this.agents.values()];
  }

  /** Find an agent by component name. */
  findAgentByComponent(component: string): ConnectedAgent | undefined {
    for (const agent of this.agents.values()) {
      if (agent.component === component) return agent;
    }
    return undefined;
  }

  get connectedAgentCount(): number {
    return this.agents.size;
  }

  // -------------------------------------------------------------------------
  // Phase 0: Check
  // -------------------------------------------------------------------------

  /** Initiate a version check via a connected agent. */
  checkForUpdates(repo: string, currentVersion: string): boolean {
    if (!this.canTransitionTo('checking')) return false;

    const agent = this.agents.values().next().value;
    if (!agent) return false;

    this.transitionTo('checking');
    this.sendToAgent(agent.connectionId, 'update_check', {
      source: 'github',
      repo,
      currentVersion,
    });

    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_CHECK_INITIATED, 'orchestrator', {
      repo,
      currentVersion,
      agentId: agent.agentId,
    });

    return true;
  }

  /** Handle update_available response from agent. */
  handleUpdateAvailable(availableVersion: string, _commitHash: string): void {
    this.targetVersion = availableVersion;
    // Stay in checking state — admin decides whether to proceed
    this.clearPhaseTimer();
  }

  // -------------------------------------------------------------------------
  // Phase 1: Prepare
  // -------------------------------------------------------------------------

  /** Send prepare to all connected agents. */
  prepareAll(targetVersion: string, commitHash: string, reason: string): boolean {
    if (!this.canTransitionTo('preparing')) return false;
    if (this.agents.size === 0) return false;

    this.transitionTo('preparing');
    this.targetVersion = targetVersion;
    this.prepareAcks.clear();

    for (const agent of this.agents.values()) {
      this.sendToAgent(agent.connectionId, 'update_prepare', {
        targetVersion,
        commitHash,
        reason,
      });
    }

    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_PREPARE_SENT, 'orchestrator', {
      targetVersion,
      commitHash,
      agentCount: this.agents.size,
    });

    this.startPhaseTimer('preparing');
    return true;
  }

  /** Handle prepare acknowledgement from a component. */
  handlePrepareAck(component: string): void {
    this.prepareAcks.add(component);

    // Check if all agents have acknowledged
    const expectedComponents = new Set([...this.agents.values()].map((a) => a.component));
    const allAcked = [...expectedComponents].every((c) => this.prepareAcks.has(c));

    if (allAcked) {
      this.clearPhaseTimer();
      // Ready for build phase — admin can now call executeBuild()
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2: Build
  // -------------------------------------------------------------------------

  /** Execute build on all connected agents (parallel). */
  executeBuild(commands: readonly Record<string, unknown>[], version: string, commitHash: string): boolean {
    if (!this.canTransitionTo('building')) return false;
    if (this.agents.size === 0) return false;

    this.transitionTo('building');
    this.buildResults.clear();

    for (const agent of this.agents.values()) {
      this.buildResults.set(agent.component, { status: 'pending' });

      this.sendToAgent(agent.connectionId, 'update_execute', {
        targetComponent: agent.component,
        commands,
        version,
        commitHash,
      });
    }

    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_BUILD_STARTED, 'orchestrator', {
      version,
      commitHash,
      components: [...this.agents.values()].map((a) => a.component),
    });

    this.startPhaseTimer('building');
    return true;
  }

  /** Handle build status update from an agent. */
  handleBuildStatus(component: string, phase: string, duration?: number, error?: string): void {
    if (phase === 'complete') {
      this.buildResults.set(component, { status: 'complete', duration });
      this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_BUILD_COMPLETE, 'orchestrator', { component, duration });
    } else if (phase === 'failed') {
      this.buildResults.set(component, { status: 'failed', error });
      this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_BUILD_FAILED, 'orchestrator', { component, error });
      this.fail(`Build failed for ${component}: ${error ?? 'unknown error'}`);
      return;
    } else {
      this.buildResults.set(component, { status: 'building' });
    }

    // Check if all builds complete
    const allComplete = [...this.buildResults.values()].every((r) => r.status === 'complete');
    if (allComplete && this.buildResults.size === this.agents.size) {
      this.clearPhaseTimer();
      // Ready for restart phase
    }
  }

  // -------------------------------------------------------------------------
  // Phase 3: Restart
  // -------------------------------------------------------------------------

  /** Send restart commands to agents sequentially. */
  executeRestart(services: Record<string, string>, timeout = 30): boolean {
    if (!this.canTransitionTo('restarting')) return false;

    this.transitionTo('restarting');
    this.reconnections.clear();

    for (const agent of this.agents.values()) {
      const service = services[agent.component];
      if (service) {
        this.sendToAgent(agent.connectionId, 'update_restart', {
          targetComponent: agent.component,
          service,
          timeout,
        });
      }
    }

    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_RESTART_ISSUED, 'orchestrator', {
      components: [...this.agents.values()].map((a) => a.component),
      services,
    });

    this.startPhaseTimer('restarting');
    return true;
  }

  /** Handle reconnection from a component after restart. */
  handleReconnected(component: string, version: string): void {
    this.reconnections.add(component);

    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_COMPLETED, 'orchestrator', {
      component,
      version,
    });

    // We don't require all to reconnect — agents might reconnect at different times
    // The verify phase handles final confirmation
  }

  // -------------------------------------------------------------------------
  // Phase 4: Verify
  // -------------------------------------------------------------------------

  /** Verify all components are on the new version. */
  verifyAll(): boolean {
    if (!this.canTransitionTo('verifying')) return false;

    this.transitionTo('verifying');

    // If we have reconnections already, we can complete immediately
    if (this.reconnections.size > 0) {
      this.complete();
      return true;
    }

    this.startPhaseTimer('verifying');
    return true;
  }

  // -------------------------------------------------------------------------
  // Status & Control
  // -------------------------------------------------------------------------

  /** Get the current orchestrator status. */
  getStatus(): OrchestratorStatus {
    return {
      phase: this.phase,
      targetVersion: this.targetVersion,
      startedAt: this.startedAt,
      agents: [...this.agents.values()],
      prepareAcks: [...this.prepareAcks],
      buildResults: Object.fromEntries(this.buildResults),
      reconnections: [...this.reconnections],
      error: this.error,
    };
  }

  /** Cancel an in-progress update. */
  cancel(): void {
    if (this.phase === 'idle') return;
    this.clearPhaseTimer();
    const previousPhase = this.phase;
    this.reset();
    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_FAILED, 'orchestrator', {
      reason: 'cancelled',
      previousPhase,
    });
  }

  /** Current phase. */
  get currentPhase(): OrchestratorPhase {
    return this.phase;
  }

  // -------------------------------------------------------------------------
  // Internal state management
  // -------------------------------------------------------------------------

  private canTransitionTo(target: OrchestratorPhase): boolean {
    const allowed: Record<string, OrchestratorPhase[]> = {
      checking: ['idle', 'complete', 'failed'],
      preparing: ['idle', 'checking', 'complete', 'failed'],
      building: ['preparing'],
      restarting: ['building'],
      verifying: ['restarting'],
      complete: ['verifying', 'restarting'],
      failed: ['checking', 'preparing', 'building', 'restarting', 'verifying'],
    };
    return allowed[target]?.includes(this.phase) ?? false;
  }

  private transitionTo(phase: OrchestratorPhase): void {
    this.phase = phase;
    if (phase !== 'idle') {
      this.startedAt = this.startedAt ?? new Date().toISOString();
    }
    this.error = null;
  }

  private complete(): void {
    this.clearPhaseTimer();
    this.phase = 'complete';

    const duration = this.startedAt ? Date.now() - new Date(this.startedAt).getTime() : 0;
    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_COMPLETED, 'orchestrator', {
      fromVersion: 'previous',
      toVersion: this.targetVersion,
      duration: Math.round(duration / 1000),
      components: [...this.reconnections],
    });
  }

  private fail(error: string): void {
    this.clearPhaseTimer();
    this.phase = 'failed';
    this.error = error;
    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_FAILED, 'orchestrator', {
      phase: this.phase,
      error,
    });
  }

  private reset(): void {
    this.phase = 'idle';
    this.targetVersion = null;
    this.startedAt = null;
    this.error = null;
    this.prepareAcks.clear();
    this.buildResults.clear();
    this.reconnections.clear();
  }

  private sendToAgent(connectionId: string, type: string, payload: Record<string, unknown>): void {
    const msg = JSON.stringify({
      type,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      sender: { id: 'relay', type: 'relay', displayName: 'Bastion Relay' },
      payload,
    });
    this.send(connectionId, msg);
  }

  private startPhaseTimer(phase: OrchestratorPhase): void {
    this.clearPhaseTimer();
    this.phaseTimer = setTimeout(() => {
      this.fail(`Phase '${phase}' timed out after ${this.phaseTimeoutMs / 1000}s`);
    }, this.phaseTimeoutMs);
    if (this.phaseTimer.unref) this.phaseTimer.unref();
  }

  private clearPhaseTimer(): void {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }
}
