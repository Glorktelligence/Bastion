// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Layer 1: Absolute Boundaries — non-negotiable, non-configurable denial rules.
 *
 * This is a pure function with no state. If any denial category matches,
 * the task is immediately denied. First match wins (short-circuit).
 */

import type { Layer1DenialCategory, Layer1Result, TaskPayload } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Denial category definitions
// ---------------------------------------------------------------------------

interface DenialRule {
  readonly category: Layer1DenialCategory;
  readonly check: (task: TaskPayload) => string | null;
}

/** Word-boundary regex test on a lowercased string. */
function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, 'i').test(text);
}

/** Check if any keyword appears (word-boundary) in lowercased text. */
function hasAnyWord(text: string, words: readonly string[]): boolean {
  return words.some((w) => hasWord(text, w));
}

/** Recursively extract all string values from a record. */
function extractStringValues(obj: Record<string, unknown>): string[] {
  const results: string[] = [];
  for (const value of Object.values(obj)) {
    if (typeof value === 'string') {
      results.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          results.push(item);
        } else if (item !== null && typeof item === 'object') {
          results.push(...extractStringValues(item as Record<string, unknown>));
        }
      }
    } else if (value !== null && typeof value === 'object') {
      results.push(...extractStringValues(value as Record<string, unknown>));
    }
  }
  return results;
}

/** Combine action, target, and all parameter string values for scanning. */
function allText(task: TaskPayload): string {
  const parts = [task.action, task.target, ...extractStringValues(task.parameters)];
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Category 1: Destructive without scope
// ---------------------------------------------------------------------------

const DESTRUCTIVE_KEYWORDS = [
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
  'dd',
  'mkfs',
] as const;

const BROAD_TARGETS = ['*', '/', '.', '**'] as const;

function checkDestructiveWithoutScope(task: TaskPayload): string | null {
  const action = task.action.toLowerCase();
  if (!hasAnyWord(action, DESTRUCTIVE_KEYWORDS)) return null;

  // Check if scope is defined in parameters
  if (task.parameters.scope !== undefined && task.parameters.scope !== null) return null;

  // Check if target is broad
  const target = task.target.trim();
  const isBroad = BROAD_TARGETS.some((bt) => target === bt);
  if (!isBroad) return null;

  return `Destructive action "${task.action}" targets broad path "${task.target}" without scope parameter`;
}

// ---------------------------------------------------------------------------
// Category 2: Boundary violation
// ---------------------------------------------------------------------------

const SYSTEM_PATHS = [
  '/etc',
  '/sys',
  '/proc',
  '/boot',
  '/root',
  '/dev',
  'C:\\Windows',
  'C:\\System32',
  'c:\\windows',
  'c:\\system32',
] as const;

function isSystemPath(target: string): boolean {
  const normalised = target.replace(/\\/g, '/').toLowerCase();
  for (const sp of SYSTEM_PATHS) {
    const normSp = sp.replace(/\\/g, '/').toLowerCase();
    if (normalised === normSp || normalised.startsWith(`${normSp}/`)) {
      return true;
    }
  }

  // Other user homes: /home/<user> where user is not the current scope
  if (/^\/home\/[^/]+/i.test(normalised)) {
    return true;
  }

  return false;
}

function isNonLocalhostNetwork(target: string): boolean {
  // Match URIs with non-localhost hosts
  const uriMatch = target.match(/^(https?|ftp):\/\/([^/:]+)/i);
  if (!uriMatch) return false;
  const host = uriMatch[2]!.toLowerCase();
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

function checkBoundaryViolation(task: TaskPayload): string | null {
  if (isSystemPath(task.target)) {
    return `Target "${task.target}" is a protected system path`;
  }
  if (isNonLocalhostNetwork(task.target)) {
    return `Target "${task.target}" is a non-localhost network URI (boundary violation)`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Category 3: Privilege escalation
// ---------------------------------------------------------------------------

const PRIVILEGE_KEYWORDS = [
  'sudo',
  'su',
  'chmod',
  'chown',
  'chgrp',
  'useradd',
  'userdel',
  'usermod',
  'adduser',
  'passwd',
  'visudo',
  'systemctl',
  'service',
  'crontab',
] as const;

function checkPrivilegeEscalation(task: TaskPayload): string | null {
  const text = allText(task);
  for (const kw of PRIVILEGE_KEYWORDS) {
    if (hasWord(text, kw)) {
      return `Privilege escalation keyword "${kw}" detected`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Category 4: Data exfiltration
// ---------------------------------------------------------------------------

const EXFIL_ACTION_KEYWORDS = ['curl', 'wget', 'fetch', 'upload', 'transmit'] as const;
const NETWORK_PROTOCOLS = ['http://', 'https://', 'ftp://'] as const;

function checkDataExfiltration(task: TaskPayload): string | null {
  const action = task.action.toLowerCase();
  if (!hasAnyWord(action, EXFIL_ACTION_KEYWORDS)) return null;

  // Check if target contains a network protocol
  const target = task.target.toLowerCase();
  for (const proto of NETWORK_PROTOCOLS) {
    if (target.includes(proto)) {
      return `Data exfiltration: action "${task.action}" targeting network resource "${task.target}"`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Category 5: Safety floor modification
// ---------------------------------------------------------------------------

const CONFIG_ACTION_KEYWORDS = ['config', 'set', 'disable', 'lower', 'modify'] as const;
const SAFETY_TARGET_KEYWORDS = ['safety', 'floor', 'quarantine', 'sensitivity', 'threshold'] as const;

function checkSafetyFloorModification(task: TaskPayload): string | null {
  const action = task.action.toLowerCase();
  if (!hasAnyWord(action, CONFIG_ACTION_KEYWORDS)) return null;

  const target = task.target.toLowerCase();
  for (const kw of SAFETY_TARGET_KEYWORDS) {
    if (hasWord(target, kw)) {
      return `Attempt to modify safety floor: action "${task.action}" targeting "${task.target}"`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Rule pipeline
// ---------------------------------------------------------------------------

const DENIAL_RULES: readonly DenialRule[] = [
  { category: 'destructive_without_scope', check: checkDestructiveWithoutScope },
  { category: 'boundary_violation', check: checkBoundaryViolation },
  { category: 'privilege_escalation', check: checkPrivilegeEscalation },
  { category: 'data_exfiltration', check: checkDataExfiltration },
  { category: 'safety_floor_modification', check: checkSafetyFloorModification },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a task against Layer 1 absolute boundaries.
 *
 * Pure function, no state. First denial category match wins (short-circuit).
 */
export function evaluateLayer1(task: TaskPayload): Layer1Result {
  for (const rule of DENIAL_RULES) {
    const reason = rule.check(task);
    if (reason !== null) {
      return {
        passed: false,
        denialCategory: rule.category,
        reason,
      };
    }
  }
  return { passed: true };
}
