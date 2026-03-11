// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Safety evaluation types for the three-layer safety engine (Section 6).
 */

import type { PatternSensitivity, SafetyLayer, SafetyOutcome } from '../constants/safety-levels.js';
import type { TaskId, Timestamp } from './common.js';

/** Result of evaluating a task through the safety engine. */
export interface SafetyEvaluation {
  readonly taskId: TaskId;
  readonly timestamp: Timestamp;
  readonly outcome: SafetyOutcome;
  /** Which layer produced the final outcome. */
  readonly decidingLayer: SafetyLayer;
  readonly layerResults: SafetyLayerResults;
}

/** Per-layer evaluation results. */
export interface SafetyLayerResults {
  readonly layer1: Layer1Result;
  readonly layer2: Layer2Result | null;
  readonly layer3: Layer3Result | null;
}

/** Layer 1: Absolute boundaries. Pass or deny. */
export interface Layer1Result {
  readonly passed: boolean;
  /** If denied, which category triggered the denial. */
  readonly denialCategory?: Layer1DenialCategory;
  readonly reason?: string;
}

/** Categories of Layer 1 absolute denials. */
export type Layer1DenialCategory =
  | 'destructive_without_scope'
  | 'boundary_violation'
  | 'privilege_escalation'
  | 'data_exfiltration'
  | 'safety_floor_modification';

/** Layer 2: Contextual evaluation. May challenge or allow. */
export interface Layer2Result {
  readonly triggered: boolean;
  readonly factors: readonly Layer2Factor[];
  /** Aggregate risk score from all factors. */
  readonly riskScore: number;
  /** Threshold above which a challenge is issued. */
  readonly challengeThreshold: number;
}

/** Individual contextual factor evaluated in Layer 2. */
export interface Layer2Factor {
  readonly name: Layer2FactorName;
  readonly triggered: boolean;
  readonly weight: number;
  readonly detail: string;
}

/** Named factors evaluated in Layer 2 (Section 6.2). */
export type Layer2FactorName =
  | 'reversibility'
  | 'scope_intent_mismatch'
  | 'behavioural_deviation'
  | 'time_of_day'
  | 'resource_impact'
  | 'cascading_effects';

/** Layer 3: Completeness and clarity check. */
export interface Layer3Result {
  readonly complete: boolean;
  readonly issues: readonly CompletenessIssue[];
}

/** An issue found during Layer 3 completeness check. */
export interface CompletenessIssue {
  readonly type: CompletenessIssueType;
  readonly description: string;
  readonly suggestion: string;
}

export type CompletenessIssueType =
  | 'missing_parameter'
  | 'ambiguous_target'
  | 'conflicting_constraints'
  | 'insufficient_context'
  | 'logical_inconsistency';

/** User-adjustable safety configuration. Floors cannot be lowered. */
export interface SafetyConfig {
  readonly highRiskHoursStart: number;
  readonly highRiskHoursEnd: number;
  readonly timeOfDayWeight: number;
  readonly patternDeviationSensitivity: PatternSensitivity;
}
