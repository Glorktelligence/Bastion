// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Message envelope structure (Section 5.1).
 *
 * Every message shares a common envelope containing: unique message ID (UUID v4),
 * message type identifier, timestamp (ISO 8601), sender identity (authenticated
 * via JWT), correlation ID linking related messages, and protocol version.
 */

import type { MessageType } from '../constants/message-types.js';
import type { CorrelationId, MessageId, SenderIdentity, Timestamp } from './common.js';

/**
 * The standard message envelope that wraps every protocol message.
 * The payload field contains type-specific content.
 */
export interface MessageEnvelope<TPayload = unknown> {
  /** Unique message identifier (UUID v4). */
  readonly id: MessageId;
  /** Message type identifier. */
  readonly type: MessageType;
  /** ISO 8601 timestamp of when the message was created. */
  readonly timestamp: Timestamp;
  /** Authenticated sender identity derived from JWT. */
  readonly sender: SenderIdentity;
  /** Correlation ID linking related messages in a conversation thread. */
  readonly correlationId: CorrelationId;
  /** Protocol version identifier. */
  readonly version: string;
  /** Type-specific message content. */
  readonly payload: TPayload;
}

/**
 * An envelope carrying encrypted payload bytes.
 * The relay sees this form — it cannot read the payload.
 */
export interface EncryptedEnvelope {
  /** Unique message identifier (UUID v4). */
  readonly id: MessageId;
  /** Message type identifier. */
  readonly type: MessageType;
  /** ISO 8601 timestamp. */
  readonly timestamp: Timestamp;
  /** Authenticated sender identity. */
  readonly sender: SenderIdentity;
  /** Correlation ID. */
  readonly correlationId: CorrelationId;
  /** Protocol version. */
  readonly version: string;
  /** Base64-encoded encrypted payload. */
  readonly encryptedPayload: string;
  /** Nonce used for encryption (base64-encoded). */
  readonly nonce: string;
}
