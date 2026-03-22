// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * @bastion/relay-admin-ui — SvelteKit admin panel for the Bastion relay.
 *
 * Exports the logic layer: stores, API client, types, and theme utilities.
 * Svelte components are not exported (consumed via SvelteKit routes).
 */

// ---------------------------------------------------------------------------
// Store primitives
// ---------------------------------------------------------------------------
export { writable, derived } from './store.js';
export type { Readable, Writable } from './store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type {
  FileTransferCapabilities,
  CapabilityMatrix,
  ProviderWithCapabilities,
  AuditEventSummary,
  ThroughputMetrics,
  QuarantineStatusSummary,
  BlocklistEntry,
  QuarantineViewEntry,
  CustodyEventView,
  ConnectionEntry,
  RelaySettingsSummary,
  SafetyFloorsSummary,
  TlsStatusSummary,
  ChainIntegritySummary,
  ApiResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
export {
  THEME,
  auditEventColor,
  statusColor,
  quarantineStateColor,
  formatBytes,
  formatTimestamp,
  relativeTime,
} from './theme.js';

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------
export { AdminApiClient } from './api/admin-client.js';
export type { AdminCredentials, AdminClientConfig } from './api/admin-client.js';

export { DataService } from './api/data-service.js';
export type { DataServiceConfig } from './api/data-service.js';

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------
export { createOverviewStore } from './stores/overview.js';
export type { OverviewState, OverviewStore } from './stores/overview.js';

export { createProvidersStore, defaultCapabilityMatrix } from './stores/providers.js';
export type { ProvidersState, ProvidersStore } from './stores/providers.js';

export { createBlocklistStore } from './stores/blocklist.js';
export type { BlocklistState, BlocklistStore } from './stores/blocklist.js';

export { createQuarantineStore } from './stores/quarantine.js';
export type { QuarantineStoreState, QuarantineStore } from './stores/quarantine.js';

export { createConnectionsStore } from './stores/connections.js';
export type { ConnectionsState, ConnectionsStore } from './stores/connections.js';

export { createConfigStore } from './stores/config.js';
export type { ConfigState, ConfigStore } from './stores/config.js';
