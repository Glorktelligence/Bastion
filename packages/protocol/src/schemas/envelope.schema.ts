// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Zod schemas for message envelope structures.
 */

import { z } from 'zod';
import { ALL_MESSAGE_TYPES } from '../constants/message-types.js';
import type { MessageType } from '../constants/message-types.js';
import { CorrelationIdSchema, MessageIdSchema, SenderIdentitySchema, TimestampSchema } from './common.schema.js';

/** Schema for the message type field, validated against known types. */
export const MessageTypeFieldSchema = z.enum(ALL_MESSAGE_TYPES as unknown as [MessageType, ...MessageType[]]);

/**
 * Schema for a cleartext message envelope.
 * The payload is validated separately using PAYLOAD_SCHEMAS lookup.
 */
export const MessageEnvelopeSchema = z.object({
  id: MessageIdSchema,
  type: MessageTypeFieldSchema,
  timestamp: TimestampSchema,
  sender: SenderIdentitySchema,
  correlationId: CorrelationIdSchema,
  version: z.string().min(1),
  payload: z.unknown(),
});

/**
 * Schema for an encrypted envelope (as seen by the relay).
 * The relay cannot read the payload — it sees only encrypted bytes.
 */
export const EncryptedEnvelopeSchema = z.object({
  id: MessageIdSchema,
  type: MessageTypeFieldSchema,
  timestamp: TimestampSchema,
  sender: SenderIdentitySchema,
  correlationId: CorrelationIdSchema,
  version: z.string().min(1),
  encryptedPayload: z.string().min(1),
  nonce: z.string().min(1),
});
