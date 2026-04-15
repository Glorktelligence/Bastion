// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * BastionGuardian Phase 1 — Identity Announcement
 *
 * Every outbound API call includes Bastion identity headers. Pre-request
 * verification ensures headers are never missing or tampered. Foreign
 * harness detection prevents Bastion from running inside another agent framework.
 *
 * This is the 7th Sole Authority — the full Guardian class comes in a future phase.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

/**
 * Read the Bastion version from the VERSION file at the repo/install root.
 * Falls back to 'unknown' if the file cannot be read.
 */
export function getBastionVersion(rootDir?: string): string {
  // Try multiple paths: explicit root, CWD, relative to this file
  const candidates = [rootDir ? join(rootDir, 'VERSION') : null, join(process.cwd(), 'VERSION')].filter(
    (p): p is string => p !== null,
  );

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf-8').trim();
    } catch {
      // Try next candidate
    }
  }
  return 'unknown';
}

/** Cached version string — read once at import time. */
const BASTION_VERSION = getBastionVersion();

// ---------------------------------------------------------------------------
// Identity Headers
// ---------------------------------------------------------------------------

/** The full set of identity headers added to every outbound API request. */
export interface BastionIdentityHeaders {
  readonly 'User-Agent': string;
  readonly 'X-Client-Name': string;
  readonly 'X-Client-Version': string;
}

/** Build identity headers for the current Bastion version. */
export function getIdentityHeaders(version?: string): BastionIdentityHeaders {
  const v = version ?? BASTION_VERSION;
  return {
    'User-Agent': `Bastion/${v} (+https://bastion.glorktelligence.co.uk)`,
    'X-Client-Name': 'Bastion',
    'X-Client-Version': v,
  };
}

// ---------------------------------------------------------------------------
// Pre-Request Verification
// ---------------------------------------------------------------------------

/**
 * Verify that identity headers are correct before an API call fires.
 * Throws with BASTION-9001 if headers are missing or tampered.
 */
export function verifyIdentityHeaders(headers: Record<string, string>): void {
  const ua = headers['User-Agent'] ?? '';
  if (!ua.startsWith('Bastion/')) {
    throw new Error('BASTION-9001: Identity header missing or tampered — User-Agent must start with Bastion/');
  }
  if (!headers['X-Client-Name'] || headers['X-Client-Name'] !== 'Bastion') {
    throw new Error('BASTION-9001: Identity header missing or tampered — X-Client-Name must be Bastion');
  }
  if (!headers['X-Client-Version']) {
    throw new Error('BASTION-9001: Identity header missing or tampered — X-Client-Version must be present');
  }
}

// ---------------------------------------------------------------------------
// Foreign Harness Detection
// ---------------------------------------------------------------------------

/** Environment variables that indicate a foreign agent harness. */
export const FOREIGN_HARNESS_VARS: readonly string[] = [
  'CLAUDE_CODE_ENTRY_POINT',
  'CLAUDE_CODE_VERSION',
  'CLAUDE_CODE_PROJECT_DIR',
  'OPENCLAW_HOME',
  'OPENHARNESS_HOME',
  'OH_HOME',
  'OPENHARNESS_API_FORMAT',
  'CURSOR_TRACE_ID',
  'CURSOR_SESSION_ID',
  'AGENT_HARNESS_MODE',
  'CLINE_DIR',
];

/**
 * Check for foreign harness environment variables.
 * Returns the name of the first detected variable, or null if clean.
 */
export function detectForeignHarness(env: Record<string, string | undefined> = process.env): string | null {
  for (const envVar of FOREIGN_HARNESS_VARS) {
    if (env[envVar]) {
      return envVar;
    }
  }
  return null;
}

/**
 * Enforce foreign harness detection — logs and exits with code 99 if detected.
 * Call this at the top of start-ai-client.mjs before any other initialisation.
 */
export function enforceForeignHarnessCheck(env: Record<string, string | undefined> = process.env): void {
  const detected = detectForeignHarness(env);
  if (detected) {
    console.error(`[✗] BASTION-9002: Foreign harness environment detected: ${detected}`);
    console.error('[✗] Bastion is a sovereign system — it does not run inside another harness.');
    console.error('[✗] Remove the foreign harness or run Bastion independently.');
    process.exit(99);
  }
  console.log('[✓] Environment clean — no foreign harness detected');
}
