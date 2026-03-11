// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Append-only audit logger with tamper-evident hash chain.
 *
 * Every significant relay event is logged with a chained SHA-256 hash:
 *   - Message routing (routed, rejected, rate-limited)
 *   - Authentication (login, logout, token refresh, failures)
 *   - File transfer events (manifest, quarantine, delivery)
 *   - Configuration changes (provider approval, safety config)
 *   - Protocol violations (schema failures, spoofing attempts)
 *
 * The chain hash ensures any tampering (modification, deletion,
 * reordering) is detectable by verifying the chain. Each entry's
 * hash depends on all prior entries via:
 *   hash_n = SHA-256( hash_{n-1} || canonical(entry_n) )
 *
 * Uses @bastion/crypto's appendEntry() for chain computation and
 * AuditStore (SQLite) for persistent storage.
 */

import { type AuditEntry, GENESIS_SEED, type HashedAuditEntry, appendEntry } from '@bastion/crypto';
import { type AuditQuery, AuditStore, type AuditStoreConfig } from './audit-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the audit logger. */
export interface AuditLoggerConfig {
  /** SQLite store configuration. */
  readonly store: AuditStoreConfig;
}

/** Standard audit event types logged by the relay. */
export const AUDIT_EVENT_TYPES = {
  // Message routing
  MESSAGE_ROUTED: 'message_routed',
  MESSAGE_REJECTED: 'message_rejected',
  MESSAGE_RATE_LIMITED: 'message_rate_limited',

  // Authentication
  AUTH_SUCCESS: 'auth_success',
  AUTH_FAILURE: 'auth_failure',
  AUTH_TOKEN_REFRESH: 'auth_token_refresh',
  AUTH_TOKEN_EXPIRED: 'auth_token_expired',

  // Session lifecycle
  SESSION_STARTED: 'session_started',
  SESSION_ENDED: 'session_ended',
  SESSION_TIMEOUT: 'session_timeout',

  // File transfer
  FILE_MANIFEST: 'file_manifest',
  FILE_QUARANTINE: 'file_quarantine',
  FILE_DELIVERED: 'file_delivered',
  FILE_REJECTED: 'file_rejected',

  // Configuration
  CONFIG_CHANGE: 'config_change',
  PROVIDER_APPROVED: 'provider_approved',
  PROVIDER_DEACTIVATED: 'provider_deactivated',

  // Protocol violations
  PROTOCOL_VIOLATION: 'protocol_violation',
  SENDER_MISMATCH: 'sender_mismatch',
  ALLOWLIST_REJECTED: 'allowlist_rejected',
  MALICLAW_REJECTED: 'maliclaw_rejected',
} as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];

// ---------------------------------------------------------------------------
// AuditLogger
// ---------------------------------------------------------------------------

/**
 * Tamper-evident audit logger with hash chain and SQLite storage.
 *
 * Usage:
 *   1. Create: `const logger = new AuditLogger(config)`
 *   2. Log events: `logger.logEvent('message_routed', sessionId, { ... })`
 *   3. Query: `logger.query({ eventType: 'auth_failure' })`
 *   4. Verify: `logger.getChainForVerification()`
 *   5. Close: `logger.close()`
 *
 * The logger maintains chain state (next index + last hash) in memory
 * and resumes from the last stored entry on construction.
 */
export class AuditLogger {
  private readonly store: AuditStore;
  private nextIndex: number;
  private lastHash: string;
  private chain: HashedAuditEntry[];
  private closed: boolean;

  constructor(config: AuditLoggerConfig) {
    this.store = new AuditStore(config.store);
    this.chain = [];
    this.closed = false;

    // Resume chain state from the store
    const lastEntry = this.store.getLastEntry();
    if (lastEntry) {
      this.nextIndex = lastEntry.index + 1;
      this.lastHash = lastEntry.chainHash;
      // Load the full chain into memory for verification support
      this.chain = this.store.getAllEntries();
    } else {
      this.nextIndex = 0;
      this.lastHash = GENESIS_SEED;
    }
  }

  /** Number of entries in the audit log. */
  get entryCount(): number {
    return this.nextIndex;
  }

  /** Whether the logger is closed. */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Log an audit event.
   *
   * Appends the event to the hash chain and persists it to SQLite.
   * This is the core logging method — all convenience methods delegate here.
   *
   * @param eventType — the type of audit event
   * @param sessionId — the session this event belongs to
   * @param detail — structured detail about the event
   * @returns the stored HashedAuditEntry
   */
  logEvent(eventType: string, sessionId: string, detail: Record<string, unknown> = {}): HashedAuditEntry {
    if (this.closed) throw new AuditLoggerError('Logger is closed');

    const entry: AuditEntry = {
      index: this.nextIndex,
      timestamp: new Date().toISOString(),
      eventType,
      sessionId,
      detail,
    };

    // Compute chain hash using @bastion/crypto's appendEntry
    const hashed = appendEntry(entry, this.chain);

    // Persist to SQLite
    this.store.insert(hashed);

    // Update in-memory state
    this.chain.push(hashed);
    this.lastHash = hashed.chainHash;
    this.nextIndex++;

    return hashed;
  }

  // -------------------------------------------------------------------------
  // Convenience logging methods
  // -------------------------------------------------------------------------

  /** Log a successfully routed message. */
  logMessageRouted(
    sessionId: string,
    detail: { messageId: string; messageType: string; senderType: string; recipientId: string },
  ): HashedAuditEntry {
    return this.logEvent(AUDIT_EVENT_TYPES.MESSAGE_ROUTED, sessionId, detail);
  }

  /** Log a rejected message. */
  logMessageRejected(
    sessionId: string,
    detail: { reason: string; senderConnectionId: string; [key: string]: unknown },
  ): HashedAuditEntry {
    return this.logEvent(AUDIT_EVENT_TYPES.MESSAGE_REJECTED, sessionId, detail);
  }

  /** Log a successful authentication. */
  logAuthSuccess(
    sessionId: string,
    detail: { clientId: string; clientType: string; [key: string]: unknown },
  ): HashedAuditEntry {
    return this.logEvent(AUDIT_EVENT_TYPES.AUTH_SUCCESS, sessionId, detail);
  }

  /** Log a failed authentication attempt. */
  logAuthFailure(
    sessionId: string,
    detail: { reason: string; clientId?: string; [key: string]: unknown },
  ): HashedAuditEntry {
    return this.logEvent(AUDIT_EVENT_TYPES.AUTH_FAILURE, sessionId, detail);
  }

  /** Log a token refresh. */
  logTokenRefresh(sessionId: string, detail: { clientId: string; [key: string]: unknown }): HashedAuditEntry {
    return this.logEvent(AUDIT_EVENT_TYPES.AUTH_TOKEN_REFRESH, sessionId, detail);
  }

  /** Log a protocol violation. */
  logProtocolViolation(
    sessionId: string,
    detail: { violation: string; connectionId: string; [key: string]: unknown },
  ): HashedAuditEntry {
    return this.logEvent(AUDIT_EVENT_TYPES.PROTOCOL_VIOLATION, sessionId, detail);
  }

  /** Log a file transfer event. */
  logFileTransfer(
    eventType: string,
    sessionId: string,
    detail: { transferId: string; filename?: string; [key: string]: unknown },
  ): HashedAuditEntry {
    return this.logEvent(eventType, sessionId, detail);
  }

  /** Log a configuration change. */
  logConfigChange(
    sessionId: string,
    detail: { changeType: string; changedBy: string; [key: string]: unknown },
  ): HashedAuditEntry {
    return this.logEvent(AUDIT_EVENT_TYPES.CONFIG_CHANGE, sessionId, detail);
  }

  // -------------------------------------------------------------------------
  // Query methods
  // -------------------------------------------------------------------------

  /**
   * Query audit entries with filters.
   *
   * @param query — filter criteria (time range, event type, session, pagination)
   * @returns matching entries ordered by index
   */
  query(query: AuditQuery = {}): HashedAuditEntry[] {
    if (this.closed) throw new AuditLoggerError('Logger is closed');
    return this.store.query(query);
  }

  /**
   * Get the full in-memory chain for verification.
   *
   * @returns all entries in chain order
   */
  getChain(): readonly HashedAuditEntry[] {
    return this.chain;
  }

  /**
   * Get the last chain hash (for incremental verification).
   */
  getLastHash(): string {
    return this.lastHash;
  }

  /**
   * Get a contiguous range of entries from the store.
   *
   * @param startIndex — first index (inclusive)
   * @param endIndex — last index (inclusive)
   * @returns ordered array of entries
   */
  getRange(startIndex: number, endIndex: number): HashedAuditEntry[] {
    if (this.closed) throw new AuditLoggerError('Logger is closed');
    return this.store.getRange(startIndex, endIndex);
  }

  /** Close the logger and underlying store. */
  close(): void {
    if (this.closed) return;
    this.store.close();
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class AuditLoggerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditLoggerError';
  }
}
