// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Safety configuration manager with immutable floor enforcement.
 *
 * Safety floors can be TIGHTENED but NEVER LOWERED below factory defaults.
 * This is a security non-negotiable — the MaliClaw Clause principle applied
 * to safety configuration.
 */

import type { PatternSensitivity, SafetyConfig } from '@bastion/protocol';
import { SAFETY_FLOORS } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A record of a floor violation that was clamped during validation. */
export interface FloorViolation {
  readonly parameter: string;
  readonly requested: unknown;
  readonly floor: unknown;
  readonly applied: unknown;
}

// ---------------------------------------------------------------------------
// Sensitivity ordering
// ---------------------------------------------------------------------------

const SENSITIVITY_ORDER: Record<PatternSensitivity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

/**
 * Returns the factory-default SafetyConfig.
 * All values are at or above their respective floors.
 */
export function defaultSafetyConfig(): SafetyConfig {
  return {
    highRiskHoursStart: SAFETY_FLOORS.HIGH_RISK_HOURS_START,
    highRiskHoursEnd: SAFETY_FLOORS.HIGH_RISK_HOURS_END,
    timeOfDayWeight: SAFETY_FLOORS.TIME_OF_DAY_WEIGHT_DEFAULT,
    patternDeviationSensitivity: 'medium',
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate and clamp a proposed SafetyConfig against immutable floors.
 *
 * Missing fields are filled from defaults. Values that violate floors are
 * clamped to the floor value and recorded as violations.
 *
 * @returns The clamped config and any violations that occurred.
 */
export function validateSafetyConfig(proposed: Partial<SafetyConfig>): {
  config: SafetyConfig;
  violations: readonly FloorViolation[];
} {
  const defaults = defaultSafetyConfig();
  const violations: FloorViolation[] = [];

  // --- timeOfDayWeight: floor is 1.2 ---
  let timeOfDayWeight = proposed.timeOfDayWeight ?? defaults.timeOfDayWeight;
  if (timeOfDayWeight < SAFETY_FLOORS.TIME_OF_DAY_WEIGHT_FLOOR) {
    violations.push({
      parameter: 'timeOfDayWeight',
      requested: proposed.timeOfDayWeight,
      floor: SAFETY_FLOORS.TIME_OF_DAY_WEIGHT_FLOOR,
      applied: SAFETY_FLOORS.TIME_OF_DAY_WEIGHT_FLOOR,
    });
    timeOfDayWeight = SAFETY_FLOORS.TIME_OF_DAY_WEIGHT_FLOOR;
  }

  // --- patternDeviationSensitivity: floor is 'low' (cannot be 'off') ---
  let patternDeviationSensitivity = proposed.patternDeviationSensitivity ?? defaults.patternDeviationSensitivity;
  // Runtime guard: reject any value not in the valid set
  if (!(patternDeviationSensitivity in SENSITIVITY_ORDER)) {
    violations.push({
      parameter: 'patternDeviationSensitivity',
      requested: patternDeviationSensitivity,
      floor: SAFETY_FLOORS.PATTERN_DEVIATION_SENSITIVITY_FLOOR,
      applied: SAFETY_FLOORS.PATTERN_DEVIATION_SENSITIVITY_FLOOR,
    });
    patternDeviationSensitivity = SAFETY_FLOORS.PATTERN_DEVIATION_SENSITIVITY_FLOOR;
  }

  // --- highRiskHoursStart: must cover at least factory range [0, 6) ---
  // Start must be <= factory start (0), i.e. can only extend earlier (wrap around)
  let highRiskHoursStart = proposed.highRiskHoursStart ?? defaults.highRiskHoursStart;
  if (highRiskHoursStart > SAFETY_FLOORS.HIGH_RISK_HOURS_START) {
    violations.push({
      parameter: 'highRiskHoursStart',
      requested: proposed.highRiskHoursStart,
      floor: SAFETY_FLOORS.HIGH_RISK_HOURS_START,
      applied: SAFETY_FLOORS.HIGH_RISK_HOURS_START,
    });
    highRiskHoursStart = SAFETY_FLOORS.HIGH_RISK_HOURS_START;
  }

  // --- highRiskHoursEnd: must be >= factory end (6) ---
  let highRiskHoursEnd = proposed.highRiskHoursEnd ?? defaults.highRiskHoursEnd;
  if (highRiskHoursEnd < SAFETY_FLOORS.HIGH_RISK_HOURS_END) {
    violations.push({
      parameter: 'highRiskHoursEnd',
      requested: proposed.highRiskHoursEnd,
      floor: SAFETY_FLOORS.HIGH_RISK_HOURS_END,
      applied: SAFETY_FLOORS.HIGH_RISK_HOURS_END,
    });
    highRiskHoursEnd = SAFETY_FLOORS.HIGH_RISK_HOURS_END;
  }

  return {
    config: {
      highRiskHoursStart,
      highRiskHoursEnd,
      timeOfDayWeight,
      patternDeviationSensitivity,
    },
    violations,
  };
}
