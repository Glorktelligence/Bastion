// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Safety Message Generator — converts SafetyEvaluation results into
 * protocol-compliant DenialPayload, ChallengePayload, or ConversationPayload
 * messages with human-readable explanations.
 */

import type {
  ChallengeFactor,
  ChallengePayload,
  CompletenessIssue,
  ConversationPayload,
  DenialPayload,
  Layer1DenialCategory,
  Layer2Factor,
  MessageId,
  SafetyEvaluation,
} from '@bastion/protocol';
import { SAFETY_LAYERS, SAFETY_OUTCOMES } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Discriminated union of possible safety response messages. */
export type SafetyResponse =
  | { readonly type: 'denial'; readonly payload: DenialPayload }
  | { readonly type: 'challenge'; readonly payload: ChallengePayload }
  | { readonly type: 'clarify'; readonly payload: ConversationPayload }
  | { readonly type: 'allow'; readonly payload: null };

// ---------------------------------------------------------------------------
// Denial category → human-readable labels
// ---------------------------------------------------------------------------

const DENIAL_LABELS: Record<Layer1DenialCategory, string> = {
  destructive_without_scope: 'Destructive action without a defined scope',
  boundary_violation: 'System boundary violation',
  privilege_escalation: 'Privilege escalation attempt',
  data_exfiltration: 'Data exfiltration risk',
  safety_floor_modification: 'Attempt to modify safety floor settings',
};

// ---------------------------------------------------------------------------
// Layer 2 factor → suggested alternatives
// ---------------------------------------------------------------------------

const FACTOR_ALTERNATIVES: Record<string, string> = {
  reversibility: 'Use a reversible alternative or create a backup before proceeding',
  scope_intent_mismatch: 'Narrow the target scope to match the intended action',
  behavioural_deviation: 'Confirm this action is intentional — it deviates from your usual patterns',
  time_of_day: 'Consider performing this action during normal working hours',
  resource_impact: 'Run this as a smaller batch or schedule it during a low-traffic period',
  cascading_effects: 'Test changes in an isolated environment before applying broadly',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Maximum possible single-factor weight (reversibility = 3.0). */
const MAX_FACTOR_WEIGHT = 3.0;

/**
 * Normalise a Layer2Factor weight to [0, 1] for ChallengePayload.
 * Uses the maximum factor weight as the normalisation base.
 */
function normaliseWeight(weight: number): number {
  return Math.min(weight / MAX_FACTOR_WEIGHT, 1.0);
}

/** Convert Layer2Factor[] → ChallengeFactor[] (only triggered factors). */
function toChallengeFactor(factor: Layer2Factor): ChallengeFactor {
  return {
    name: factor.name,
    description: factor.detail,
    weight: normaliseWeight(factor.weight),
  };
}

/** Build a risk assessment summary from triggered Layer2 factors. */
function buildRiskAssessment(factors: readonly Layer2Factor[], riskScore: number, threshold: number): string {
  const triggered = factors.filter((f) => f.triggered);
  if (triggered.length === 0) {
    return `Risk score ${riskScore.toFixed(1)}/${threshold.toFixed(1)} — no individual factors triggered, but combined score exceeded threshold`;
  }

  const names = triggered.map((f) => f.name.replace(/_/g, ' ')).join(', ');
  return `Risk score ${riskScore.toFixed(1)}/${threshold.toFixed(1)} — triggered factors: ${names}`;
}

/** Build suggested alternatives from triggered Layer2 factors. */
function buildAlternatives(factors: readonly Layer2Factor[]): string[] {
  return factors
    .filter((f) => f.triggered)
    .map((f) => FACTOR_ALTERNATIVES[f.name])
    .filter((alt): alt is string => alt !== undefined);
}

/** Build a clarification message from Layer3 completeness issues. */
function buildClarificationContent(issues: readonly CompletenessIssue[]): string {
  const lines = ['I need some clarification before I can proceed with this task:', ''];

  for (const issue of issues) {
    const label = issue.type.replace(/_/g, ' ');
    lines.push(`• ${label}: ${issue.description}`);
    lines.push(`  Suggestion: ${issue.suggestion}`);
  }

  return lines.join('\n');
}

/** Build a denial detail string from Layer1 denial information. */
function buildDenialDetail(category: Layer1DenialCategory, reason: string): string {
  const label = DENIAL_LABELS[category];
  return `${label}. ${reason}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a protocol-compliant safety response message from a SafetyEvaluation.
 *
 * @param evaluation - Result from the safety pipeline
 * @param messageId - ID of the original task message that was evaluated
 * @returns A discriminated union with the appropriate payload, or null payload for 'allow'
 */
export function generateSafetyResponse(evaluation: SafetyEvaluation, messageId: MessageId): SafetyResponse {
  const { outcome, layerResults } = evaluation;

  // ------ DENY ------
  if (outcome === SAFETY_OUTCOMES.DENY) {
    const { layer1 } = layerResults;
    const category = layer1.denialCategory ?? 'destructive_without_scope';
    const reason = layer1.reason ?? 'Task denied by safety evaluation';

    return {
      type: 'denial',
      payload: {
        deniedMessageId: messageId,
        deniedTaskId: evaluation.taskId,
        layer: SAFETY_LAYERS.LAYER_1_ABSOLUTE,
        reason: DENIAL_LABELS[category],
        detail: buildDenialDetail(category, reason),
      },
    };
  }

  // ------ CHALLENGE ------
  if (outcome === SAFETY_OUTCOMES.CHALLENGE) {
    const layer2 = layerResults.layer2!;
    const triggeredFactors = layer2.factors.filter((f) => f.triggered).map(toChallengeFactor);

    return {
      type: 'challenge',
      payload: {
        challengedMessageId: messageId,
        challengedTaskId: evaluation.taskId,
        layer: SAFETY_LAYERS.LAYER_2_CONTEXTUAL,
        reason: buildChallengeReason(layer2.factors),
        riskAssessment: buildRiskAssessment(layer2.factors, layer2.riskScore, layer2.challengeThreshold),
        suggestedAlternatives: buildAlternatives(layer2.factors),
        factors: triggeredFactors,
      },
    };
  }

  // ------ CLARIFY ------
  if (outcome === SAFETY_OUTCOMES.CLARIFY) {
    const layer3 = layerResults.layer3!;

    return {
      type: 'clarify',
      payload: {
        content: buildClarificationContent(layer3.issues),
        // No replyTo — this is a new clarification request
      },
    };
  }

  // ------ ALLOW ------
  return { type: 'allow', payload: null };
}

/**
 * Build a concise reason string for a challenge from triggered factors.
 */
function buildChallengeReason(factors: readonly Layer2Factor[]): string {
  const triggered = factors.filter((f) => f.triggered);

  if (triggered.length === 0) {
    return 'This task requires confirmation before proceeding';
  }

  if (triggered.length === 1) {
    return `This task was flagged: ${triggered[0]!.detail}`;
  }

  return `This task was flagged for ${triggered.length} risk factors and requires your confirmation before proceeding`;
}
