// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * ReconnectionManager — grace period and message queue for client reconnection.
 *
 * When a client disconnects unexpectedly (network drop, browser refresh),
 * the manager keeps the session alive for a configurable grace period.
 * During this window:
 *   - Messages destined for the disconnected client are queued (bounded).
 *   - If the client reconnects with the same identity + previousSessionId,
 *     the queued messages are flushed in order and the session resumes.
 *   - If the grace period expires, the session is cleaned up normally.
 *
 * Limits: max 100 messages or 1 MB total queued data, whichever comes first.
 * This is an in-memory-only queue — no persistence.
 */

import type { SenderIdentity } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReconnectionConfig {
  /** Grace period in milliseconds before a disconnected session is discarded. Default: 30_000 (30s). */
  readonly gracePeriodMs?: number;
  /** Maximum number of queued messages per session. Default: 100. */
  readonly maxQueuedMessages?: number;
  /** Maximum total bytes of queued messages per session. Default: 1_048_576 (1 MB). */
  readonly maxQueuedBytes?: number;
}

export interface GraceSession {
  /** The original session ID. */
  readonly sessionId: string;
  /** The identity of the disconnected client. */
  readonly identity: SenderIdentity;
  /** Client type (human or ai). */
  readonly clientType: 'human' | 'ai';
  /** Queued messages (raw serialised strings, ready to send). */
  readonly queue: string[];
  /** Total byte size of queued messages. */
  queueBytes: number;
  /** Timestamp when the grace period started. */
  readonly disconnectedAt: number;
  /** Timer handle for grace expiry. */
  readonly expiryTimer: ReturnType<typeof setTimeout>;
  /** Provider info snapshot (AI clients only). */
  readonly providerSnapshot?: unknown;
}

export type GraceExpiryCallback = (session: GraceSession) => void;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_GRACE_PERIOD_MS = 30_000;
const DEFAULT_MAX_QUEUED_MESSAGES = 100;
const DEFAULT_MAX_QUEUED_BYTES = 1_048_576; // 1 MB

// ---------------------------------------------------------------------------
// ReconnectionManager
// ---------------------------------------------------------------------------

export class ReconnectionManager {
  private readonly gracePeriodMs: number;
  private readonly maxQueuedMessages: number;
  private readonly maxQueuedBytes: number;

  /** Active grace sessions, keyed by sessionId. */
  private readonly sessions = new Map<string, GraceSession>();

  /** Callback invoked when a grace period expires. */
  private onExpiry: GraceExpiryCallback | null = null;

  constructor(config: ReconnectionConfig = {}) {
    this.gracePeriodMs = config.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
    this.maxQueuedMessages = config.maxQueuedMessages ?? DEFAULT_MAX_QUEUED_MESSAGES;
    this.maxQueuedBytes = config.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
  }

  /** Register a callback for grace period expiry events. */
  setExpiryCallback(cb: GraceExpiryCallback): void {
    this.onExpiry = cb;
  }

  /**
   * Start a grace period for a disconnected client.
   * Returns true if the grace session was created, false if one already exists for this sessionId.
   */
  startGracePeriod(
    sessionId: string,
    identity: SenderIdentity,
    clientType: 'human' | 'ai',
    providerSnapshot?: unknown,
  ): boolean {
    if (this.sessions.has(sessionId)) return false;

    const timer = setTimeout(() => {
      this.expire(sessionId);
    }, this.gracePeriodMs);

    // Don't block process exit
    if (timer.unref) timer.unref();

    const session: GraceSession = {
      sessionId,
      identity,
      clientType,
      queue: [],
      queueBytes: 0,
      disconnectedAt: Date.now(),
      expiryTimer: timer,
      providerSnapshot,
    };

    this.sessions.set(sessionId, session);
    return true;
  }

  /**
   * Queue a message for a disconnected client.
   * Returns true if the message was queued, false if the queue is full or no grace session exists.
   */
  queueMessage(sessionId: string, message: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const messageBytes = Buffer.byteLength(message, 'utf-8');

    if (session.queue.length >= this.maxQueuedMessages) return false;
    if (session.queueBytes + messageBytes > this.maxQueuedBytes) return false;

    session.queue.push(message);
    session.queueBytes += messageBytes;
    return true;
  }

  /**
   * Attempt to restore a session for a reconnecting client.
   * Returns the grace session if successful (caller should flush the queue), or null if no match.
   * On success the grace session is removed from the manager.
   */
  tryRestore(previousSessionId: string, identity: SenderIdentity): GraceSession | null {
    const session = this.sessions.get(previousSessionId);
    if (!session) return null;

    // Identity must match (same client id and type)
    if (session.identity.id !== identity.id || session.identity.type !== identity.type) {
      return null;
    }

    // Cancel the expiry timer and remove
    clearTimeout(session.expiryTimer);
    this.sessions.delete(previousSessionId);
    return session;
  }

  /**
   * Check if a session ID has an active grace period.
   */
  hasGraceSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get the grace session for a session ID (read-only inspection).
   */
  getGraceSession(sessionId: string): GraceSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Find a grace session by client identity (for reconnection lookup by identity alone).
   */
  findByIdentity(identity: SenderIdentity): GraceSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.identity.id === identity.id && session.identity.type === identity.type) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Find a grace session by client type (for message queuing when a peer disconnects).
   */
  findByClientType(clientType: 'human' | 'ai'): GraceSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.clientType === clientType) return session;
    }
    return undefined;
  }

  /** Number of active grace sessions. */
  get activeCount(): number {
    return this.sessions.size;
  }

  /** Clean up all grace sessions (e.g. on shutdown). */
  destroy(): void {
    for (const session of this.sessions.values()) {
      clearTimeout(session.expiryTimer);
    }
    this.sessions.clear();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private expire(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);
    this.onExpiry?.(session);
  }
}
