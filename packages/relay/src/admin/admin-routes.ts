// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Admin API route handlers for the relay.
 *
 * Provides CRUD endpoints for managing AI providers, capability
 * matrices, and relay configuration. All admin actions generate
 * audit log entries.
 *
 * Endpoints:
 *   GET    /api/health                         — Health check
 *   GET    /api/providers                      — List all providers
 *   GET    /api/providers/:id                  — Get provider details
 *   POST   /api/providers                      — Approve new provider
 *   PUT    /api/providers/:id/revoke           — Revoke (soft-delete)
 *   PUT    /api/providers/:id/activate         — Reactivate
 *   GET    /api/providers/:id/capabilities     — Get capability matrix
 *   PUT    /api/providers/:id/capabilities     — Set capability matrix
 *
 * MaliClaw Clause: blocked identifiers cannot be approved as providers.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuditLogger } from '../audit/audit-logger.js';
import { AUDIT_EVENT_TYPES } from '../audit/audit-logger.js';
import { Allowlist } from '../auth/allowlist.js';
import { ProviderRegistry } from '../auth/provider-registry.js';

// ---------------------------------------------------------------------------
// Capability Matrix
// ---------------------------------------------------------------------------

/** File transfer permissions for a provider. */
export interface FileTransferCapabilities {
  readonly canSend: boolean;
  readonly canReceive: boolean;
  readonly maxFileSizeBytes: number;
  readonly allowedMimeTypes: readonly string[];
}

/**
 * Structured capability matrix for an approved provider.
 *
 * Defines exactly what an AI provider's client can do through the relay.
 * Enforced at the relay routing level (Task 3.4).
 */
export interface CapabilityMatrix {
  /** Message types this provider's AI client is allowed to send. */
  readonly allowedMessageTypes: readonly string[];
  /** File transfer permissions. */
  readonly fileTransfer: FileTransferCapabilities;
  /** Maximum concurrent tasks. */
  readonly maxConcurrentTasks: number;
  /** Optional budget limit in USD. */
  readonly budgetLimitUsd?: number;
}

/**
 * Default capability matrix for newly approved providers.
 *
 * Allows standard AI→human message types and file transfers.
 * Does NOT allow admin message types (config_update, etc.).
 */
export function defaultCapabilityMatrix(): CapabilityMatrix {
  return {
    allowedMessageTypes: [
      'conversation',
      'challenge',
      'denial',
      'status',
      'result',
      'error',
      'file_offer',
      'heartbeat',
      'provider_status',
      'budget_alert',
      'config_ack',
      'config_nack',
    ],
    fileTransfer: {
      canSend: true,
      canReceive: true,
      maxFileSizeBytes: 50 * 1024 * 1024, // 50 MB
      allowedMimeTypes: ['*/*'],
    },
    maxConcurrentTasks: 10,
  };
}

// ---------------------------------------------------------------------------
// API Response
// ---------------------------------------------------------------------------

/** Structured API response. */
export interface ApiResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Live connection info returned by the status provider. */
export interface LiveConnectionInfo {
  readonly connectionId: string;
  readonly remoteAddress: string;
  readonly connectedAt: string;
  readonly clientType: 'human' | 'ai' | 'updater' | 'unknown';
  readonly authenticated: boolean;
  readonly providerId?: string;
  readonly messageCount: number;
}

/**
 * Provider of live relay state for the admin API.
 *
 * Decouples AdminRoutes from BastionRelay/MessageRouter internals.
 * Implement this interface and pass it via config to enable
 * GET /api/status and GET /api/connections.
 */
export interface RelayStatusProvider {
  /** Get all active connections with metadata. */
  getConnections(): readonly LiveConnectionInfo[];
  /** Number of paired (human↔AI) sessions. */
  getActiveSessionCount(): number;
  /** Rolling messages-per-minute rate. */
  getMessagesPerMinute(): number;
  /** Quarantine status: active entries and capacity. */
  getQuarantineStatus(): { active: number; capacity: number };
  /** Cumulative stats: session + all-time counters. */
  getCumulativeStats?(): {
    session: {
      messagesRouted: number;
      connectionsServed: number;
      sessionsCreated: number;
      fileTransfers: number;
      uptimeSeconds: number;
      startedAt: string;
    };
    allTime: {
      totalMessagesRouted: number;
      totalConnectionsServed: number;
      totalSessionsCreated: number;
      totalFileTransfers: number;
      firstStartedAt: string;
    };
  };
}

/** AI disclosure banner configuration for regulatory transparency. */
export interface DisclosureConfig {
  enabled: boolean;
  text: string;
  style: 'info' | 'legal' | 'warning';
  position: 'banner' | 'footer';
  dismissible: boolean;
  link?: string;
  linkText?: string;
  jurisdiction?: string;
}

/** Update status tracking. */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'preparing'
  | 'building'
  | 'restarting'
  | 'verifying'
  | 'complete'
  | 'failed';

export interface UpdateStatus {
  phase: UpdatePhase;
  targetVersion: string | null;
  startedAt: string | null;
  component: string | null;
  error: string | null;
}

/** Configuration for admin routes. */
export interface AdminRoutesConfig {
  readonly providerRegistry: ProviderRegistry;
  readonly auditLogger: AuditLogger;
  /** Optional live relay state provider for status/connections endpoints. */
  readonly statusProvider?: RelayStatusProvider;
  /** Optional extension registry for listing loaded extensions. */
  readonly extensionRegistry?: import('../extensions/extension-registry.js').ExtensionRegistry;
  /** Callback invoked when admin updates disclosure config via API. */
  readonly onDisclosureUpdate?: (config: DisclosureConfig) => void;
  /** Callback for sending update messages to the connected updater client. */
  readonly onUpdateMessage?: (type: string, payload: Record<string, unknown>) => void;
  /** Optional update orchestrator for enriched status responses. */
  readonly updateOrchestrator?: import('./update-orchestrator.js').UpdateOrchestrator;
  /** Local git repo path for relay-side version checks (default: process.cwd()). */
  readonly localGitPath?: string;
  /** Current relay version (read from VERSION file). Exposed via GET /api/update/status. */
  readonly currentVersion?: string;
  /** Initial disclosure config loaded from file/env vars at startup. */
  readonly initialDisclosureConfig?: DisclosureConfig;
  /** Path to persist disclosure config. When set, PUT /api/disclosure writes to this file. */
  readonly disclosureConfigPath?: string;
  /** Callback to forward challenge config changes to AI client. Returns true if forwarded. */
  readonly onChallengeConfigUpdate?: (schedule: Record<string, unknown>, cooldowns: Record<string, unknown>) => boolean;
}

// ---------------------------------------------------------------------------
// AdminRoutes
// ---------------------------------------------------------------------------

/**
 * Admin API route handlers.
 *
 * Manages providers, capability matrices, and relay configuration.
 * All mutations generate audit log entries. MaliClaw Clause is
 * enforced on provider approval.
 *
 * Usage:
 *   1. Create: `const routes = new AdminRoutes(config)`
 *   2. Approve: `routes.approveProvider(id, name, by)`
 *   3. Enforce: `routes.checkCapability(providerId, messageType)`
 *   4. HTTP: `routes.handleRequest(req, res, adminUsername)`
 */
export class AdminRoutes {
  private readonly registry: ProviderRegistry;
  private readonly audit: AuditLogger;
  private readonly capabilities: Map<string, CapabilityMatrix>;
  /** Connection ID → Provider ID mapping for capability enforcement. */
  private readonly connectionProviders: Map<string, string>;
  private readonly statusProvider: RelayStatusProvider | null;
  private readonly extensionRegistry: import('../extensions/extension-registry.js').ExtensionRegistry | null;
  private readonly onDisclosureUpdate: ((config: DisclosureConfig) => void) | null;
  private readonly onUpdateMessage: ((type: string, payload: Record<string, unknown>) => void) | null;
  private readonly orchestrator: import('./update-orchestrator.js').UpdateOrchestrator | null;
  private readonly localGitPath: string;
  private readonly currentVersion: string;
  private readonly disclosureConfigPath: string | null;
  private readonly onChallengeConfigUpdate:
    | ((schedule: Record<string, unknown>, cooldowns: Record<string, unknown>) => boolean)
    | null;
  private disclosureConfig: DisclosureConfig;
  private updateStatus: UpdateStatus;
  /** Cached challenge status from AI client (updated via setChallengeStatus). */
  private challengeStatus: Record<string, unknown> | null;
  /** Last version check result (cached for admin UI display). */
  private lastCheckResult: Record<string, unknown> | null;

  constructor(config: AdminRoutesConfig) {
    this.registry = config.providerRegistry;
    this.audit = config.auditLogger;
    this.capabilities = new Map();
    this.connectionProviders = new Map();
    this.statusProvider = config.statusProvider ?? null;
    this.extensionRegistry = config.extensionRegistry ?? null;
    this.onDisclosureUpdate = config.onDisclosureUpdate ?? null;
    this.onUpdateMessage = config.onUpdateMessage ?? null;
    this.onChallengeConfigUpdate = config.onChallengeConfigUpdate ?? null;
    this.orchestrator = config.updateOrchestrator ?? null;
    this.localGitPath = config.localGitPath ?? process.cwd();
    this.currentVersion = config.currentVersion ?? 'unknown';
    this.disclosureConfigPath = config.disclosureConfigPath ?? null;
    this.updateStatus = { phase: 'idle', targetVersion: null, startedAt: null, component: null, error: null };
    this.challengeStatus = null;
    this.lastCheckResult = null;
    this.disclosureConfig = config.initialDisclosureConfig ?? {
      enabled: false,
      text: 'You are interacting with an AI system powered by {provider} ({model}).',
      style: 'info',
      position: 'banner',
      dismissible: true,
    };
  }

  // -------------------------------------------------------------------------
  // Disclosure config persistence
  // -------------------------------------------------------------------------

  /** Load disclosure config from a JSON file. Returns null if file doesn't exist or is invalid. */
  static loadDisclosureConfig(path: string): DisclosureConfig | null {
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      if (typeof data.enabled === 'boolean' && typeof data.text === 'string') {
        return {
          enabled: data.enabled,
          text: data.text,
          style: ['info', 'legal', 'warning'].includes(data.style) ? data.style : 'info',
          position: ['banner', 'footer'].includes(data.position) ? data.position : 'banner',
          dismissible: typeof data.dismissible === 'boolean' ? data.dismissible : true,
          link: typeof data.link === 'string' ? data.link : undefined,
          linkText: typeof data.linkText === 'string' ? data.linkText : undefined,
          jurisdiction: typeof data.jurisdiction === 'string' ? data.jurisdiction : undefined,
        };
      }
    } catch {
      // File doesn't exist or is invalid — not configured yet
    }
    return null;
  }

  /** Persist the current disclosure config to the configured file path. */
  private persistDisclosureConfig(savedBy: string): void {
    if (!this.disclosureConfigPath) return;
    try {
      const data = {
        ...this.disclosureConfig,
        savedAt: new Date().toISOString(),
        savedBy,
      };
      writeFileSync(this.disclosureConfigPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[!] Failed to persist disclosure config: ${msg}`);
    }
  }

  /** Number of providers with custom capability matrices. */
  get capabilityCount(): number {
    return this.capabilities.size;
  }

  // -------------------------------------------------------------------------
  // Provider CRUD
  // -------------------------------------------------------------------------

  /** List all providers (optionally filter to active only). */
  listProviders(includeInactive = true): ApiResponse {
    const providers = includeInactive ? this.registry.getAllProviders() : this.registry.getActiveProviders();

    return {
      status: 200,
      body: {
        providers: providers.map((p) => ({
          ...p,
          capabilityMatrix: this.capabilities.get(p.id) ?? defaultCapabilityMatrix(),
        })),
        total: providers.length,
      },
    };
  }

  /** Get a single provider by ID. */
  getProvider(id: string): ApiResponse {
    const provider = this.registry.getProvider(id);
    if (!provider) {
      return { status: 404, body: { error: 'Provider not found', providerId: id } };
    }
    return {
      status: 200,
      body: {
        ...provider,
        capabilityMatrix: this.capabilities.get(id) ?? defaultCapabilityMatrix(),
      },
    };
  }

  /**
   * Approve a new AI provider.
   *
   * MaliClaw Clause: blocked identifiers cannot be approved.
   * Creates an audit log entry on success or MaliClaw rejection.
   */
  approveProvider(
    id: string,
    name: string,
    approvedBy: string,
    capabilities?: readonly string[],
    matrix?: CapabilityMatrix,
  ): ApiResponse {
    // MaliClaw Clause — check before any action
    if (Allowlist.isMaliClawMatch(id) || Allowlist.isMaliClawMatch(name)) {
      this.audit.logEvent(AUDIT_EVENT_TYPES.MALICLAW_REJECTED, 'admin', {
        action: 'approve_provider',
        providerId: id,
        providerName: name,
        detail: 'MaliClaw Clause: blocked identity cannot be approved as provider',
      });
      return {
        status: 403,
        body: {
          error: 'MaliClaw Clause: this identity is permanently blocked',
          code: 'BASTION-1003',
        },
      };
    }

    const provider = ProviderRegistry.createProvider(id, name, approvedBy, capabilities ?? []);
    this.registry.addProvider(provider);

    if (matrix) {
      this.capabilities.set(id, matrix);
    }

    this.audit.logEvent(AUDIT_EVENT_TYPES.PROVIDER_APPROVED, 'admin', {
      providerId: id,
      providerName: name,
      approvedBy,
      capabilities: [...(capabilities ?? [])],
    });

    return {
      status: 201,
      body: {
        ...provider,
        capabilityMatrix: this.capabilities.get(id) ?? defaultCapabilityMatrix(),
      },
    };
  }

  /**
   * Revoke (soft-delete) a provider.
   *
   * Deactivates the provider but preserves the record for audit.
   */
  revokeProvider(id: string, revokedBy: string): ApiResponse {
    const provider = this.registry.getProvider(id);
    if (!provider) {
      return { status: 404, body: { error: 'Provider not found', providerId: id } };
    }

    this.registry.deactivateProvider(id);

    this.audit.logEvent(AUDIT_EVENT_TYPES.PROVIDER_DEACTIVATED, 'admin', {
      providerId: id,
      providerName: provider.name,
      revokedBy,
    });

    const updated = this.registry.getProvider(id)!;
    return {
      status: 200,
      body: {
        ...updated,
        capabilityMatrix: this.capabilities.get(id) ?? defaultCapabilityMatrix(),
      },
    };
  }

  /** Reactivate a previously revoked provider. */
  activateProvider(id: string, activatedBy: string): ApiResponse {
    const provider = this.registry.getProvider(id);
    if (!provider) {
      return { status: 404, body: { error: 'Provider not found', providerId: id } };
    }

    this.registry.addProvider({ ...provider, active: true });

    this.audit.logEvent(AUDIT_EVENT_TYPES.PROVIDER_APPROVED, 'admin', {
      providerId: id,
      providerName: provider.name,
      activatedBy,
      reactivation: true,
    });

    const updated = this.registry.getProvider(id)!;
    return {
      status: 200,
      body: {
        ...updated,
        capabilityMatrix: this.capabilities.get(id) ?? defaultCapabilityMatrix(),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Capability Matrix
  // -------------------------------------------------------------------------

  /** Get the capability matrix for a provider. */
  getCapabilities(providerId: string): ApiResponse {
    const provider = this.registry.getProvider(providerId);
    if (!provider) {
      return { status: 404, body: { error: 'Provider not found', providerId } };
    }
    return {
      status: 200,
      body: {
        providerId,
        matrix: this.capabilities.get(providerId) ?? defaultCapabilityMatrix(),
      },
    };
  }

  /** Set the capability matrix for a provider. */
  setCapabilities(providerId: string, matrix: CapabilityMatrix, changedBy: string): ApiResponse {
    const provider = this.registry.getProvider(providerId);
    if (!provider) {
      return { status: 404, body: { error: 'Provider not found', providerId } };
    }

    this.capabilities.set(providerId, matrix);

    this.audit.logConfigChange('admin', {
      changeType: 'capability_matrix_update',
      changedBy,
      providerId,
      allowedMessageTypes: [...matrix.allowedMessageTypes],
      fileTransfer: { ...matrix.fileTransfer },
      maxConcurrentTasks: matrix.maxConcurrentTasks,
    });

    return {
      status: 200,
      body: { providerId, matrix },
    };
  }

  /** Get the raw capability matrix object (for routing integration). */
  getCapabilityMatrix(providerId: string): CapabilityMatrix {
    return this.capabilities.get(providerId) ?? defaultCapabilityMatrix();
  }

  // -------------------------------------------------------------------------
  // Audit Query
  // -------------------------------------------------------------------------

  /** Query audit events with filters. */
  queryAudit(filters: {
    startTime?: string;
    endTime?: string;
    eventType?: string;
    sessionId?: string;
    limit?: number;
    offset?: number;
  }): ApiResponse {
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const entries = this.audit.query({
      startTime: filters.startTime,
      endTime: filters.endTime,
      eventType: filters.eventType,
      sessionId: filters.sessionId,
      limit,
      offset,
    });

    const totalCount = this.audit.count({
      startTime: filters.startTime,
      endTime: filters.endTime,
      eventType: filters.eventType,
      sessionId: filters.sessionId,
    });

    return {
      status: 200,
      body: {
        entries: entries.map((e) => ({
          index: e.index,
          timestamp: e.timestamp,
          eventType: e.eventType,
          sessionId: e.sessionId,
          detail: typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail,
          chainHash: e.chainHash,
        })),
        totalCount,
        page: Math.floor(offset / limit),
        pageSize: limit,
        hasMore: offset + entries.length < totalCount,
      },
    };
  }

  /** Get chain integrity status. */
  getChainIntegrity(): ApiResponse {
    const chain = this.audit.getChain();
    const totalEntries = chain.length;

    // Verify chain by checking hash linkage
    let chainValid = true;
    for (let i = 1; i < chain.length; i++) {
      if (!chain[i]!.chainHash || chain[i]!.chainHash.length === 0) {
        chainValid = false;
        break;
      }
    }

    return {
      status: 200,
      body: {
        totalEntries,
        chainValid,
        lastVerifiedAt: new Date().toISOString(),
        lastHash: chain.length > 0 ? chain[chain.length - 1]!.chainHash : null,
        genesisHash: chain.length > 0 ? chain[0]!.chainHash : null,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Live Status
  // -------------------------------------------------------------------------

  /** Get live relay status (connections, sessions, throughput, quarantine). */
  getStatus(): ApiResponse {
    if (!this.statusProvider) {
      return {
        status: 200,
        body: {
          connectedClients: { total: 0, human: 0, ai: 0, unknown: 0 },
          activeSessions: 0,
          messagesPerMinute: 0,
          quarantine: { active: 0, capacity: 100 },
        },
      };
    }

    const conns = this.statusProvider.getConnections();
    const human = conns.filter((c) => c.clientType === 'human').length;
    const ai = conns.filter((c) => c.clientType === 'ai').length;
    const unknown = conns.filter((c) => c.clientType === 'unknown').length;

    const cumulative = this.statusProvider.getCumulativeStats?.() ?? null;
    return {
      status: 200,
      body: {
        connectedClients: { total: conns.length, human, ai, unknown },
        activeSessions: this.statusProvider.getActiveSessionCount(),
        messagesPerMinute: this.statusProvider.getMessagesPerMinute(),
        quarantine: this.statusProvider.getQuarantineStatus(),
        ...(cumulative ? { session: cumulative.session, allTime: cumulative.allTime } : {}),
      },
    };
  }

  /** Get all active connections with metadata. */
  getConnectionsList(): ApiResponse {
    if (!this.statusProvider) {
      return { status: 200, body: { connections: [], total: 0 } };
    }

    const connections = this.statusProvider.getConnections();
    return {
      status: 200,
      body: {
        connections,
        total: connections.length,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Capability Enforcement (relay routing integration)
  // -------------------------------------------------------------------------

  /**
   * Register a connection's provider mapping.
   * Called when an AI client authenticates with a providerId.
   */
  registerConnection(connectionId: string, providerId: string): void {
    this.connectionProviders.set(connectionId, providerId);
  }

  /** Unregister a connection's provider mapping. */
  unregisterConnection(connectionId: string): void {
    this.connectionProviders.delete(connectionId);
  }

  /** Get the provider ID for a connection. */
  getConnectionProvider(connectionId: string): string | undefined {
    return this.connectionProviders.get(connectionId);
  }

  /**
   * Check whether a provider is allowed to send a given message type.
   *
   * @param providerId — the provider to check
   * @param messageType — the message type being sent
   * @returns allowed/denied with reason
   */
  checkCapability(providerId: string, messageType: string): { allowed: boolean; reason?: string } {
    const provider = this.registry.getProvider(providerId);
    if (!provider) {
      return { allowed: false, reason: 'provider_not_found' };
    }
    if (!provider.active) {
      return { allowed: false, reason: 'provider_inactive' };
    }

    const matrix = this.capabilities.get(providerId) ?? defaultCapabilityMatrix();
    if (!matrix.allowedMessageTypes.includes(messageType)) {
      return { allowed: false, reason: `message_type_not_allowed: ${messageType}` };
    }

    return { allowed: true };
  }

  /**
   * Check whether a provider is allowed to perform a file transfer.
   *
   * @param providerId — the provider to check
   * @param direction — 'send' or 'receive'
   * @param sizeBytes — file size (optional)
   * @param mimeType — MIME type (optional)
   * @returns allowed/denied with reason
   */
  checkFileTransfer(
    providerId: string,
    direction: 'send' | 'receive',
    sizeBytes?: number,
    mimeType?: string,
  ): { allowed: boolean; reason?: string } {
    const provider = this.registry.getProvider(providerId);
    if (!provider || !provider.active) {
      return { allowed: false, reason: 'provider_not_found_or_inactive' };
    }

    const matrix = this.capabilities.get(providerId) ?? defaultCapabilityMatrix();
    const ft = matrix.fileTransfer;

    if (direction === 'send' && !ft.canSend) {
      return { allowed: false, reason: 'file_send_not_permitted' };
    }
    if (direction === 'receive' && !ft.canReceive) {
      return { allowed: false, reason: 'file_receive_not_permitted' };
    }
    if (sizeBytes !== undefined && sizeBytes > ft.maxFileSizeBytes) {
      return { allowed: false, reason: `file_too_large: ${sizeBytes} > ${ft.maxFileSizeBytes}` };
    }
    if (mimeType !== undefined && !ft.allowedMimeTypes.includes('*/*') && !ft.allowedMimeTypes.includes(mimeType)) {
      return { allowed: false, reason: `mime_type_not_allowed: ${mimeType}` };
    }

    return { allowed: true };
  }

  /**
   * Create a capability check function for the MessageRouter.
   *
   * Returns a function that maps connectionId → providerId → capability check.
   * Pass this to RouterConfig.capabilityCheck.
   */
  createCapabilityCheck(): (senderConnectionId: string, messageType: string) => { allowed: boolean; reason?: string } {
    return (senderConnectionId: string, messageType: string) => {
      const providerId = this.connectionProviders.get(senderConnectionId);
      if (!providerId) {
        // No provider mapping — allow (human clients don't have providers)
        return { allowed: true };
      }
      return this.checkCapability(providerId, messageType);
    };
  }

  // -------------------------------------------------------------------------
  // Self-Update System
  // -------------------------------------------------------------------------

  /**
   * Trigger a version check.
   *
   * If update agents are connected, sends update_check to the first agent.
   * If no agents are connected, runs a local git fetch + comparison on the
   * relay's own repo (since the relay process has access to the git checkout).
   */
  triggerUpdateCheck(repo: string, currentVersion: string, adminUsername: string): ApiResponse {
    if (
      this.updateStatus.phase !== 'idle' &&
      this.updateStatus.phase !== 'complete' &&
      this.updateStatus.phase !== 'failed'
    ) {
      return { status: 409, body: { error: 'Update already in progress', phase: this.updateStatus.phase } };
    }

    this.updateStatus = {
      phase: 'checking',
      targetVersion: null,
      startedAt: new Date().toISOString(),
      component: null,
      error: null,
    };

    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_CHECK_INITIATED, 'admin', {
      repo,
      currentVersion,
      triggeredBy: adminUsername,
    });

    // Try via connected agent first
    const hasAgents = this.orchestrator && this.orchestrator.connectedAgentCount > 0;
    if (hasAgents && this.onUpdateMessage) {
      this.onUpdateMessage('update_check', { source: 'github', repo, currentVersion });
      return { status: 200, body: { status: 'checking', method: 'agent', repo, currentVersion } };
    }

    // No agents connected — run local git check on the relay's repo
    return this.localVersionCheck(currentVersion);
  }

  /** Run git fetch + log locally to check for available updates. */
  private localVersionCheck(currentVersion: string): ApiResponse {
    try {
      execSync(`git -C ${this.localGitPath} fetch --quiet 2>/dev/null`, {
        timeout: 30_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // fetch failed — maybe offline, check local state anyway
    }

    try {
      const ahead = execSync(`git -C ${this.localGitPath} log HEAD..origin/main --oneline 2>/dev/null`, {
        timeout: 10_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      if (!ahead) {
        this.updateStatus = { phase: 'idle', targetVersion: null, startedAt: null, component: null, error: null };
        return { status: 200, body: { status: 'up_to_date', currentVersion, method: 'local_git' } };
      }

      const commits = ahead.split('\n').filter((l) => l.length > 0);
      const latestHash = commits[0]?.split(' ')[0] ?? 'unknown';

      // Try to read the remote VERSION file
      let remoteVersion = 'unknown';
      try {
        remoteVersion = execSync(`git -C ${this.localGitPath} show origin/main:VERSION 2>/dev/null`, {
          timeout: 5_000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {
        // VERSION file may not exist in remote — use commit count as indicator
        remoteVersion = `${currentVersion}+${commits.length}`;
      }

      this.updateStatus.targetVersion = remoteVersion;

      return {
        status: 200,
        body: {
          status: 'update_available',
          method: 'local_git',
          currentVersion,
          availableVersion: remoteVersion,
          commitHash: latestHash,
          changelog: commits.map((c) => c.replace(/^[a-f0-9]+ /, '')),
          commitCount: commits.length,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.updateStatus = { phase: 'failed', targetVersion: null, startedAt: null, component: null, error: msg };
      return { status: 500, body: { status: 'error', error: `Local git check failed: ${msg}`, method: 'local_git' } };
    }
  }

  /** Trigger an update execution sequence via the connected updater client. */
  triggerUpdateExecute(
    targetComponent: string,
    version: string,
    commitHash: string,
    commands: readonly Record<string, unknown>[],
    adminUsername: string,
  ): ApiResponse {
    if (
      this.updateStatus.phase !== 'idle' &&
      this.updateStatus.phase !== 'checking' &&
      this.updateStatus.phase !== 'complete' &&
      this.updateStatus.phase !== 'failed'
    ) {
      return { status: 409, body: { error: 'Update already in progress', phase: this.updateStatus.phase } };
    }

    this.updateStatus = {
      phase: 'building',
      targetVersion: version,
      startedAt: new Date().toISOString(),
      component: targetComponent,
      error: null,
    };

    if (this.onUpdateMessage) {
      this.onUpdateMessage('update_execute', { targetComponent, commands, version, commitHash });
    }

    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_BUILD_STARTED, 'admin', {
      targetComponent,
      version,
      commitHash,
      triggeredBy: adminUsername,
    });

    return { status: 200, body: { status: 'building', targetComponent, version } };
  }

  /** Cache the last version check result for admin UI display. */
  setCheckResult(result: Record<string, unknown>): void {
    this.lastCheckResult = { ...result, cachedAt: new Date().toISOString() };
  }

  /** Get the current update status, enriched with orchestrator data + last check result. */
  getUpdateStatus(): ApiResponse {
    const orchStatus = this.orchestrator?.getStatus();
    return {
      status: 200,
      body: {
        ...this.updateStatus,
        currentVersion: this.currentVersion,
        checkResult: this.lastCheckResult,
        agents: orchStatus?.agents ?? [],
        prepareAcks: orchStatus?.prepareAcks ?? [],
        buildResults: orchStatus?.buildResults ?? {},
        reconnections: orchStatus?.reconnections ?? [],
        expectedComponents: orchStatus?.expectedComponents ?? [],
        warnings: orchStatus?.warnings ?? [],
      },
    };
  }

  /** Cancel an in-progress update. */
  cancelUpdate(adminUsername: string): ApiResponse {
    if (this.updateStatus.phase === 'idle') {
      return { status: 400, body: { error: 'No update in progress' } };
    }

    const previousPhase = this.updateStatus.phase;
    this.updateStatus = { phase: 'idle', targetVersion: null, startedAt: null, component: null, error: null };

    // Cancel the orchestrator too — otherwise it continues its lifecycle unaware
    if (this.orchestrator) {
      this.orchestrator.cancel();
    }

    this.audit.logEvent(AUDIT_EVENT_TYPES.UPDATE_FAILED, 'admin', {
      reason: 'cancelled_by_admin',
      previousPhase,
      cancelledBy: adminUsername,
    });

    return { status: 200, body: { status: 'cancelled', previousPhase } };
  }

  /** Update the internal update status (called by relay when receiving update messages from updater). */
  setUpdateStatus(phase: UpdatePhase, detail?: { targetVersion?: string; component?: string; error?: string }): void {
    this.updateStatus.phase = phase;
    if (detail?.targetVersion !== undefined) this.updateStatus.targetVersion = detail.targetVersion;
    if (detail?.component !== undefined) this.updateStatus.component = detail.component;
    if (detail?.error !== undefined) this.updateStatus.error = detail.error;
  }

  /** Cache the latest challenge status from AI client (called by relay on challenge_status messages). */
  setChallengeStatus(status: Record<string, unknown>): void {
    this.challengeStatus = { ...status, cachedAt: new Date().toISOString() };
  }

  // -------------------------------------------------------------------------
  // HTTP request handling
  // -------------------------------------------------------------------------

  /**
   * Handle an incoming HTTP request.
   *
   * Routes the request to the appropriate handler based on method + path.
   * The adminUsername is from the authenticated admin session.
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse, adminUsername: string): Promise<void> {
    const url = new URL(req.url ?? '/', `https://${req.headers.host ?? 'localhost'}`);
    const method = req.method?.toUpperCase() ?? 'GET';
    const path = url.pathname;

    try {
      let result: ApiResponse;

      if (method === 'GET' && path === '/api/health') {
        result = {
          status: 200,
          body: { status: 'ok', timestamp: new Date().toISOString() },
        };
      } else if (method === 'GET' && path === '/api/providers') {
        const includeInactive = url.searchParams.get('includeInactive') !== 'false';
        result = this.listProviders(includeInactive);
      } else if (method === 'GET' && /^\/api\/providers\/[^/]+$/.test(path)) {
        const id = decodeURIComponent(path.split('/')[3]!);
        result = this.getProvider(id);
      } else if (method === 'POST' && path === '/api/providers') {
        const body = await readJsonBody(req);
        if (!body.id || !body.name) {
          result = { status: 400, body: { error: 'Missing required fields: id, name' } };
        } else {
          result = this.approveProvider(body.id, body.name, adminUsername, body.capabilities, body.capabilityMatrix);
        }
      } else if (method === 'PUT' && /^\/api\/providers\/[^/]+\/revoke$/.test(path)) {
        const id = decodeURIComponent(path.split('/')[3]!);
        result = this.revokeProvider(id, adminUsername);
      } else if (method === 'PUT' && /^\/api\/providers\/[^/]+\/activate$/.test(path)) {
        const id = decodeURIComponent(path.split('/')[3]!);
        result = this.activateProvider(id, adminUsername);
      } else if (method === 'GET' && /^\/api\/providers\/[^/]+\/capabilities$/.test(path)) {
        const id = decodeURIComponent(path.split('/')[3]!);
        result = this.getCapabilities(id);
      } else if (method === 'PUT' && /^\/api\/providers\/[^/]+\/capabilities$/.test(path)) {
        const id = decodeURIComponent(path.split('/')[3]!);
        const body = await readJsonBody(req);
        if (!body.matrix) {
          result = { status: 400, body: { error: 'Missing required field: matrix' } };
        } else {
          result = this.setCapabilities(id, body.matrix, adminUsername);
        }
      } else if (method === 'GET' && path === '/api/status') {
        result = this.getStatus();
      } else if (method === 'GET' && path === '/api/connections') {
        result = this.getConnectionsList();
      } else if (method === 'GET' && path === '/api/audit') {
        result = this.queryAudit({
          startTime: url.searchParams.get('startTime') ?? undefined,
          endTime: url.searchParams.get('endTime') ?? undefined,
          eventType: url.searchParams.get('eventType') ?? undefined,
          sessionId: url.searchParams.get('sessionId') ?? undefined,
          limit: url.searchParams.has('limit') ? Number.parseInt(url.searchParams.get('limit')!, 10) : undefined,
          offset: url.searchParams.has('offset') ? Number.parseInt(url.searchParams.get('offset')!, 10) : undefined,
        });
      } else if (method === 'GET' && path === '/api/audit/integrity') {
        result = this.getChainIntegrity();
      } else if (method === 'GET' && path === '/api/tools') {
        // Tool registry — read from config file if it exists
        result = {
          status: 200,
          body: { providers: [], totalTools: 0, message: 'Tool registry configured via tools.json' },
        };
      } else if (method === 'GET' && path === '/api/extensions') {
        const exts = this.extensionRegistry?.getAllExtensions() ?? [];
        result = {
          status: 200,
          body: {
            extensions: exts.map((e) => ({
              namespace: e.namespace,
              name: e.name,
              version: e.version,
              description: e.description,
              author: e.author,
              messageTypeCount: e.messageTypes.length,
            })),
            totalCount: exts.length,
          },
        };
      } else if (method === 'GET' && /^\/api\/extensions\/[^/]+$/.test(path)) {
        const ns = decodeURIComponent(path.split('/')[3]!);
        const ext = this.extensionRegistry?.getExtension(ns);
        result = ext
          ? { status: 200, body: { ...ext } as Record<string, unknown> }
          : { status: 404, body: { error: 'Extension not found', namespace: ns } };
      } else if (method === 'GET' && path === '/api/disclosure') {
        result = { status: 200, body: { ...this.disclosureConfig } };
      } else if (method === 'POST' && path === '/api/update/check') {
        const body = await readJsonBody(req);
        if (!body.repo || !body.currentVersion) {
          result = { status: 400, body: { error: 'Missing required fields: repo, currentVersion' } };
        } else {
          result = this.triggerUpdateCheck(body.repo, body.currentVersion, adminUsername);
        }
      } else if (method === 'POST' && path === '/api/update/execute') {
        const body = await readJsonBody(req);
        if (!body.targetComponent || !body.version || !body.commitHash || !body.commands) {
          result = {
            status: 400,
            body: { error: 'Missing required fields: targetComponent, version, commitHash, commands' },
          };
        } else {
          result = this.triggerUpdateExecute(
            body.targetComponent,
            body.version,
            body.commitHash,
            body.commands,
            adminUsername,
          );
        }
      } else if (method === 'GET' && path === '/api/update/status') {
        result = this.getUpdateStatus();
      } else if (method === 'POST' && path === '/api/update/cancel') {
        result = this.cancelUpdate(adminUsername);
      } else if (method === 'PUT' && path === '/api/disclosure') {
        const body = await readJsonBody(req);
        const updated: DisclosureConfig = {
          enabled: typeof body.enabled === 'boolean' ? body.enabled : this.disclosureConfig.enabled,
          text: typeof body.text === 'string' && body.text.length > 0 ? body.text : this.disclosureConfig.text,
          style: ['info', 'legal', 'warning'].includes(body.style) ? body.style : this.disclosureConfig.style,
          position: ['banner', 'footer'].includes(body.position) ? body.position : this.disclosureConfig.position,
          dismissible: typeof body.dismissible === 'boolean' ? body.dismissible : this.disclosureConfig.dismissible,
        };
        if (typeof body.link === 'string') updated.link = body.link || undefined;
        if (typeof body.linkText === 'string') updated.linkText = body.linkText || undefined;
        if (typeof body.jurisdiction === 'string') updated.jurisdiction = body.jurisdiction || undefined;
        this.disclosureConfig = updated;
        this.persistDisclosureConfig(adminUsername);
        this.audit.logEvent(AUDIT_EVENT_TYPES.CONFIG_CHANGE, 'admin', {
          changeType: 'disclosure_config',
          changedBy: adminUsername,
          enabled: updated.enabled,
          jurisdiction: updated.jurisdiction ?? null,
        });
        if (this.onDisclosureUpdate) this.onDisclosureUpdate(updated);
        result = { status: 200, body: { ...updated, saved: true } };
      } else if (method === 'GET' && path === '/api/challenge') {
        // Return cached challenge status from AI client
        if (this.challengeStatus) {
          result = { status: 200, body: this.challengeStatus };
        } else {
          result = { status: 200, body: { active: false, note: 'No challenge status received from AI client yet' } };
        }
      } else if (method === 'PUT' && path === '/api/challenge') {
        const body = await readJsonBody(req);
        // Safety floor: Challenge Me More cannot be disabled
        if (body.enabled === false) {
          result = { status: 400, body: { error: 'Challenge Me More cannot be disabled — safety floor enforced' } };
        } else if (!body.schedule || !body.cooldowns) {
          result = { status: 400, body: { error: 'Missing required fields: schedule, cooldowns' } };
        } else if (this.challengeStatus && this.challengeStatus.active === true) {
          result = { status: 409, body: { error: 'Cannot modify challenge config during active challenge hours' } };
        } else if (this.onChallengeConfigUpdate) {
          const forwarded = this.onChallengeConfigUpdate(body.schedule, body.cooldowns);
          if (forwarded) {
            this.audit.logEvent(AUDIT_EVENT_TYPES.CONFIG_CHANGE, 'admin', {
              changeType: 'challenge_config',
              changedBy: adminUsername,
            });
            result = {
              status: 200,
              body: { forwarded: true, note: 'Challenge config forwarded to AI client — await challenge_config_ack' },
            };
          } else {
            result = { status: 503, body: { error: 'No AI client connected to forward challenge config' } };
          }
        } else {
          result = { status: 503, body: { error: 'Challenge config forwarding not available' } };
        }
      } else {
        result = { status: 404, body: { error: 'Not found', path, method } };
      }

      sendJson(res, result.status, result.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: 'Internal server error', detail: message });
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP Utilities
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json).toString(),
  });
  res.end(json);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readJsonBody(req: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString();
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}
