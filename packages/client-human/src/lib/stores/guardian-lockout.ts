// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Guardian lockout state — persisted in localStorage so a full-viewport
 * lockout survives browser restarts. The shape is shared with session.ts
 * (which imports and re-exports it).
 */

import type { Writable } from '../store.js';
import { writable } from '../store.js';

export interface GuardianLockoutState {
  active: boolean;
  shutdownId: string;
  code: string;
  reason: string;
  receivedAt: string;
  restartCount: number;
}

export interface GuardianStatusSummary {
  status: 'active' | 'alert' | 'shutdown';
  lastCheckAt: string;
  environmentClean: boolean;
  violationCount: number;
  updatedAt: string;
}

export const GUARDIAN_LOCKOUT_KEY = 'bastion-guardian-lockout';

/** Read guardian lockout state from localStorage. Returns null on miss, parse error, or SSR. */
export function getGuardianLockout(): GuardianLockoutState | null {
  try {
    const stored = localStorage.getItem(GUARDIAN_LOCKOUT_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as GuardianLockoutState;
    if (typeof parsed.active !== 'boolean') return null;
    if (typeof parsed.restartCount !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist guardian lockout state to localStorage. Silent on SSR / disabled storage. */
export function setGuardianLockout(state: GuardianLockoutState): void {
  try {
    localStorage.setItem(GUARDIAN_LOCKOUT_KEY, JSON.stringify(state));
  } catch {
    /* SSR or disabled storage */
  }
}

/** Remove guardian lockout state from localStorage. */
export function clearGuardianLockout(): void {
  try {
    localStorage.removeItem(GUARDIAN_LOCKOUT_KEY);
  } catch {
    /* SSR or disabled storage */
  }
}

/**
 * Build the updated lockout state for an incoming guardian_shutdown.
 * Pure function — no side effects. Writing is the caller's responsibility.
 */
export function buildLockoutFromShutdown(
  shutdownId: string,
  code: string,
  reason: string,
  existing: GuardianLockoutState | null,
  nowIso: string = new Date().toISOString(),
): GuardianLockoutState {
  return {
    active: true,
    shutdownId,
    code,
    reason,
    receivedAt: nowIso,
    // Replacing an in-flight shutdown preserves existing restartCount — that
    // counter tracks browser restarts while locked, not new violations.
    restartCount: existing ? existing.restartCount : 0,
  };
}

/**
 * Increment the restart counter for the active lockout.
 * Call at `connect()` time before contacting the relay, so the UI can
 * escalate its messaging (Tier 1/2+ variants) based on persistence across
 * restarts rather than any server-side state.
 */
export function incrementRestartCount(existing: GuardianLockoutState): GuardianLockoutState {
  return { ...existing, restartCount: existing.restartCount + 1 };
}

/** Factory for the writable store — exported for testing and for session.ts to instantiate. */
export function createGuardianLockoutStore(): Writable<GuardianLockoutState | null> {
  return writable<GuardianLockoutState | null>(null);
}

export function createGuardianStatusStore(): Writable<GuardianStatusSummary | null> {
  return writable<GuardianStatusSummary | null>(null);
}
