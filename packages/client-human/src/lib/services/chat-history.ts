// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Local chat history service for the human client.
 * Uses an injectable storage adapter so it can be backed by Tauri's
 * built-in SQLite (via sql plugin) in the real app, or by an
 * in-memory store for testing.
 */

import type { Writable } from '../store.js';
import { writable } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly type: string;
  readonly timestamp: string;
  readonly senderType: string;
  readonly senderName: string;
  readonly content: string;
  readonly payload: string; // JSON-serialised
  readonly direction: string;
}

export interface ChatHistoryQuery {
  readonly sessionId?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly senderType?: string;
  readonly type?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ChatHistoryState {
  readonly sessionCount: number;
  readonly totalMessages: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly currentSessionMessages: readonly StoredMessage[];
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface ChatHistoryAdapter {
  /** Save a single message. */
  saveMessage(msg: StoredMessage): Promise<void>;
  /** Save multiple messages in batch. */
  saveBatch(msgs: readonly StoredMessage[]): Promise<void>;
  /** Load messages matching a query. */
  loadMessages(query: ChatHistoryQuery): Promise<StoredMessage[]>;
  /** Delete messages older than a timestamp. Returns count deleted. */
  deleteOlderThan(before: string): Promise<number>;
  /** Get all distinct session IDs, newest first. */
  getSessionIds(): Promise<string[]>;
  /** Get total message count. */
  getMessageCount(): Promise<number>;
  /** Clear all stored messages. */
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory adapter for testing
// ---------------------------------------------------------------------------

export class InMemoryChatHistory implements ChatHistoryAdapter {
  private _messages: StoredMessage[] = [];

  get messages(): readonly StoredMessage[] {
    return this._messages;
  }

  async saveMessage(msg: StoredMessage): Promise<void> {
    this._messages.push(msg);
  }

  async saveBatch(msgs: readonly StoredMessage[]): Promise<void> {
    this._messages.push(...msgs);
  }

  async loadMessages(query: ChatHistoryQuery): Promise<StoredMessage[]> {
    let results = [...this._messages];

    if (query.sessionId) {
      results = results.filter((m) => m.sessionId === query.sessionId);
    }
    if (query.startTime) {
      results = results.filter((m) => m.timestamp >= query.startTime!);
    }
    if (query.endTime) {
      results = results.filter((m) => m.timestamp <= query.endTime!);
    }
    if (query.senderType) {
      results = results.filter((m) => m.senderType === query.senderType);
    }
    if (query.type) {
      results = results.filter((m) => m.type === query.type);
    }

    // Sort by timestamp descending (newest first)
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (query.offset) {
      results = results.slice(query.offset);
    }
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  async deleteOlderThan(before: string): Promise<number> {
    const original = this._messages.length;
    this._messages = this._messages.filter((m) => m.timestamp >= before);
    return original - this._messages.length;
  }

  async getSessionIds(): Promise<string[]> {
    const sessions = new Map<string, string>();
    for (const m of this._messages) {
      const existing = sessions.get(m.sessionId);
      if (!existing || m.timestamp > existing) {
        sessions.set(m.sessionId, m.timestamp);
      }
    }
    return Array.from(sessions.entries())
      .sort((a, b) => b[1].localeCompare(a[1]))
      .map(([id]) => id);
  }

  async getMessageCount(): Promise<number> {
    return this._messages.length;
  }

  async clear(): Promise<void> {
    this._messages = [];
  }
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createChatHistoryService(adapter: ChatHistoryAdapter): {
  store: Writable<ChatHistoryState>;
  saveMessage(
    id: string,
    sessionId: string,
    type: string,
    timestamp: string,
    senderType: string,
    senderName: string,
    content: string,
    payload: unknown,
    direction: string,
  ): Promise<void>;
  loadSession(sessionId: string, limit?: number): Promise<StoredMessage[]>;
  loadRange(startTime: string, endTime: string): Promise<StoredMessage[]>;
  search(query: ChatHistoryQuery): Promise<StoredMessage[]>;
  getSessions(): Promise<string[]>;
  deleteOlderThan(timestamp: string): Promise<number>;
  clear(): Promise<void>;
  refreshStats(): Promise<void>;
} {
  const store = writable<ChatHistoryState>({
    sessionCount: 0,
    totalMessages: 0,
    loading: false,
    error: null,
    currentSessionMessages: [],
  });

  async function saveMessage(
    id: string,
    sessionId: string,
    type: string,
    timestamp: string,
    senderType: string,
    senderName: string,
    content: string,
    payload: unknown,
    direction: string,
  ): Promise<void> {
    const msg: StoredMessage = {
      id,
      sessionId,
      type,
      timestamp,
      senderType,
      senderName,
      content,
      payload: JSON.stringify(payload),
      direction,
    };

    try {
      await adapter.saveMessage(msg);
      const count = await adapter.getMessageCount();
      store.update((s) => ({ ...s, totalMessages: count, error: null }));
    } catch (err) {
      store.update((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  async function loadSession(sessionId: string, limit?: number): Promise<StoredMessage[]> {
    store.update((s) => ({ ...s, loading: true }));
    try {
      const msgs = await adapter.loadMessages({ sessionId, limit });
      store.update((s) => ({
        ...s,
        loading: false,
        currentSessionMessages: msgs,
        error: null,
      }));
      return msgs;
    } catch (err) {
      store.update((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      return [];
    }
  }

  async function loadRange(startTime: string, endTime: string): Promise<StoredMessage[]> {
    store.update((s) => ({ ...s, loading: true }));
    try {
      const msgs = await adapter.loadMessages({ startTime, endTime });
      store.update((s) => ({
        ...s,
        loading: false,
        currentSessionMessages: msgs,
        error: null,
      }));
      return msgs;
    } catch (err) {
      store.update((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      return [];
    }
  }

  async function search(query: ChatHistoryQuery): Promise<StoredMessage[]> {
    store.update((s) => ({ ...s, loading: true }));
    try {
      const msgs = await adapter.loadMessages(query);
      store.update((s) => ({ ...s, loading: false, error: null }));
      return msgs;
    } catch (err) {
      store.update((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      return [];
    }
  }

  async function getSessions(): Promise<string[]> {
    try {
      const ids = await adapter.getSessionIds();
      store.update((s) => ({ ...s, sessionCount: ids.length, error: null }));
      return ids;
    } catch (err) {
      store.update((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
      }));
      return [];
    }
  }

  async function deleteOlderThan(timestamp: string): Promise<number> {
    try {
      const deleted = await adapter.deleteOlderThan(timestamp);
      await refreshStats();
      return deleted;
    } catch (err) {
      store.update((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
      }));
      return 0;
    }
  }

  async function clear(): Promise<void> {
    try {
      await adapter.clear();
      store.set({
        sessionCount: 0,
        totalMessages: 0,
        loading: false,
        error: null,
        currentSessionMessages: [],
      });
    } catch (err) {
      store.update((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  async function refreshStats(): Promise<void> {
    try {
      const [count, sessions] = await Promise.all([adapter.getMessageCount(), adapter.getSessionIds()]);
      store.update((s) => ({
        ...s,
        totalMessages: count,
        sessionCount: sessions.length,
        error: null,
      }));
    } catch (err) {
      store.update((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  return {
    store,
    saveMessage,
    loadSession,
    loadRange,
    search,
    getSessions,
    deleteOlderThan,
    clear,
    refreshStats,
  };
}
