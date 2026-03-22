// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Audit log store for the human client.
 * Queryable view of the audit trail with filtering by time range,
 * message type, sender, task ID, safety outcome, file transfer status.
 */

import type { Readable, Writable } from '../store.js';
import { derived, writable } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  readonly index: number;
  readonly timestamp: string;
  readonly eventType: string;
  readonly sessionId: string;
  readonly detail: Record<string, unknown>;
  readonly chainHash: string;
}

export interface AuditLogFilter {
  readonly startTime?: string;
  readonly endTime?: string;
  readonly eventType?: string;
  readonly sessionId?: string;
  readonly senderId?: string;
  readonly taskId?: string;
  readonly safetyOutcome?: string;
  readonly fileTransferStatus?: string;
}

export interface ChainIntegrityStatus {
  readonly chainValid: boolean;
  readonly entriesChecked: number;
  readonly lastVerifiedAt: string;
}

export interface AuditLogState {
  readonly entries: readonly AuditLogEntry[];
  readonly filter: AuditLogFilter;
  readonly loading: boolean;
  readonly error: string | null;
  readonly pageSize: number;
  readonly currentPage: number;
  readonly integrity: ChainIntegrityStatus | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 50;

/** Known event type categories for filtering. */
export const AUDIT_EVENT_CATEGORIES = {
  message: ['message_routed', 'message_rejected', 'message_rate_limited'],
  auth: ['auth_success', 'auth_failure', 'auth_token_refresh', 'auth_token_expired'],
  session: ['session_started', 'session_ended', 'session_timeout'],
  file: ['file_manifest', 'file_quarantine', 'file_delivered', 'file_rejected'],
  config: ['config_change', 'provider_approved', 'provider_deactivated'],
  violation: ['protocol_violation', 'sender_mismatch', 'allowlist_rejected', 'maliclaw_rejected'],
} as const;

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createAuditLogStore(): {
  store: Writable<AuditLogState>;
  filteredEntries: Readable<readonly AuditLogEntry[]>;
  totalCount: Readable<number>;
  pageCount: Readable<number>;
  currentPageEntries: Readable<readonly AuditLogEntry[]>;
  integrity: Readable<ChainIntegrityStatus | null>;
  setEntries(entries: readonly AuditLogEntry[]): void;
  addEntry(entry: AuditLogEntry): void;
  setFilter(filter: Partial<AuditLogFilter>): void;
  clearFilter(): void;
  setPage(page: number): void;
  setPageSize(size: number): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  setIntegrity(integrity: ChainIntegrityStatus | null): void;
  handleAuditResponse(response: {
    entries: readonly { eventType: string; sessionId: string; detail: Record<string, unknown>; chainHash: string }[];
    totalCount: number;
    integrity: ChainIntegrityStatus | null;
  }): void;
  buildAuditQuery(): {
    startTime?: string;
    endTime?: string;
    eventType?: string;
    sessionId?: string;
    limit: number;
    offset: number;
    includeIntegrity: boolean;
  };
  clear(): void;
} {
  const store = writable<AuditLogState>({
    entries: [],
    filter: {},
    loading: false,
    error: null,
    pageSize: DEFAULT_PAGE_SIZE,
    currentPage: 0,
    integrity: null,
  });

  // -------------------------------------------------------------------------
  // Filtering logic
  // -------------------------------------------------------------------------

  function matchesFilter(entry: AuditLogEntry, filter: AuditLogFilter): boolean {
    if (filter.startTime && entry.timestamp < filter.startTime) return false;
    if (filter.endTime && entry.timestamp > filter.endTime) return false;
    if (filter.eventType && entry.eventType !== filter.eventType) return false;
    if (filter.sessionId && entry.sessionId !== filter.sessionId) return false;

    if (filter.senderId) {
      const detail = entry.detail;
      const senderId = detail.senderId ?? detail.sender_id ?? detail.identity;
      if (senderId !== filter.senderId) return false;
    }

    if (filter.taskId) {
      const taskId = entry.detail.taskId ?? entry.detail.task_id;
      if (taskId !== filter.taskId) return false;
    }

    if (filter.safetyOutcome) {
      const outcome = entry.detail.safetyOutcome ?? entry.detail.outcome;
      if (outcome !== filter.safetyOutcome) return false;
    }

    if (filter.fileTransferStatus) {
      const status = entry.detail.fileTransferStatus ?? entry.detail.state;
      if (status !== filter.fileTransferStatus) return false;
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Derived stores
  // -------------------------------------------------------------------------

  const filteredEntries = derived([store], ([state]) => state.entries.filter((e) => matchesFilter(e, state.filter)));

  const totalCount = derived([filteredEntries], ([entries]) => entries.length);

  const integrity = derived([store], ([state]) => state.integrity);

  const pageCount = derived([totalCount, store], ([count, state]) => Math.max(1, Math.ceil(count / state.pageSize)));

  const currentPageEntries = derived([filteredEntries, store], ([entries, state]) => {
    const start = state.currentPage * state.pageSize;
    return entries.slice(start, start + state.pageSize);
  });

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  function setEntries(entries: readonly AuditLogEntry[]): void {
    store.update((s) => ({ ...s, entries, currentPage: 0 }));
  }

  function addEntry(entry: AuditLogEntry): void {
    store.update((s) => ({ ...s, entries: [entry, ...s.entries] }));
  }

  function setFilter(filter: Partial<AuditLogFilter>): void {
    store.update((s) => ({ ...s, filter: { ...s.filter, ...filter }, currentPage: 0 }));
  }

  function clearFilter(): void {
    store.update((s) => ({ ...s, filter: {}, currentPage: 0 }));
  }

  function setPage(page: number): void {
    store.update((s) => ({ ...s, currentPage: Math.max(0, page) }));
  }

  function setPageSize(size: number): void {
    store.update((s) => ({ ...s, pageSize: Math.max(1, size), currentPage: 0 }));
  }

  function setLoading(loading: boolean): void {
    store.update((s) => ({ ...s, loading }));
  }

  function setError(error: string | null): void {
    store.update((s) => ({ ...s, error }));
  }

  function setIntegrity(integ: ChainIntegrityStatus | null): void {
    store.update((s) => ({ ...s, integrity: integ }));
  }

  function handleAuditResponse(response: {
    entries: readonly { eventType: string; sessionId: string; detail: Record<string, unknown>; chainHash: string }[];
    totalCount: number;
    integrity: ChainIntegrityStatus | null;
  }): void {
    const mapped: AuditLogEntry[] = response.entries.map((e, i) => ({
      index: i,
      timestamp: (e.detail.timestamp as string) ?? new Date().toISOString(),
      eventType: e.eventType,
      sessionId: e.sessionId,
      detail: e.detail,
      chainHash: e.chainHash,
    }));
    store.update((s) => ({
      ...s,
      entries: mapped,
      loading: false,
      error: null,
      currentPage: 0,
      integrity: response.integrity,
    }));
  }

  function buildAuditQuery(): {
    startTime?: string;
    endTime?: string;
    eventType?: string;
    sessionId?: string;
    limit: number;
    offset: number;
    includeIntegrity: boolean;
  } {
    const state = store.get();
    return {
      startTime: state.filter.startTime,
      endTime: state.filter.endTime,
      eventType: state.filter.eventType,
      sessionId: state.filter.sessionId,
      limit: state.pageSize,
      offset: state.currentPage * state.pageSize,
      includeIntegrity: true,
    };
  }

  function clear(): void {
    store.set({
      entries: [],
      filter: {},
      loading: false,
      error: null,
      pageSize: DEFAULT_PAGE_SIZE,
      currentPage: 0,
      integrity: null,
    });
  }

  return {
    store,
    filteredEntries,
    totalCount,
    pageCount,
    currentPageEntries,
    integrity,
    setEntries,
    addEntry,
    setFilter,
    clearFilter,
    setPage,
    setPageSize,
    setLoading,
    setError,
    setIntegrity,
    handleAuditResponse,
    buildAuditQuery,
    clear,
  };
}
