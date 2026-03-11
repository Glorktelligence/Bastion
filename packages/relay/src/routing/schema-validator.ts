// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Inbound message schema validation for the relay.
 *
 * The relay sees EncryptedEnvelopes — it validates the envelope
 * structure (plaintext routing metadata) without touching the
 * encrypted payload. This ensures well-formed routing data before
 * the router makes forwarding decisions.
 */

import { EncryptedEnvelopeSchema } from '@bastion/protocol';
import type { EncryptedEnvelope } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Validation error with a JSON path and human-readable message. */
export interface SchemaValidationError {
  readonly path: string;
  readonly message: string;
}

/** Result of validating an inbound message against EncryptedEnvelopeSchema. */
export type EnvelopeValidationResult =
  | {
      readonly valid: true;
      readonly envelope: EncryptedEnvelope;
      readonly errors: readonly [];
    }
  | {
      readonly valid: false;
      readonly envelope?: undefined;
      readonly errors: readonly SchemaValidationError[];
    };

// ---------------------------------------------------------------------------
// Validation functions
// ---------------------------------------------------------------------------

/**
 * Validate a parsed object against the EncryptedEnvelope schema.
 *
 * @param raw — parsed JSON value to validate
 * @returns validation result with typed envelope on success
 */
export function validateEncryptedEnvelope(raw: unknown): EnvelopeValidationResult {
  const result = EncryptedEnvelopeSchema.safeParse(raw);

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  return {
    valid: true,
    envelope: result.data as EncryptedEnvelope,
    errors: [],
  };
}

/**
 * Parse a raw JSON string and validate against EncryptedEnvelopeSchema.
 *
 * This is the primary entry point for inbound message validation.
 * Handles JSON parse errors and schema validation in a single call.
 *
 * @param data — raw JSON string from the WebSocket
 * @returns validation result with typed envelope on success
 */
export function parseAndValidate(data: string): EnvelopeValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return {
      valid: false,
      errors: [{ path: '', message: 'Invalid JSON' }],
    };
  }

  return validateEncryptedEnvelope(parsed);
}
