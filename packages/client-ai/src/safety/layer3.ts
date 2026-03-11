// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Layer 3: Completeness Checks — task completeness and coherence.
 *
 * Pure function. Checks that a task has sufficient information for
 * unambiguous execution. Returns issues with suggestions.
 */

import type { CompletenessIssue, Layer3Result, TaskPayload } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Issue checker types
// ---------------------------------------------------------------------------

type IssueChecker = (task: TaskPayload) => CompletenessIssue | null;

// ---------------------------------------------------------------------------
// 1. Missing parameter
// ---------------------------------------------------------------------------

/** Action → required parameter keys (any one suffices). */
const REQUIRED_PARAMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['rename', ['newName', 'newname', 'from', 'to', 'new_name']],
  ['copy', ['destination', 'to', 'dest']],
  ['move', ['destination', 'to', 'dest']],
  ['create', ['name', 'content', 'filename']],
  ['deploy', ['environment', 'target', 'env']],
  ['send', ['recipient', 'to', 'destination']],
  ['install', ['package', 'packages', 'name']],
  ['connect', ['host', 'url', 'endpoint']],
]);

function checkMissingParameter(task: TaskPayload): CompletenessIssue | null {
  const action = task.action.toLowerCase();

  for (const [actionKey, requiredKeys] of REQUIRED_PARAMS) {
    if (action !== actionKey && !action.startsWith(`${actionKey} `)) continue;

    const paramKeys = Object.keys(task.parameters).map((k) => k.toLowerCase());
    const hasRequired = requiredKeys.some((rk) => paramKeys.includes(rk));

    if (!hasRequired) {
      return {
        type: 'missing_parameter',
        description: `Action "${task.action}" requires one of: ${requiredKeys.join(', ')}`,
        suggestion: `Add ${requiredKeys[0]} to the task parameters`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2. Ambiguous target
// ---------------------------------------------------------------------------

const WILDCARD_CHARS = ['*', '**', '?', '[', '{'] as const;
const GENERIC_TARGETS = ['all', 'everything', 'files'] as const;

function checkAmbiguousTarget(task: TaskPayload): CompletenessIssue | null {
  const target = task.target.trim();

  const hasWildcard = WILDCARD_CHARS.some((c) => target.includes(c));
  if (hasWildcard) {
    return {
      type: 'ambiguous_target',
      description: `Target "${target}" contains wildcards — scope is ambiguous`,
      suggestion: 'Specify an explicit file path or narrower glob pattern',
    };
  }

  const lowerTarget = target.toLowerCase();
  const isGeneric = GENERIC_TARGETS.some((g) => lowerTarget === g);
  if (isGeneric) {
    return {
      type: 'ambiguous_target',
      description: `Target "${target}" is too generic`,
      suggestion: 'Specify which files or resources to target',
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 3. Conflicting constraints
// ---------------------------------------------------------------------------

const CONTRADICTION_PAIRS: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [/\bdry[-\s]?run\b/i, /\bexecute\b/i],
  [/\bonly\b/i, /\bexcept\b/i],
  [/\bforce\b/i, /\b(safe|careful)\b/i],
  [/\bverbose\b/i, /\b(quiet|silent)\b/i],
];

function checkConflictingConstraints(task: TaskPayload): CompletenessIssue | null {
  if (task.constraints.length < 2) return null;

  const joined = task.constraints.join(' ');

  for (const [patA, patB] of CONTRADICTION_PAIRS) {
    if (patA.test(joined) && patB.test(joined)) {
      return {
        type: 'conflicting_constraints',
        description: `Constraints contain contradictory directives: ${patA.source} vs ${patB.source}`,
        suggestion: 'Remove one of the conflicting constraints',
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. Insufficient context
// ---------------------------------------------------------------------------

const GENERIC_VERBS = ['check', 'fix', 'handle', 'process', 'do', 'update', 'run'] as const;
const VAGUE_TARGETS = ['it', 'this', 'that', 'thing', 'stuff', 'something'] as const;

function checkInsufficientContext(task: TaskPayload): CompletenessIssue | null {
  const action = task.action.toLowerCase().trim();

  // Single generic verb
  const isGenericVerb = GENERIC_VERBS.some((v) => action === v);
  if (!isGenericVerb) return null;

  // Vague target
  const target = task.target.toLowerCase().trim();
  const isVagueTarget = target.length <= 3 || VAGUE_TARGETS.some((v) => target === v);
  if (!isVagueTarget) return null;

  // Empty constraints
  if (task.constraints.length > 0) return null;

  // Sparse parameters (0 or 1 keys)
  if (Object.keys(task.parameters).length > 1) return null;

  return {
    type: 'insufficient_context',
    description: `Action "${task.action}" with target "${task.target}" lacks sufficient context for execution`,
    suggestion: 'Provide more details: specific target, parameters, or constraints',
  };
}

// ---------------------------------------------------------------------------
// 5. Logical inconsistency
// ---------------------------------------------------------------------------

function checkLogicalInconsistency(task: TaskPayload): CompletenessIssue | null {
  const params = task.parameters;

  // min > max
  if (typeof params.min === 'number' && typeof params.max === 'number') {
    if (params.min > params.max) {
      return {
        type: 'logical_inconsistency',
        description: `Parameter min (${params.min}) is greater than max (${params.max})`,
        suggestion: 'Correct the min/max values so min <= max',
      };
    }
  }

  // Priority contradicts urgency constraint
  if (task.priority === 'low') {
    const hasUrgent = task.constraints.some((c) => /\b(urgent|asap|immediately|rush)\b/i.test(c));
    if (hasUrgent) {
      return {
        type: 'logical_inconsistency',
        description: 'Task priority is "low" but constraints indicate urgency',
        suggestion: 'Align priority with urgency constraints',
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const ISSUE_CHECKERS: readonly IssueChecker[] = [
  checkMissingParameter,
  checkAmbiguousTarget,
  checkConflictingConstraints,
  checkInsufficientContext,
  checkLogicalInconsistency,
];

/**
 * Evaluate a task for completeness and coherence.
 *
 * Pure function. Checks all issue types and returns any found.
 */
export function evaluateLayer3(task: TaskPayload): Layer3Result {
  const issues: CompletenessIssue[] = [];

  for (const checker of ISSUE_CHECKERS) {
    const issue = checker(task);
    if (issue !== null) {
      issues.push(issue);
    }
  }

  return {
    complete: issues.length === 0,
    issues,
  };
}
