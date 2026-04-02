// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Overview dashboard store.
 *
 * Aggregates relay health metrics: connected clients, active sessions,
 * message throughput, quarantine status, and recent audit events.
 */

import { type Readable, type Writable, derived, writable } from '../store.js';
import type { AuditEventSummary, QuarantineStatusSummary, ThroughputMetrics } from '../types.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface SessionStats {
  readonly messagesRouted: number;
  readonly connectionsServed: number;
  readonly sessionsCreated: number;
  readonly fileTransfers: number;
  readonly uptimeSeconds: number;
  readonly startedAt: string;
}

export interface AllTimeStats {
  readonly totalMessagesRouted: number;
  readonly totalConnectionsServed: number;
  readonly totalSessionsCreated: number;
  readonly totalFileTransfers: number;
  readonly firstStartedAt: string;
}

export interface OverviewState {
  readonly connectedClients: number;
  readonly activeSessions: number;
  readonly throughput: ThroughputMetrics;
  readonly quarantine: QuarantineStatusSummary;
  readonly recentAuditEvents: readonly AuditEventSummary[];
  readonly sessionStats: SessionStats | null;
  readonly allTimeStats: AllTimeStats | null;
  readonly lastUpdated: string | null;
  readonly loading: boolean;
  readonly error: string | null;
}

function initialState(): OverviewState {
  return {
    connectedClients: 0,
    activeSessions: 0,
    throughput: { total: 0, perMinute: 0 },
    quarantine: { count: 0, maxEntries: 100, oldestAge: null },
    recentAuditEvents: [],
    sessionStats: null,
    allTimeStats: null,
    lastUpdated: null,
    loading: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface OverviewStore {
  readonly store: Writable<OverviewState>;
  readonly healthStatus: Readable<'healthy' | 'degraded' | 'critical'>;
  readonly quarantineUtilisation: Readable<number>;
  setClients(count: number): void;
  setSessions(count: number): void;
  setThroughput(metrics: ThroughputMetrics): void;
  setQuarantine(status: QuarantineStatusSummary): void;
  addAuditEvent(event: AuditEventSummary): void;
  setAuditEvents(events: readonly AuditEventSummary[]): void;
  setSessionStats(stats: SessionStats): void;
  setAllTimeStats(stats: AllTimeStats): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

export function createOverviewStore(): OverviewStore {
  const store = writable<OverviewState>(initialState());

  const healthStatus = derived([store], ([state]) => {
    if (state.error) return 'critical' as const;
    if (state.quarantine.count >= state.quarantine.maxEntries * 0.9) return 'degraded' as const;
    if (state.throughput.perMinute === 0 && state.connectedClients > 0) return 'degraded' as const;
    return 'healthy' as const;
  });

  const quarantineUtilisation = derived([store], ([state]) => {
    if (state.quarantine.maxEntries === 0) return 0;
    return state.quarantine.count / state.quarantine.maxEntries;
  });

  return {
    store,
    healthStatus,
    quarantineUtilisation,
    setClients(count) {
      store.update((s) => ({ ...s, connectedClients: count, lastUpdated: new Date().toISOString() }));
    },
    setSessions(count) {
      store.update((s) => ({ ...s, activeSessions: count, lastUpdated: new Date().toISOString() }));
    },
    setThroughput(metrics) {
      store.update((s) => ({ ...s, throughput: metrics, lastUpdated: new Date().toISOString() }));
    },
    setQuarantine(status) {
      store.update((s) => ({ ...s, quarantine: status, lastUpdated: new Date().toISOString() }));
    },
    addAuditEvent(event) {
      store.update((s) => ({
        ...s,
        recentAuditEvents: [event, ...s.recentAuditEvents].slice(0, 50),
        lastUpdated: new Date().toISOString(),
      }));
    },
    setAuditEvents(events) {
      store.update((s) => ({
        ...s,
        recentAuditEvents: events.slice(0, 50),
        lastUpdated: new Date().toISOString(),
      }));
    },
    setSessionStats(stats) {
      store.update((s) => ({ ...s, sessionStats: stats, lastUpdated: new Date().toISOString() }));
    },
    setAllTimeStats(stats) {
      store.update((s) => ({ ...s, allTimeStats: stats, lastUpdated: new Date().toISOString() }));
    },
    setLoading(loading) {
      store.update((s) => ({ ...s, loading }));
    },
    setError(error) {
      store.update((s) => ({ ...s, error }));
    },
    reset() {
      store.set(initialState());
    },
  };
}
