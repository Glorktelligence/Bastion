// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Message store for the mobile client.
 * Maintains an ordered list of display-ready messages.
 */

import type { Writable } from '../store.js';
import { writable } from '../store.js';

export interface DisplayMessage {
  readonly id: string;
  readonly type: string;
  readonly timestamp: string;
  readonly senderType: 'human' | 'ai' | 'system';
  readonly senderName: string;
  readonly content: string;
  readonly payload: unknown;
  readonly direction: 'incoming' | 'outgoing';
}

export interface MessagesStoreState {
  readonly messages: readonly DisplayMessage[];
}

/**
 * Extract human-readable content from a message payload based on type.
 */
function extractContent(type: string, payload: unknown): string {
  if (!payload || typeof payload !== 'object') return JSON.stringify(payload);
  const p = payload as Record<string, unknown>;

  switch (type) {
    case 'conversation':
      return typeof p.content === 'string' ? p.content : JSON.stringify(payload);
    case 'result':
      return typeof p.summary === 'string' ? p.summary : JSON.stringify(payload);
    case 'status': {
      const action = typeof p.currentAction === 'string' ? p.currentAction : '';
      const pct = typeof p.completionPercentage === 'number' ? p.completionPercentage : 0;
      return `${action} (${pct}%)`;
    }
    case 'denial':
      return typeof p.reason === 'string' ? p.reason : JSON.stringify(payload);
    case 'error':
      return typeof p.message === 'string' ? p.message : JSON.stringify(payload);
    default:
      return JSON.stringify(payload);
  }
}

export function createMessagesStore(): {
  store: Writable<MessagesStoreState>;
  addMessage(msg: DisplayMessage): void;
  addIncoming(
    type: string,
    payload: unknown,
    sender: { type: string; displayName: string },
    id: string,
    timestamp: string,
  ): void;
  clear(): void;
} {
  const store = writable<MessagesStoreState>({ messages: [] });

  function addMessage(msg: DisplayMessage): void {
    store.update((s) => ({
      messages: [...s.messages, msg],
    }));
  }

  function addIncoming(
    type: string,
    payload: unknown,
    sender: { type: string; displayName: string },
    id: string,
    timestamp: string,
  ): void {
    const senderType = sender.type === 'human' || sender.type === 'ai' ? sender.type : ('system' as const);

    addMessage({
      id,
      type,
      timestamp,
      senderType,
      senderName: sender.displayName,
      content: extractContent(type, payload),
      payload,
      direction: 'incoming',
    });
  }

  function clear(): void {
    store.set({ messages: [] });
  }

  return { store, addMessage, addIncoming, clear };
}
