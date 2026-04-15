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

  // Connection lifecycle
  CONNECTION_OPENED: 'connection_opened',
  CONNECTION_CLOSED: 'connection_closed',

  // Session lifecycle
  SESSION_STARTED: 'session_started',
  SESSION_ENDED: 'session_ended',
  SESSION_TIMEOUT: 'session_timeout',

  // File transfer
  FILE_MANIFEST: 'file_manifest',
  FILE_QUARANTINE: 'file_quarantine',
  FILE_DELIVERED: 'file_delivered',
  FILE_REJECTED: 'file_rejected',
  FILE_PURGED: 'file_purged',

  // Configuration
  CONFIG_CHANGE: 'config_change',
  PROVIDER_APPROVED: 'provider_approved',
  PROVIDER_DEACTIVATED: 'provider_deactivated',

  // Protocol violations
  PROTOCOL_VIOLATION: 'protocol_violation',
  SENDER_MISMATCH: 'sender_mismatch',
  ALLOWLIST_REJECTED: 'allowlist_rejected',
  MALICLAW_REJECTED: 'maliclaw_rejected',

  // Security & auth (relay-wide)
  JWT_REPLAY_REJECTED: 'jwt_replay_rejected',
  SESSION_CONFLICT: 'session_conflict',
  SESSION_SUPERSEDED: 'session_superseded',
  SECURITY_VIOLATION: 'security_violation',
  FILE_HASH_MISMATCH: 'file_hash_mismatch',
  FILE_SUBMITTED: 'file_submitted',
  EXTENSION_LOADED: 'extension_loaded',
  CHAIN_INTEGRITY_OK: 'chain_integrity_ok',
  CHAIN_INTEGRITY_VIOLATION: 'chain_integrity_violation',
  AUDIT_CHAIN_LOGGING_VIOLATION: 'audit_chain_logging_violation',
  ADMIN_AUTH_SUCCESS: 'admin_auth_success',
  ADMIN_AUTH_FAILURE: 'admin_auth_failure',

  // Relay operational events
  AI_DISCLOSURE_SENT: 'ai_disclosure_sent',
  SESSION_PAIRED: 'session_paired',
  PROVIDER_REGISTERED: 'provider_registered',
  AUDIT_QUERY: 'audit_query',
  KEY_EXCHANGE: 'key_exchange',
  BUDGET_ALERT: 'budget_alert',
  BUDGET_CONFIG_CHANGED: 'budget_config_changed',
  BUDGET_STATUS: 'budget_status',
  STREAM_STARTED: 'stream_started',
  STREAM_COMPLETED: 'stream_completed',
  CONTEXT_UPDATE: 'context_update',

  // Guardian (7th Sole Authority)
  GUARDIAN_CHECK: 'guardian_check',
  GUARDIAN_VIOLATION: 'guardian_violation',
  GUARDIAN_STATUS_QUERIED: 'guardian_status_queried',
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

  // Event type registry — validates event types after lock
  private readonly eventTypes = new Map<string, { severity: string; description: string }>();
  private typesLocked = false;

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

    // Register all built-in event types
    this.registerEventType(AUDIT_EVENT_TYPES.MESSAGE_ROUTED, {
      severity: 'info',
      description: 'Message successfully routed',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.MESSAGE_REJECTED, {
      severity: 'warning',
      description: 'Message rejected',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.MESSAGE_RATE_LIMITED, {
      severity: 'warning',
      description: 'Message rate-limited',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.AUTH_SUCCESS, {
      severity: 'info',
      description: 'Authentication succeeded',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.AUTH_FAILURE, {
      severity: 'warning',
      description: 'Authentication failed',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.AUTH_TOKEN_REFRESH, { severity: 'info', description: 'Token refreshed' });
    this.registerEventType(AUDIT_EVENT_TYPES.AUTH_TOKEN_EXPIRED, { severity: 'warning', description: 'Token expired' });
    this.registerEventType(AUDIT_EVENT_TYPES.CONNECTION_OPENED, { severity: 'info', description: 'Connection opened' });
    this.registerEventType(AUDIT_EVENT_TYPES.CONNECTION_CLOSED, { severity: 'info', description: 'Connection closed' });
    this.registerEventType(AUDIT_EVENT_TYPES.SESSION_STARTED, { severity: 'info', description: 'Session started' });
    this.registerEventType(AUDIT_EVENT_TYPES.SESSION_ENDED, { severity: 'info', description: 'Session ended' });
    this.registerEventType(AUDIT_EVENT_TYPES.SESSION_TIMEOUT, {
      severity: 'warning',
      description: 'Session timed out',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.FILE_MANIFEST, {
      severity: 'info',
      description: 'File manifest received',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.FILE_QUARANTINE, {
      severity: 'info',
      description: 'File placed in quarantine',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.FILE_DELIVERED, {
      severity: 'info',
      description: 'File delivered to recipient',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.FILE_REJECTED, { severity: 'warning', description: 'File rejected' });
    this.registerEventType(AUDIT_EVENT_TYPES.FILE_PURGED, {
      severity: 'info',
      description: 'File purged from quarantine',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.CONFIG_CHANGE, { severity: 'info', description: 'Configuration changed' });
    this.registerEventType(AUDIT_EVENT_TYPES.PROVIDER_APPROVED, { severity: 'info', description: 'Provider approved' });
    this.registerEventType(AUDIT_EVENT_TYPES.PROVIDER_DEACTIVATED, {
      severity: 'warning',
      description: 'Provider deactivated',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.PROTOCOL_VIOLATION, {
      severity: 'warning',
      description: 'Protocol violation detected',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.SENDER_MISMATCH, {
      severity: 'warning',
      description: 'Sender type mismatch',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.ALLOWLIST_REJECTED, {
      severity: 'warning',
      description: 'Rejected by allowlist',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.MALICLAW_REJECTED, {
      severity: 'violation',
      description: 'Blocked by MaliClaw Clause',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.JWT_REPLAY_REJECTED, {
      severity: 'violation',
      description: 'JWT replay attack rejected',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.SESSION_CONFLICT, {
      severity: 'warning',
      description: 'Session conflict detected',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.SESSION_SUPERSEDED, {
      severity: 'warning',
      description: 'Session superseded by new connection',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.SECURITY_VIOLATION, {
      severity: 'critical',
      description: 'Security violation',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.FILE_HASH_MISMATCH, {
      severity: 'violation',
      description: 'File hash verification failed',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.EXTENSION_LOADED, { severity: 'info', description: 'Extension loaded' });
    this.registerEventType(AUDIT_EVENT_TYPES.CHAIN_INTEGRITY_OK, {
      severity: 'info',
      description: 'Chain integrity verification passed',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.CHAIN_INTEGRITY_VIOLATION, {
      severity: 'critical',
      description: 'Chain integrity violation detected',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.AUDIT_CHAIN_LOGGING_VIOLATION, {
      severity: 'critical',
      description: 'Unregistered event type logged after lock',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.ADMIN_AUTH_SUCCESS, {
      severity: 'info',
      description: 'Admin authentication succeeded',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.ADMIN_AUTH_FAILURE, {
      severity: 'warning',
      description: 'Admin authentication failed',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.FILE_SUBMITTED, {
      severity: 'info',
      description: 'File submitted to quarantine',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.AI_DISCLOSURE_SENT, {
      severity: 'info',
      description: 'AI disclosure sent to human client',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.SESSION_PAIRED, {
      severity: 'info',
      description: 'Human and AI clients paired',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.PROVIDER_REGISTERED, {
      severity: 'info',
      description: 'AI provider registered',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.AUDIT_QUERY, { severity: 'info', description: 'Audit log queried' });
    this.registerEventType(AUDIT_EVENT_TYPES.KEY_EXCHANGE, { severity: 'info', description: 'Key exchange completed' });
    this.registerEventType(AUDIT_EVENT_TYPES.BUDGET_ALERT, {
      severity: 'warning',
      description: 'Budget threshold alert',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.BUDGET_CONFIG_CHANGED, {
      severity: 'info',
      description: 'Budget configuration changed',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.BUDGET_STATUS, { severity: 'info', description: 'Budget status update' });
    this.registerEventType(AUDIT_EVENT_TYPES.STREAM_STARTED, {
      severity: 'info',
      description: 'Streaming response started',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.STREAM_COMPLETED, {
      severity: 'info',
      description: 'Streaming response completed',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.CONTEXT_UPDATE, {
      severity: 'info',
      description: 'Context update forwarded',
    });

    // Guardian (7th Sole Authority)
    this.registerEventType(AUDIT_EVENT_TYPES.GUARDIAN_CHECK, {
      severity: 'info',
      description: 'Guardian environment check completed',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.GUARDIAN_VIOLATION, {
      severity: 'critical',
      description: 'Guardian detected a security violation',
    });
    this.registerEventType(AUDIT_EVENT_TYPES.GUARDIAN_STATUS_QUERIED, {
      severity: 'info',
      description: 'Guardian status requested',
    });
  }

  // -------------------------------------------------------------------------
  // Event type registry
  // -------------------------------------------------------------------------

  /**
   * Register an event type in the registry.
   * Must be called before lockEventTypes(). Extensions use this to register
   * custom event types at startup.
   */
  registerEventType(eventType: string, config: { severity: string; description: string }): void {
    if (this.typesLocked) throw new AuditLoggerError('Event type registry is locked');
    this.eventTypes.set(eventType, config);
  }

  /** Lock the event type registry — after this, unregistered types trigger a violation. */
  lockEventTypes(): void {
    this.typesLocked = true;
  }

  /** Whether the event type registry is locked. */
  get isTypesLocked(): boolean {
    return this.typesLocked;
  }

  /** Number of registered event types. */
  get registeredTypeCount(): number {
    return this.eventTypes.size;
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
  /** Whether audit storage is degraded (write failure detected). */
  private degraded = false;

  /** Whether audit storage is in a degraded state. */
  get isDegraded(): boolean {
    return this.degraded;
  }

  logEvent(eventType: string, sessionId: string, detail: Record<string, unknown> = {}): HashedAuditEntry {
    if (this.closed) throw new AuditLoggerError('Logger is closed');

    // Validate event type against registry when locked
    if (this.typesLocked && !this.eventTypes.has(eventType)) {
      // Log a violation instead of the unregistered type (avoid infinite recursion via _logInternal)
      return this._logInternal(AUDIT_EVENT_TYPES.AUDIT_CHAIN_LOGGING_VIOLATION, sessionId, {
        attemptedType: eventType,
        originalDetail: detail,
        reason: 'Unregistered event type after lock',
      });
    }

    return this._logInternal(eventType, sessionId, detail);
  }

  /**
   * Core logging logic — appends to hash chain and persists.
   * Separated from logEvent() to avoid infinite recursion during violation logging.
   */
  private _logInternal(eventType: string, sessionId: string, detail: Record<string, unknown>): HashedAuditEntry {
    const entry: AuditEntry = {
      index: this.nextIndex,
      timestamp: new Date().toISOString(),
      eventType,
      sessionId,
      detail,
    };

    // Compute chain hash using @bastion/crypto's appendEntry
    const hashed = appendEntry(entry, this.chain);

    // Persist to SQLite — catch storage failures so relay doesn't crash
    try {
      this.store.insert(hashed);
    } catch (err) {
      this.degraded = true;
      const msg = err instanceof Error ? err.message : String(err);
      // Last-resort logging: stderr is always available even when DB is full
      console.error(
        `[!!!] AUDIT STORAGE FAILURE — event ${eventType} at index ${this.nextIndex} NOT persisted: ${msg}`,
      );
      // Still update in-memory state so the chain remains consistent for this session
    }

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
   * Count entries matching filters (no limit/offset).
   *
   * Used by the admin API to return the real totalCount for pagination.
   */
  count(query: Omit<AuditQuery, 'limit' | 'offset'>): number {
    if (this.closed) throw new AuditLoggerError('Logger is closed');
    return this.store.count(query);
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
