// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Data service — bridges the admin API client to the UI stores.
 *
 * Provides polling and one-shot fetch methods that call the API
 * and pipe results into the appropriate store mutations.
 * All errors are surfaced in the store's error field.
 */

import type { ConfigStore } from '../stores/config.js';
import type { ConnectionsStore } from '../stores/connections.js';
import type { OverviewStore } from '../stores/overview.js';
import type { ProvidersStore } from '../stores/providers.js';
import type { AuditEventSummary, CapabilityMatrix, ConnectionEntry } from '../types.js';
import type { AdminApiClient } from './admin-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataServiceConfig {
  readonly client: AdminApiClient;
  readonly statusIntervalMs?: number;
  readonly connectionsIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// DataService
// ---------------------------------------------------------------------------

export class DataService {
  readonly client: AdminApiClient;
  private readonly statusIntervalMs: number;
  private readonly connectionsIntervalMs: number;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private connectionsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: DataServiceConfig) {
    this.client = config.client;
    this.statusIntervalMs = config.statusIntervalMs ?? 5_000;
    this.connectionsIntervalMs = config.connectionsIntervalMs ?? 10_000;
  }

  // -----------------------------------------------------------------------
  // Overview polling
  // -----------------------------------------------------------------------

  /** Fetch status once and populate the overview store. Returns false on auth failure. */
  async fetchStatus(store: OverviewStore): Promise<boolean> {
    // Only show loading spinner on first fetch, not on poll refreshes
    const isFirstFetch = store.store.get().lastUpdated === null;
    if (isFirstFetch) store.setLoading(true);
    const result = await this.client.getStatus();
    if (result.ok) {
      const d = result.data as Record<string, unknown>;
      const cc = d.connectedClients as { total: number; human: number; ai: number; unknown: number };
      store.setClients(cc?.total ?? 0);
      store.setSessions((d.activeSessions as number) ?? 0);
      store.setThroughput({ total: 0, perMinute: (d.messagesPerMinute as number) ?? 0 });
      const q = d.quarantine as { active: number; capacity: number } | undefined;
      store.setQuarantine({ count: q?.active ?? 0, maxEntries: q?.capacity ?? 100, oldestAge: null });
      // Persistent stats (session + all-time)
      if (d.session) {
        const s = d.session as {
          messagesRouted: number;
          connectionsServed: number;
          sessionsCreated: number;
          fileTransfers: number;
          uptimeSeconds: number;
          startedAt: string;
        };
        store.setSessionStats(s);
      }
      if (d.allTime) {
        const a = d.allTime as {
          totalMessagesRouted: number;
          totalConnectionsServed: number;
          totalSessionsCreated: number;
          totalFileTransfers: number;
          firstStartedAt: string;
        };
        store.setAllTimeStats(a);
      }
      store.setError(null);
      store.setLoading(false);
      return true;
    }
    store.setError(result.error ?? 'Failed to fetch status');
    store.setLoading(false);
    // Stop polling on auth failure — don't retry endlessly
    if (result.status === 401 || result.status === 403) {
      this.stopStatusPolling();
    }
    return false;
  }

  /** Fetch recent audit events and populate the overview store. */
  async fetchAuditEvents(store: OverviewStore): Promise<void> {
    const result = await this.client.queryAudit({ limit: 50 });
    if (result.ok) {
      const d = result.data as { entries: AuditEventSummary[] };
      store.setAuditEvents(d.entries ?? []);
    }
  }

  /** Start polling status for the overview store. */
  startStatusPolling(store: OverviewStore): void {
    this.stopStatusPolling();
    this.fetchStatus(store);
    this.fetchAuditEvents(store);
    this.statusTimer = setInterval(() => {
      this.fetchStatus(store);
      this.fetchAuditEvents(store);
    }, this.statusIntervalMs);
  }

  /** Stop polling status. */
  stopStatusPolling(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Connections polling
  // -----------------------------------------------------------------------

  /** Fetch connections once and populate the connections store. */
  async fetchConnections(store: ConnectionsStore): Promise<void> {
    const isFirstFetch = store.store.get().connections.length === 0 && !store.store.get().error;
    if (isFirstFetch) store.setLoading(true);
    const result = await this.client.getConnections();
    if (result.ok) {
      const d = result.data as { connections: ConnectionEntry[]; total: number };
      store.setConnections(d.connections ?? []);
      store.setError(null);
    } else {
      store.setError(result.error ?? 'Failed to fetch connections');
      if (result.status === 401 || result.status === 403) {
        this.stopConnectionsPolling();
      }
    }
    store.setLoading(false);
  }

  /** Start polling connections. */
  startConnectionsPolling(store: ConnectionsStore): void {
    this.stopConnectionsPolling();
    this.fetchConnections(store);
    this.connectionsTimer = setInterval(() => {
      this.fetchConnections(store);
    }, this.connectionsIntervalMs);
  }

  /** Stop polling connections. */
  stopConnectionsPolling(): void {
    if (this.connectionsTimer) {
      clearInterval(this.connectionsTimer);
      this.connectionsTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Providers
  // -----------------------------------------------------------------------

  /** Fetch all providers and populate the providers store. */
  async fetchProviders(store: ProvidersStore): Promise<void> {
    store.setLoading(true);
    const result = await this.client.listProviders(true);
    if (result.ok) {
      const d = result.data as { providers: Array<Record<string, unknown>>; total: number };
      const providers = (d.providers ?? []).map((p) => ({
        id: p.id as string,
        name: p.name as string,
        approvedAt: (p.approvedAt as string) ?? '',
        approvedBy: (p.approvedBy as string) ?? '',
        capabilities: (p.capabilities as string[]) ?? [],
        active: (p.active as boolean) ?? true,
        capabilityMatrix: (p.capabilityMatrix as CapabilityMatrix) ?? undefined,
      }));
      store.setProviders(providers);
      store.setError(null);
    } else {
      store.setError(result.error ?? 'Failed to fetch providers');
    }
    store.setLoading(false);
  }

  /** Approve a new provider via the API. */
  async approveProvider(
    store: ProvidersStore,
    id: string,
    name: string,
    capabilities?: string[],
    matrix?: CapabilityMatrix,
  ): Promise<boolean> {
    const result = await this.client.approveProvider(id, name, capabilities, matrix);
    if (result.ok) {
      await this.fetchProviders(store);
      return true;
    }
    store.setError(result.error ?? 'Failed to approve provider');
    return false;
  }

  /** Revoke a provider via the API. */
  async revokeProvider(store: ProvidersStore, id: string): Promise<boolean> {
    const result = await this.client.revokeProvider(id);
    if (result.ok) {
      await this.fetchProviders(store);
      return true;
    }
    store.setError(result.error ?? 'Failed to revoke provider');
    return false;
  }

  /** Activate a provider via the API. */
  async activateProvider(store: ProvidersStore, id: string): Promise<boolean> {
    const result = await this.client.activateProvider(id);
    if (result.ok) {
      await this.fetchProviders(store);
      return true;
    }
    store.setError(result.error ?? 'Failed to activate provider');
    return false;
  }

  // -----------------------------------------------------------------------
  // Config
  // -----------------------------------------------------------------------

  /** Fetch config/integrity and populate the config store. */
  async fetchConfig(store: ConfigStore): Promise<void> {
    store.setLoading(true);
    const integrityResult = await this.client.getChainIntegrity();
    if (integrityResult.ok) {
      const d = integrityResult.data as Record<string, unknown>;
      store.setAuditChainIntegrity({
        totalEntries: (d.totalEntries as number) ?? 0,
        lastVerifiedAt: (d.lastVerifiedAt as string) ?? null,
        chainValid: (d.chainValid as boolean) ?? false,
        genesisHash: (d.genesisHash as string) ?? '',
        lastHash: (d.lastHash as string) ?? '',
      });
      store.setError(null);
    } else {
      store.setError(integrityResult.error ?? 'Failed to fetch config');
    }
    store.setLoading(false);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Stop all polling. */
  destroy(): void {
    this.stopStatusPolling();
    this.stopConnectionsPolling();
  }
}
