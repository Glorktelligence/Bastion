// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Audit store for the admin UI.
 *
 * Manages audit event state with advanced filtering: date range,
 * event type, session ID, configurable pagination, chain integrity.
 */

import { type Readable, type Writable, derived, writable } from '../store.js';
import type { AuditEventSummary } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditFilter {
  startTime: string;
  endTime: string;
  eventType: string;
  sessionId: string;
}

export interface ChainIntegrity {
  readonly totalEntries: number;
  readonly chainValid: boolean;
  readonly lastVerifiedAt: string | null;
}

export interface AdminAuditState {
  readonly entries: readonly AuditEventSummary[];
  readonly filter: AuditFilter;
  readonly pageSize: number;
  readonly currentPage: number;
  readonly totalServerCount: number;
  readonly integrity: ChainIntegrity | null;
  readonly loading: boolean;
  readonly error: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AUDIT_EVENT_TYPES = [
  'message_routed',
  'message_rejected',
  'message_rate_limited',
  'auth_success',
  'auth_failure',
  'auth_token_refresh',
  'auth_token_expired',
  'session_started',
  'session_ended',
  'session_timeout',
  'session_paired',
  'file_manifest',
  'file_quarantine',
  'file_delivered',
  'file_rejected',
  'file_submitted',
  'file_hash_mismatch',
  'config_change',
  'provider_approved',
  'provider_deactivated',
  'provider_registered',
  'protocol_violation',
  'sender_mismatch',
  'allowlist_rejected',
  'maliclaw_rejected',
  'security_violation',
  'key_exchange',
  'context_update',
  'audit_query',
  'budget_alert',
  'budget_config_changed',
  'budget_status',
  'challenge_status',
  'challenge_config',
  'tool_request',
  'tool_approved',
  'tool_denied',
  'tool_result',
  'tool_revoke',
  'tool_alert',
  'memory_proposed',
  'memory_decided',
  'project_sync',
] as const;

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export interface AdminAuditStore {
  readonly store: Writable<AdminAuditState>;
  readonly pageCount: Readable<number>;
  setEntries(entries: readonly AuditEventSummary[], totalCount: number): void;
  setFilter(filter: Partial<AuditFilter>): void;
  clearFilter(): void;
  setPage(page: number): void;
  setPageSize(size: number): void;
  setIntegrity(integrity: ChainIntegrity | null): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  getQueryParams(): {
    startTime?: string;
    endTime?: string;
    eventType?: string;
    sessionId?: string;
    limit: number;
    offset: number;
  };
  clear(): void;
}

export function createAdminAuditStore(): AdminAuditStore {
  const store = writable<AdminAuditState>({
    entries: [],
    filter: { startTime: '', endTime: '', eventType: '', sessionId: '' },
    pageSize: 50,
    currentPage: 0,
    totalServerCount: 0,
    integrity: null,
    loading: false,
    error: null,
  });

  const pageCount = derived([store], ([s]) => Math.max(1, Math.ceil(s.totalServerCount / s.pageSize)));

  return {
    store,
    pageCount,
    setEntries(entries, totalCount) {
      store.update((s) => ({ ...s, entries, totalServerCount: totalCount, loading: false, error: null }));
    },
    setFilter(filter) {
      store.update((s) => ({ ...s, filter: { ...s.filter, ...filter }, currentPage: 0 }));
    },
    clearFilter() {
      store.update((s) => ({
        ...s,
        filter: { startTime: '', endTime: '', eventType: '', sessionId: '' },
        currentPage: 0,
      }));
    },
    setPage(page) {
      store.update((s) => ({ ...s, currentPage: Math.max(0, page) }));
    },
    setPageSize(size) {
      store.update((s) => ({ ...s, pageSize: Math.max(1, size), currentPage: 0 }));
    },
    setIntegrity(integrity) {
      store.update((s) => ({ ...s, integrity }));
    },
    setLoading(loading) {
      store.update((s) => ({ ...s, loading }));
    },
    setError(error) {
      store.update((s) => ({ ...s, error }));
    },
    getQueryParams() {
      const s = store.get();
      const params: Record<string, unknown> = {
        limit: s.pageSize,
        offset: s.currentPage * s.pageSize,
      };
      if (s.filter.startTime) params.startTime = s.filter.startTime;
      if (s.filter.endTime) params.endTime = s.filter.endTime;
      if (s.filter.eventType) params.eventType = s.filter.eventType;
      if (s.filter.sessionId) params.sessionId = s.filter.sessionId;
      return params as ReturnType<AdminAuditStore['getQueryParams']>;
    },
    clear() {
      store.set({
        entries: [],
        filter: { startTime: '', endTime: '', eventType: '', sessionId: '' },
        pageSize: 50,
        currentPage: 0,
        totalServerCount: 0,
        integrity: null,
        loading: false,
        error: null,
      });
    },
  };
}
