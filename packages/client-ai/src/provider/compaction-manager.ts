// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * CompactionManager — context optimisation via conversation summarisation.
 *
 * Original messages are NEVER modified or deleted — they stay hash-chained
 * in SQLite. Compaction creates a SUMMARY that replaces older messages
 * in the Layer 1 buffer only.
 *
 * Pinned messages are excluded from compaction and always stay in full.
 */

import type { CompactionSummary, ConversationStore } from './conversation-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompactionCheck {
  readonly needed: boolean;
  readonly messageCount: number;
  readonly tokenEstimate: number;
  readonly budgetPercent: number;
}

export interface CompactionResult {
  readonly success: boolean;
  readonly summary?: string;
  readonly messagesCovered?: number;
  readonly tokensSaved?: number;
  readonly error?: string;
}

export interface CompactionManagerConfig {
  /** Conversation segment token budget. Default: 80,000. */
  readonly conversationBudget?: number;
  /** Trigger compaction at this percent of budget. Default: 80. */
  readonly triggerPercent?: number;
  /** Keep this many recent messages uncompacted. Default: 50. */
  readonly keepRecent?: number;
  /** Chars per token estimate. Default: 4. */
  readonly charsPerToken?: number;
}

/** Function that calls the Anthropic API for summarisation. */
export type SummariseFn = (prompt: string) => Promise<{ ok: boolean; text: string; error?: string }>;

// ---------------------------------------------------------------------------
// CompactionManager
// ---------------------------------------------------------------------------

export class CompactionManager {
  private readonly store: ConversationStore;
  private readonly conversationBudget: number;
  private readonly triggerPercent: number;
  private readonly keepRecent: number;
  private readonly charsPerToken: number;

  constructor(store: ConversationStore, config?: CompactionManagerConfig) {
    this.store = store;
    this.conversationBudget = config?.conversationBudget ?? 80_000;
    this.triggerPercent = config?.triggerPercent ?? 80;
    this.keepRecent = config?.keepRecent ?? 50;
    this.charsPerToken = config?.charsPerToken ?? 4;
  }

  /**
   * Check if compaction is needed for a conversation.
   */
  shouldCompact(conversationId: string): CompactionCheck {
    const messageCount = this.store.getMessageCount(conversationId);
    const recent = this.store.getRecentMessages(conversationId, 10000);
    let totalChars = 0;
    for (const m of recent) {
      totalChars += m.content.length;
    }
    const tokenEstimate = Math.ceil(totalChars / this.charsPerToken);
    const budgetPercent = Math.round((tokenEstimate / this.conversationBudget) * 100);

    return {
      needed: budgetPercent >= this.triggerPercent && messageCount > this.keepRecent,
      messageCount,
      tokenEstimate,
      budgetPercent,
    };
  }

  /**
   * Perform compaction — summarise older messages.
   *
   * Uses the provided summarise function to call the Anthropic API.
   * Original messages are NEVER modified or deleted.
   */
  async compact(conversationId: string, summarise: SummariseFn): Promise<CompactionResult> {
    const compactable = this.store.getCompactableMessages(conversationId, this.keepRecent);
    if (compactable.length === 0) {
      return { success: true, summary: '', messagesCovered: 0, tokensSaved: 0 };
    }

    // Build summarisation prompt
    const transcript = compactable.map((m) => `[${m.role}] ${m.content}`).join('\n\n');

    const prompt = `Summarise the following conversation, preserving key decisions, facts, agreements, and turning points. Be concise but complete. Format as structured notes with bullet points.\n\n--- Conversation (${compactable.length} messages) ---\n\n${transcript}`;

    const result = await summarise(prompt);
    if (!result.ok) {
      return { success: false, error: result.error ?? 'Summarisation failed' };
    }

    // Calculate tokens saved
    const originalChars = compactable.reduce((sum, m) => sum + m.content.length, 0);
    const summaryChars = result.text.length;
    const tokensSaved = Math.max(0, Math.ceil((originalChars - summaryChars) / this.charsPerToken));

    // Store the compaction summary
    const firstMsg = compactable[0]!;
    const lastMsg = compactable[compactable.length - 1]!;
    this.store.addCompactionSummary(
      conversationId,
      firstMsg.id,
      lastMsg.id,
      result.text,
      compactable.length,
      tokensSaved,
    );

    return {
      success: true,
      summary: result.text,
      messagesCovered: compactable.length,
      tokensSaved,
    };
  }

  /**
   * Get the latest compaction summary for a conversation.
   */
  getCompactionSummary(conversationId: string): CompactionSummary | null {
    return this.store.getLatestCompaction(conversationId);
  }
}
