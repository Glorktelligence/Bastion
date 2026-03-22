// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Client identity allowlist for the relay.
 *
 * Enforces the allowlist model: only pre-approved client identifiers
 * may connect. This is checked at connection time, before any protocol
 * exchange occurs.
 *
 * The MaliClaw Clause entries are HARDCODED and cannot be removed
 * or made configurable (CLAUDE.md non-negotiable). They represent
 * permanently blocked identifiers.
 *
 * Maps to BASTION-1003 (MALICLAW_REJECTED) when a blocked client
 * attempts to connect.
 */

import type { ClientType } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An entry in the client allowlist. */
export interface AllowlistEntry {
  /** Unique client identifier (matched against connection credentials). */
  readonly id: string;
  /** Client type this entry applies to. */
  readonly clientType: ClientType;
  /** Human-readable label for this entry. */
  readonly label: string;
  /** Whether this entry is currently active. */
  readonly active: boolean;
}

/** Result of checking a client against the allowlist. */
export type AllowlistCheckResult =
  | { readonly allowed: true; readonly entry: AllowlistEntry }
  | { readonly allowed: false; readonly reason: AllowlistRejectionReason };

/** Reasons a client may be rejected by the allowlist. */
export type AllowlistRejectionReason = 'not_listed' | 'inactive' | 'blocked';

// ---------------------------------------------------------------------------
// MaliClaw Clause — HARDCODED, NEVER configurable, NEVER removable
// ---------------------------------------------------------------------------

/**
 * The MaliClaw Clause: permanently blocked identifier patterns.
 *
 * These entries are HARDCODED per CLAUDE.md security non-negotiables.
 * They cannot be removed, disabled, or made configurable.
 * Any connection attempt matching these patterns is immediately rejected.
 *
 * Naming lineage: Clawdbot → Moltbot → OpenClaw (same project, renamed twice).
 * Matching is case-insensitive and partial — any identifier containing
 * one of these patterns is blocked (e.g. 'openclaw-agent-v2' or
 * 'my-clawdbot-fork' are both caught).
 */
const MALICLAW_PATTERNS: readonly string[] = Object.freeze([
  // Primary identifiers (project name lineage)
  'openclaw',             // Current project name
  'clawdbot',             // Original project name
  'moltbot',              // Intermediate project name
  // Secondary identifiers
  'clawhub',              // Plugin marketplace
  'ai.openclaw.client',   // iOS bundle ID
  // Domain patterns
  'openclaw.ai',          // Main site
  'docs.openclaw.ai',     // Documentation site
]);

/** Check if an identifier matches any MaliClaw pattern (case-insensitive, partial). */
function isMaliClawMatch(identifier: string): boolean {
  const lower = identifier.toLowerCase();
  return MALICLAW_PATTERNS.some((pattern) => lower.includes(pattern));
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

/**
 * Client identity allowlist with MaliClaw Clause enforcement.
 *
 * Usage:
 *   1. Create: `const allowlist = new Allowlist()`
 *   2. Add entries: `allowlist.addEntry(entry)`
 *   3. Check on connect: `const result = allowlist.check(clientId, clientType)`
 *
 * The MaliClaw Clause is always enforced regardless of allowlist entries.
 * A client ID matching any MaliClaw entry is immediately rejected.
 */
export class Allowlist {
  private readonly entries: Map<string, AllowlistEntry>;

  constructor(entries?: readonly AllowlistEntry[]) {
    this.entries = new Map();
    if (entries) {
      for (const entry of entries) {
        // Prevent adding MaliClaw entries
        if (isMaliClawMatch(entry.id)) continue;
        this.entries.set(entry.id, entry);
      }
    }
  }

  /** Number of entries in the allowlist (excluding MaliClaw). */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Add a client to the allowlist.
   *
   * MaliClaw Clause identifiers cannot be added — they are
   * permanently blocked regardless.
   *
   * @param entry — the allowlist entry to add
   * @returns true if added, false if blocked by MaliClaw
   */
  addEntry(entry: AllowlistEntry): boolean {
    if (isMaliClawMatch(entry.id)) {
      return false;
    }
    this.entries.set(entry.id, entry);
    return true;
  }

  /**
   * Remove a client from the allowlist.
   *
   * @param id — client identifier to remove
   * @returns true if found and removed
   */
  removeEntry(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Check whether a client is allowed to connect.
   *
   * Check order:
   *   1. MaliClaw Clause (permanently blocked — always checked first)
   *   2. Allowlist lookup (must be listed and active)
   *
   * @param clientId — the client identifier to check
   * @param clientType — expected client type
   * @returns check result with entry or rejection reason
   */
  check(clientId: string, clientType: ClientType): AllowlistCheckResult {
    // MaliClaw Clause — always checked first, non-negotiable
    if (isMaliClawMatch(clientId)) {
      return { allowed: false, reason: 'blocked' };
    }

    const entry = this.entries.get(clientId);
    if (!entry) {
      return { allowed: false, reason: 'not_listed' };
    }

    if (!entry.active) {
      return { allowed: false, reason: 'inactive' };
    }

    if (entry.clientType !== clientType) {
      return { allowed: false, reason: 'not_listed' };
    }

    return { allowed: true, entry };
  }

  /**
   * Quick check: is this ID blocked by the MaliClaw Clause?
   *
   * @param clientId — the identifier to check
   * @returns true if permanently blocked
   */
  isBlocked(clientId: string): boolean {
    return isMaliClawMatch(clientId);
  }

  /** Get all allowlist entries. */
  getAllEntries(): readonly AllowlistEntry[] {
    return [...this.entries.values()];
  }

  /** Get the MaliClaw blocked patterns (read-only, for display). */
  static getMaliClawEntries(): readonly string[] {
    return MALICLAW_PATTERNS;
  }

  /** Check if an identifier matches any MaliClaw pattern. */
  static isMaliClawMatch(identifier: string): boolean {
    return isMaliClawMatch(identifier);
  }
}
