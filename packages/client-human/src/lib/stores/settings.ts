// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Settings store for the human client.
 * Safety floors can be TIGHTENED but NEVER LOWERED below factory defaults.
 */

import type { Readable, Writable } from '../store.js';
import { derived, writable } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PatternSensitivity = 'low' | 'medium' | 'high';

export interface SafetySettings {
  /** Risk score threshold for challenge (lower = stricter). Floor: 0.6. */
  readonly challengeThreshold: number;
  /** Risk score threshold for denial (lower = stricter). Floor: 0.9. */
  readonly denialThreshold: number;
  /** Time-of-day scrutiny multiplier (higher = stricter). Floor: 1.2. */
  readonly timeOfDayWeight: number;
  /** Always challenge irreversible actions. Locked: true. */
  readonly irreversibleAlwaysChallenge: boolean;
  /** File quarantine always enabled. Locked: true. */
  readonly fileQuarantineEnabled: boolean;
  /** Pattern deviation sensitivity (higher = stricter). Floor: 'low'. */
  readonly patternDeviationSensitivity: PatternSensitivity;
  /** Grace period in ms (higher = stricter). Floor: 120000. */
  readonly gracePeriodMs: number;
  /** Audit retention in days (higher = stricter). Floor: 90. */
  readonly auditRetentionDays: number;
  /** High-risk hours start (0–23). */
  readonly highRiskHoursStart: number;
  /** High-risk hours end (0–23). */
  readonly highRiskHoursEnd: number;
}

export interface SettingsStoreState {
  readonly settings: SafetySettings;
  readonly dirty: boolean;
  readonly lastSaved: string | null;
  readonly error: string | null;
  readonly userContext: string;
}

export interface SettingUpdateResult {
  readonly ok: boolean;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Safety floor constants
// ---------------------------------------------------------------------------

// Cannot import SAFETY_FLOORS from @bastion/protocol — it pulls in hash.ts
// which uses node:crypto, breaking Vite's browser build. Keep in sync manually.
// Source of truth: packages/protocol/src/constants/safety-levels.ts
export const SAFETY_FLOOR_VALUES: Readonly<SafetySettings> = {
  challengeThreshold: 0.6, // SAFETY_FLOORS.CHALLENGE_THRESHOLD
  denialThreshold: 0.9, // SAFETY_FLOORS.DENIAL_THRESHOLD
  timeOfDayWeight: 1.2, // SAFETY_FLOORS.TIME_OF_DAY_WEIGHT_FLOOR
  irreversibleAlwaysChallenge: true, // SAFETY_FLOORS.IRREVERSIBLE_ACTION_ALWAYS_CHALLENGE
  fileQuarantineEnabled: true, // SAFETY_FLOORS.FILE_QUARANTINE_ENABLED
  patternDeviationSensitivity: 'low', // SAFETY_FLOORS.PATTERN_DEVIATION_SENSITIVITY_FLOOR
  gracePeriodMs: 120_000, // SAFETY_FLOORS.GRACE_PERIOD_MINIMUM_MS
  auditRetentionDays: 90, // SAFETY_FLOORS.AUDIT_RETENTION_FLOOR_DAYS
  highRiskHoursStart: 0, // SAFETY_FLOORS.HIGH_RISK_HOURS_START
  highRiskHoursEnd: 6, // SAFETY_FLOORS.HIGH_RISK_HOURS_END
};

/** Default settings (may be stricter than floors). */
const DEFAULT_SETTINGS: SafetySettings = {
  challengeThreshold: 0.6,
  denialThreshold: 0.9,
  timeOfDayWeight: 1.5,
  irreversibleAlwaysChallenge: true,
  fileQuarantineEnabled: true,
  patternDeviationSensitivity: 'low',
  gracePeriodMs: 300_000,
  auditRetentionDays: 365,
  highRiskHoursStart: 0,
  highRiskHoursEnd: 6,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const SENSITIVITY_ORDER: Record<PatternSensitivity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Validate that a setting change tightens (or maintains) security.
 * Returns `{ ok: true }` if valid, `{ ok: false, reason }` if it would lower below floor.
 */
export function validateSettingChange(
  key: keyof SafetySettings,
  value: unknown,
  currentSettings?: SafetySettings,
): SettingUpdateResult {
  const floor = SAFETY_FLOOR_VALUES[key];

  switch (key) {
    // Thresholds: lower = stricter. Can't go ABOVE the floor.
    case 'challengeThreshold':
    case 'denialThreshold': {
      const num = value as number;
      if (typeof num !== 'number' || num < 0 || num > 1) {
        return { ok: false, reason: `${key} must be a number between 0 and 1` };
      }
      if (num > (floor as number)) {
        return { ok: false, reason: `${key} cannot exceed floor value of ${floor} (lower = stricter)` };
      }
      return { ok: true };
    }

    // Weights/durations: higher = stricter. Can't go BELOW the floor.
    case 'timeOfDayWeight': {
      const num = value as number;
      if (typeof num !== 'number' || num < 0) {
        return { ok: false, reason: `${key} must be a positive number` };
      }
      if (num < (floor as number)) {
        return { ok: false, reason: `${key} cannot go below floor value of ${floor} (higher = stricter)` };
      }
      return { ok: true };
    }

    case 'gracePeriodMs': {
      const num = value as number;
      if (typeof num !== 'number' || num < 0) {
        return { ok: false, reason: `${key} must be a positive number` };
      }
      if (num < (floor as number)) {
        return { ok: false, reason: `${key} cannot go below floor of ${floor}ms (${(floor as number) / 60_000} min)` };
      }
      return { ok: true };
    }

    case 'auditRetentionDays': {
      const num = value as number;
      if (typeof num !== 'number' || num < 1) {
        return { ok: false, reason: `${key} must be a positive integer` };
      }
      if (num < (floor as number)) {
        return { ok: false, reason: `${key} cannot go below floor of ${floor} days` };
      }
      return { ok: true };
    }

    // Locked booleans: cannot be set to false
    case 'irreversibleAlwaysChallenge':
    case 'fileQuarantineEnabled': {
      if (value !== true) {
        return { ok: false, reason: `${key} is locked to true and cannot be disabled` };
      }
      return { ok: true };
    }

    // Sensitivity: can only go higher
    case 'patternDeviationSensitivity': {
      const val = value as PatternSensitivity;
      if (!Object.hasOwn(SENSITIVITY_ORDER, val)) {
        return { ok: false, reason: `${key} must be 'low', 'medium', or 'high'` };
      }
      if (SENSITIVITY_ORDER[val] < SENSITIVITY_ORDER[floor as PatternSensitivity]) {
        return { ok: false, reason: `${key} cannot go below '${floor}' (higher = stricter)` };
      }
      return { ok: true };
    }

    // Hours: validate range and enforce minimum window size (6 hours floor)
    case 'highRiskHoursStart':
    case 'highRiskHoursEnd': {
      const num = value as number;
      if (typeof num !== 'number' || num < 0 || num > 23 || !Number.isInteger(num)) {
        return { ok: false, reason: `${key} must be an integer between 0 and 23` };
      }
      // Enforce minimum 6-hour high-risk window (safety floor)
      if (currentSettings) {
        const proposedStart = key === 'highRiskHoursStart' ? num : currentSettings.highRiskHoursStart;
        const proposedEnd = key === 'highRiskHoursEnd' ? num : currentSettings.highRiskHoursEnd;
        const window = proposedEnd > proposedStart ? proposedEnd - proposedStart : 24 - proposedStart + proposedEnd; // handles wrap-around (e.g., 22:00-06:00)
        if (window < 6) {
          return { ok: false, reason: `High-risk hours window cannot be less than 6 hours (proposed: ${window}h)` };
        }
      }
      return { ok: true };
    }

    default:
      return { ok: false, reason: `Unknown setting: ${key}` };
  }
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createSettingsStore(initial?: Partial<SafetySettings>): {
  store: Writable<SettingsStoreState>;
  floorValues: Readable<SafetySettings>;
  isAtFloor: Readable<Record<keyof SafetySettings, boolean>>;
  userContext: Readable<string>;
  tryUpdate(key: keyof SafetySettings, value: unknown): SettingUpdateResult;
  setUserContext(content: string): void;
  resetToDefaults(): void;
  markSaved(): void;
} {
  // Merge initial settings with floor validation — no below-floor values allowed
  const rawMerged = { ...DEFAULT_SETTINGS, ...initial };
  const mergedSettings: SafetySettings = {
    ...rawMerged,
    // Clamp numeric values to their floors
    challengeThreshold: Math.min(rawMerged.challengeThreshold, SAFETY_FLOOR_VALUES.challengeThreshold),
    denialThreshold: Math.min(rawMerged.denialThreshold, SAFETY_FLOOR_VALUES.denialThreshold),
    timeOfDayWeight: Math.max(rawMerged.timeOfDayWeight, SAFETY_FLOOR_VALUES.timeOfDayWeight),
    gracePeriodMs: Math.max(rawMerged.gracePeriodMs, SAFETY_FLOOR_VALUES.gracePeriodMs),
    auditRetentionDays: Math.max(rawMerged.auditRetentionDays, SAFETY_FLOOR_VALUES.auditRetentionDays),
    // Locked booleans
    irreversibleAlwaysChallenge: true,
    fileQuarantineEnabled: true,
  };

  const store = writable<SettingsStoreState>({
    settings: mergedSettings,
    dirty: false,
    lastSaved: null,
    error: null,
    userContext: '',
  });

  const floorStore = writable(SAFETY_FLOOR_VALUES);

  const floorValues = derived([floorStore], ([f]) => f);

  const isAtFloor = derived([store], ([state]) => {
    const s = state.settings;
    const f = SAFETY_FLOOR_VALUES;
    return {
      challengeThreshold: s.challengeThreshold >= f.challengeThreshold,
      denialThreshold: s.denialThreshold >= f.denialThreshold,
      timeOfDayWeight: s.timeOfDayWeight <= f.timeOfDayWeight,
      irreversibleAlwaysChallenge: true, // always locked
      fileQuarantineEnabled: true, // always locked
      patternDeviationSensitivity:
        SENSITIVITY_ORDER[s.patternDeviationSensitivity] <= SENSITIVITY_ORDER[f.patternDeviationSensitivity],
      gracePeriodMs: s.gracePeriodMs <= f.gracePeriodMs,
      auditRetentionDays: s.auditRetentionDays <= f.auditRetentionDays,
      highRiskHoursStart: s.highRiskHoursStart === f.highRiskHoursStart,
      highRiskHoursEnd: s.highRiskHoursEnd === f.highRiskHoursEnd,
    } as Record<keyof SafetySettings, boolean>;
  });

  function tryUpdate(key: keyof SafetySettings, value: unknown): SettingUpdateResult {
    let currentState: SettingsStoreState | undefined;
    store.subscribe((s) => {
      currentState = s;
    })();
    const result = validateSettingChange(key, value, currentState?.settings);
    if (!result.ok) {
      store.update((s) => ({ ...s, error: result.reason ?? null }));
      return result;
    }

    store.update((s) => ({
      ...s,
      settings: { ...s.settings, [key]: value },
      dirty: true,
      error: null,
    }));
    return { ok: true };
  }

  function resetToDefaults(): void {
    store.update((s) => ({
      ...s,
      settings: { ...DEFAULT_SETTINGS },
      dirty: true,
      error: null,
    }));
  }

  function markSaved(): void {
    store.update((s) => ({
      ...s,
      dirty: false,
      lastSaved: new Date().toISOString(),
    }));
  }

  const userContext = derived([store], ([s]) => s.userContext);

  function setUserContext(content: string): void {
    store.update((s) => ({ ...s, userContext: content }));
  }

  return {
    store,
    floorValues,
    isAtFloor,
    userContext,
    tryUpdate,
    setUserContext,
    resetToDefaults,
    markSaved,
  };
}
