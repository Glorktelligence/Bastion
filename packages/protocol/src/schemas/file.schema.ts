// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Zod schemas for file transfer metadata types.
 */

import { z } from 'zod';
import { FileTransferIdSchema, MessageIdSchema, TimestampSchema } from './common.schema.js';

export const FileTransferStateSchema = z.enum([
  'pending_manifest',
  'quarantined',
  'offered',
  'accepted',
  'rejected',
  'delivering',
  'delivered',
  'hash_mismatch',
  'purged',
  'timed_out',
]);

export const FileTransferDirectionSchema = z.enum(['human_to_ai', 'ai_to_human']);

export const CustodyEventTypeSchema = z.enum([
  'submitted',
  'quarantined',
  'hash_verified_receipt',
  'manifest_sent',
  'offered',
  'accepted',
  'rejected',
  'hash_verified_delivery',
  'delivered',
  'hash_mismatch',
  'purged',
  'timed_out',
]);

export const CustodyEventSchema = z.object({
  event: CustodyEventTypeSchema,
  timestamp: TimestampSchema,
  actor: z.string().min(1),
  hash: z.string().optional(),
  detail: z.string().optional(),
});

export const FileChainOfCustodySchema = z.object({
  transferId: FileTransferIdSchema,
  direction: FileTransferDirectionSchema,
  filename: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().min(1),
  events: z.array(CustodyEventSchema).readonly(),
});

export const QuarantineEntrySchema = z.object({
  transferId: FileTransferIdSchema,
  direction: FileTransferDirectionSchema,
  filename: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().min(1),
  hashAtReceipt: z.string().min(1),
  hashAlgorithm: z.literal('sha256'),
  quarantinedAt: TimestampSchema,
  manifestMessageId: MessageIdSchema,
  state: FileTransferStateSchema,
  purgeAt: TimestampSchema,
});
