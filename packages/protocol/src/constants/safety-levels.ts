// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Safety evaluation layers and configurable parameters.
 * Safety floors can be TIGHTENED but NEVER LOWERED below factory defaults.
 */

/** The three safety evaluation layers. */
export const SAFETY_LAYERS = {
  /** Non-negotiable absolute boundaries. Results in denial. */
  LAYER_1_ABSOLUTE: 1,
  /** Contextual evaluation. May result in challenge. */
  LAYER_2_CONTEXTUAL: 2,
  /** Completeness and clarity check. May request clarification. */
  LAYER_3_COMPLETENESS: 3,
} as const;

export type SafetyLayer = (typeof SAFETY_LAYERS)[keyof typeof SAFETY_LAYERS];

/** Safety evaluation outcomes. */
export const SAFETY_OUTCOMES = {
  ALLOW: 'allow',
  CHALLENGE: 'challenge',
  DENY: 'deny',
  CLARIFY: 'clarify',
} as const;

export type SafetyOutcome = (typeof SAFETY_OUTCOMES)[keyof typeof SAFETY_OUTCOMES];

/** Factory default safety configuration. These are minimum floors. */
export const SAFETY_FLOORS = {
  /** Challenge threshold floor (lower = stricter). Cannot exceed this value. */
  CHALLENGE_THRESHOLD: 0.6,
  /** Denial threshold floor (lower = stricter). Cannot exceed this value. */
  DENIAL_THRESHOLD: 0.9,

  /** High-risk hours cannot be disabled entirely. Default: 00:00-06:00. */
  HIGH_RISK_HOURS_START: 0,
  HIGH_RISK_HOURS_END: 6,

  /** Time-of-day scrutiny weight minimum. Default: 1.5x, floor: 1.2x. */
  TIME_OF_DAY_WEIGHT_DEFAULT: 1.5,
  TIME_OF_DAY_WEIGHT_FLOOR: 1.2,

  /** Irreversible action behaviour: always challenge. Locked. */
  IRREVERSIBLE_ACTION_ALWAYS_CHALLENGE: true,

  /** Pattern deviation sensitivity floor: cannot be set to 'off'. */
  PATTERN_DEVIATION_SENSITIVITY_FLOOR: 'low' as const,

  /** File transfer quarantine: always enabled. Locked. */
  FILE_QUARANTINE_ENABLED: true,

  /** Grace period minimum: 2 minutes (in ms). */
  GRACE_PERIOD_MINIMUM_MS: 2 * 60 * 1000,

  /** Grace period default: 5 minutes (in ms). */
  GRACE_PERIOD_DEFAULT_MS: 5 * 60 * 1000,

  /** JWT expiry: 15 minutes (in ms). */
  JWT_EXPIRY_MS: 15 * 60 * 1000,

  /** Reconnection message queue limits. */
  MESSAGE_QUEUE_MAX_COUNT: 100,
  MESSAGE_QUEUE_MAX_BYTES: 5 * 1024 * 1024,

  /** Audit log retention: default 365 days, minimum 90 days. */
  AUDIT_RETENTION_DEFAULT_DAYS: 365,
  AUDIT_RETENTION_FLOOR_DAYS: 90,

  /** Budget Guard cooldown minimum: 1 day (cannot be set to 0 via config). */
  MIN_COOLDOWN_DAYS: 1,

  /** High-risk hours minimum window: 6 hours. Cannot shrink below floor. */
  HIGH_RISK_HOURS_MIN_WINDOW: 6,
} as const;

/** Pattern deviation sensitivity levels. */
export const PATTERN_SENSITIVITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;

export type PatternSensitivity = (typeof PATTERN_SENSITIVITY)[keyof typeof PATTERN_SENSITIVITY];
