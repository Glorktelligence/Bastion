// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * System configuration store.
 *
 * Relay settings, safety floors, TLS status, audit chain integrity.
 * Read-only view — modifications go through the admin API.
 */

import { SAFETY_FLOORS } from '@bastion/protocol';
import { type Readable, type Writable, derived, writable } from '../store.js';
import type { ChainIntegritySummary, RelaySettingsSummary, SafetyFloorsSummary, TlsStatusSummary } from '../types.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ConfigState {
  readonly relaySettings: RelaySettingsSummary;
  readonly safetyFloors: SafetyFloorsSummary;
  readonly tlsStatus: TlsStatusSummary;
  readonly auditChainIntegrity: ChainIntegritySummary;
  readonly loading: boolean;
  readonly error: string | null;
}

function defaultRelaySettings(): RelaySettingsSummary {
  return {
    port: 9443,
    host: '0.0.0.0',
    adminPort: 9444,
    maxConnections: 100,
    heartbeatIntervalMs: 30_000,
    heartbeatTimeoutMs: 90_000,
  };
}

function defaultSafetyFloors(): SafetyFloorsSummary {
  return {
    challengeThreshold: SAFETY_FLOORS.CHALLENGE_THRESHOLD,
    denialThreshold: SAFETY_FLOORS.DENIAL_THRESHOLD,
    maxRiskScore: 1.0,
    description: 'Factory defaults — can be tightened but never lowered',
  };
}

function defaultTlsStatus(): TlsStatusSummary {
  return {
    enabled: false,
    certExpiry: null,
    protocol: 'unknown',
    cipher: 'unknown',
  };
}

function defaultChainIntegrity(): ChainIntegritySummary {
  return {
    totalEntries: 0,
    lastVerifiedAt: null,
    chainValid: true,
    genesisHash: '',
    lastHash: '',
  };
}

function initialState(): ConfigState {
  return {
    relaySettings: defaultRelaySettings(),
    safetyFloors: defaultSafetyFloors(),
    tlsStatus: defaultTlsStatus(),
    auditChainIntegrity: defaultChainIntegrity(),
    loading: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface ConfigStore {
  readonly store: Writable<ConfigState>;
  readonly tlsHealthy: Readable<boolean>;
  readonly chainHealthy: Readable<boolean>;
  readonly systemHealthy: Readable<boolean>;
  setRelaySettings(settings: RelaySettingsSummary): void;
  setSafetyFloors(floors: SafetyFloorsSummary): void;
  setTlsStatus(status: TlsStatusSummary): void;
  setAuditChainIntegrity(integrity: ChainIntegritySummary): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

export function createConfigStore(): ConfigStore {
  const store = writable<ConfigState>(initialState());

  const tlsHealthy = derived([store], ([s]) => s.tlsStatus.enabled && s.tlsStatus.certExpiry !== null);

  const chainHealthy = derived([store], ([s]) => s.auditChainIntegrity.chainValid);

  const systemHealthy = derived([store], ([s]) => s.tlsStatus.enabled && s.auditChainIntegrity.chainValid && !s.error);

  return {
    store,
    tlsHealthy,
    chainHealthy,
    systemHealthy,
    setRelaySettings(settings) {
      store.update((s) => ({ ...s, relaySettings: settings }));
    },
    setSafetyFloors(floors) {
      store.update((s) => ({ ...s, safetyFloors: floors }));
    },
    setTlsStatus(status) {
      store.update((s) => ({ ...s, tlsStatus: status }));
    },
    setAuditChainIntegrity(integrity) {
      store.update((s) => ({ ...s, auditChainIntegrity: integrity }));
    },
    setLoading(loading) {
      store.update((s) => ({ ...s, loading }));
    },
    setError(error) {
      store.update((s) => ({ ...s, error }));
    },
    reset() {
      store.set(initialState());
    },
  };
}
