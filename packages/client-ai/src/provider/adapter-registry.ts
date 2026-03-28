// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * AdapterRegistry — multi-adapter routing for the AI client.
 *
 * Stores multiple ProviderAdapter instances keyed by adapterId with
 * declared roles. Routes operations (conversation, task, compaction,
 * dream) to the appropriate adapter based on role assignments and
 * conversation preferences.
 *
 * The registry locks after startup — no mid-session adapter registration.
 */

import type { ProviderAdapter } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdapterRole = 'default' | 'conversation' | 'task' | 'compaction' | 'dream';
export type OperationType = 'conversation' | 'task' | 'compaction' | 'dream';

export interface RegisteredAdapter {
  readonly adapter: ProviderAdapter;
  readonly roles: readonly AdapterRole[];
}

export interface AdapterSelection {
  readonly adapter: ProviderAdapter;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// AdapterRegistry
// ---------------------------------------------------------------------------

export class AdapterRegistry {
  private readonly adapters = new Map<string, RegisteredAdapter>();
  private locked = false;

  /** Number of registered adapters. */
  get adapterCount(): number {
    return this.adapters.size;
  }

  /** Whether the registry is locked. */
  get isLocked(): boolean {
    return this.locked;
  }

  /**
   * Register an adapter with its declared roles.
   * Throws if registry is locked.
   */
  registerAdapter(adapter: ProviderAdapter, roles: readonly AdapterRole[]): void {
    if (this.locked) {
      throw new Error('AdapterRegistry is locked — cannot register after startup');
    }
    this.adapters.set(adapter.providerId, { adapter, roles: [...roles] });
  }

  /** Get a specific adapter by ID. */
  get(adapterId: string): ProviderAdapter | undefined {
    return this.adapters.get(adapterId)?.adapter;
  }

  /** Get the adapter with a specific role. Prefers one also marked 'default'. */
  getByRole(role: AdapterRole): ProviderAdapter | undefined {
    let fallback: ProviderAdapter | undefined;
    for (const { adapter, roles } of this.adapters.values()) {
      if (roles.includes(role)) {
        if (roles.includes('default')) return adapter;
        fallback = fallback ?? adapter;
      }
    }
    return fallback;
  }

  /** Get the adapter with the lowest pricing (cheapest per input+output MTok). */
  getCheapest(): ProviderAdapter | undefined {
    let cheapest: ProviderAdapter | undefined;
    let lowestCost = Number.POSITIVE_INFINITY;
    for (const { adapter } of this.adapters.values()) {
      const pricing = adapter.getModelPricing();
      const totalCost = pricing.inputPerMTok + pricing.outputPerMTok;
      if (totalCost < lowestCost) {
        lowestCost = totalCost;
        cheapest = adapter;
      }
    }
    return cheapest;
  }

  /** Get the default adapter. */
  getDefault(): ProviderAdapter | undefined {
    return this.getByRole('default');
  }

  /** List all registered adapters with their roles. */
  list(): readonly RegisteredAdapter[] {
    return [...this.adapters.values()];
  }

  /**
   * Select the appropriate adapter for an operation.
   *
   * Routing logic:
   * - compaction → role 'compaction', fallback to cheapest
   * - dream → role 'dream', fallback to 'compaction', fallback to cheapest
   * - conversation/task → conversation preferredAdapter, fallback to role, fallback to default
   */
  selectAdapter(operation: OperationType, preferredAdapterId?: string | null): AdapterSelection {
    // Check preference first
    if (preferredAdapterId) {
      const preferred = this.get(preferredAdapterId);
      if (preferred) return { adapter: preferred, reason: `preferred: ${preferredAdapterId}` };
    }

    switch (operation) {
      case 'compaction': {
        const comp = this.getByRole('compaction');
        if (comp) return { adapter: comp, reason: 'role: compaction' };
        const cheap = this.getCheapest();
        if (cheap) return { adapter: cheap, reason: 'fallback: cheapest' };
        break;
      }
      case 'dream': {
        const dream = this.getByRole('dream');
        if (dream) return { adapter: dream, reason: 'role: dream' };
        const comp = this.getByRole('compaction');
        if (comp) return { adapter: comp, reason: 'fallback: compaction for dream' };
        const cheap = this.getCheapest();
        if (cheap) return { adapter: cheap, reason: 'fallback: cheapest for dream' };
        break;
      }
      case 'conversation':
      case 'task': {
        const role = this.getByRole(operation);
        if (role) return { adapter: role, reason: `role: ${operation}` };
        break;
      }
    }

    // Final fallback: default adapter
    const def = this.getDefault();
    if (def) return { adapter: def, reason: 'fallback: default' };

    // Last resort: first registered adapter
    const first = this.adapters.values().next().value;
    if (first) return { adapter: first.adapter, reason: 'fallback: first registered' };

    throw new Error(`No adapter available for operation: ${operation}`);
  }

  /** Lock the registry — no more registrations. */
  lock(): void {
    this.locked = true;
  }
}
