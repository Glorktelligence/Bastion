// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Approved AI provider registry for the relay.
 *
 * AI clients must present a `providerId` during session initiation.
 * The relay validates this ID against the approved providers list.
 * Only active providers are accepted.
 *
 * Provider approval is a relay admin function — clients cannot
 * modify this list. The registry maps to BASTION-2004
 * (AUTH_PROVIDER_NOT_APPROVED) when a provider is rejected.
 */

import type { ApprovedProvider, Timestamp } from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of checking a provider against the registry. */
export type ProviderCheckResult =
  | { readonly approved: true; readonly provider: ApprovedProvider }
  | { readonly approved: false; readonly reason: ProviderRejectionReason };

/** Reasons a provider may be rejected. */
export type ProviderRejectionReason = 'not_registered' | 'inactive' | 'missing_provider_id';

// ---------------------------------------------------------------------------
// ProviderRegistry
// ---------------------------------------------------------------------------

/**
 * Registry of approved AI providers.
 *
 * Usage:
 *   1. Create: `const registry = new ProviderRegistry()`
 *   2. Add providers: `registry.addProvider(provider)`
 *   3. Check on connect: `const result = registry.checkProvider(providerId)`
 *   4. Query: `registry.getProvider(id)`, `registry.getAllProviders()`
 */
export class ProviderRegistry {
  private readonly providers: Map<string, ApprovedProvider>;

  constructor(providers?: readonly ApprovedProvider[]) {
    this.providers = new Map();
    if (providers) {
      for (const p of providers) {
        this.providers.set(p.id, p);
      }
    }
  }

  /** Number of registered providers. */
  get size(): number {
    return this.providers.size;
  }

  /**
   * Add or update an approved provider.
   *
   * @param provider — the provider registration record
   */
  addProvider(provider: ApprovedProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Remove a provider from the registry.
   *
   * @param id — provider identifier to remove
   * @returns true if the provider was found and removed
   */
  removeProvider(id: string): boolean {
    return this.providers.delete(id);
  }

  /**
   * Deactivate a provider without removing it.
   * Preserves the registration record for audit purposes.
   *
   * @param id — provider identifier to deactivate
   * @returns true if found and deactivated
   */
  deactivateProvider(id: string): boolean {
    const provider = this.providers.get(id);
    if (!provider) return false;

    this.providers.set(id, { ...provider, active: false });
    return true;
  }

  /**
   * Get a provider by ID.
   *
   * @param id — provider identifier
   * @returns the provider or undefined
   */
  getProvider(id: string): ApprovedProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Check whether a provider is approved and active.
   *
   * This is called during AI client session initiation.
   *
   * @param providerId — the provider ID from SessionInitiation (may be undefined)
   * @returns check result with provider info or rejection reason
   */
  checkProvider(providerId: string | undefined): ProviderCheckResult {
    if (!providerId) {
      return { approved: false, reason: 'missing_provider_id' };
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      return { approved: false, reason: 'not_registered' };
    }

    if (!provider.active) {
      return { approved: false, reason: 'inactive' };
    }

    return { approved: true, provider };
  }

  /**
   * Get capabilities for an approved, active provider.
   *
   * @param id — provider identifier
   * @returns capabilities array, or empty if not found/inactive
   */
  getCapabilities(id: string): readonly string[] {
    const provider = this.providers.get(id);
    if (!provider || !provider.active) return [];
    return provider.capabilities;
  }

  /** Get all registered providers (active and inactive). */
  getAllProviders(): readonly ApprovedProvider[] {
    return [...this.providers.values()];
  }

  /** Get only active providers. */
  getActiveProviders(): readonly ApprovedProvider[] {
    return [...this.providers.values()].filter((p) => p.active);
  }

  /**
   * Create a provider record with standard fields.
   * Convenience factory for adding new providers.
   *
   * @param id — unique provider identifier
   * @param name — human-readable provider name
   * @param approvedBy — admin who approved the provider
   * @param capabilities — granted capabilities
   * @returns a new ApprovedProvider record
   */
  static createProvider(
    id: string,
    name: string,
    approvedBy: string,
    capabilities: readonly string[] = [],
  ): ApprovedProvider {
    return {
      id,
      name,
      approvedAt: new Date().toISOString() as Timestamp,
      approvedBy,
      capabilities: [...capabilities],
      active: true,
    };
  }
}
