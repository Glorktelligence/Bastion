// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * ConversationStore — SQLite-persisted multi-conversation storage.
 *
 * Each conversation has its own message thread with hash chain integrity.
 * Messages survive process restarts. The active conversation ID is
 * tracked persistently so the AI resumes where it left off.
 *
 * Hash chain: each message's hash = SHA-256(content + timestamp + previousHash).
 * Chain verification detects tampering or data corruption.
 */

import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { DateTimeManager } from './datetime-manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationRecord {
  readonly id: string;
  readonly name: string;
  readonly type: 'normal' | 'game';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archived: boolean;
  readonly messageCount: number;
  readonly lastMessagePreview: string;
  readonly metadata: Record<string, unknown> | null;
  readonly preferredAdapter: string | null;
}

export interface MessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly role: 'user' | 'assistant';
  readonly type: string;
  readonly content: string;
  readonly timestamp: string;
  readonly hash: string;
  readonly previousHash: string | null;
  readonly pinned: boolean;
  readonly metadata: Record<string, unknown> | null;
}

export interface CompactionSummary {
  readonly id: string;
  readonly conversationId: string;
  readonly fromMessageId: string;
  readonly toMessageId: string;
  readonly summary: string;
  readonly messagesCovered: number;
  readonly tokensSaved: number;
  readonly createdAt: string;
}

export interface ChainVerification {
  readonly valid: boolean;
  readonly checkedCount: number;
  readonly brokenAt?: string;
}

export interface ConversationStoreConfig {
  /** Path to SQLite database. Default: '/var/lib/bastion/conversations.db'. */
  readonly path?: string;
  /** Injected DateTimeManager — sole time authority. Falls back to raw Date if omitted. */
  readonly dateTimeManager?: DateTimeManager;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const CREATE_CONVERSATIONS = `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'normal',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    messageCount INTEGER NOT NULL DEFAULT 0,
    lastMessagePreview TEXT NOT NULL DEFAULT '',
    metadata TEXT
  )
`;

const CREATE_MESSAGES = `
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversationId TEXT NOT NULL,
    role TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    hash TEXT NOT NULL,
    previousHash TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    metadata TEXT,
    FOREIGN KEY (conversationId) REFERENCES conversations(id)
  )
`;

const CREATE_MSG_INDEX = 'CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversationId, timestamp)';
const CREATE_CONV_INDEX = 'CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updatedAt DESC)';

const CREATE_CONFIG = `
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`;

const CREATE_COMPACTION_SUMMARIES = `
  CREATE TABLE IF NOT EXISTS compaction_summaries (
    id TEXT PRIMARY KEY,
    conversationId TEXT NOT NULL,
    fromMessageId TEXT NOT NULL,
    toMessageId TEXT NOT NULL,
    summary TEXT NOT NULL,
    messagesCovered INTEGER NOT NULL,
    tokensSaved INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (conversationId) REFERENCES conversations(id)
  )
`;

const CREATE_COMPACTION_INDEX =
  'CREATE INDEX IF NOT EXISTS idx_compaction_conversation ON compaction_summaries(conversationId, createdAt DESC)';

// ---------------------------------------------------------------------------
// ConversationStore
// ---------------------------------------------------------------------------

export class ConversationStore {
  private readonly db: InstanceType<typeof DatabaseSync>;
  private readonly dateTimeManager: DateTimeManager | null;

  constructor(config?: ConversationStoreConfig) {
    this.dateTimeManager = config?.dateTimeManager ?? null;
    const dbPath = config?.path ?? '/var/lib/bastion/conversations.db';
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA foreign_keys=ON');
    this.db.exec(CREATE_CONVERSATIONS);
    this.db.exec(CREATE_MESSAGES);
    this.db.exec(CREATE_MSG_INDEX);
    this.db.exec(CREATE_CONV_INDEX);
    this.db.exec(CREATE_CONFIG);
    this.db.exec(CREATE_COMPACTION_SUMMARIES);
    this.db.exec(CREATE_COMPACTION_INDEX);
    // Migration: add preferredAdapter column if missing
    try {
      this.db.exec('ALTER TABLE conversations ADD COLUMN preferredAdapter TEXT');
    } catch {
      /* already exists */
    }
  }

  // -----------------------------------------------------------------------
  // Conversation CRUD
  // -----------------------------------------------------------------------

  createConversation(name?: string, type?: 'normal' | 'game', preferredAdapter?: string | null): ConversationRecord {
    const id = randomUUID();
    const ts = this.now();
    const convName = name || 'New Conversation';
    const convType = type || 'normal';
    const adapter = preferredAdapter ?? null;

    this.db
      .prepare(
        'INSERT INTO conversations (id, name, type, createdAt, updatedAt, preferredAdapter) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, convName, convType, ts, ts, adapter);

    return {
      id,
      name: convName,
      type: convType,
      createdAt: ts,
      updatedAt: ts,
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      metadata: null,
      preferredAdapter: adapter,
    };
  }

  getConversation(id: string): ConversationRecord | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapConversation(row) : null;
  }

  listConversations(includeArchived = false): ConversationRecord[] {
    const sql = includeArchived
      ? 'SELECT * FROM conversations ORDER BY updatedAt DESC'
      : 'SELECT * FROM conversations WHERE archived = 0 ORDER BY updatedAt DESC';
    const rows = this.db.prepare(sql).all() as Record<string, unknown>[];
    return rows.map((r) => this.mapConversation(r));
  }

  get conversationCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM conversations WHERE archived = 0').get() as {
      cnt: number;
    };
    return row.cnt;
  }

  updatePreferredAdapter(id: string, adapterId: string): boolean {
    const result = this.db
      .prepare('UPDATE conversations SET preferredAdapter = ?, updatedAt = ? WHERE id = ?')
      .run(adapterId, this.now(), id);
    return result.changes > 0;
  }

  archiveConversation(id: string): boolean {
    const result = this.db
      .prepare('UPDATE conversations SET archived = 1, updatedAt = ? WHERE id = ?')
      .run(this.now(), id);
    return result.changes > 0;
  }

  deleteConversation(id: string): boolean {
    this.db.prepare('DELETE FROM messages WHERE conversationId = ?').run(id);
    const result = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // -----------------------------------------------------------------------
  // Message storage with hash chain
  // -----------------------------------------------------------------------

  addMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    type: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): MessageRecord {
    const id = randomUUID();
    const timestamp = this.now();

    // Get previous hash for chain
    const lastMsg = this.db
      .prepare('SELECT hash FROM messages WHERE conversationId = ? ORDER BY timestamp DESC LIMIT 1')
      .get(conversationId) as { hash: string } | undefined;
    const previousHash = lastMsg?.hash ?? null;

    // Compute hash chain: SHA-256(content + timestamp + previousHash)
    const hashInput = content + timestamp + (previousHash ?? '');
    const hash = createHash('sha256').update(hashInput).digest('hex');

    const metaStr = metadata ? JSON.stringify(metadata) : null;

    this.db
      .prepare(
        'INSERT INTO messages (id, conversationId, role, type, content, timestamp, hash, previousHash, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, conversationId, role, type, content, timestamp, hash, previousHash, metaStr);

    // Update conversation metadata
    const preview = content.length > 100 ? `${content.slice(0, 100)}...` : content;
    this.db
      .prepare(
        'UPDATE conversations SET messageCount = messageCount + 1, updatedAt = ?, lastMessagePreview = ? WHERE id = ?',
      )
      .run(timestamp, preview, conversationId);

    return {
      id,
      conversationId,
      role,
      type,
      content,
      timestamp,
      hash,
      previousHash,
      pinned: false,
      metadata: metadata ?? null,
    };
  }

  getMessages(conversationId: string, limit = 50, offset = 0): MessageRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE conversationId = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?')
      .all(conversationId, limit, offset) as Record<string, unknown>[];
    return rows.map((r) => this.mapMessage(r));
  }

  getRecentMessages(conversationId: string, limit = 50): MessageRecord[] {
    // Returns messages in chronological order (oldest first) for buffer loading
    const rows = this.db
      .prepare(
        'SELECT * FROM (SELECT * FROM messages WHERE conversationId = ? ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC',
      )
      .all(conversationId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapMessage(r));
  }

  getMessageCount(conversationId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversationId = ?')
      .get(conversationId) as { cnt: number };
    return row.cnt;
  }

  pinMessage(messageId: string, pinned: boolean): boolean {
    const result = this.db.prepare('UPDATE messages SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, messageId);
    return result.changes > 0;
  }

  // -----------------------------------------------------------------------
  // Hash chain verification
  // -----------------------------------------------------------------------

  verifyChain(conversationId: string): ChainVerification {
    const rows = this.db
      .prepare(
        'SELECT id, content, timestamp, hash, previousHash FROM messages WHERE conversationId = ? ORDER BY timestamp ASC',
      )
      .all(conversationId) as Array<{
      id: string;
      content: string;
      timestamp: string;
      hash: string;
      previousHash: string | null;
    }>;

    let prevHash: string | null = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      // Verify previousHash pointer
      if (row.previousHash !== prevHash) {
        return { valid: false, checkedCount: i, brokenAt: row.id };
      }
      // Verify hash computation
      const expected: string = createHash('sha256')
        .update(row.content + row.timestamp + (prevHash ?? ''))
        .digest('hex');
      if (row.hash !== expected) {
        return { valid: false, checkedCount: i, brokenAt: row.id };
      }
      prevHash = row.hash;
    }

    return { valid: true, checkedCount: rows.length };
  }

  // -----------------------------------------------------------------------
  // Active conversation tracking
  // -----------------------------------------------------------------------

  getActiveConversationId(): string | null {
    const row = this.db.prepare("SELECT value FROM config WHERE key = 'activeConversationId'").get() as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setActiveConversation(id: string): void {
    this.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('activeConversationId', ?)").run(id);
  }

  // -----------------------------------------------------------------------
  // Compaction summaries
  // -----------------------------------------------------------------------

  /** Store a compaction summary. */
  addCompactionSummary(
    conversationId: string,
    fromMessageId: string,
    toMessageId: string,
    summary: string,
    messagesCovered: number,
    tokensSaved: number,
  ): CompactionSummary {
    const id = randomUUID();
    const ts = this.now();
    this.db
      .prepare(
        'INSERT INTO compaction_summaries (id, conversationId, fromMessageId, toMessageId, summary, messagesCovered, tokensSaved, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, conversationId, fromMessageId, toMessageId, summary, messagesCovered, tokensSaved, ts);
    return { id, conversationId, fromMessageId, toMessageId, summary, messagesCovered, tokensSaved, createdAt: ts };
  }

  /** Get the most recent compaction summary for a conversation. */
  getLatestCompaction(conversationId: string): CompactionSummary | null {
    const row = this.db
      .prepare('SELECT * FROM compaction_summaries WHERE conversationId = ? ORDER BY createdAt DESC LIMIT 1')
      .get(conversationId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      conversationId: String(row.conversationId),
      fromMessageId: String(row.fromMessageId),
      toMessageId: String(row.toMessageId),
      summary: String(row.summary),
      messagesCovered: Number(row.messagesCovered),
      tokensSaved: Number(row.tokensSaved),
      createdAt: String(row.createdAt),
    };
  }

  /** Get non-pinned messages older than the most recent N, for compaction. */
  getCompactableMessages(conversationId: string, keepRecent = 50): MessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE conversationId = ? AND pinned = 0
         AND timestamp < (SELECT timestamp FROM messages WHERE conversationId = ? ORDER BY timestamp DESC LIMIT 1 OFFSET ?)
         ORDER BY timestamp ASC`,
      )
      .all(conversationId, conversationId, keepRecent - 1) as Record<string, unknown>[];
    return rows.map((r) => this.mapMessage(r));
  }

  /**
   * Get messages added after a specific message ID.
   * Uses the timestamp of the reference message to find subsequent messages.
   * Returns messages in chronological order (oldest first).
   */
  getMessagesSince(conversationId: string, afterMessageId: string): MessageRecord[] {
    // Get the timestamp of the reference message
    const ref = this.db
      .prepare('SELECT timestamp FROM messages WHERE id = ? AND conversationId = ?')
      .get(afterMessageId, conversationId) as { timestamp: string } | undefined;
    if (!ref) return this.getRecentMessages(conversationId, 10000);

    const rows = this.db
      .prepare('SELECT * FROM messages WHERE conversationId = ? AND timestamp > ? ORDER BY timestamp ASC')
      .all(conversationId, ref.timestamp) as Record<string, unknown>[];
    return rows.map((r) => this.mapMessage(r));
  }

  /** Get pinned messages for a conversation. */
  getPinnedMessages(conversationId: string): MessageRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE conversationId = ? AND pinned = 1 ORDER BY timestamp ASC')
      .all(conversationId) as Record<string, unknown>[];
    return rows.map((r) => this.mapMessage(r));
  }

  // -----------------------------------------------------------------------
  // Search — keyword-based message retrieval for recall
  // -----------------------------------------------------------------------

  /**
   * Search all messages in a conversation by keyword query.
   * Returns matches sorted by relevance (keyword hit count).
   * Searches across ALL messages including those covered by compaction summaries.
   */
  searchMessages(conversationId: string, query: string, limit = 5): MessageRecord[] {
    const allMessages = this.db
      .prepare('SELECT * FROM messages WHERE conversationId = ? ORDER BY timestamp ASC')
      .all(conversationId) as Record<string, unknown>[];

    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    if (keywords.length === 0) return [];

    const scored: Array<{ msg: Record<string, unknown>; score: number }> = [];
    const queryLower = query.toLowerCase();

    for (const msg of allMessages) {
      const contentLower = String(msg.content ?? '').toLowerCase();
      let score = 0;
      for (const keyword of keywords) {
        if (contentLower.includes(keyword)) score++;
      }
      // Bonus for exact phrase match
      if (contentLower.includes(queryLower)) score += 3;
      if (score > 0) scored.push({ msg, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => this.mapMessage(s.msg));
  }

  /**
   * Get message context — the message before and after a given message.
   */
  getMessageContext(conversationId: string, messageId: string): { before?: MessageRecord; after?: MessageRecord } {
    const beforeRow = this.db
      .prepare(
        'SELECT * FROM messages WHERE conversationId = ? AND timestamp < (SELECT timestamp FROM messages WHERE id = ?) ORDER BY timestamp DESC LIMIT 1',
      )
      .get(conversationId, messageId) as Record<string, unknown> | undefined;
    const afterRow = this.db
      .prepare(
        'SELECT * FROM messages WHERE conversationId = ? AND timestamp > (SELECT timestamp FROM messages WHERE id = ?) ORDER BY timestamp ASC LIMIT 1',
      )
      .get(conversationId, messageId) as Record<string, unknown> | undefined;
    return {
      before: beforeRow ? this.mapMessage(beforeRow) : undefined,
      after: afterRow ? this.mapMessage(afterRow) : undefined,
    };
  }

  // -----------------------------------------------------------------------
  // Migration: import existing in-memory messages
  // -----------------------------------------------------------------------

  migrateFromBuffer(messages: readonly { role: 'user' | 'assistant'; content: string }[]): string {
    const conv = this.createConversation('Default', 'normal');
    for (const msg of messages) {
      this.addMessage(conv.id, msg.role, 'conversation', msg.content);
    }
    this.setActiveConversation(conv.id);
    return conv.id;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private now(): string {
    return this.dateTimeManager?.now().iso ?? new Date().toISOString();
  }

  private mapConversation(row: Record<string, unknown>): ConversationRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      type: String(row.type) as 'normal' | 'game',
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      archived: Boolean(row.archived),
      messageCount: Number(row.messageCount),
      lastMessagePreview: String(row.lastMessagePreview ?? ''),
      metadata: row.metadata ? JSON.parse(String(row.metadata)) : null,
      preferredAdapter: row.preferredAdapter ? String(row.preferredAdapter) : null,
    };
  }

  private mapMessage(row: Record<string, unknown>): MessageRecord {
    return {
      id: String(row.id),
      conversationId: String(row.conversationId),
      role: String(row.role) as 'user' | 'assistant',
      type: String(row.type),
      content: String(row.content),
      timestamp: String(row.timestamp),
      hash: String(row.hash),
      previousHash: row.previousHash ? String(row.previousHash) : null,
      pinned: Boolean(row.pinned),
      metadata: row.metadata ? JSON.parse(String(row.metadata)) : null,
    };
  }
}
