// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Schema validation helpers for Bastion protocol messages.
 */

import type { ZodSchema } from 'zod';
import type { MessageType } from '../constants/message-types.js';
import { MessageEnvelopeSchema } from '../schemas/envelope.schema.js';
import { PAYLOAD_SCHEMAS } from '../schemas/message.schema.js';

/** Result of validating a message envelope and its payload. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

export interface ValidationError {
  readonly path: string;
  readonly message: string;
}

/**
 * Validate a raw message object against the envelope schema
 * and the type-specific payload schema.
 */
export function validateMessage(raw: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  // Step 1: Validate the envelope structure
  const envelopeResult = MessageEnvelopeSchema.safeParse(raw);
  if (!envelopeResult.success) {
    for (const issue of envelopeResult.error.issues) {
      errors.push({
        path: issue.path.join('.'),
        message: issue.message,
      });
    }
    return { valid: false, errors };
  }

  const envelope = envelopeResult.data;

  // Step 2: Look up and validate the type-specific payload
  const payloadSchema = PAYLOAD_SCHEMAS[envelope.type as MessageType] as ZodSchema | undefined;

  if (!payloadSchema) {
    errors.push({
      path: 'type',
      message: `No payload schema registered for message type: ${envelope.type}`,
    });
    return { valid: false, errors };
  }

  const payloadResult = payloadSchema.safeParse(envelope.payload);
  if (!payloadResult.success) {
    for (const issue of payloadResult.error.issues) {
      errors.push({
        path: `payload.${issue.path.join('.')}`,
        message: issue.message,
      });
    }
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

/**
 * Validate only a payload against the schema for a given message type.
 */
export function validatePayload(type: MessageType, payload: unknown): ValidationResult {
  const schema = PAYLOAD_SCHEMAS[type] as ZodSchema | undefined;

  if (!schema) {
    return {
      valid: false,
      errors: [{ path: 'type', message: `Unknown message type: ${type}` }],
    };
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  return { valid: true, errors: [] };
}
