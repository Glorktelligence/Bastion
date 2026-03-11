// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Connection log store.
 *
 * Real-time view of connected clients, auth status, message counts.
 * Tracks connection adds/removes and message count updates.
 */

import { type Readable, type Writable, derived, writable } from '../store.js';
import type { ConnectionEntry } from '../types.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ConnectionsState {
  readonly connections: readonly ConnectionEntry[];
  readonly filterType: 'all' | 'human' | 'ai' | 'unknown';
  readonly totalMessagesRouted: number;
  readonly loading: boolean;
  readonly error: string | null;
}

function initialState(): ConnectionsState {
  return {
    connections: [],
    filterType: 'all',
    totalMessagesRouted: 0,
    loading: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface ConnectionsStore {
  readonly store: Writable<ConnectionsState>;
  readonly filteredConnections: Readable<readonly ConnectionEntry[]>;
  readonly humanCount: Readable<number>;
  readonly aiCount: Readable<number>;
  readonly authenticatedCount: Readable<number>;
  readonly totalCount: Readable<number>;
  setConnections(connections: readonly ConnectionEntry[]): void;
  addConnection(conn: ConnectionEntry): void;
  removeConnection(connectionId: string): void;
  updateMessageCount(connectionId: string, count: number): void;
  setAuthenticated(connectionId: string, authenticated: boolean): void;
  setFilter(type: 'all' | 'human' | 'ai' | 'unknown'): void;
  setTotalMessages(count: number): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

export function createConnectionsStore(): ConnectionsStore {
  const store = writable<ConnectionsState>(initialState());

  const filteredConnections = derived([store], ([s]) => {
    if (s.filterType === 'all') return s.connections;
    return s.connections.filter((c) => c.clientType === s.filterType);
  });

  const humanCount = derived([store], ([s]) => s.connections.filter((c) => c.clientType === 'human').length);

  const aiCount = derived([store], ([s]) => s.connections.filter((c) => c.clientType === 'ai').length);

  const authenticatedCount = derived([store], ([s]) => s.connections.filter((c) => c.authenticated).length);

  const totalCount = derived([store], ([s]) => s.connections.length);

  return {
    store,
    filteredConnections,
    humanCount,
    aiCount,
    authenticatedCount,
    totalCount,
    setConnections(connections) {
      store.update((s) => ({ ...s, connections, error: null }));
    },
    addConnection(conn) {
      store.update((s) => ({
        ...s,
        connections: [...s.connections, conn],
      }));
    },
    removeConnection(connectionId) {
      store.update((s) => ({
        ...s,
        connections: s.connections.filter((c) => c.connectionId !== connectionId),
      }));
    },
    updateMessageCount(connectionId, count) {
      store.update((s) => ({
        ...s,
        connections: s.connections.map((c) => (c.connectionId === connectionId ? { ...c, messageCount: count } : c)),
      }));
    },
    setAuthenticated(connectionId, authenticated) {
      store.update((s) => ({
        ...s,
        connections: s.connections.map((c) => (c.connectionId === connectionId ? { ...c, authenticated } : c)),
      }));
    },
    setFilter(type) {
      store.update((s) => ({ ...s, filterType: type }));
    },
    setTotalMessages(count) {
      store.update((s) => ({ ...s, totalMessagesRouted: count }));
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
