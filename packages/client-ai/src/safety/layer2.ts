// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Layer 2: Contextual Evaluation — weighted risk factor scoring.
 *
 * Evaluates 6 risk factors against a configurable threshold (5.0).
 * If the `reversibility` factor triggers, a challenge is forced regardless
 * of total score (IRREVERSIBLE_ACTION_ALWAYS_CHALLENGE is a safety floor).
 */

import type { Layer2Factor, Layer2Result, PatternSensitivity, SafetyConfig, TaskPayload } from '@bastion/protocol';
import { SAFETY_FLOORS } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHALLENGE_THRESHOLD = 5.0;
const HISTORY_CAPACITY = 100;

// ---------------------------------------------------------------------------
// PatternHistory
// ---------------------------------------------------------------------------

/** A single recorded action entry. */
export interface PatternEntry {
  readonly action: string;
  readonly target: string;
  readonly timestamp: Date;
}

/** In-memory circular buffer tracking recent task patterns. */
export interface PatternHistory {
  /** Record an action/target pair. */
  record(action: string, target: string, timestamp: Date): void;
  /** Get entries within the last windowMs milliseconds. */
  recent(windowMs: number): readonly PatternEntry[];
  /** Check if this action/target combination deviates from history. */
  isDeviation(action: string, target: string, sensitivity: PatternSensitivity): boolean;
  /** Number of entries currently stored. */
  readonly size: number;
}

/**
 * Create a new in-memory PatternHistory with a circular buffer of 100 entries.
 */
export function createPatternHistory(): PatternHistory {
  const buffer: PatternEntry[] = [];

  return {
    record(action: string, target: string, timestamp: Date): void {
      if (buffer.length >= HISTORY_CAPACITY) {
        buffer.shift();
      }
      buffer.push({ action: action.toLowerCase(), target: target.toLowerCase(), timestamp });
    },

    recent(windowMs: number): readonly PatternEntry[] {
      const cutoff = Date.now() - windowMs;
      return buffer.filter((e) => e.timestamp.getTime() >= cutoff);
    },

    isDeviation(action: string, target: string, sensitivity: PatternSensitivity): boolean {
      const a = action.toLowerCase();
      const t = target.toLowerCase();

      if (sensitivity === 'low') {
        // Action verb never seen before
        return !buffer.some((e) => e.action === a);
      }

      if (sensitivity === 'medium') {
        // (action, target-prefix) combination new
        // Use first path segment as prefix
        const prefix = t.split('/').slice(0, 2).join('/');
        return !buffer.some((e) => e.action === a && e.target.startsWith(prefix));
      }

      // sensitivity === 'high'
      // Exact (action, target) combination new — but only with >=5 entries
      if (buffer.length < 5) return false;
      return !buffer.some((e) => e.action === a && e.target === t);
    },

    get size(): number {
      return buffer.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Factor evaluators
// ---------------------------------------------------------------------------

const IRREVERSIBLE_ACTIONS = [
  'delete',
  'remove',
  'rm',
  'drop',
  'truncate',
  'format',
  'purge',
  'destroy',
  'wipe',
  'erase',
  'shred',
  'deploy',
  'migrate',
  'overwrite',
] as const;

function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, 'i').test(text);
}

function evaluateReversibility(task: TaskPayload): Layer2Factor {
  const action = task.action.toLowerCase();
  const triggered = IRREVERSIBLE_ACTIONS.some((kw) => hasWord(action, kw));
  return {
    name: 'reversibility',
    triggered,
    weight: 3.0,
    detail: triggered ? `Action "${task.action}" is potentially irreversible` : 'Action appears reversible',
  };
}

function evaluateScopeIntentMismatch(task: TaskPayload): Layer2Factor {
  const target = task.target.toLowerCase();
  const action = task.action.toLowerCase();

  // Broad target indicators
  const broadTarget =
    /[*]/.test(target) || target === '/' || target === '.' || target.includes('all') || target.includes('every');

  // Narrow action language (single specific verb, not batch/bulk)
  const narrowAction =
    !hasWord(action, 'batch') && !hasWord(action, 'bulk') && !hasWord(action, 'all') && action.split(/\s+/).length <= 2;

  const triggered = broadTarget && narrowAction;
  return {
    name: 'scope_intent_mismatch',
    triggered,
    weight: 2.0,
    detail: triggered
      ? `Broad target "${task.target}" with narrow action "${task.action}"`
      : 'Scope and intent are consistent',
  };
}

function evaluateBehaviouralDeviation(task: TaskPayload, history: PatternHistory, config: SafetyConfig): Layer2Factor {
  const sensitivity = config.patternDeviationSensitivity;

  // Cold-start guard: need >=5 entries at high sensitivity
  if (sensitivity === 'high' && history.size < 5) {
    return {
      name: 'behavioural_deviation',
      triggered: false,
      weight: 1.5,
      detail: `Insufficient history for high-sensitivity deviation check (${history.size}/5 entries)`,
    };
  }

  const triggered = history.isDeviation(task.action, task.target, sensitivity);
  return {
    name: 'behavioural_deviation',
    triggered,
    weight: 1.5,
    detail: triggered
      ? `Action/target combination deviates from established patterns (sensitivity: ${sensitivity})`
      : 'Action/target consistent with history',
  };
}

function evaluateTimeOfDay(_task: TaskPayload, config: SafetyConfig, now: Date): Layer2Factor {
  const hour = now.getHours();
  const { highRiskHoursStart, highRiskHoursEnd } = config;

  // Effective weight: config value clamped to floor
  const weight = Math.max(config.timeOfDayWeight, SAFETY_FLOORS.TIME_OF_DAY_WEIGHT_FLOOR);

  let inHighRisk: boolean;
  if (highRiskHoursStart <= highRiskHoursEnd) {
    // Normal range: e.g. [0, 6) — start <= hour < end
    inHighRisk = hour >= highRiskHoursStart && hour < highRiskHoursEnd;
  } else {
    // Wrapped range: e.g. [22, 6) — hour >= 22 OR hour < 6
    inHighRisk = hour >= highRiskHoursStart || hour < highRiskHoursEnd;
  }

  return {
    name: 'time_of_day',
    triggered: inHighRisk,
    weight: inHighRisk ? weight : 0,
    detail: inHighRisk
      ? `Current hour (${hour}) is within high-risk window [${highRiskHoursStart}, ${highRiskHoursEnd})`
      : `Current hour (${hour}) is outside high-risk window`,
  };
}

const RESOURCE_IMPACT_KEYWORDS = ['build', 'compile', 'scan', 'backup', 'clone', 'migrate'] as const;

function evaluateResourceImpact(_task: TaskPayload): Layer2Factor {
  const action = _task.action.toLowerCase();
  const actionTriggered = RESOURCE_IMPACT_KEYWORDS.some((kw) => hasWord(action, kw));

  // Large size indicators in parameters
  const paramText = JSON.stringify(_task.parameters).toLowerCase();
  const sizeTriggered =
    /\b(large|huge|full|complete|entire|all)\b/.test(paramText) ||
    /\b\d{4,}\s*(mb|gb|tb|files|records|rows)\b/.test(paramText);

  const triggered = actionTriggered || sizeTriggered;
  return {
    name: 'resource_impact',
    triggered,
    weight: 1.5,
    detail: triggered
      ? `Resource-intensive operation detected: "${_task.action}"`
      : 'No significant resource impact detected',
  };
}

const CASCADING_PATTERNS = [
  /\.env$/i,
  /docker-compose/i,
  /dockerfile/i,
  /package\.json$/i,
  /tsconfig/i,
  /\.config\./i,
  /^\.git/i,
  /requirements\.txt$/i,
  /go\.mod$/i,
  /cargo\.toml$/i,
  /pom\.xml$/i,
  /makefile$/i,
] as const;

const CASCADING_KEYWORDS = ['dependency', 'dependencies', 'shared', 'global', 'env', 'config'] as const;

function evaluateCascadingEffects(task: TaskPayload): Layer2Factor {
  const target = task.target.toLowerCase();

  const patternMatch = CASCADING_PATTERNS.some((p) => p.test(target));
  const keywordMatch = CASCADING_KEYWORDS.some((kw) => hasWord(target, kw));

  const triggered = patternMatch || keywordMatch;
  return {
    name: 'cascading_effects',
    triggered,
    weight: 2.0,
    detail: triggered
      ? `Target "${task.target}" may have cascading effects on other components`
      : 'No cascading effects detected',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a task against Layer 2 contextual risk factors.
 *
 * @param task - The task to evaluate
 * @param config - User-adjustable safety configuration (floors enforced)
 * @param history - Pattern history for behavioural deviation detection
 * @param now - Optional current time for testable time-of-day evaluation
 */
export function evaluateLayer2(
  task: TaskPayload,
  config: SafetyConfig,
  history: PatternHistory,
  now?: Date,
): Layer2Result {
  const effectiveNow = now ?? new Date();

  const factors: Layer2Factor[] = [
    evaluateReversibility(task),
    evaluateScopeIntentMismatch(task),
    evaluateBehaviouralDeviation(task, history, config),
    evaluateTimeOfDay(task, config, effectiveNow),
    evaluateResourceImpact(task),
    evaluateCascadingEffects(task),
  ];

  const riskScore = factors.filter((f) => f.triggered).reduce((sum, f) => sum + f.weight, 0);

  // SAFETY FLOOR: irreversible actions ALWAYS challenge (non-configurable)
  const reversibilityFactor = factors.find((f) => f.name === 'reversibility');
  const forceChallenge =
    SAFETY_FLOORS.IRREVERSIBLE_ACTION_ALWAYS_CHALLENGE &&
    reversibilityFactor !== undefined &&
    reversibilityFactor.triggered;

  const triggered = forceChallenge || riskScore >= CHALLENGE_THRESHOLD;

  return {
    triggered,
    factors,
    riskScore,
    challengeThreshold: CHALLENGE_THRESHOLD,
  };
}
