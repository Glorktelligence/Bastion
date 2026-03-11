// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Safety Pipeline Orchestrator — three-layer evaluation pipeline.
 *
 * Flow: L1 (deny?) → L2 (challenge?) → L3 (clarify?) → allow.
 * L1 denial short-circuits: L2 and L3 are null.
 * L3 ALWAYS runs if L1 passed, even if L2 challenged.
 */

import type { SafetyConfig, SafetyEvaluation, TaskPayload } from '@bastion/protocol';
import { SAFETY_LAYERS, SAFETY_OUTCOMES } from '@bastion/protocol';
import { defaultSafetyConfig, validateSafetyConfig } from './config.js';
import { evaluateLayer1 } from './layer1.js';
import { createPatternHistory, evaluateLayer2 } from './layer2.js';
import type { PatternHistory } from './layer2.js';
import { evaluateLayer3 } from './layer3.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the safety evaluation pipeline. */
export interface SafetyPipelineOptions {
  readonly config?: Partial<SafetyConfig>;
  readonly history?: PatternHistory;
  readonly now?: Date;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a task through the three-layer safety evaluation pipeline.
 *
 * @param task - The task to evaluate
 * @param options - Optional config overrides, pattern history, and time
 * @returns Complete safety evaluation result
 */
export function evaluateSafety(task: TaskPayload, options?: SafetyPipelineOptions): SafetyEvaluation {
  const timestamp = new Date().toISOString();

  // 1. Validate/clamp config
  const { config } = options?.config ? validateSafetyConfig(options.config) : { config: defaultSafetyConfig() };

  const history = options?.history ?? createPatternHistory();

  // 2. Layer 1 — Absolute Boundaries
  const layer1 = evaluateLayer1(task);
  if (!layer1.passed) {
    return {
      taskId: task.taskId,
      timestamp,
      outcome: SAFETY_OUTCOMES.DENY,
      decidingLayer: SAFETY_LAYERS.LAYER_1_ABSOLUTE,
      layerResults: {
        layer1,
        layer2: null,
        layer3: null,
      },
    };
  }

  // 3. Layer 2 — Contextual Evaluation
  const layer2 = evaluateLayer2(task, config, history, options?.now);

  // 4. Layer 3 — Completeness (ALWAYS runs if L1 passed)
  const layer3 = evaluateLayer3(task);

  // 5. Determine final outcome
  if (layer2.triggered) {
    return {
      taskId: task.taskId,
      timestamp,
      outcome: SAFETY_OUTCOMES.CHALLENGE,
      decidingLayer: SAFETY_LAYERS.LAYER_2_CONTEXTUAL,
      layerResults: { layer1, layer2, layer3 },
    };
  }

  if (!layer3.complete) {
    return {
      taskId: task.taskId,
      timestamp,
      outcome: SAFETY_OUTCOMES.CLARIFY,
      decidingLayer: SAFETY_LAYERS.LAYER_3_COMPLETENESS,
      layerResults: { layer1, layer2, layer3 },
    };
  }

  return {
    taskId: task.taskId,
    timestamp,
    outcome: SAFETY_OUTCOMES.ALLOW,
    decidingLayer: SAFETY_LAYERS.LAYER_3_COMPLETENESS,
    layerResults: { layer1, layer2, layer3 },
  };
}
