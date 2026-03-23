// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * MemoryStore — persistent memory for the AI client.
 *
 * Stores approved memories in SQLite (Node 24 built-in).
 * Memories are injected into the system prompt between role context
 * and user context. Top 20 by recency are included per call.
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
}

export interface MemoryStoreConfig {
  /** Path to SQLite database. Default: '/var/lib/bastion-ai/memories.db'. */
  readonly path?: string;
  /** Maximum memories to include in system prompt. Default: 20. */
  readonly maxPromptMemories?: number;
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
    updated_at TEXT NOT NULL
  )
`;

const CREATE_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC)
`;

// ---------------------------------------------------------------------------
// MemoryStore
// ---------------------------------------------------------------------------

export class MemoryStore {
  private db: DatabaseSync | null;
  private readonly maxPromptMemories: number;

  constructor(config?: MemoryStoreConfig) {
    const dbPath = config?.path ?? '/var/lib/bastion-ai/memories.db';
    this.maxPromptMemories = config?.maxPromptMemories ?? 20;
    this.db = new DatabaseSync(dbPath);
    this.db.exec(CREATE_TABLE);
    this.db.exec(CREATE_INDEX);
  }

  /** Add a new approved memory. Returns the memory ID. */
  addMemory(content: string, category: Memory['category'], source: string): string {
    if (!this.db) throw new Error('Store is closed');
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT INTO memories (id, content, category, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, content, category, source, now, now);
    return id;
  }

  /** Get all memories ordered by most recently updated. */
  getMemories(limit?: number): readonly Memory[] {
    if (!this.db) throw new Error('Store is closed');
    const rows = this.db
      .prepare(
        'SELECT id, content, category, source, created_at, updated_at FROM memories ORDER BY updated_at DESC LIMIT ?',
      )
      .all(limit ?? 1000) as Array<{
      id: string;
      content: string;
      category: string;
      source: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      category: r.category as Memory['category'],
      source: r.source,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /** Get memories by category. */
  getMemoriesByCategory(category: Memory['category']): readonly Memory[] {
    if (!this.db) throw new Error('Store is closed');
    const rows = this.db
      .prepare(
        'SELECT id, content, category, source, created_at, updated_at FROM memories WHERE category = ? ORDER BY updated_at DESC',
      )
      .all(category) as Array<{
      id: string;
      content: string;
      category: string;
      source: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      category: r.category as Memory['category'],
      source: r.source,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /** Update memory content. Bumps updatedAt. */
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

  /** Search memories by content substring (case-insensitive). */
  searchMemories(query: string): readonly Memory[] {
    if (!this.db) throw new Error('Store is closed');
    const rows = this.db
      .prepare(
        'SELECT id, content, category, source, created_at, updated_at FROM memories WHERE content LIKE ? ORDER BY updated_at DESC',
      )
      .all(`%${query}%`) as Array<{
      id: string;
      content: string;
      category: string;
      source: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      category: r.category as Memory['category'],
      source: r.source,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /** Get the total number of memories. */
  get count(): number {
    if (!this.db) throw new Error('Store is closed');
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM memories').get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  /**
   * Get the top N memories for system prompt injection.
   * Returns formatted text block ready for prompt assembly.
   */
  getPromptMemories(): string {
    const memories = this.getMemories(this.maxPromptMemories);
    if (memories.length === 0) return '';
    const lines = memories.map((m) => `- [${m.category}] ${m.content}`);
    return `--- Remembered Context (${memories.length} memories) ---\n${lines.join('\n')}`;
  }

  /** Close the database connection. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
