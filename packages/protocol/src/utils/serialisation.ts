// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Message serialisation and deserialisation with SHA-256 integrity checks.
 *
 * Wire format:
 *   The envelope fields are serialised as a JSON object with an added
 *   `_integrity` field containing `"sha256:<hex>"`. The hash is computed
 *   over the **canonical** JSON of the envelope (without `_integrity`),
 *   using deterministic key ordering (sorted lexicographically at every
 *   nesting level) and no superfluous whitespace.
 *
 * Serialise flow:
 *   1. Validate envelope + payload against Zod schemas
 *   2. Produce canonical JSON of envelope
 *   3. SHA-256 hash the canonical JSON
 *   4. Emit JSON with all envelope fields + `_integrity`
 *
 * Deserialise flow:
 *   1. Parse wire JSON
 *   2. Extract `_integrity`, reconstruct envelope without it
 *   3. Canonical JSON of envelope → SHA-256 → compare with extracted hash
 *   4. Validate envelope + payload against Zod schemas
 *   5. Return typed MessageEnvelope
 */

import type { MessageEnvelope } from '../types/envelope.js';
import { sha256 } from './hash.js';
import type { ValidationError } from './validation.js';
import { validateMessage } from './validation.js';

const INTEGRITY_PREFIX = 'sha256:';

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic JSON string with lexicographically sorted keys
 * at every nesting level and no extra whitespace.
 *
 * This guarantees that structurally identical objects always produce the
 * same byte sequence, which is essential for integrity hashing.
 *
 * Follows the same spirit as RFC 8785 (JSON Canonicalization Scheme):
 *   - Object keys sorted by Unicode code point
 *   - No insignificant whitespace
 *   - Properties with `undefined` values omitted
 *   - `null` preserved as-is
 */
export function canonicalise(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalise(item));
    return `[${items.join(',')}]`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries: string[] = [];
    for (const key of keys) {
      const v = obj[key];
      // Omit undefined values (matches JSON.stringify behaviour)
      if (v !== undefined) {
        entries.push(`${JSON.stringify(key)}:${canonicalise(v)}`);
      }
    }
    return `{${entries.join(',')}}`;
  }

  // Fallback for unexpected types (symbols, functions, bigint)
  return 'null';
}

// ---------------------------------------------------------------------------
// Serialisation result types
// ---------------------------------------------------------------------------

/** Successful serialisation output. */
export interface SerialisedMessage {
  /** JSON string ready for WebSocket transmission (includes `_integrity`). */
  readonly wire: string;
  /** The integrity hash string (`sha256:<hex>`). */
  readonly integrity: string;
  /** The canonical JSON that was hashed. Useful for audit chain input. */
  readonly canonical: string;
}

/** Deserialisation result — discriminated union on `success`. */
export type DeserialisationResult = DeserialisationSuccess | DeserialisationFailure;

export interface DeserialisationSuccess {
  readonly success: true;
  readonly envelope: MessageEnvelope;
  /** The verified integrity hash string (`sha256:<hex>`). */
  readonly integrity: string;
  /** The canonical JSON of the envelope. Useful for audit chain input. */
  readonly canonical: string;
}

export interface DeserialisationFailure {
  readonly success: false;
  readonly errors: readonly ValidationError[];
}

// ---------------------------------------------------------------------------
// Serialise
// ---------------------------------------------------------------------------

/**
 * Serialise a MessageEnvelope to wire format with a SHA-256 integrity hash.
 *
 * The envelope is validated against Zod schemas before serialisation.
 * Throws if the envelope is invalid (a programming error — callers should
 * construct valid envelopes).
 *
 * @param envelope — a valid MessageEnvelope
 * @returns SerialisedMessage with wire string, integrity hash, and canonical form
 * @throws Error if the envelope fails schema validation
 */
export function serialise(envelope: MessageEnvelope): SerialisedMessage {
  // 1. Validate the envelope + payload before producing wire output
  const validation = validateMessage(envelope);
  if (!validation.valid) {
    throw new SerialisationError('Cannot serialise invalid envelope', validation.errors);
  }

  // 2. Produce canonical JSON and compute integrity hash
  const canonical = canonicalise(envelope);
  const integrity = INTEGRITY_PREFIX + sha256(canonical);

  // 3. Build wire format: envelope fields + _integrity
  const wireObj = { ...(envelope as unknown as Record<string, unknown>), _integrity: integrity };
  const wire = JSON.stringify(wireObj);

  return { wire, integrity, canonical };
}

// ---------------------------------------------------------------------------
// Deserialise
// ---------------------------------------------------------------------------

/**
 * Deserialise a wire-format JSON string back to a validated MessageEnvelope.
 *
 * Performs in order:
 *   1. JSON parsing
 *   2. Integrity hash extraction and verification
 *   3. Zod schema validation (envelope + type-specific payload)
 *
 * Returns a discriminated union — check `result.success` before accessing
 * `result.envelope`.
 *
 * @param wire — raw JSON string from the WebSocket
 * @returns DeserialisationResult
 */
export function deserialise(wire: string): DeserialisationResult {
  // 1. Parse the wire JSON
  let wireObj: Record<string, unknown>;
  try {
    wireObj = JSON.parse(wire) as Record<string, unknown>;
  } catch {
    return {
      success: false,
      errors: [{ path: '', message: 'Invalid JSON: failed to parse wire data' }],
    };
  }

  if (wireObj === null || typeof wireObj !== 'object' || Array.isArray(wireObj)) {
    return {
      success: false,
      errors: [{ path: '', message: 'Wire data must be a JSON object' }],
    };
  }

  // 2. Extract the integrity hash
  const receivedIntegrity = wireObj._integrity;
  if (typeof receivedIntegrity !== 'string') {
    return {
      success: false,
      errors: [{ path: '_integrity', message: 'Missing _integrity field' }],
    };
  }

  if (!receivedIntegrity.startsWith(INTEGRITY_PREFIX)) {
    return {
      success: false,
      errors: [
        {
          path: '_integrity',
          message: `Invalid integrity format: expected "${INTEGRITY_PREFIX}" prefix`,
        },
      ],
    };
  }

  // 3. Reconstruct the envelope (strip _integrity)
  const { _integrity: _, ...envelopeObj } = wireObj;

  // 4. Compute expected hash from canonical form and compare
  const canonical = canonicalise(envelopeObj);
  const expectedIntegrity = INTEGRITY_PREFIX + sha256(canonical);

  if (receivedIntegrity !== expectedIntegrity) {
    return {
      success: false,
      errors: [
        {
          path: '_integrity',
          message: 'Integrity check failed: SHA-256 hash does not match envelope content',
        },
      ],
    };
  }

  // 5. Validate against Zod schemas (envelope structure + payload)
  const validation = validateMessage(envelopeObj);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  return {
    success: true,
    envelope: envelopeObj as unknown as MessageEnvelope,
    integrity: receivedIntegrity,
    canonical,
  };
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/** Error thrown when serialise() is called with an invalid envelope. */
export class SerialisationError extends Error {
  readonly errors: readonly ValidationError[];

  constructor(message: string, errors: readonly ValidationError[]) {
    super(`${message}: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    this.name = 'SerialisationError';
    this.errors = errors;
  }
}
