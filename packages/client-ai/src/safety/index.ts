// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Three-layer safety evaluation engine for the AI client.
 */

// Config
export { defaultSafetyConfig, validateSafetyConfig } from './config.js';
export type { FloorViolation } from './config.js';

// Layer 1: Absolute Boundaries
export { evaluateLayer1 } from './layer1.js';

// Layer 2: Contextual Evaluation
export { evaluateLayer2, createPatternHistory } from './layer2.js';
export type { PatternHistory, PatternEntry } from './layer2.js';

// Layer 3: Completeness Checks
export { evaluateLayer3 } from './layer3.js';

// Pipeline Orchestrator
export { evaluateSafety } from './pipeline.js';
export type { SafetyPipelineOptions } from './pipeline.js';

// Message Generation
export { generateSafetyResponse } from './messages.js';
export type { SafetyResponse } from './messages.js';
