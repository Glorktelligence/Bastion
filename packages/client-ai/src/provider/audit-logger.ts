// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * AI client audit logger with tamper-evident SQLite hash chain.
 *
 * Identical in pattern to the relay's AuditLogger but with AI-client-specific
 * event types (bash commands, tool approvals, safety evaluations, memory
 * proposals, extensions, dream cycles, etc.).
 *
 * The chain hash ensures any tampering (modification, deletion, reordering)
 * is detectable by verifying the chain. Each entry's hash depends on all
 * prior entries via:
 *   hash_n = SHA-256( hash_{n-1} || canonical(entry_n) )
 */

import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { DateTimeManager } from './datetime-manager.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000000';

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS audit_events (
  idx INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  principal TEXT NOT NULL,
  source TEXT NOT NULL,
  severity TEXT NOT NULL,
  data TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  hash TEXT NOT NULL
)`;

const CREATE_INDEX_TIMESTAMP = 'CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp)';
const CREATE_INDEX_EVENT_TYPE = 'CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_events(event_type)';
const CREATE_INDEX_SEVERITY = 'CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_events(severity)';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single audit event as stored and returned. */
export interface AuditEvent {
  readonly index: number;
  readonly eventType: string;
  readonly timestamp: string;
  readonly principal: string;
  readonly source: string;
  readonly severity: string;
  readonly data: Record<string, unknown>;
  readonly previousHash: string;
  readonly hash: string;
}

/** Configuration for the AI client audit logger. */
export interface AiClientAuditLoggerConfig {
  readonly path: string;
  readonly dateTimeManager?: DateTimeManager;
}

// ---------------------------------------------------------------------------
// Event type registry
// ---------------------------------------------------------------------------

/** Standard audit event types for the AI client. */
export const AI_AUDIT_EVENT_TYPES = {
  BASH_COMMAND: 'bash_command',
  BASH_BLOCKED: 'bash_blocked',
  BASH_INVISIBLE: 'bash_invisible',
  TOOL_REGISTERED: 'tool_registered',
  TOOL_VIOLATION: 'tool_violation',
  TOOL_UPSTREAM_DETECTED: 'tool_upstream_detected',
  TOOL_APPROVED: 'tool_approved',
  TOOL_DENIED: 'tool_denied',
  TOOL_REVOKED: 'tool_revoked',
  SKILL_SCANNED: 'skill_scanned',
  SKILL_APPROVED: 'skill_approved',
  SKILL_REJECTED: 'skill_rejected',
  SKILL_VIOLATION: 'skill_violation',
  MEMORY_PROPOSED: 'memory_proposed',
  MEMORY_APPROVED: 'memory_approved',
  MEMORY_REJECTED: 'memory_rejected',
  RECALL_SEARCH: 'recall_search',
  CHALLENGE_ISSUED: 'challenge_issued',
  CHALLENGE_ACCEPTED: 'challenge_accepted',
  CHALLENGE_REJECTED: 'challenge_rejected',
  CHALLENGE_OVERRIDDEN: 'challenge_overridden',
  SAFETY_DENIED: 'safety_denied',
  SAFETY_CHALLENGED: 'safety_challenged',
  SAFETY_ALLOWED: 'safety_allowed',
  EXTENSION_HANDLED: 'extension_handled',
  EXTENSION_ERROR: 'extension_error',
  PURGE_STAGED: 'purge_staged',
  PURGE_VIOLATION: 'purge_violation',
  COMPACTION_TRIGGERED: 'compaction_triggered',
  COMPACTION_COMPLETE: 'compaction_complete',
  DREAM_CYCLE_START: 'dream_cycle_start',
  DREAM_CYCLE_COMPLETE: 'dream_cycle_complete',
  CONVERSATION_CREATED: 'conversation_created',
  CONVERSATION_SWITCHED: 'conversation_switched',
  AUTH_SUCCESS: 'auth_success',
  AUTH_FAILURE: 'auth_failure',
  CONNECTION_OPENED: 'connection_opened',
  CONNECTION_CLOSED: 'connection_closed',
  BUDGET_BLOCKED: 'budget_blocked',
  BUDGET_COOLDOWN: 'budget_cooldown',
  BUDGET_CONFIG_APPLIED: 'budget_config_applied',
  DATA_EXPORT: 'data_export',
  DATA_IMPORT: 'data_import',
  DATA_ERASURE: 'data_erasure',
  AUDIT_CHAIN_LOGGING_VIOLATION: 'audit_chain_logging_violation',
} as const;

export type AiAuditEventType = (typeof AI_AUDIT_EVENT_TYPES)[keyof typeof AI_AUDIT_EVENT_TYPES];

// ---------------------------------------------------------------------------
// AiClientAuditLogger
// ---------------------------------------------------------------------------

/**
 * Tamper-evident audit logger for the AI client with hash chain and SQLite storage.
 *
 * Usage:
 *   1. Create: `const logger = new AiClientAuditLogger(config)`
 *   2. Register extra event types: `logger.registerEventType('custom_event')`
 *   3. Lock types: `logger.lockEventTypes()`
 *   4. Log events: `logger.logEvent('bash_command', 'ai', 'bastion-bash', { ... })`
 *   5. Query: `logger.query({ eventType: 'safety_denied' })`
 *   6. Verify: `logger.verifyChainIntegrity()`
 *   7. Close: `logger.close()`
 */
export class AiClientAuditLogger {
  private readonly db: DatabaseSync;
  private readonly dateTimeManager: DateTimeManager | undefined;
  private readonly registeredTypes: Set<string>;
  private typesLocked = false;
  private nextIndex: number;
  private lastHash: string;
  private closed = false;

  constructor(config: AiClientAuditLoggerConfig) {
    this.dateTimeManager = config.dateTimeManager;
    this.registeredTypes = new Set<string>();

    // Open SQLite database
    this.db = new DatabaseSync(config.path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(CREATE_TABLE);
    this.db.exec(CREATE_INDEX_TIMESTAMP);
    this.db.exec(CREATE_INDEX_EVENT_TYPE);
    this.db.exec(CREATE_INDEX_SEVERITY);

    // Resume chain state from the store
    const lastRow = this.db.prepare('SELECT idx, hash FROM audit_events ORDER BY idx DESC LIMIT 1').get() as
      | { idx: number; hash: string }
      | undefined;

    if (lastRow) {
      this.nextIndex = lastRow.idx + 1;
      this.lastHash = lastRow.hash;
    } else {
      this.nextIndex = 0;
      this.lastHash = GENESIS_SEED;
    }

    // Register all built-in event types
    for (const eventType of Object.values(AI_AUDIT_EVENT_TYPES)) {
      this.registeredTypes.add(eventType);
    }
  }

  // -------------------------------------------------------------------------
  // Event type registration
  // -------------------------------------------------------------------------

  /**
   * Register a custom event type for audit logging.
   * Must be called before lockEventTypes().
   */
  registerEventType(eventType: string): void {
    if (this.typesLocked) {
      throw new AiClientAuditLoggerError('Event types are locked — cannot register new types after lock');
    }
    this.registeredTypes.add(eventType);
  }

  /**
   * Lock event types — after this call, only registered types can be logged.
   * Unregistered types will be logged as AUDIT_CHAIN_LOGGING_VIOLATION instead.
   */
  lockEventTypes(): void {
    this.typesLocked = true;
  }

  /** Whether event types have been locked. */
  get isLocked(): boolean {
    return this.typesLocked;
  }

  // -------------------------------------------------------------------------
  // Hash chain computation
  // -------------------------------------------------------------------------

  /**
   * Compute a SHA-256 chain hash for a given entry.
   * hash_n = SHA-256( hash_{n-1} || canonical(entry_n) )
   */
  private computeHash(previousHash: string, entry: Omit<AuditEvent, 'hash'>): string {
    const canonical = JSON.stringify({
      index: entry.index,
      timestamp: entry.timestamp,
      eventType: entry.eventType,
      principal: entry.principal,
      source: entry.source,
      severity: entry.severity,
      data: entry.data,
      previousHash: entry.previousHash,
    });
    return createHash('sha256').update(previousHash).update(canonical).digest('hex');
  }

  // -------------------------------------------------------------------------
  // Core logging
  // -------------------------------------------------------------------------

  /** Number of entries in the audit log. */
  get entryCount(): number {
    return this.nextIndex;
  }

  /** Number of registered event types. */
  get registeredTypeCount(): number {
    return this.registeredTypes.size;
  }

  /** Whether the logger is closed. */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Log an audit event.
   *
   * Appends the event to the hash chain and persists it to SQLite.
   * If event types are locked and the type is unregistered, logs an
   * AUDIT_CHAIN_LOGGING_VIOLATION instead.
   *
   * @param eventType — the type of audit event
   * @param principal — who triggered the event (e.g. 'ai', 'human', 'system')
   * @param source — which component generated the event
   * @param data — structured detail about the event
   * @returns the stored AuditEvent
   */
  logEvent(eventType: string, principal: string, source: string, data: Record<string, unknown> = {}): AuditEvent {
    if (this.closed) throw new AiClientAuditLoggerError('Logger is closed');

    // Validate event type if locked
    if (this.typesLocked && !this.registeredTypes.has(eventType)) {
      // Log a violation instead of the unregistered event type
      return this.logEvent(AI_AUDIT_EVENT_TYPES.AUDIT_CHAIN_LOGGING_VIOLATION, 'system', 'audit-logger', {
        attemptedEventType: eventType,
        originalPrincipal: principal,
        originalSource: source,
        originalData: data,
      });
    }

    const timestamp = this.dateTimeManager?.now().iso ?? new Date().toISOString();
    const severity = this.deriveSeverity(eventType);

    const entry: Omit<AuditEvent, 'hash'> = {
      index: this.nextIndex,
      timestamp,
      eventType,
      principal,
      source,
      severity,
      data,
      previousHash: this.lastHash,
    };

    const hash = this.computeHash(this.lastHash, entry);
    const event: AuditEvent = { ...entry, hash };

    // Persist to SQLite
    this.db
      .prepare(
        `INSERT INTO audit_events (idx, timestamp, event_type, principal, source, severity, data, previous_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.index,
        event.timestamp,
        event.eventType,
        event.principal,
        event.source,
        event.severity,
        JSON.stringify(event.data),
        event.previousHash,
        event.hash,
      );

    // Update in-memory chain state
    this.lastHash = hash;
    this.nextIndex++;

    return event;
  }

  // -------------------------------------------------------------------------
  // Domain convenience methods
  // -------------------------------------------------------------------------

  /** Log a bash command execution event. */
  logCommand(command: string, tier: number, success: boolean, data?: Record<string, unknown>): AuditEvent {
    const type = tier === 3 ? 'bash_invisible' : tier === 2 ? 'bash_blocked' : 'bash_command';
    return this.logEvent(type, 'ai', 'bastion-bash', {
      command: command.substring(0, 200),
      tier,
      success,
      ...data,
    });
  }

  /** Log a safety evaluation event. */
  logSafety(action: 'denied' | 'challenged' | 'allowed', layer: number, data?: Record<string, unknown>): AuditEvent {
    return this.logEvent(`safety_${action}`, 'system', 'safety-engine', { layer, ...data });
  }

  /** Log a challenge lifecycle event. */
  logChallenge(action: 'issued' | 'accepted' | 'rejected' | 'overridden', data?: Record<string, unknown>): AuditEvent {
    return this.logEvent(`challenge_${action}`, action === 'issued' ? 'ai' : 'human', 'challenge-manager', data ?? {});
  }

  /** Log a tool registry event. */
  logTool(action: 'approved' | 'denied' | 'revoked' | 'violation', data?: Record<string, unknown>): AuditEvent {
    return this.logEvent(`tool_${action}`, action === 'violation' ? 'system' : 'human', 'tool-registry', data ?? {});
  }

  /** Log a memory lifecycle event. */
  logMemory(action: 'proposed' | 'approved' | 'rejected', data?: Record<string, unknown>): AuditEvent {
    return this.logEvent(`memory_${action}`, action === 'proposed' ? 'ai' : 'human', 'memory-store', data ?? {});
  }

  /** Log an extension handling event. */
  logExtension(namespace: string, messageType: string, success: boolean, data?: Record<string, unknown>): AuditEvent {
    const type = success ? 'extension_handled' : 'extension_error';
    return this.logEvent(type, 'ai', `extension:${namespace}`, { messageType, ...data });
  }

  /** Log a violation event from any subsystem. */
  logViolation(source: string, type: string, data?: Record<string, unknown>): AuditEvent {
    return this.logEvent(type, 'system', source, data ?? {});
  }

  // -------------------------------------------------------------------------
  // Query methods
  // -------------------------------------------------------------------------

  /** Get recent events, most recent first. */
  getRecentEvents(limit = 50): AuditEvent[] {
    if (this.closed) throw new AiClientAuditLoggerError('Logger is closed');
    const rows = this.db
      .prepare('SELECT * FROM audit_events ORDER BY idx DESC LIMIT ?')
      .all(limit) as unknown as RawAuditRow[];
    return rows.map(rowToEvent);
  }

  /** Query events with optional filters. */
  query(
    filters: {
      eventType?: string;
      source?: string;
      severity?: string;
      limit?: number;
    } = {},
  ): AuditEvent[] {
    if (this.closed) throw new AiClientAuditLoggerError('Logger is closed');

    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filters.eventType) {
      conditions.push('event_type = ?');
      params.push(filters.eventType);
    }
    if (filters.source) {
      conditions.push('source = ?');
      params.push(filters.source);
    }
    if (filters.severity) {
      conditions.push('severity = ?');
      params.push(filters.severity);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 100;

    const rows = this.db
      .prepare(`SELECT * FROM audit_events ${where} ORDER BY idx DESC LIMIT ?`)
      .all(...params, limit) as unknown as RawAuditRow[];

    return rows.map(rowToEvent);
  }

  // -------------------------------------------------------------------------
  // Chain verification
  // -------------------------------------------------------------------------

  /**
   * Verify the integrity of the entire hash chain.
   *
   * Reads all entries from the database, recomputes each hash, and compares
   * it against the stored value. Returns where the chain breaks (if it does).
   */
  verifyChainIntegrity(): { valid: boolean; brokenAt?: number } {
    if (this.closed) throw new AiClientAuditLoggerError('Logger is closed');

    const rows = this.db.prepare('SELECT * FROM audit_events ORDER BY idx ASC').all() as unknown as RawAuditRow[];

    let previousHash = GENESIS_SEED;

    for (const row of rows) {
      const event = rowToEvent(row);
      const entry: Omit<AuditEvent, 'hash'> = {
        index: event.index,
        timestamp: event.timestamp,
        eventType: event.eventType,
        principal: event.principal,
        source: event.source,
        severity: event.severity,
        data: event.data,
        previousHash: event.previousHash,
      };

      const expected = this.computeHash(previousHash, entry);

      if (expected !== event.hash) {
        return { valid: false, brokenAt: event.index };
      }

      if (event.previousHash !== previousHash) {
        return { valid: false, brokenAt: event.index };
      }

      previousHash = event.hash;
    }

    return { valid: true };
  }

  /** Get the last chain hash (for incremental verification). */
  getLastHash(): string {
    return this.lastHash;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Close the logger and underlying database. */
  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Derive severity from event type.
   * Violations and denials are 'high', challenges and blocks are 'medium',
   * everything else is 'info'.
   */
  private deriveSeverity(eventType: string): string {
    if (
      eventType.includes('violation') ||
      eventType.includes('denied') ||
      eventType === 'bash_blocked' ||
      eventType === 'auth_failure' ||
      eventType === 'purge_violation'
    ) {
      return 'high';
    }
    if (
      eventType.includes('challenge') ||
      eventType.includes('blocked') ||
      eventType.includes('rejected') ||
      eventType.includes('error') ||
      eventType === 'budget_cooldown'
    ) {
      return 'medium';
    }
    return 'info';
  }
}

// ---------------------------------------------------------------------------
// Raw row type for SQLite results
// ---------------------------------------------------------------------------

interface RawAuditRow {
  idx: number;
  timestamp: string;
  event_type: string;
  principal: string;
  source: string;
  severity: string;
  data: string;
  previous_hash: string;
  hash: string;
}

/** Convert a raw SQLite row to an AuditEvent. */
function rowToEvent(row: RawAuditRow): AuditEvent {
  return {
    index: row.idx,
    timestamp: row.timestamp,
    eventType: row.event_type,
    principal: row.principal,
    source: row.source,
    severity: row.severity,
    data: JSON.parse(row.data) as Record<string, unknown>,
    previousHash: row.previous_hash,
    hash: row.hash,
  };
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class AiClientAuditLoggerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiClientAuditLoggerError';
  }
}
