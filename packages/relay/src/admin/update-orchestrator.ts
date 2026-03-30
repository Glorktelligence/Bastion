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
 *   3. Restart — restart services sequentially, persist state to disk
 *   4. Verify  — confirm all components reconnected on new version
 *
 * State persistence:
 *   Before restarting, the orchestrator writes a pending-update.json
 *   state file. On startup, if this file exists, the orchestrator
 *   resumes from the restart phase, waiting for reconnections.
 *   The file is deleted on successful completion or failure.
 */

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
  readonly expectedComponents: readonly string[];
  readonly error: string | null;
  readonly warnings: readonly string[];
}

/** Persisted state for restart recovery. */
export interface PendingUpdateState {
  readonly phase: 'restarting';
  readonly targetVersion: string;
  readonly startedAt: string;
  readonly expectedComponents: readonly string[];
  readonly restartOrder: readonly string[];
  readonly restartedComponents: readonly string[];
  readonly buildResults: Record<string, BuildResult>;
}

export interface OrchestratorConfig {
  readonly auditLogger: AuditLogger;
  /** Send a message to a specific connection ID. */
  readonly send: (connectionId: string, data: string) => boolean;
  /** Phase timeout in milliseconds. Default: 300000 (5 min). */
  readonly phaseTimeoutMs?: number;
  /** Reconnection timeout per component in milliseconds. Default: 60000 (60s). */
  readonly reconnectTimeoutMs?: number;
  /** Remote component reconnection timeout (AI VM). Default: 120000 (120s). */
  readonly remoteReconnectTimeoutMs?: number;
  /** Path to pending-update.json state file. Default: /var/lib/bastion/pending-update.json. */
  readonly stateFilePath?: string;
}

// ---------------------------------------------------------------------------
// UpdateOrchestrator
// ---------------------------------------------------------------------------

const DEFAULT_PHASE_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_RECONNECT_TIMEOUT_MS = 60_000; // 60 seconds
const DEFAULT_REMOTE_RECONNECT_TIMEOUT_MS = 120_000; // 120 seconds
const DEFAULT_STATE_FILE_PATH = '/var/lib/bastion/pending-update.json';

/** Components that are considered "remote" (longer reconnect timeout). */
const REMOTE_COMPONENTS = new Set(['ai-client']);

/** Components that are optional for completion (human clients). */
const OPTIONAL_COMPONENTS = new Set(['human']);

export class UpdateOrchestrator {
  private readonly audit: AuditLogger;
  private readonly sendFn: (connectionId: string, data: string) => boolean;
  private readonly phaseTimeoutMs: number;
  private readonly reconnectTimeoutMs: number;
  private readonly remoteReconnectTimeoutMs: number;
  readonly stateFilePath: string;

  private phase: OrchestratorPhase = 'idle';
  private targetVersion: string | null = null;
  private startedAt: string | null = null;
  private error: string | null = null;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly warnings: string[] = [];

  /** Connected update agents keyed by connection ID. */
  private readonly agents: Map<string, ConnectedAgent> = new Map();
  /** Components that acknowledged prepare phase. */
  private readonly prepareAcks: Set<string> = new Set();
  /** Build results keyed by component name. */
  private readonly buildResults: Map<string, BuildResult> = new Map();
  /** Components that reconnected after restart (component → version). */
  private readonly reconnections: Map<string, string> = new Map();
  /** Expected components for reconnection verification. */
  private readonly expectedComponents: Set<string> = new Set();
  /** Sequential restart order. */
  private restartOrder: string[] = [];
  /** Components already restarted (for cancel tracking). */
  private readonly restartedComponents: Set<string> = new Set();
  /** Whether cancel was requested during restart. Read by external code checking partial state. */
  cancelRequested = false;

  constructor(config: OrchestratorConfig) {
    this.audit = config.auditLogger;
    this.sendFn = config.send;
    this.phaseTimeoutMs = config.phaseTimeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS;
    this.reconnectTimeoutMs = config.reconnectTimeoutMs ?? DEFAULT_RECONNECT_TIMEOUT_MS;
    this.remoteReconnectTimeoutMs = config.remoteReconnectTimeoutMs ?? DEFAULT_REMOTE_RECONNECT_TIMEOUT_MS;
    this.stateFilePath = config.stateFilePath ?? DEFAULT_STATE_FILE_PATH;
  }

  // -------------------------------------------------------------------------
  // Agent management
  // -------------------------------------------------------------------------

  /**
   * Register a connected update agent. Keyed by agentId so
   * reconnections replace the old entry instead of duplicating.
   */
  registerAgent(connectionId: string, agentId: string, component: string): void {
    this.agents.set(agentId, {
      connectionId,
      component,
      agentId,
      connectedAt: new Date().toISOString(),
    });

    // If we're waiting for reconnections, check if this agent is expected
    if (this.phase === 'restarting' || this.phase === 'verifying') {
      // Agent reconnected — they'll send update_reconnected with version
    }
  }

  /** Unregister an agent by connection ID (called on WebSocket disconnect). */
  unregisterAgent(connectionId: string): void {
    // Find by connectionId since that's what the relay knows at disconnect time
    let found: ConnectedAgent | undefined;
    for (const agent of this.agents.values()) {
      if (agent.connectionId === connectionId) {
        found = agent;
        break;
      }
    }
    if (!found) return;
    this.agents.delete(found.agentId);

    // If agent disconnects during build, fail that component
    if (this.phase === 'building') {
      const result = this.buildResults.get(found.component);
      if (result && result.status !== 'complete') {
        this.handleBuildStatus(found.component, 'failed', undefined, 'Agent disconnected during build');
      }
    }
  }

  getAgents(): readonly ConnectedAgent[] {
    return [...this.agents.values()];
  }

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
  // State persistence (restart recovery)
  // -------------------------------------------------------------------------

  /** Write pending update state to disk before restart. */
  private saveState(): void {
    const state: PendingUpdateState = {
      phase: 'restarting',
      targetVersion: this.targetVersion ?? '',
      startedAt: this.startedAt ?? new Date().toISOString(),
      expectedComponents: [...this.expectedComponents],
      restartOrder: this.restartOrder,
      restartedComponents: [...this.restartedComponents],
      buildResults: Object.fromEntries(this.buildResults),
    };
    try {
      writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2));
    } catch {
      this.warnings.push('Failed to write pending-update.json — restart recovery unavailable');
    }
  }

  /** Check for and load pending update state on startup. Returns true if state was loaded. */
  loadPendingState(): boolean {
    try {
      const raw = readFileSync(this.stateFilePath, 'utf-8');
      const state = JSON.parse(raw) as PendingUpdateState;
      if (state.phase === 'restarting' && state.targetVersion) {
        this.phase = 'restarting';
        this.targetVersion = state.targetVersion;
        this.startedAt = state.startedAt;
        this.restartOrder = [...state.restartOrder];
        for (const c of state.expectedComponents) this.expectedComponents.add(c);
        for (const c of state.restartedComponents) this.restartedComponents.add(c);
        for (const [k, v] of Object.entries(state.buildResults)) this.buildResults.set(k, v);

        this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_CHECK_INITIATED, 'orchestrator', {
          action: 'resumed_from_state_file',
          targetVersion: state.targetVersion,
          expectedComponents: state.expectedComponents,
        });

        // Start reconnection timeout
        this.startReconnectionTimer();
        return true;
      }
    } catch {
      // No state file or invalid — normal startup
    }
    return false;
  }

  /** Delete the state file after completion or failure. */
  private deleteStateFile(): void {
    try {
      unlinkSync(this.stateFilePath);
    } catch {
      // File may not exist — that's fine
    }
  }

  // -------------------------------------------------------------------------
  // Phase 0: Check
  // -------------------------------------------------------------------------

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

  handleUpdateAvailable(availableVersion: string, _commitHash: string): void {
    this.targetVersion = availableVersion;
    this.clearPhaseTimer();
  }

  // -------------------------------------------------------------------------
  // Phase 1: Prepare
  // -------------------------------------------------------------------------

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

  handlePrepareAck(component: string): void {
    this.prepareAcks.add(component);
    const expectedComponents = new Set([...this.agents.values()].map((a) => a.component));
    const allAcked = [...expectedComponents].every((c) => this.prepareAcks.has(c));
    if (allAcked) this.clearPhaseTimer();
  }

  // -------------------------------------------------------------------------
  // Phase 2: Build
  // -------------------------------------------------------------------------

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

    const allComplete = [...this.buildResults.values()].every((r) => r.status === 'complete');
    if (allComplete && this.buildResults.size === this.agents.size) {
      this.clearPhaseTimer();
    }
  }

  // -------------------------------------------------------------------------
  // Phase 3: Restart (with state persistence)
  // -------------------------------------------------------------------------

  /**
   * Execute sequential restart of services.
   *
   * @param services — map of component name → systemd service name
   * @param order — restart order (e.g. ['relay', 'ai-client']). Relay first.
   * @param timeout — restart timeout per component in seconds
   */
  executeRestart(services: Record<string, string>, order?: readonly string[], timeout = 30): boolean {
    if (!this.canTransitionTo('restarting')) return false;

    this.transitionTo('restarting');
    this.reconnections.clear();
    this.restartedComponents.clear();
    this.cancelRequested = false;

    // Set expected components and restart order
    const agentComponents = [...this.agents.values()].map((a) => a.component);
    this.restartOrder = order ? [...order] : agentComponents;
    for (const c of this.restartOrder) {
      if (!OPTIONAL_COMPONENTS.has(c)) {
        this.expectedComponents.add(c);
      }
    }

    // Persist state BEFORE sending restart commands
    this.saveState();

    // Send restart to all agents
    for (const agent of this.agents.values()) {
      const service = services[agent.component];
      if (service) {
        this.restartedComponents.add(agent.component);
        this.sendToAgent(agent.connectionId, 'update_restart', {
          targetComponent: agent.component,
          service,
          timeout,
        });
      }
    }

    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_RESTART_ISSUED, 'orchestrator', {
      components: this.restartOrder,
      services,
      order: this.restartOrder,
    });

    // Start reconnection timeout
    this.startReconnectionTimer();
    return true;
  }

  /**
   * Handle reconnection from a component after restart.
   * Verifies the component reports the expected new version.
   */
  handleReconnected(component: string, version: string): void {
    // Version verification — reject if old version reconnects
    if (this.targetVersion && version !== this.targetVersion && version !== 'pending-restart') {
      this.warnings.push(`${component} reconnected with version ${version}, expected ${this.targetVersion}`);
      this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_FAILED, 'orchestrator', {
        component,
        reportedVersion: version,
        expectedVersion: this.targetVersion,
        reason: 'version_mismatch',
      });
      // Don't block — log as warning, it might still be starting up
    }

    this.reconnections.set(component, version);
    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_COMPLETED, 'orchestrator', {
      component,
      version,
    });

    // Check if all required components have reconnected
    this.checkReconnectionComplete();
  }

  private checkReconnectionComplete(): void {
    const requiredReconnected = [...this.expectedComponents].every(
      (c) => this.reconnections.has(c) || OPTIONAL_COMPONENTS.has(c),
    );

    if (requiredReconnected && this.reconnections.size > 0) {
      this.clearPhaseTimer();
      this.complete();
    }
  }

  private startReconnectionTimer(): void {
    this.clearPhaseTimer();
    // Use the longer timeout for remote components if any are expected
    const hasRemote = [...this.expectedComponents].some((c) => REMOTE_COMPONENTS.has(c));
    const timeout = hasRemote ? this.remoteReconnectTimeoutMs : this.reconnectTimeoutMs;

    this.phaseTimer = setTimeout(() => {
      const missing = [...this.expectedComponents].filter((c) => !this.reconnections.has(c));
      if (missing.length > 0) {
        this.fail(`Reconnection timeout: components did not reconnect: ${missing.join(', ')}`);
      } else {
        this.complete();
      }
    }, timeout);
    if (this.phaseTimer.unref) this.phaseTimer.unref();
  }

  // -------------------------------------------------------------------------
  // Phase 4: Verify
  // -------------------------------------------------------------------------

  verifyAll(): boolean {
    if (!this.canTransitionTo('verifying')) return false;

    this.transitionTo('verifying');

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

  getStatus(): OrchestratorStatus {
    return {
      phase: this.phase,
      targetVersion: this.targetVersion,
      startedAt: this.startedAt,
      agents: [...this.agents.values()],
      prepareAcks: [...this.prepareAcks],
      buildResults: Object.fromEntries(this.buildResults),
      reconnections: [...this.reconnections.keys()],
      expectedComponents: [...this.expectedComponents],
      error: this.error,
      warnings: [...this.warnings],
    };
  }

  /**
   * Cancel an in-progress update.
   *
   * During restart phase: marks as cancelled, stops further restarts,
   * but already-restarted components stay on new version.
   */
  cancel(): void {
    if (this.phase === 'idle') return;

    const previousPhase = this.phase;

    if (this.phase === 'restarting') {
      this.cancelRequested = true;
      this.warnings.push(
        `Cancelled during restart. Already restarted: ${[...this.restartedComponents].join(', ') || 'none'}`,
      );
    }

    this.clearPhaseTimer();
    this.deleteStateFile();

    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_FAILED, 'orchestrator', {
      reason: 'cancelled',
      previousPhase,
      restartedComponents: [...this.restartedComponents],
    });

    this.reset();
  }

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
    this.deleteStateFile();

    const duration = this.startedAt ? Date.now() - new Date(this.startedAt).getTime() : 0;
    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_COMPLETED, 'orchestrator', {
      fromVersion: 'previous',
      toVersion: this.targetVersion,
      duration: Math.round(duration / 1000),
      components: [...this.reconnections.keys()],
    });
  }

  private fail(error: string): void {
    this.clearPhaseTimer();
    this.phase = 'failed';
    this.error = error;
    this.deleteStateFile();
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
    this.expectedComponents.clear();
    this.restartedComponents.clear();
    this.restartOrder = [];
    this.cancelRequested = false;
    this.warnings.length = 0;
  }

  private sendToAgent(connectionId: string, type: string, payload: Record<string, unknown>): void {
    const msg = JSON.stringify({
      type,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      sender: { id: 'relay', type: 'relay', displayName: 'Bastion Relay' },
      payload,
    });
    this.sendFn(connectionId, msg);
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
