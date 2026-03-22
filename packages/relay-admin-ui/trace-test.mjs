// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Trace tests for @bastion/relay-admin-ui logic layer.
 *
 * Tests stores, API client, theme utilities, and derived computations.
 * Run: node packages/relay-admin-ui/trace-test.mjs
 */

import { strict as assert } from 'node:assert';

// ---------------------------------------------------------------------------
// Imports from compiled output
// ---------------------------------------------------------------------------

import {
  writable,
  derived,
  THEME,
  auditEventColor,
  statusColor,
  quarantineStateColor,
  formatBytes,
  formatTimestamp,
  relativeTime,
  AdminApiClient,
  createOverviewStore,
  createProvidersStore,
  defaultCapabilityMatrix,
  createBlocklistStore,
  createQuarantineStore,
  createConnectionsStore,
  createConfigStore,
} from './dist/index.js';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let totalChecks = 0;
let totalGroups = 0;
let failedGroups = 0;

function check(condition, label) {
  totalChecks++;
  if (!condition) throw new Error(`FAIL: ${label}`);
}

async function group(name, fn) {
  totalGroups++;
  const groupStart = performance.now();
  try {
    await fn();
    const ms = (performance.now() - groupStart).toFixed(1);
    console.log(`  \x1b[32m✓\x1b[0m ${name} (${ms}ms)`);
  } catch (err) {
    failedGroups++;
    const ms = (performance.now() - groupStart).toFixed(1);
    console.log(`  \x1b[31m✗\x1b[0m ${name} (${ms}ms)`);
    console.log(`    ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Test 1: Store primitives — writable
// ---------------------------------------------------------------------------
await group('Store: writable set/get/subscribe/update', async () => {
  const s = writable(0);
  check(s.get() === 0, 'initial value is 0');

  s.set(42);
  check(s.get() === 42, 'set updates value');

  let observed = -1;
  const unsub = s.subscribe((v) => { observed = v; });
  check(observed === 42, 'subscribe fires immediately with current value');

  s.set(100);
  check(observed === 100, 'subscriber notified on set');

  s.update((v) => v + 1);
  check(s.get() === 101, 'update transforms value');
  check(observed === 101, 'subscriber notified on update');

  unsub();
  s.set(999);
  check(observed === 101, 'unsubscribe stops notifications');
  check(s.get() === 999, 'value still updated after unsub');
});

// ---------------------------------------------------------------------------
// Test 2: Store primitives — derived
// ---------------------------------------------------------------------------
await group('Store: derived recomputes from sources', async () => {
  const a = writable(2);
  const b = writable(3);
  const sum = derived([a, b], ([x, y]) => x + y);

  let observed = -1;
  const unsub = sum.subscribe((v) => { observed = v; });
  check(observed === 5, 'derived initial = 2+3=5');
  check(sum.get() === 5, 'get() matches');

  a.set(10);
  check(observed === 13, 'derived updates on source change: 10+3=13');

  b.set(20);
  check(observed === 30, 'derived updates on other source: 10+20=30');

  unsub();
  a.set(100);
  // After unsub, get() recomputes eagerly
  check(sum.get() === 120, 'after unsub, get() recomputes: 100+20=120');
});

// ---------------------------------------------------------------------------
// Test 3: Theme — colour mapping utilities
// ---------------------------------------------------------------------------
await group('Theme: colour mapping and formatting utilities', async () => {
  // Audit event colours
  check(auditEventColor('message_rejected') === THEME.status.error, 'rejected → error');
  check(auditEventColor('auth_failure') === THEME.status.error, 'auth_failure → error');
  check(auditEventColor('maliclaw_rejected') === THEME.status.error, 'maliclaw → error');
  check(auditEventColor('message_rate_limited') === THEME.status.warning, 'rate_limited → warning');
  check(auditEventColor('auth_token_expired') === THEME.status.warning, 'expired → warning');
  check(auditEventColor('message_routed') === THEME.status.success, 'routed → success');
  check(auditEventColor('provider_approved') === THEME.status.success, 'approved → success');
  check(auditEventColor('session_started') === THEME.status.info, 'session_started → info');

  // Status colour
  check(statusColor(true) === THEME.status.success, 'active → green');
  check(statusColor(false) === THEME.status.error, 'inactive → red');

  // Quarantine state colours
  check(quarantineStateColor('quarantined') === THEME.status.warning, 'quarantined → warning');
  check(quarantineStateColor('accepted') === THEME.status.success, 'accepted → success');
  check(quarantineStateColor('rejected') === THEME.status.error, 'rejected → error');
  check(quarantineStateColor('purged') === THEME.text.muted, 'purged → muted');

  // formatBytes
  check(formatBytes(0) === '0 B', '0 bytes');
  check(formatBytes(1024) === '1.0 KB', '1024 bytes = 1.0 KB');
  check(formatBytes(50 * 1024 * 1024) === '50.0 MB', '50 MB');

  // formatTimestamp
  const ts = formatTimestamp('2026-03-11T12:00:00.000Z');
  check(typeof ts === 'string' && ts.length > 0, 'formatTimestamp returns string');

  // relativeTime
  const recent = new Date(Date.now() - 30000).toISOString();
  const rt = relativeTime(recent);
  check(rt.includes('s ago') || rt.includes('m ago'), 'relativeTime for recent');
});

// ---------------------------------------------------------------------------
// Test 4: API client — request formation
// ---------------------------------------------------------------------------
await group('API client: request formation and auth headers', async () => {
  const requests = [];
  const mockFetch = async (url, opts) => {
    requests.push({ url, opts });
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
    };
  };

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'secret', totpCode: '123456' },
    fetchImpl: mockFetch,
  });

  await client.getHealth();
  check(requests.length === 1, 'getHealth made 1 request');
  check(requests[0].url === 'https://127.0.0.1:9444/api/health', 'correct URL');
  check(requests[0].opts.method === 'GET', 'GET method');

  const authHeader = requests[0].opts.headers['Authorization'];
  check(authHeader.startsWith('Basic '), 'Basic auth header');
  const decoded = atob(authHeader.slice(6));
  check(decoded === 'admin:secret', 'correct credentials encoded');

  check(requests[0].opts.headers['X-TOTP'] === '123456', 'TOTP header');

  await client.listProviders(false);
  check(requests[1].url === 'https://127.0.0.1:9444/api/providers?includeInactive=false', 'list with filter');

  await client.approveProvider('claude-4', 'Claude 4');
  check(requests[2].opts.method === 'POST', 'POST for approve');
  const approveBody = JSON.parse(requests[2].opts.body);
  check(approveBody.id === 'claude-4', 'approve body has id');
  check(approveBody.name === 'Claude 4', 'approve body has name');

  await client.revokeProvider('claude-4');
  check(requests[3].url.includes('/revoke'), 'revoke URL');
  check(requests[3].opts.method === 'PUT', 'PUT for revoke');

  await client.getCapabilities('claude-4');
  check(requests[4].url.includes('/capabilities'), 'capabilities URL');

  // Audit API methods
  await client.queryAudit({ eventType: 'message_routed', limit: 50 });
  check(requests[5].url.includes('/api/audit'), 'audit query URL');
  check(requests[5].url.includes('eventType=message_routed'), 'audit query has eventType param');
  check(requests[5].url.includes('limit=50'), 'audit query has limit param');
  check(requests[5].opts.method === 'GET', 'GET for audit query');

  await client.getChainIntegrity();
  check(requests[6].url.includes('/api/audit/integrity'), 'integrity URL');
  check(requests[6].opts.method === 'GET', 'GET for integrity');

  // Audit query with no filters
  await client.queryAudit();
  check(requests[7].url === 'https://127.0.0.1:9444/api/audit', 'audit query no params');
});

// ---------------------------------------------------------------------------
// Test 5: API client — error handling
// ---------------------------------------------------------------------------
await group('API client: error handling', async () => {
  const errorFetch = async () => {
    return {
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    };
  };

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'wrong', totpCode: '000000' },
    fetchImpl: errorFetch,
  });

  const result = await client.getHealth();
  check(result.ok === false, 'failed request returns ok: false');
  check(result.status === 401, 'status 401');
  check(result.error === 'Unauthorized', 'error message');

  // Network error
  const throwFetch = async () => { throw new Error('ECONNREFUSED'); };
  const client2 = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'secret', totpCode: '123456' },
    fetchImpl: throwFetch,
  });

  const result2 = await client2.getHealth();
  check(result2.ok === false, 'network error returns ok: false');
  check(result2.status === 0, 'status 0 for network error');
  check(result2.error === 'ECONNREFUSED', 'error message from exception');
});

// ---------------------------------------------------------------------------
// Test 6: Overview store
// ---------------------------------------------------------------------------
await group('Overview store: state management and derived values', async () => {
  const overview = createOverviewStore();
  const state = overview.store.get();

  check(state.connectedClients === 0, 'initial clients = 0');
  check(state.activeSessions === 0, 'initial sessions = 0');
  check(state.throughput.total === 0, 'initial throughput = 0');
  check(state.quarantine.count === 0, 'initial quarantine = 0');
  check(state.recentAuditEvents.length === 0, 'initial events empty');
  check(state.loading === false, 'initial loading = false');
  check(state.lastUpdated === null, 'initial lastUpdated = null');

  overview.setClients(5);
  check(overview.store.get().connectedClients === 5, 'clients updated');
  check(overview.store.get().lastUpdated !== null, 'lastUpdated set');

  overview.setSessions(3);
  check(overview.store.get().activeSessions === 3, 'sessions updated');

  overview.setThroughput({ total: 1000, perMinute: 42 });
  check(overview.store.get().throughput.perMinute === 42, 'throughput updated');

  overview.setQuarantine({ count: 90, maxEntries: 100, oldestAge: null });
  check(overview.store.get().quarantine.count === 90, 'quarantine updated');

  // Derived: health status
  check(overview.healthStatus.get() === 'degraded', '90% quarantine → degraded');

  overview.setQuarantine({ count: 10, maxEntries: 100, oldestAge: null });
  check(overview.healthStatus.get() === 'healthy', '10% quarantine → healthy');

  overview.setError('connection lost');
  check(overview.healthStatus.get() === 'critical', 'error → critical');

  // Derived: quarantine utilisation
  overview.setError(null);
  overview.setQuarantine({ count: 50, maxEntries: 100, oldestAge: null });
  check(overview.quarantineUtilisation.get() === 0.5, '50/100 = 0.5');

  // Audit events
  const event = { index: 0, timestamp: new Date().toISOString(), eventType: 'auth_success', sessionId: 's1', detail: {} };
  overview.addAuditEvent(event);
  check(overview.store.get().recentAuditEvents.length === 1, '1 event added');

  overview.addAuditEvent({ ...event, index: 1 });
  check(overview.store.get().recentAuditEvents.length === 2, '2 events');
  check(overview.store.get().recentAuditEvents[0].index === 1, 'newest first');

  // Reset
  overview.reset();
  check(overview.store.get().connectedClients === 0, 'reset clears state');
});

// ---------------------------------------------------------------------------
// Test 7: Providers store — CRUD
// ---------------------------------------------------------------------------
await group('Providers store: CRUD operations', async () => {
  const providers = createProvidersStore();

  check(providers.store.get().providers.length === 0, 'initially empty');
  check(providers.totalCount.get() === 0, 'totalCount = 0');
  check(providers.activeCount.get() === 0, 'activeCount = 0');

  const matrix = defaultCapabilityMatrix();
  check(matrix.allowedMessageTypes.includes('conversation'), 'default allows conversation');
  check(!matrix.allowedMessageTypes.includes('task'), 'default does NOT allow task');
  check(matrix.fileTransfer.canSend === true, 'default allows send');
  check(matrix.fileTransfer.maxFileSizeBytes === 50 * 1024 * 1024, 'default 50MB');

  const p1 = {
    id: 'claude-4', name: 'Claude 4', approvedAt: new Date().toISOString(),
    approvedBy: 'admin', capabilities: [], active: true, capabilityMatrix: matrix,
  };
  const p2 = {
    id: 'gpt-5', name: 'GPT-5', approvedAt: new Date().toISOString(),
    approvedBy: 'admin', capabilities: [], active: true, capabilityMatrix: matrix,
  };

  providers.addProvider(p1);
  providers.addProvider(p2);
  check(providers.totalCount.get() === 2, '2 providers');
  check(providers.activeCount.get() === 2, '2 active');

  // Select
  providers.selectProvider('claude-4');
  check(providers.selectedProvider.get()?.id === 'claude-4', 'selected claude-4');

  providers.selectProvider(null);
  check(providers.selectedProvider.get() === null, 'deselected');

  // Update (revoke)
  providers.updateProvider('gpt-5', { active: false });
  check(providers.activeCount.get() === 1, '1 active after revoke');
  check(providers.activeProviders.get().length === 1, 'activeProviders filtered');

  // Set capabilities
  const customMatrix = { ...matrix, maxConcurrentTasks: 5 };
  providers.setCapabilities('claude-4', customMatrix);
  const updated = providers.store.get().providers.find(p => p.id === 'claude-4');
  check(updated?.capabilityMatrix.maxConcurrentTasks === 5, 'capabilities updated');

  // Remove
  providers.selectProvider('gpt-5');
  providers.removeProvider('gpt-5');
  check(providers.totalCount.get() === 1, '1 provider after remove');
  check(providers.store.get().selectedId === null, 'selection cleared on remove');

  // Set all at once
  providers.setProviders([p1, p2]);
  check(providers.totalCount.get() === 2, 'setProviders replaces all');
});

// ---------------------------------------------------------------------------
// Test 8: Blocklist store — MaliClaw enforcement
// ---------------------------------------------------------------------------
await group('Blocklist store: MaliClaw immutability and custom entries', async () => {
  const blocklist = createBlocklistStore();
  const state = blocklist.store.get();

  // MaliClaw patterns always present (OpenClaw lineage)
  check(state.maliClawEntries.length === 7, '7 MaliClaw patterns');
  check(state.maliClawEntries.includes('openclaw'), 'has openclaw');
  check(state.maliClawEntries.includes('clawdbot'), 'has clawdbot');
  check(state.maliClawEntries.includes('moltbot'), 'has moltbot');
  check(state.maliClawEntries.includes('clawhub'), 'has clawhub');
  check(state.maliClawEntries.includes('ai.openclaw.client'), 'has ai.openclaw.client');
  check(state.maliClawEntries.includes('openclaw.ai'), 'has openclaw.ai');
  check(state.maliClawEntries.includes('docs.openclaw.ai'), 'has docs.openclaw.ai');

  check(blocklist.maliClawCount.get() === 7, 'maliClawCount = 7');

  // Case-insensitive partial matching
  check(blocklist.isMaliClaw('openclaw'), 'isMaliClaw(openclaw) = true');
  check(blocklist.isMaliClaw('OpenClaw-Agent'), 'isMaliClaw(OpenClaw-Agent) = true');
  check(blocklist.isMaliClaw('my-clawdbot-fork'), 'isMaliClaw(my-clawdbot-fork) = true');
  check(blocklist.isMaliClaw('MOLTBOT'), 'isMaliClaw(MOLTBOT) = true');
  check(!blocklist.isMaliClaw('someother'), 'isMaliClaw(someother) = false');

  // Cannot add MaliClaw as custom (exact or partial match)
  const added = blocklist.addCustomEntry({ id: 'openclaw', label: 'test', addedAt: '', addedBy: '' });
  check(added === false, 'cannot add openclaw as custom');
  const added2 = blocklist.addCustomEntry({ id: 'clawdbot-fork', label: 'test', addedAt: '', addedBy: '' });
  check(added2 === false, 'cannot add clawdbot-fork as custom');
  check(blocklist.store.get().customEntries.length === 0, 'still 0 custom');

  // Add real custom entry
  const ok = blocklist.addCustomEntry({ id: 'bad-bot', label: 'Bad Bot', addedAt: new Date().toISOString(), addedBy: 'admin' });
  check(ok === true, 'added custom entry');
  check(blocklist.store.get().customEntries.length === 1, '1 custom entry');
  check(blocklist.totalCount.get() === 8, 'total = 7 + 1');

  // Derived allEntries
  const all = blocklist.allEntries.get();
  check(all.length === 8, '8 total entries');
  check(all.filter(e => e.source === 'maliclaw').length === 7, '7 maliclaw');
  check(all.filter(e => e.removable).length === 1, '1 removable');

  // Cannot remove MaliClaw entries
  check(blocklist.removeCustomEntry('openclaw') === false, 'cannot remove openclaw');

  // Remove custom
  check(blocklist.removeCustomEntry('bad-bot') === true, 'removed bad-bot');
  check(blocklist.store.get().customEntries.length === 0, '0 custom after remove');

  // setCustomEntries filters MaliClaw (partial matching)
  blocklist.setCustomEntries([
    { id: 'safe-block', label: 'Safe', addedAt: '', addedBy: '' },
    { id: 'openclaw-agent', label: 'Sneak', addedAt: '', addedBy: '' },
  ]);
  check(blocklist.store.get().customEntries.length === 1, 'openclaw-agent filtered from setCustomEntries');
  check(blocklist.store.get().customEntries[0].id === 'safe-block', 'only safe-block kept');

  // Reset preserves MaliClaw
  blocklist.reset();
  check(blocklist.store.get().maliClawEntries.length === 7, 'MaliClaw preserved after reset');
  check(blocklist.store.get().customEntries.length === 0, 'custom cleared after reset');
});

// ---------------------------------------------------------------------------
// Test 9: Quarantine store
// ---------------------------------------------------------------------------
await group('Quarantine store: entries, filtering, selection', async () => {
  const quarantine = createQuarantineStore();

  check(quarantine.totalCount.get() === 0, 'initially empty');

  const e1 = {
    transferId: 'tf-1', direction: 'human_to_ai', filename: 'doc.pdf',
    sizeBytes: 1024, mimeType: 'application/pdf', hashAtReceipt: 'abc123',
    state: 'quarantined', quarantinedAt: new Date().toISOString(),
    purgeAt: new Date(Date.now() + 3600000).toISOString(), custodyEvents: [],
  };
  const e2 = {
    ...e1, transferId: 'tf-2', filename: 'img.png', state: 'offered',
    mimeType: 'image/png',
  };
  const e3 = {
    ...e1, transferId: 'tf-3', filename: 'data.csv', state: 'quarantined',
    mimeType: 'text/csv',
  };

  quarantine.addEntry(e1);
  quarantine.addEntry(e2);
  quarantine.addEntry(e3);
  check(quarantine.totalCount.get() === 3, '3 entries');

  // State breakdown
  const breakdown = quarantine.stateBreakdown.get();
  check(breakdown['quarantined'] === 2, '2 quarantined');
  check(breakdown['offered'] === 1, '1 offered');

  // Filter
  quarantine.setFilter('quarantined');
  check(quarantine.filteredEntries.get().length === 2, 'filter: 2 quarantined');

  quarantine.setFilter('offered');
  check(quarantine.filteredEntries.get().length === 1, 'filter: 1 offered');

  quarantine.setFilter(null);
  check(quarantine.filteredEntries.get().length === 3, 'no filter: all 3');

  // Select
  quarantine.selectEntry('tf-2');
  check(quarantine.selectedEntry.get()?.filename === 'img.png', 'selected tf-2');

  // Update
  quarantine.updateEntry('tf-2', { state: 'accepted' });
  check(quarantine.store.get().entries.find(e => e.transferId === 'tf-2')?.state === 'accepted', 'state updated');

  // Remove
  quarantine.removeEntry('tf-2');
  check(quarantine.totalCount.get() === 2, '2 after remove');
  check(quarantine.selectedEntry.get() === null, 'selection cleared');

  quarantine.reset();
  check(quarantine.totalCount.get() === 0, 'reset clears all');
});

// ---------------------------------------------------------------------------
// Test 10: Connections store
// ---------------------------------------------------------------------------
await group('Connections store: add/remove, filtering, counts', async () => {
  const connections = createConnectionsStore();

  check(connections.totalCount.get() === 0, 'initially empty');

  const c1 = {
    connectionId: 'conn-1', remoteAddress: '127.0.0.1', connectedAt: new Date().toISOString(),
    clientType: 'human', authenticated: true, messageCount: 5,
  };
  const c2 = {
    connectionId: 'conn-2', remoteAddress: '10.0.0.2', connectedAt: new Date().toISOString(),
    clientType: 'ai', authenticated: true, providerId: 'claude-4', messageCount: 42,
  };
  const c3 = {
    connectionId: 'conn-3', remoteAddress: '10.0.0.3', connectedAt: new Date().toISOString(),
    clientType: 'ai', authenticated: false, messageCount: 0,
  };

  connections.addConnection(c1);
  connections.addConnection(c2);
  connections.addConnection(c3);

  check(connections.totalCount.get() === 3, '3 connections');
  check(connections.humanCount.get() === 1, '1 human');
  check(connections.aiCount.get() === 2, '2 ai');
  check(connections.authenticatedCount.get() === 2, '2 authenticated');

  // Filter
  connections.setFilter('human');
  check(connections.filteredConnections.get().length === 1, 'filter human: 1');

  connections.setFilter('ai');
  check(connections.filteredConnections.get().length === 2, 'filter ai: 2');

  connections.setFilter('all');
  check(connections.filteredConnections.get().length === 3, 'filter all: 3');

  // Update message count
  connections.updateMessageCount('conn-1', 10);
  check(connections.store.get().connections.find(c => c.connectionId === 'conn-1')?.messageCount === 10, 'message count updated');

  // Set authenticated
  connections.setAuthenticated('conn-3', true);
  check(connections.authenticatedCount.get() === 3, '3 authenticated after update');

  // Remove
  connections.removeConnection('conn-2');
  check(connections.totalCount.get() === 2, '2 after remove');
  check(connections.aiCount.get() === 1, '1 ai after remove');

  // Total messages
  connections.setTotalMessages(500);
  check(connections.store.get().totalMessagesRouted === 500, 'total messages set');

  connections.reset();
  check(connections.totalCount.get() === 0, 'reset clears all');
});

// ---------------------------------------------------------------------------
// Test 11: Config store
// ---------------------------------------------------------------------------
await group('Config store: settings, derived health indicators', async () => {
  const config = createConfigStore();
  const state = config.store.get();

  // Defaults
  check(state.relaySettings.port === 9443, 'default port 9443');
  check(state.relaySettings.adminPort === 9444, 'default admin port 9444');
  check(state.safetyFloors.challengeThreshold === 0.6, 'default challenge threshold');
  check(state.safetyFloors.denialThreshold === 0.9, 'default denial threshold');
  check(state.tlsStatus.enabled === false, 'TLS initially disabled');
  check(state.auditChainIntegrity.chainValid === true, 'chain initially valid');

  // Derived health
  check(config.tlsHealthy.get() === false, 'TLS not healthy (disabled)');
  check(config.chainHealthy.get() === true, 'chain healthy');
  check(config.systemHealthy.get() === false, 'system not healthy (TLS off)');

  // Enable TLS
  config.setTlsStatus({
    enabled: true,
    certExpiry: '2027-01-01T00:00:00Z',
    protocol: 'TLSv1.3',
    cipher: 'TLS_AES_256_GCM_SHA384',
  });
  check(config.tlsHealthy.get() === true, 'TLS healthy after enable');
  check(config.systemHealthy.get() === true, 'system healthy (TLS + chain)');

  // Break chain
  config.setAuditChainIntegrity({
    totalEntries: 100,
    lastVerifiedAt: new Date().toISOString(),
    chainValid: false,
    genesisHash: 'abc',
    lastHash: 'xyz',
  });
  check(config.chainHealthy.get() === false, 'chain unhealthy');
  check(config.systemHealthy.get() === false, 'system unhealthy (broken chain)');

  // Update relay settings
  config.setRelaySettings({ ...state.relaySettings, maxConnections: 200 });
  check(config.store.get().relaySettings.maxConnections === 200, 'maxConnections updated');

  // Update safety floors
  config.setSafetyFloors({ ...state.safetyFloors, challengeThreshold: 0.5 });
  check(config.store.get().safetyFloors.challengeThreshold === 0.5, 'safety floors updated');

  // Error state
  config.setError('connection lost');
  check(config.systemHealthy.get() === false, 'system unhealthy with error');

  config.reset();
  check(config.store.get().relaySettings.port === 9443, 'reset restores defaults');
});

// ---------------------------------------------------------------------------
// Test 12: defaultCapabilityMatrix
// ---------------------------------------------------------------------------
await group('Default capability matrix: structure and values', async () => {
  const m1 = defaultCapabilityMatrix();
  const m2 = defaultCapabilityMatrix();

  // Returns a new object each time
  check(m1 !== m2, 'returns new object each call');

  // Standard AI→human types
  check(m1.allowedMessageTypes.includes('conversation'), 'allows conversation');
  check(m1.allowedMessageTypes.includes('challenge'), 'allows challenge');
  check(m1.allowedMessageTypes.includes('denial'), 'allows denial');
  check(m1.allowedMessageTypes.includes('status'), 'allows status');
  check(m1.allowedMessageTypes.includes('result'), 'allows result');
  check(m1.allowedMessageTypes.includes('error'), 'allows error');
  check(m1.allowedMessageTypes.includes('file_offer'), 'allows file_offer');
  check(m1.allowedMessageTypes.includes('heartbeat'), 'allows heartbeat');

  // Does NOT allow human→AI only types
  check(!m1.allowedMessageTypes.includes('task'), 'does NOT allow task');
  check(!m1.allowedMessageTypes.includes('confirmation'), 'does NOT allow confirmation');

  // File transfer defaults
  check(m1.fileTransfer.canSend === true, 'canSend default true');
  check(m1.fileTransfer.canReceive === true, 'canReceive default true');
  check(m1.fileTransfer.maxFileSizeBytes === 50 * 1024 * 1024, 'maxSize 50MB');
  check(m1.fileTransfer.allowedMimeTypes[0] === '*/*', 'wildcard MIME');

  check(m1.maxConcurrentTasks === 10, 'maxConcurrentTasks = 10');
});

// ---------------------------------------------------------------------------
// Test 13: Theme constants
// ---------------------------------------------------------------------------
await group('Theme: infrastructure blue palette constants', async () => {
  check(THEME.bg.primary === '#0a1628', 'bg.primary is deep navy');
  check(THEME.accent.primary === '#3b82f6', 'accent is bright blue');
  check(THEME.text.primary === '#e2e8f0', 'text is light gray');
  check(THEME.status.success === '#22c55e', 'success is green');
  check(THEME.status.error === '#ef4444', 'error is red');
  check(THEME.status.warning === '#f59e0b', 'warning is amber');
  check(THEME.border.active === '#3b82f6', 'active border is accent blue');
});

// ---------------------------------------------------------------------------
// Test 14: Overview — audit event cap
// ---------------------------------------------------------------------------
await group('Overview store: audit event cap at 50', async () => {
  const overview = createOverviewStore();

  // Add 55 events
  for (let i = 0; i < 55; i++) {
    overview.addAuditEvent({
      index: i, timestamp: new Date().toISOString(),
      eventType: 'message_routed', sessionId: 's1', detail: { i },
    });
  }
  check(overview.store.get().recentAuditEvents.length === 50, 'capped at 50');
  check(overview.store.get().recentAuditEvents[0].index === 54, 'newest first');
  check(overview.store.get().recentAuditEvents[49].index === 5, 'oldest is #5');
});

// ---------------------------------------------------------------------------
// Test 15: Providers — duplicate add and setProviders
// ---------------------------------------------------------------------------
await group('Providers store: duplicate handling and bulk set', async () => {
  const providers = createProvidersStore();
  const matrix = defaultCapabilityMatrix();
  const p1 = {
    id: 'claude-4', name: 'Claude 4', approvedAt: new Date().toISOString(),
    approvedBy: 'admin', capabilities: [], active: true, capabilityMatrix: matrix,
  };

  providers.addProvider(p1);
  providers.addProvider(p1); // duplicate
  check(providers.totalCount.get() === 2, 'addProvider does not deduplicate (relay handles it)');

  // setProviders replaces
  providers.setProviders([p1]);
  check(providers.totalCount.get() === 1, 'setProviders replaces all');

  // Error state
  providers.setError('fetch failed');
  check(providers.store.get().error === 'fetch failed', 'error set');
  providers.setProviders([p1]);
  check(providers.store.get().error === null, 'error cleared on setProviders');

  // Loading
  providers.setLoading(true);
  check(providers.store.get().loading === true, 'loading set');
  providers.setLoading(false);
  check(providers.store.get().loading === false, 'loading cleared');
});

// ---------------------------------------------------------------------------
// Test 16: Quarantine — custody events in entry
// ---------------------------------------------------------------------------
await group('Quarantine store: custody events preserved', async () => {
  const quarantine = createQuarantineStore();

  const entry = {
    transferId: 'tf-1', direction: 'human_to_ai', filename: 'doc.pdf',
    sizeBytes: 2048, mimeType: 'application/pdf', hashAtReceipt: 'deadbeef',
    state: 'quarantined', quarantinedAt: new Date().toISOString(),
    purgeAt: new Date(Date.now() + 3600000).toISOString(),
    custodyEvents: [
      { event: 'submitted', timestamp: new Date().toISOString(), actor: 'human', hash: 'deadbeef' },
      { event: 'quarantined', timestamp: new Date().toISOString(), actor: 'relay', hash: 'deadbeef' },
    ],
  };

  quarantine.addEntry(entry);
  const stored = quarantine.store.get().entries[0];
  check(stored.custodyEvents.length === 2, '2 custody events');
  check(stored.custodyEvents[0].event === 'submitted', 'first event is submitted');
  check(stored.custodyEvents[1].actor === 'relay', 'second actor is relay');
});

// ---------------------------------------------------------------------------
// Test 17: Connections — setConnections bulk
// ---------------------------------------------------------------------------
await group('Connections store: bulk setConnections and error/loading', async () => {
  const connections = createConnectionsStore();

  const conns = [
    { connectionId: 'c1', remoteAddress: '127.0.0.1', connectedAt: new Date().toISOString(), clientType: 'human', authenticated: true, messageCount: 0 },
    { connectionId: 'c2', remoteAddress: '10.0.0.1', connectedAt: new Date().toISOString(), clientType: 'ai', authenticated: false, messageCount: 0 },
  ];

  connections.setConnections(conns);
  check(connections.totalCount.get() === 2, 'bulk set 2 connections');

  connections.setError('timeout');
  check(connections.store.get().error === 'timeout', 'error set');

  connections.setConnections(conns);
  check(connections.store.get().error === null, 'error cleared on setConnections');

  connections.setLoading(true);
  check(connections.store.get().loading === true, 'loading true');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(60));
if (failedGroups === 0) {
  console.log(`\x1b[32m  ALL ${totalGroups} GROUPS PASSED (${totalChecks} checks)\x1b[0m`);
} else {
  console.log(`\x1b[31m  ${failedGroups}/${totalGroups} GROUPS FAILED (${totalChecks} checks)\x1b[0m`);
  process.exit(1);
}
console.log('='.repeat(60));
