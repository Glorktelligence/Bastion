// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Types for the relay admin UI data layer.
 *
 * These mirror the relay's admin API response shapes but are
 * UI-oriented — flattened and enriched for display.
 */

// ---------------------------------------------------------------------------
// Provider types
// ---------------------------------------------------------------------------

/** File transfer permissions for a provider. */
export interface FileTransferCapabilities {
  readonly canSend: boolean;
  readonly canReceive: boolean;
  readonly maxFileSizeBytes: number;
  readonly allowedMimeTypes: readonly string[];
}

/** Capability matrix for an approved provider. */
export interface CapabilityMatrix {
  readonly allowedMessageTypes: readonly string[];
  readonly fileTransfer: FileTransferCapabilities;
  readonly maxConcurrentTasks: number;
  readonly budgetLimitUsd?: number;
}

/** Provider with its capability matrix (API response shape). */
export interface ProviderWithCapabilities {
  readonly id: string;
  readonly name: string;
  readonly approvedAt: string;
  readonly approvedBy: string;
  readonly capabilities: readonly string[];
  readonly active: boolean;
  readonly capabilityMatrix: CapabilityMatrix;
}

// ---------------------------------------------------------------------------
// Overview types
// ---------------------------------------------------------------------------

/** Summary of an audit event for display. */
export interface AuditEventSummary {
  readonly index: number;
  readonly timestamp: string;
  readonly eventType: string;
  readonly sessionId: string;
  readonly detail: Record<string, unknown>;
}

/** Message throughput metrics. */
export interface ThroughputMetrics {
  readonly total: number;
  readonly perMinute: number;
}

/** Quarantine status summary. */
export interface QuarantineStatusSummary {
  readonly count: number;
  readonly maxEntries: number;
  readonly oldestAge: string | null;
}

// ---------------------------------------------------------------------------
// Blocklist types
// ---------------------------------------------------------------------------

/** A custom (non-MaliClaw) blocklist entry. */
export interface BlocklistEntry {
  readonly id: string;
  readonly label: string;
  readonly addedAt: string;
  readonly addedBy: string;
}

// ---------------------------------------------------------------------------
// Quarantine viewer types
// ---------------------------------------------------------------------------

/** Quarantine entry enriched for display. */
export interface QuarantineViewEntry {
  readonly transferId: string;
  readonly direction: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly hashAtReceipt: string;
  readonly state: string;
  readonly quarantinedAt: string;
  readonly purgeAt: string;
  readonly custodyEvents: readonly CustodyEventView[];
}

/** Custody event for display. */
export interface CustodyEventView {
  readonly event: string;
  readonly timestamp: string;
  readonly actor: string;
  readonly hash?: string;
  readonly detail?: string;
}

// ---------------------------------------------------------------------------
// Connection types
// ---------------------------------------------------------------------------

/** Connected client for display. */
export interface ConnectionEntry {
  readonly connectionId: string;
  readonly remoteAddress: string;
  readonly connectedAt: string;
  readonly clientType: 'human' | 'ai' | 'unknown';
  readonly authenticated: boolean;
  readonly providerId?: string;
  readonly messageCount: number;
}

// ---------------------------------------------------------------------------
// System config types
// ---------------------------------------------------------------------------

/** Relay settings summary. */
export interface RelaySettingsSummary {
  readonly port: number;
  readonly host: string;
  readonly adminPort: number;
  readonly maxConnections: number;
  readonly heartbeatIntervalMs: number;
  readonly heartbeatTimeoutMs: number;
}

/** Safety floors summary. */
export interface SafetyFloorsSummary {
  readonly challengeThreshold: number;
  readonly denialThreshold: number;
  readonly maxRiskScore: number;
  readonly description: string;
}

/** TLS status summary. */
export interface TlsStatusSummary {
  readonly enabled: boolean;
  readonly certExpiry: string | null;
  readonly protocol: string;
  readonly cipher: string;
}

/** Audit chain integrity summary. */
export interface ChainIntegritySummary {
  readonly totalEntries: number;
  readonly lastVerifiedAt: string | null;
  readonly chainValid: boolean;
  readonly genesisHash: string;
  readonly lastHash: string;
}

// ---------------------------------------------------------------------------
// API response wrapper
// ---------------------------------------------------------------------------

/** Generic API response from the admin server. */
export interface ApiResult<T = Record<string, unknown>> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T;
  readonly error?: string;
}
