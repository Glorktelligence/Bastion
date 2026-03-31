// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * SQLite-backed audit log storage.
 *
 * Stores HashedAuditEntry records in a SQLite database with indices
 * for efficient querying by time range, event type, and session ID.
 * Uses node:sqlite (built-in since Node 22.5) for zero-dependency
 * synchronous access.
 *
 * The store is append-only by design — entries are inserted but
 * never updated or deleted. This matches the tamper-evident hash
 * chain model: any modification would break the chain.
 */

import { DatabaseSync } from 'node:sqlite';
import type { HashedAuditEntry } from '@bastion/crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the audit store. */
export interface AuditStoreConfig {
  /**
   * Path to the SQLite database file.
   * Use ':memory:' for in-memory storage (testing/ephemeral).
   */
  readonly path: string;
}

/** Query filters for retrieving audit entries. */
export interface AuditQuery {
  /** Start of time range (inclusive, ISO 8601). */
  readonly startTime?: string;
  /** End of time range (inclusive, ISO 8601). */
  readonly endTime?: string;
  /** Filter by event type. */
  readonly eventType?: string;
  /** Filter by session ID. */
  readonly sessionId?: string;
  /** Maximum number of entries to return. */
  readonly limit?: number;
  /** Offset for pagination. */
  readonly offset?: number;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS audit_entries (
    idx INTEGER PRIMARY KEY,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,
    session_id TEXT NOT NULL,
    detail TEXT NOT NULL,
    chain_hash TEXT NOT NULL
  )
`;

const CREATE_INDICES = `
  CREATE INDEX IF NOT EXISTS idx_ae_timestamp ON audit_entries(timestamp);
  CREATE INDEX IF NOT EXISTS idx_ae_event_type ON audit_entries(event_type);
  CREATE INDEX IF NOT EXISTS idx_ae_session_id ON audit_entries(session_id)
`;

// ---------------------------------------------------------------------------
// AuditStore
// ---------------------------------------------------------------------------

/**
 * SQLite-backed append-only audit log store.
 *
 * Usage:
 *   1. Create: `const store = new AuditStore({ path: './audit.db' })`
 *   2. Insert: `store.insert(hashedEntry)`
 *   3. Query: `store.query({ eventType: 'message_routed', limit: 50 })`
 *   4. Close: `store.close()`
 */
export class AuditStore {
  private db: DatabaseSync | null;
  private readonly insertStmt: ReturnType<DatabaseSync['prepare']>;

  constructor(config: AuditStoreConfig) {
    this.db = new DatabaseSync(config.path);
    this.db.exec(CREATE_TABLE);
    this.db.exec(CREATE_INDICES);
    this.insertStmt = this.db.prepare(
      'INSERT INTO audit_entries (idx, timestamp, event_type, session_id, detail, chain_hash) VALUES (?, ?, ?, ?, ?, ?)',
    );
  }

  /**
   * Insert a hashed audit entry into the store.
   *
   * @param entry — the chain-hashed entry to store
   * @throws AuditStoreError on duplicate index or closed store
   */
  insert(entry: HashedAuditEntry): void {
    if (!this.db) throw new AuditStoreError('Store is closed');

    try {
      this.insertStmt.run(
        entry.index,
        entry.timestamp,
        entry.eventType,
        entry.sessionId,
        JSON.stringify(entry.detail),
        entry.chainHash,
      );
    } catch (err) {
      throw new AuditStoreError(`Failed to insert entry at index ${entry.index}: ${String(err)}`);
    }
  }

  /**
   * Get the last entry in the store (highest index).
   *
   * @returns the last HashedAuditEntry, or undefined if empty
   */
  getLastEntry(): HashedAuditEntry | undefined {
    if (!this.db) throw new AuditStoreError('Store is closed');

    const row = this.db
      .prepare(
        'SELECT idx, timestamp, event_type, session_id, detail, chain_hash FROM audit_entries ORDER BY idx DESC LIMIT 1',
      )
      .get() as AuditRow | undefined;

    return row ? rowToEntry(row) : undefined;
  }

  /**
   * Get a specific entry by index.
   *
   * @param index — the entry index
   * @returns the entry or undefined
   */
  getEntry(index: number): HashedAuditEntry | undefined {
    if (!this.db) throw new AuditStoreError('Store is closed');

    const row = this.db
      .prepare('SELECT idx, timestamp, event_type, session_id, detail, chain_hash FROM audit_entries WHERE idx = ?')
      .get(index) as AuditRow | undefined;

    return row ? rowToEntry(row) : undefined;
  }

  /**
   * Get a contiguous range of entries [startIndex, endIndex] inclusive.
   *
   * @param startIndex — first index (inclusive)
   * @param endIndex — last index (inclusive)
   * @returns ordered array of entries
   */
  getRange(startIndex: number, endIndex: number): HashedAuditEntry[] {
    if (!this.db) throw new AuditStoreError('Store is closed');

    const rows = this.db
      .prepare(
        'SELECT idx, timestamp, event_type, session_id, detail, chain_hash FROM audit_entries WHERE idx >= ? AND idx <= ? ORDER BY idx',
      )
      .all(startIndex, endIndex) as unknown as AuditRow[];

    return rows.map(rowToEntry);
  }

  /**
   * Query entries with optional filters.
   *
   * @param query — filter criteria
   * @returns matching entries ordered by index
   */
  query(query: AuditQuery = {}): HashedAuditEntry[] {
    if (!this.db) throw new AuditStoreError('Store is closed');

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (query.startTime) {
      conditions.push('timestamp >= ?');
      params.push(query.startTime);
    }
    if (query.endTime) {
      conditions.push('timestamp <= ?');
      params.push(query.endTime);
    }
    if (query.eventType) {
      conditions.push('event_type = ?');
      params.push(query.eventType);
    }
    if (query.sessionId) {
      conditions.push('session_id = ?');
      params.push(query.sessionId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ? `LIMIT ${query.limit}` : '';
    const offset = query.offset ? `OFFSET ${query.offset}` : '';

    const sql = `SELECT idx, timestamp, event_type, session_id, detail, chain_hash FROM audit_entries ${where} ORDER BY idx ${limit} ${offset}`;

    const rows = this.db.prepare(sql).all(...params) as unknown as AuditRow[];
    return rows.map(rowToEntry);
  }

  /**
   * Get the total number of entries in the store.
   */
  get entryCount(): number {
    if (!this.db) throw new AuditStoreError('Store is closed');

    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM audit_entries').get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  /**
   * Count entries matching the given filters (same WHERE clause as query(),
   * but returns SELECT COUNT(*) instead of rows).
   *
   * Used by the admin API to return the real totalCount for pagination.
   */
  count(query: Omit<AuditQuery, 'limit' | 'offset'>): number {
    if (!this.db) throw new AuditStoreError('Store is closed');

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (query.startTime) {
      conditions.push('timestamp >= ?');
      params.push(query.startTime);
    }
    if (query.endTime) {
      conditions.push('timestamp <= ?');
      params.push(query.endTime);
    }
    if (query.eventType) {
      conditions.push('event_type = ?');
      params.push(query.eventType);
    }
    if (query.sessionId) {
      conditions.push('session_id = ?');
      params.push(query.sessionId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT COUNT(*) as cnt FROM audit_entries ${where}`;

    const row = this.db.prepare(sql).all(...params) as unknown as { cnt: number }[];
    return row[0]?.cnt ?? 0;
  }

  /**
   * Get all entries ordered by index. Use with caution on large stores.
   */
  getAllEntries(): HashedAuditEntry[] {
    if (!this.db) throw new AuditStoreError('Store is closed');

    const rows = this.db
      .prepare('SELECT idx, timestamp, event_type, session_id, detail, chain_hash FROM audit_entries ORDER BY idx')
      .all() as unknown as AuditRow[];

    return rows.map(rowToEntry);
  }

  /** Whether the store is closed. */
  get isClosed(): boolean {
    return this.db === null;
  }

  /** Close the database connection. */
  close(): void {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }
}

// ---------------------------------------------------------------------------
// Internal: Row mapping
// ---------------------------------------------------------------------------

interface AuditRow {
  idx: number;
  timestamp: string;
  event_type: string;
  session_id: string;
  detail: string;
  chain_hash: string;
}

function rowToEntry(row: AuditRow): HashedAuditEntry {
  return {
    index: row.idx,
    timestamp: row.timestamp,
    eventType: row.event_type,
    sessionId: row.session_id,
    detail: JSON.parse(row.detail) as Record<string, unknown>,
    chainHash: row.chain_hash,
  };
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class AuditStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditStoreError';
  }
}
