// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Multi-conversation store for the human client.
 *
 * Tracks conversation list, active conversation, and scoped messages.
 * Populated by conversation_list_response, conversation_switch_ack,
 * and conversation_history_response messages from the AI client.
 */

import type { Readable, Writable } from '../store.js';
import { derived, writable } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationEntry {
  readonly id: string;
  readonly name: string;
  readonly type: 'normal' | 'game';
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly lastMessagePreview: string;
  readonly archived: boolean;
  readonly preferredAdapter?: string | null;
}

export interface ConversationMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly role: 'user' | 'assistant';
  readonly type: string;
  readonly content: string;
  readonly timestamp: string;
  readonly hash: string;
  readonly previousHash: string | null;
  readonly pinned: boolean;
  readonly senderName?: string;
  readonly direction?: 'incoming' | 'outgoing';
  readonly payload?: unknown;
}

export interface ConversationsStoreState {
  readonly conversations: readonly ConversationEntry[];
  readonly activeConversationId: string | null;
  readonly activeMessages: readonly ConversationMessage[];
  readonly loadingHistory: boolean;
  readonly hasMoreHistory: boolean;
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export interface ConversationsStore {
  readonly store: Writable<ConversationsStoreState>;
  readonly activeConversation: Readable<ConversationEntry | null>;
  readonly activeCount: Readable<number>;
  readonly archivedConversations: Readable<readonly ConversationEntry[]>;
  setConversations(list: readonly ConversationEntry[]): void;
  setActiveConversation(id: string, messages?: readonly ConversationMessage[]): void;
  addMessage(msg: ConversationMessage): void;
  prependMessages(msgs: readonly ConversationMessage[], hasMore: boolean): void;
  createConversation(entry: ConversationEntry): void;
  updateConversation(id: string, updates: Partial<ConversationEntry>): void;
  removeConversation(id: string): void;
  setLoadingHistory(loading: boolean): void;
  clear(): void;
}

export function createConversationsStore(): ConversationsStore {
  const store = writable<ConversationsStoreState>({
    conversations: [],
    activeConversationId: null,
    activeMessages: [],
    loadingHistory: false,
    hasMoreHistory: false,
  });

  const activeConversation = derived(
    [store],
    ([s]) => s.conversations.find((c) => c.id === s.activeConversationId) ?? null,
  );

  const activeCount = derived([store], ([s]) => s.conversations.filter((c) => !c.archived).length);

  const archivedConversations = derived([store], ([s]) => s.conversations.filter((c) => c.archived));

  return {
    store,
    activeConversation,
    activeCount,
    archivedConversations,

    setConversations(list) {
      store.update((s) => ({ ...s, conversations: list }));
    },

    setActiveConversation(id, messages) {
      store.update((s) => ({
        ...s,
        activeConversationId: id,
        activeMessages: messages ?? [],
        hasMoreHistory: false,
      }));
    },

    addMessage(msg) {
      store.update((s) => {
        // Update the conversation's preview and timestamp
        const updatedConvs = s.conversations.map((c) =>
          c.id === s.activeConversationId
            ? {
                ...c,
                messageCount: c.messageCount + 1,
                lastMessagePreview: msg.content.length > 80 ? `${msg.content.slice(0, 80)}...` : msg.content,
                updatedAt: msg.timestamp,
              }
            : c,
        );
        return {
          ...s,
          conversations: updatedConvs,
          activeMessages: [...s.activeMessages, msg],
        };
      });
    },

    prependMessages(msgs, hasMore) {
      store.update((s) => ({
        ...s,
        activeMessages: [...msgs, ...s.activeMessages],
        hasMoreHistory: hasMore,
        loadingHistory: false,
      }));
    },

    createConversation(entry) {
      store.update((s) => ({
        ...s,
        conversations: [entry, ...s.conversations],
      }));
    },

    updateConversation(id, updates) {
      store.update((s) => ({
        ...s,
        conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      }));
    },

    removeConversation(id) {
      store.update((s) => ({
        ...s,
        conversations: s.conversations.filter((c) => c.id !== id),
        // If we removed the active conversation, clear messages
        ...(s.activeConversationId === id ? { activeConversationId: null, activeMessages: [] } : {}),
      }));
    },

    setLoadingHistory(loading) {
      store.update((s) => ({ ...s, loadingHistory: loading }));
    },

    clear() {
      store.set({
        conversations: [],
        activeConversationId: null,
        activeMessages: [],
        loadingHistory: false,
        hasMoreHistory: false,
      });
    },
  };
}
