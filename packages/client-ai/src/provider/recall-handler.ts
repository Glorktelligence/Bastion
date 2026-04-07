// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * RecallHandler — enables the AI to search its own conversation history.
 *
 * After compaction, the AI has a summary but loses specific detail from
 * older messages. bastion_recall lets the AI search the ConversationStore's
 * complete message history (originals are NEVER deleted from SQLite) and
 * get matching messages injected back into its context.
 *
 * Flow:
 *   AI response contains [BASTION:RECALL] block
 *   → Parsed and stripped from displayed text
 *   → RecallHandler searches ConversationStore
 *   → Results stored in recall buffer on ConversationManager
 *   → Next prompt assembly includes recalled messages
 *   → AI sees the historical messages for one turn
 */

import type { ConversationStore } from './conversation-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecallRequest {
  readonly query: string;
  readonly scope?: 'conversation' | 'all';
  readonly limit?: number;
  readonly timeframe?: 'recent' | 'session' | 'all';
}

export interface RecallMatch {
  readonly messageId: string;
  readonly role: string;
  readonly content: string;
  readonly timestamp: string;
  readonly relevanceScore: number;
  readonly contextBefore?: string;
  readonly contextAfter?: string;
}

export interface RecallResult {
  readonly matches: readonly RecallMatch[];
  readonly totalFound: number;
  readonly query: string;
  readonly searchScope: string;
  readonly queryTimeMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTENT_PER_MATCH = 2000;
const MAX_TOTAL_RECALL_CHARS = 8000;
const MAX_RESULTS = 10;

// ---------------------------------------------------------------------------
// RecallHandler
// ---------------------------------------------------------------------------

export class RecallHandler {
  constructor(private readonly store: ConversationStore) {}

  recall(conversationId: string | null, request: RecallRequest): RecallResult {
    const startTime = Date.now();
    const limit = Math.min(request.limit ?? 5, MAX_RESULTS);
    const query = request.query;

    if (!query || query.trim().length < 2) {
      return { matches: [], totalFound: 0, query: query ?? '', searchScope: 'none', queryTimeMs: 0 };
    }

    if (!conversationId && request.scope !== 'all') {
      return { matches: [], totalFound: 0, query, searchScope: 'none', queryTimeMs: 0 };
    }

    // Search messages — over-fetch for context trimming
    const rawMatches = this.store.searchMessages(conversationId!, query, limit * 2);

    // Build results with context, respecting size limits
    const matches: RecallMatch[] = [];
    let totalChars = 0;

    for (const msg of rawMatches) {
      if (matches.length >= limit) break;

      const content =
        msg.content.length > MAX_CONTENT_PER_MATCH
          ? `${msg.content.substring(0, MAX_CONTENT_PER_MATCH)}...`
          : msg.content;

      if (totalChars + content.length > MAX_TOTAL_RECALL_CHARS) break;

      // Get surrounding context
      const context = this.store.getMessageContext(conversationId!, msg.id);

      matches.push({
        messageId: msg.id,
        role: msg.role,
        content,
        timestamp: msg.timestamp,
        relevanceScore: rawMatches.indexOf(msg),
        contextBefore: context.before?.content?.substring(0, 200),
        contextAfter: context.after?.content?.substring(0, 200),
      });

      totalChars += content.length;
    }

    return {
      matches,
      totalFound: rawMatches.length,
      query,
      searchScope: conversationId ? `conversation:${conversationId.slice(0, 8)}` : 'all',
      queryTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Format recall results for injection into the system prompt.
   */
  formatForPrompt(result: RecallResult): string {
    if (result.matches.length === 0) {
      return `--- Recalled Context ---\nNo matches found for: "${result.query}"\n--- End Recalled Context ---`;
    }

    const lines = [`--- Recalled Context (${result.matches.length} matches for "${result.query}") ---`];

    for (const match of result.matches) {
      lines.push(`\n[${match.role}, ${match.timestamp}]:`);
      lines.push(match.content);
    }

    lines.push('--- End Recalled Context ---');
    return lines.join('\n');
  }
}
