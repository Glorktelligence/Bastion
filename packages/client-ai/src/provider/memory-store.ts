// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * MemoryStore — persistent memory for the AI client.
 *
 * Stores approved memories in SQLite (Node 24 built-in).
 * Memories can be global (conversationId IS NULL) or scoped to a
 * specific conversation. The prompt injection returns a hybrid set:
 * top 10 global + top 10 from the active conversation = 20 total.
 *
 * Plain SQLite, no application-level encryption — the AI VM's
 * VLAN isolation is the security boundary.
 */

import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Memory {
  readonly id: string;
  readonly content: string;
  readonly category: 'preference' | 'fact' | 'workflow' | 'project';
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly conversationId: string | null;
}

export interface MemoryStoreConfig {
  /** Path to SQLite database. Default: '/var/lib/bastion-ai/memories.db'. */
  readonly path?: string;
  /** Maximum memories per scope in system prompt. Default: 10 (10 global + 10 conversation = 20). */
  readonly maxPromptMemoriesPerScope?: number;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    category TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    conversation_id TEXT
  )
`;

const CREATE_INDEX = 'CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC)';
const CREATE_CONV_INDEX =
  'CREATE INDEX IF NOT EXISTS idx_memories_conversation ON memories(conversation_id, updated_at DESC)';

// Migration: add conversation_id column if missing (existing memories become global)
const MIGRATE_ADD_CONVERSATION_ID = `
  ALTER TABLE memories ADD COLUMN conversation_id TEXT
`;

// ---------------------------------------------------------------------------
// MemoryStore
// ---------------------------------------------------------------------------

export class MemoryStore {
  private db: DatabaseSync | null;
  private readonly maxPerScope: number;

  constructor(config?: MemoryStoreConfig) {
    const dbPath = config?.path ?? '/var/lib/bastion-ai/memories.db';
    this.maxPerScope = config?.maxPromptMemoriesPerScope ?? 10;
    this.db = new DatabaseSync(dbPath);
    this.db.exec(CREATE_TABLE);
    this.db.exec(CREATE_INDEX);

    // Migration: add conversation_id column if it doesn't exist
    try {
      this.db.exec(MIGRATE_ADD_CONVERSATION_ID);
    } catch {
      // Column already exists — safe to ignore
    }
    this.db.exec(CREATE_CONV_INDEX);
  }

  /** Add a new approved memory. Returns the memory ID. */
  addMemory(content: string, category: Memory['category'], source: string, conversationId?: string | null): string {
    if (!this.db) throw new Error('Store is closed');
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO memories (id, content, category, source, created_at, updated_at, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, content, category, source, now, now, conversationId ?? null);
    return id;
  }

  /** Get all memories ordered by most recently updated. Optional conversationId filter. */
  getMemories(limit?: number, conversationId?: string | null): readonly Memory[] {
    if (!this.db) throw new Error('Store is closed');
    const maxRows = limit ?? 1000;

    type Row = {
      id: string;
      content: string;
      category: string;
      source: string;
      created_at: string;
      updated_at: string;
      conversation_id: string | null;
    };

    let rows: Row[];
    if (conversationId !== undefined && conversationId !== null) {
      rows = this.db
        .prepare(
          'SELECT id, content, category, source, created_at, updated_at, conversation_id FROM memories WHERE conversation_id = ? ORDER BY updated_at DESC LIMIT ?',
        )
        .all(conversationId, maxRows) as Row[];
    } else if (conversationId === null) {
      rows = this.db
        .prepare(
          'SELECT id, content, category, source, created_at, updated_at, conversation_id FROM memories WHERE conversation_id IS NULL ORDER BY updated_at DESC LIMIT ?',
        )
        .all(maxRows) as Row[];
    } else {
      rows = this.db
        .prepare(
          'SELECT id, content, category, source, created_at, updated_at, conversation_id FROM memories ORDER BY updated_at DESC LIMIT ?',
        )
        .all(maxRows) as Row[];
    }

    return rows.map((r) => this.mapRow(r));
  }

  /** Get memories by category. */
  getMemoriesByCategory(category: Memory['category']): readonly Memory[] {
    if (!this.db) throw new Error('Store is closed');
    const rows = this.db
      .prepare(
        'SELECT id, content, category, source, created_at, updated_at, conversation_id FROM memories WHERE category = ? ORDER BY updated_at DESC',
      )
      .all(category) as Array<{
      id: string;
      content: string;
      category: string;
      source: string;
      created_at: string;
      updated_at: string;
      conversation_id: string | null;
    }>;
    return rows.map((r) => this.mapRow(r));
  }

  /** Update memory content. Bumps updatedAt. Preserves conversationId. */
  updateMemory(id: string, content: string): boolean {
    if (!this.db) throw new Error('Store is closed');
    const result = this.db
      .prepare('UPDATE memories SET content = ?, updated_at = ? WHERE id = ?')
      .run(content, new Date().toISOString(), id);
    return (result as unknown as { changes: number }).changes > 0;
  }

  /** Delete a memory by ID. */
  deleteMemory(id: string): boolean {
    if (!this.db) throw new Error('Store is closed');
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return (result as unknown as { changes: number }).changes > 0;
  }

  /** Search memories by content substring (case-insensitive). Optional conversationId scope. */
  searchMemories(query: string, conversationId?: string | null): readonly Memory[] {
    if (!this.db) throw new Error('Store is closed');

    type Row = {
      id: string;
      content: string;
      category: string;
      source: string;
      created_at: string;
      updated_at: string;
      conversation_id: string | null;
    };

    const pattern = `%${query}%`;
    let rows: Row[];
    if (conversationId !== undefined && conversationId !== null) {
      rows = this.db
        .prepare(
          'SELECT id, content, category, source, created_at, updated_at, conversation_id FROM memories WHERE content LIKE ? AND conversation_id = ? ORDER BY updated_at DESC',
        )
        .all(pattern, conversationId) as Row[];
    } else {
      rows = this.db
        .prepare(
          'SELECT id, content, category, source, created_at, updated_at, conversation_id FROM memories WHERE content LIKE ? ORDER BY updated_at DESC',
        )
        .all(pattern) as Row[];
    }

    return rows.map((r) => this.mapRow(r));
  }

  /** Get the total number of memories. */
  get count(): number {
    if (!this.db) throw new Error('Store is closed');
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM memories').get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  /**
   * Get the hybrid memory set for system prompt injection.
   *
   * Returns a formatted text block with:
   *   - Top N global memories (conversationId IS NULL)
   *   - Top N conversation-scoped memories (if activeConversationId provided)
   *
   * Default N = 10, so up to 20 memories total.
   */
  getPromptMemories(activeConversationId?: string | null): string {
    if (!this.db) throw new Error('Store is closed');

    // Global memories (top N)
    const globalRows = this.db
      .prepare(
        'SELECT id, content, category, source, created_at, updated_at, conversation_id FROM memories WHERE conversation_id IS NULL ORDER BY updated_at DESC LIMIT ?',
      )
      .all(this.maxPerScope) as Array<{
      id: string;
      content: string;
      category: string;
      source: string;
      created_at: string;
      updated_at: string;
      conversation_id: string | null;
    }>;
    const globalMemories = globalRows.map((r) => this.mapRow(r));

    // Conversation-scoped memories (top N)
    let convMemories: Memory[] = [];
    if (activeConversationId) {
      const convRows = this.db
        .prepare(
          'SELECT id, content, category, source, created_at, updated_at, conversation_id FROM memories WHERE conversation_id = ? ORDER BY updated_at DESC LIMIT ?',
        )
        .all(activeConversationId, this.maxPerScope) as Array<{
        id: string;
        content: string;
        category: string;
        source: string;
        created_at: string;
        updated_at: string;
        conversation_id: string | null;
      }>;
      convMemories = convRows.map((r) => this.mapRow(r));
    }

    const parts: string[] = [];
    if (globalMemories.length > 0) {
      const lines = globalMemories.map((m) => `- [${m.category}] ${m.content}`);
      parts.push(`--- Global Memories (${globalMemories.length}) ---\n${lines.join('\n')}`);
    }
    if (convMemories.length > 0) {
      const lines = convMemories.map((m) => `- [${m.category}] ${m.content}`);
      parts.push(`--- Conversation Memories (${convMemories.length}) ---\n${lines.join('\n')}`);
    }

    return parts.join('\n\n');
  }

  /** Close the database connection. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private mapRow(r: {
    id: string;
    content: string;
    category: string;
    source: string;
    created_at: string;
    updated_at: string;
    conversation_id: string | null;
  }): Memory {
    return {
      id: r.id,
      content: r.content,
      category: r.category as Memory['category'],
      source: r.source,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      conversationId: r.conversation_id,
    };
  }
}
