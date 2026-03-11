// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Zod schemas for shared primitive types.
 */

import { z } from 'zod';

/** UUID v4 validation pattern. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** ISO 8601 timestamp validation pattern. */
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export const MessageIdSchema = z.string().regex(UUID_REGEX, 'Must be a valid UUID v4');
export const SessionIdSchema = z.string().regex(UUID_REGEX, 'Must be a valid UUID v4');
export const TaskIdSchema = z.string().regex(UUID_REGEX, 'Must be a valid UUID v4');
export const FileTransferIdSchema = z.string().regex(UUID_REGEX, 'Must be a valid UUID v4');
export const CorrelationIdSchema = z.string().regex(UUID_REGEX, 'Must be a valid UUID v4');
export const TimestampSchema = z.string().regex(ISO_8601_REGEX, 'Must be ISO 8601 UTC timestamp');

export const ClientTypeSchema = z.enum(['human', 'ai', 'relay']);

export const SenderIdentitySchema = z.object({
  id: z.string().min(1),
  type: ClientTypeSchema,
  displayName: z.string().min(1),
});

export const PrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);

export const SessionStateSchema = z.enum([
  'connecting',
  'authenticating',
  'key_exchange',
  'active',
  'suspended',
  'terminated',
]);

export const ProviderStatusSchema = z.enum(['available', 'unavailable', 'degraded']);

export const ConnectionQualitySchema = z.enum(['good', 'fair', 'poor', 'offline']);
