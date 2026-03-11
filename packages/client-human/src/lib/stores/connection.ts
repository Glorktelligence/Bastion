// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Svelte-compatible connection state store.
 * Subscribes to BastionHumanClient events and reflects state reactively.
 */

import type { BastionHumanClient, HumanClientState } from '../services/connection.js';
import type { Writable } from '../store.js';
import { writable } from '../store.js';

export interface ConnectionStoreState {
  status: HumanClientState;
  jwt: string | null;
  sessionId: string | null;
  peerStatus: 'active' | 'suspended' | 'disconnected' | 'unknown';
  reconnectAttempt: number;
  lastError: string | null;
}

const INITIAL_STATE: ConnectionStoreState = {
  status: 'disconnected',
  jwt: null,
  sessionId: null,
  peerStatus: 'unknown',
  reconnectAttempt: 0,
  lastError: null,
};

export function createConnectionStore(client: BastionHumanClient): Writable<ConnectionStoreState> {
  const store = writable<ConnectionStoreState>({ ...INITIAL_STATE });

  client.on('stateChange', (status) => {
    store.update((s) => ({ ...s, status }));
  });

  client.on('authenticated', (jwt, _expiresAt) => {
    store.update((s) => ({ ...s, jwt }));
  });

  client.on('disconnected', () => {
    store.update((s) => ({
      ...s,
      jwt: null,
      sessionId: null,
      peerStatus: 'disconnected',
      reconnectAttempt: 0,
    }));
  });

  client.on('reconnecting', (attempt) => {
    store.update((s) => ({ ...s, reconnectAttempt: attempt }));
  });

  client.on('reconnected', () => {
    store.update((s) => ({ ...s, reconnectAttempt: 0 }));
  });

  client.on('peerStatus', (peerStatus) => {
    const mapped =
      peerStatus === 'active' || peerStatus === 'suspended' || peerStatus === 'disconnected'
        ? (peerStatus as 'active' | 'suspended' | 'disconnected')
        : ('unknown' as const);
    store.update((s) => ({ ...s, peerStatus: mapped }));
  });

  client.on('error', (err) => {
    store.update((s) => ({ ...s, lastError: err.message }));
  });

  return store;
}
