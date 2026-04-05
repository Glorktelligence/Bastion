// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * DreamCycleManager — reviews conversation transcripts and extracts
 * memories worth keeping via the dream adapter (Opus).
 *
 * Phase 1: Manual trigger only (human sends dream_cycle_request).
 * The dream adapter is instructed to output ONLY [BASTION:MEMORY] blocks.
 * The existing action block parser extracts them. Human approves all
 * candidates in a batch.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { ProviderAdapter } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DreamCycleConfig {
  readonly enabled: boolean;
  readonly adapterId?: string;
  readonly maxTranscriptTokens: number;
  readonly configPath: string;
}

export interface DreamCycleResult {
  readonly conversationId: string;
  readonly candidateCount: number;
  readonly candidates: readonly MemoryCandidate[];
  readonly tokensUsed: { readonly input: number; readonly output: number };
  readonly cost: number;
  readonly durationMs: number;
}

export interface MemoryCandidate {
  readonly proposalId: string;
  readonly content: string;
  readonly category: 'fact' | 'preference' | 'workflow' | 'project';
  readonly reason: string;
  readonly isUpdate: boolean;
  readonly existingMemoryContent?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4;

const DREAM_PROMPT_TEMPLATE = `You are reviewing a conversation to extract memories worth preserving for future conversations.

EXISTING MEMORIES (do not duplicate — if info has changed, propose an update):
{{existingMemories}}

CONVERSATION:
{{transcript}}

INSTRUCTIONS:
- Extract facts, preferences, workflows, and project details worth remembering
- Each memory must be a standalone statement (no context needed to understand it)
- DO extract: technical preferences, project facts, workflow patterns, stated values, configuration details
- DO NOT extract: greetings, small talk, one-time emotional states, transient events
- If an existing memory is now OUTDATED by the conversation, propose the corrected version
- Deduplicate: skip anything that already exists and is still accurate
- Keep each memory concise (1-2 sentences max)

OUTPUT: Only [BASTION:MEMORY] blocks. No preamble, no commentary.

For new memories:
[BASTION:MEMORY]{"content":"...","category":"fact|preference|workflow|project","reason":"why this matters"}[/BASTION:MEMORY]

For updates to existing memories:
[BASTION:MEMORY]{"content":"corrected info","category":"fact|preference|workflow|project","reason":"updates: original text here"}[/BASTION:MEMORY]`;

// ---------------------------------------------------------------------------
// Action block parser (reused from the AI native action system)
// ---------------------------------------------------------------------------

const MEMORY_BLOCK_RE = /\[BASTION:MEMORY\]([\s\S]*?)\[\/BASTION:MEMORY\]/g;

interface ParsedMemory {
  readonly content: string;
  readonly category: 'fact' | 'preference' | 'workflow' | 'project';
  readonly reason: string;
}

function parseMemoryBlocks(text: string): ParsedMemory[] {
  const results: ParsedMemory[] = [];
  const re = new RegExp(MEMORY_BLOCK_RE.source, MEMORY_BLOCK_RE.flags);
  for (const match of text.matchAll(re)) {
    try {
      const data = JSON.parse((match[1] ?? '').trim()) as Record<string, unknown>;
      const content = String(data.content ?? '');
      const category = String(data.category ?? 'fact');
      const reason = String(data.reason ?? '');
      if (content.length > 0 && ['fact', 'preference', 'workflow', 'project'].includes(category)) {
        results.push({
          content,
          category: category as ParsedMemory['category'],
          reason,
        });
      }
    } catch {
      // Invalid JSON — skip
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// DreamCycleManager
// ---------------------------------------------------------------------------

export class DreamCycleManager {
  private readonly config: DreamCycleConfig;
  private readonly lastDreamAt: Map<string, string> = new Map();

  constructor(config: DreamCycleConfig) {
    this.config = config;
    this.loadState();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Run a dream cycle for a specific conversation.
   *
   * Sends the transcript to the dream adapter with the dream prompt,
   * parses the response for [BASTION:MEMORY] blocks, detects updates
   * to existing memories, and returns the candidates.
   */
  async runDreamCycle(
    conversationId: string,
    transcript: string,
    existingMemories: string[],
    adapter: ProviderAdapter,
  ): Promise<DreamCycleResult> {
    const startTime = Date.now();
    const prompt = this.buildDreamPrompt(transcript, existingMemories);

    const result = await adapter.executeTask({
      taskId: randomUUID(),
      action: 'dream-cycle',
      target: 'memory-extraction',
      priority: 'low' as const,
      parameters: {
        _systemPrompt: prompt,
        _conversationHistory: [{ role: 'user', content: 'Please review this conversation and extract memories.' }],
      },
      constraints: [],
    });

    const durationMs = Date.now() - startTime;

    if (!result.ok) {
      return {
        conversationId,
        candidateCount: 0,
        candidates: [],
        tokensUsed: { input: 0, output: 0 },
        cost: 0,
        durationMs,
      };
    }

    const responseText = result.response.textContent;
    const candidates = this.parseDreamResponse(responseText, existingMemories);

    // Record last dream time
    const now = new Date().toISOString();
    this.lastDreamAt.set(conversationId, now);
    this.saveState();

    return {
      conversationId,
      candidateCount: candidates.length,
      candidates,
      tokensUsed: {
        input: result.response.usage?.inputTokens ?? 0,
        output: result.response.usage?.outputTokens ?? 0,
      },
      cost: result.response.cost?.estimatedCostUsd ?? 0,
      durationMs,
    };
  }

  /**
   * Check if a conversation has new messages since the last dream.
   */
  needsDream(conversationId: string, lastMessageAt: string): boolean {
    const lastDream = this.lastDreamAt.get(conversationId);
    if (!lastDream) return true;
    return lastMessageAt > lastDream;
  }

  /**
   * Get the last dream time for a conversation.
   */
  getLastDreamAt(conversationId: string): string | null {
    return this.lastDreamAt.get(conversationId) ?? null;
  }

  /**
   * Build the dream prompt from the template.
   */
  buildDreamPrompt(transcript: string, existingMemories: string[]): string {
    // Truncate transcript to token budget
    const maxChars = this.config.maxTranscriptTokens * CHARS_PER_TOKEN;
    const truncatedTranscript = transcript.length > maxChars ? transcript.slice(-maxChars) : transcript;

    const memoryBlock =
      existingMemories.length > 0 ? existingMemories.map((m, i) => `${i + 1}. ${m}`).join('\n') : '(none)';

    return DREAM_PROMPT_TEMPLATE.replace('{{existingMemories}}', memoryBlock).replace(
      '{{transcript}}',
      truncatedTranscript,
    );
  }

  /**
   * Parse the dream response for [BASTION:MEMORY] blocks, detecting updates.
   */
  parseDreamResponse(response: string, existingMemories?: string[]): MemoryCandidate[] {
    const parsed = parseMemoryBlocks(response);
    const memories = existingMemories ?? [];

    return parsed.map((p) => {
      const updateCheck = this.detectUpdate(p.content, memories);
      return {
        proposalId: randomUUID(),
        content: p.content,
        category: p.category,
        reason: p.reason,
        isUpdate: updateCheck.isUpdate,
        existingMemoryContent: updateCheck.existing,
      };
    });
  }

  /**
   * Detect if a candidate updates an existing memory via fuzzy word overlap.
   */
  detectUpdate(candidate: string, existingMemories: string[]): { isUpdate: boolean; existing?: string } {
    const candidateLower = candidate.toLowerCase();
    const candidateWords = new Set(candidateLower.split(/\s+/).filter((w) => w.length > 3));

    if (candidateWords.size === 0) return { isUpdate: false };

    for (const existing of existingMemories) {
      const existingLower = existing.toLowerCase();
      const existingWords = new Set(existingLower.split(/\s+/).filter((w) => w.length > 3));

      if (existingWords.size === 0) continue;

      let shared = 0;
      for (const word of candidateWords) {
        if (existingWords.has(word)) shared++;
      }

      const similarity = shared / Math.max(candidateWords.size, existingWords.size);
      if (similarity > 0.5 && candidate !== existing) {
        return { isUpdate: true, existing };
      }
    }

    return { isUpdate: false };
  }

  // -------------------------------------------------------------------------
  // Internal — state persistence
  // -------------------------------------------------------------------------

  private loadState(): void {
    try {
      const raw = readFileSync(this.config.configPath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      const lastDreams = data.lastDreamAt as Record<string, string> | undefined;
      if (lastDreams && typeof lastDreams === 'object') {
        for (const [k, v] of Object.entries(lastDreams)) {
          if (typeof v === 'string') this.lastDreamAt.set(k, v);
        }
      }
    } catch {
      // No saved state — fresh start
    }
  }

  private saveState(): void {
    try {
      const data = {
        enabled: this.config.enabled,
        lastDreamAt: Object.fromEntries(this.lastDreamAt),
      };
      writeFileSync(this.config.configPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Write failure is non-fatal
    }
  }
}
