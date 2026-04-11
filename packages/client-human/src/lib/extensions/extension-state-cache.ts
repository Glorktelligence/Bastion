// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Extension State Cache (M14) — three-tier state system.
 *
 * Tier 1: Local manifest info (namespace, version, status, counts) — populated
 *         from extension_list_response.
 * Tier 2: Pushed state from AI client — cached from extension_state_update
 *         messages. Cleared on disconnect.
 *
 * getState() returns combined tier 1 + tier 2 data for instant lookups
 * without round-trip to the AI client.
 */

import type { ExtensionInfo } from '../stores/extensions.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtensionTier1 {
  readonly namespace: string;
  readonly version: string;
  readonly status: 'ready' | 'loading' | 'error' | 'disconnected';
  readonly messageTypes: number;
  readonly uiComponents: number;
  readonly conversationRenderers: number;
}

export interface ExtensionStateInfo {
  tier1: ExtensionTier1;
  tier2: Record<string, unknown> | null;
  lastUpdated: string | null;
}

export interface ExtensionStateSummary {
  readonly namespace: string;
  readonly version: string;
  readonly status: string;
  readonly state: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// ExtensionStateCache
// ---------------------------------------------------------------------------

export class ExtensionStateCache {
  private readonly cache = new Map<string, ExtensionStateInfo>();

  /** Populate tier 1 from extension_list_response data. */
  loadFromExtensions(extensions: readonly ExtensionInfo[]): void {
    for (const ext of extensions) {
      const existing = this.cache.get(ext.namespace);
      const uiComponents = ext.ui?.pages.reduce((sum, p) => sum + p.components.length, 0) ?? 0;

      const tier1: ExtensionTier1 = {
        namespace: ext.namespace,
        version: ext.version,
        status: 'ready',
        messageTypes: ext.messageTypes.length,
        uiComponents,
        conversationRenderers: 0,
      };

      if (existing) {
        // Preserve tier 2 state across extension list refreshes
        existing.tier1 = tier1;
      } else {
        this.cache.set(ext.namespace, {
          tier1,
          tier2: null,
          lastUpdated: null,
        });
      }
    }
  }

  /** Update tier 2 pushed state from extension_state_update. */
  updateState(namespace: string, state: Record<string, unknown>): void {
    const existing = this.cache.get(namespace);
    if (existing) {
      existing.tier2 = state;
      existing.lastUpdated = new Date().toISOString();
    } else {
      // State arrived before extension list — create minimal entry
      this.cache.set(namespace, {
        tier1: {
          namespace,
          version: 'unknown',
          status: 'ready',
          messageTypes: 0,
          uiComponents: 0,
          conversationRenderers: 0,
        },
        tier2: state,
        lastUpdated: new Date().toISOString(),
      });
    }
  }

  /** Get combined tier 1 + tier 2 state for a namespace. */
  getState(namespace: string): ExtensionStateSummary | null {
    const entry = this.cache.get(namespace);
    if (!entry) return null;

    return {
      namespace: entry.tier1.namespace,
      version: entry.tier1.version,
      status: entry.tier1.status,
      state: entry.tier2,
    };
  }

  /** Clear tier 2 pushed state but keep tier 1 manifest info. */
  clearPushedState(): void {
    for (const entry of this.cache.values()) {
      entry.tier2 = null;
      entry.lastUpdated = null;
    }
  }

  /** Clear all cached state (tier 1 + tier 2). */
  clear(): void {
    this.cache.clear();
  }

  /** Number of cached extensions. */
  get size(): number {
    return this.cache.size;
  }

  /** Check if a namespace has any cached state. */
  has(namespace: string): boolean {
    return this.cache.has(namespace);
  }
}

/** Singleton instance used by session and bridge. */
export const extensionStateCache = new ExtensionStateCache();
