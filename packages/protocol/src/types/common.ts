// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Shared primitive types used across all protocol definitions.
 */

/** UUID v4 string identifier. */
export type MessageId = string;

/** UUID v4 string identifier for sessions. */
export type SessionId = string;

/** UUID v4 string identifier for tasks. */
export type TaskId = string;

/** UUID v4 string identifier for file transfers. */
export type FileTransferId = string;

/** ISO 8601 timestamp string (e.g. "2026-03-08T14:25:32.000Z"). */
export type Timestamp = string;

/** Correlation ID linking related messages in a conversation thread. */
export type CorrelationId = string;

/** Authenticated sender identity (derived from JWT). */
export interface SenderIdentity {
  /** Unique identifier for the sender. */
  readonly id: string;
  /** Type of client that sent the message. */
  readonly type: ClientType;
  /** Display name for the sender. */
  readonly displayName: string;
}

/** The three client types in the Bastion protocol. */
export type ClientType = 'human' | 'ai' | 'relay';

/** Priority levels for task messages. */
export type Priority = 'low' | 'normal' | 'high' | 'critical';

/** Session states as defined in the supplementary spec Section 2.2. */
export type SessionState = 'connecting' | 'authenticating' | 'key_exchange' | 'active' | 'suspended' | 'terminated';

/** Provider availability status. */
export type ProviderStatus = 'available' | 'unavailable' | 'degraded';

/** Connection quality indicator (mobile client). */
export type ConnectionQuality = 'good' | 'fair' | 'poor' | 'offline';
