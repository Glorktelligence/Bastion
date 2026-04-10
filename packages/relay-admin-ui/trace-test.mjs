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
  DataService,
  createOverviewStore,
  createProvidersStore,
  defaultCapabilityMatrix,
  createBlocklistStore,
  createQuarantineStore,
  createConnectionsStore,
  createConfigStore,
  createExtensionsStore,
  createToolsStore,
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

  // All requests include auth headers (admin API requires authentication)
  check(!!requests[0].opts.headers['Authorization'], 'GET includes auth header');
  check(!!requests[0].opts.headers['X-TOTP'], 'GET includes TOTP header');

  await client.listProviders(false);
  check(requests[1].url === 'https://127.0.0.1:9444/api/providers?includeInactive=false', 'list with filter');

  await client.approveProvider('claude-4', 'Claude 4');
  check(requests[2].opts.method === 'POST', 'POST for approve');
  const approveBody = JSON.parse(requests[2].opts.body);
  check(approveBody.id === 'claude-4', 'approve body has id');
  check(approveBody.name === 'Claude 4', 'approve body has name');
  // POST includes Basic auth (no session token set)
  const postAuth = requests[2].opts.headers['Authorization'];
  check(postAuth && postAuth.startsWith('Basic '), 'POST has Basic auth header');

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

  // Status and connections API methods
  await client.getStatus();
  check(requests[8].url === 'https://127.0.0.1:9444/api/status', 'status URL');
  check(requests[8].opts.method === 'GET', 'GET for status');

  await client.getConnections();
  check(requests[9].url === 'https://127.0.0.1:9444/api/connections', 'connections URL');
  check(requests[9].opts.method === 'GET', 'GET for connections');
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

  // MaliClaw patterns always present (Claw family tree)
  check(state.maliClawEntries.length === 13, '13 MaliClaw patterns');
  check(state.maliClawEntries.includes('openclaw'), 'has openclaw');
  check(state.maliClawEntries.includes('clawdbot'), 'has clawdbot');
  check(state.maliClawEntries.includes('moltbot'), 'has moltbot');
  check(state.maliClawEntries.includes('copaw'), 'has copaw');
  check(state.maliClawEntries.includes('nanoclaw'), 'has nanoclaw');
  check(state.maliClawEntries.includes('zeroclaw'), 'has zeroclaw');
  check(state.maliClawEntries.includes('hiclaw'), 'has hiclaw');
  check(state.maliClawEntries.includes('tuwunel'), 'has tuwunel');
  check(state.maliClawEntries.includes('lobster'), 'has lobster');
  check(state.maliClawEntries.includes('clawhub'), 'has clawhub');

  check(blocklist.maliClawCount.get() === 13, 'maliClawCount = 13');

  // Case-insensitive partial matching + catch-all
  check(blocklist.isMaliClaw('openclaw'), 'isMaliClaw(openclaw) = true');
  check(blocklist.isMaliClaw('OpenClaw-Agent'), 'isMaliClaw(OpenClaw-Agent) = true');
  check(blocklist.isMaliClaw('my-clawdbot-fork'), 'isMaliClaw(my-clawdbot-fork) = true');
  check(blocklist.isMaliClaw('MOLTBOT'), 'isMaliClaw(MOLTBOT) = true');
  check(blocklist.isMaliClaw('copaw'), 'isMaliClaw(copaw) = true');
  check(blocklist.isMaliClaw('HiClaw'), 'isMaliClaw(HiClaw) = true');
  check(blocklist.isMaliClaw('tuwunel-server'), 'isMaliClaw(tuwunel-server) = true');
  check(blocklist.isMaliClaw('megaclaw-future'), 'isMaliClaw(megaclaw-future) catch-all');
  check(!blocklist.isMaliClaw('someother'), 'isMaliClaw(someother) = false');

  // Cannot add MaliClaw as custom (exact, partial, or catch-all)
  const added = blocklist.addCustomEntry({ id: 'openclaw', label: 'test', addedAt: '', addedBy: '' });
  check(added === false, 'cannot add openclaw as custom');
  const added2 = blocklist.addCustomEntry({ id: 'clawdbot-fork', label: 'test', addedAt: '', addedBy: '' });
  check(added2 === false, 'cannot add clawdbot-fork as custom');
  const added3 = blocklist.addCustomEntry({ id: 'ultraclaw', label: 'test', addedAt: '', addedBy: '' });
  check(added3 === false, 'cannot add ultraclaw (catch-all) as custom');
  check(blocklist.store.get().customEntries.length === 0, 'still 0 custom');

  // Add real custom entry
  const ok = blocklist.addCustomEntry({ id: 'bad-bot', label: 'Bad Bot', addedAt: new Date().toISOString(), addedBy: 'admin' });
  check(ok === true, 'added custom entry');
  check(blocklist.store.get().customEntries.length === 1, '1 custom entry');
  check(blocklist.totalCount.get() === 14, 'total = 13 + 1');

  // Derived allEntries
  const all = blocklist.allEntries.get();
  check(all.length === 14, '14 total entries');
  check(all.filter(e => e.source === 'maliclaw').length === 13, '13 maliclaw');
  check(all.filter(e => e.removable).length === 1, '1 removable');

  // Cannot remove MaliClaw entries
  check(blocklist.removeCustomEntry('openclaw') === false, 'cannot remove openclaw');

  // Remove custom
  check(blocklist.removeCustomEntry('bad-bot') === true, 'removed bad-bot');
  check(blocklist.store.get().customEntries.length === 0, '0 custom after remove');

  // setCustomEntries filters MaliClaw (partial matching + catch-all)
  blocklist.setCustomEntries([
    { id: 'safe-block', label: 'Safe', addedAt: '', addedBy: '' },
    { id: 'openclaw-agent', label: 'Sneak', addedAt: '', addedBy: '' },
    { id: 'someclaw-x', label: 'Catch-all', addedAt: '', addedBy: '' },
  ]);
  check(blocklist.store.get().customEntries.length === 1, 'claw entries filtered from setCustomEntries');
  check(blocklist.store.get().customEntries[0].id === 'safe-block', 'only safe-block kept');

  // Reset preserves MaliClaw
  blocklist.reset();
  check(blocklist.store.get().maliClawEntries.length === 13, 'MaliClaw preserved after reset');
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
// Test 18: DataService — fetches API and populates stores
// ---------------------------------------------------------------------------
await group('DataService: fetchStatus populates overview store', async () => {
  // Mock fetch that returns status data
  const mockFetch = async (url, opts) => {
    if (url.includes('/api/status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          connectedClients: { total: 3, human: 1, ai: 1, unknown: 1 },
          activeSessions: 1,
          messagesPerMinute: 42,
          quarantine: { active: 2, capacity: 100 },
        }),
      };
    }
    if (url.includes('/api/audit')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          entries: [
            { index: 0, timestamp: '2026-03-22T10:00:00Z', eventType: 'message_routed', sessionId: 's1', detail: {} },
            { index: 1, timestamp: '2026-03-22T10:01:00Z', eventType: 'auth_success', sessionId: 's2', detail: {} },
          ],
          totalCount: 2,
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: mockFetch,
  });

  const service = new DataService({ client });
  const overview = createOverviewStore();

  await service.fetchStatus(overview);
  check(overview.store.get().connectedClients === 3, 'clients populated from API');
  check(overview.store.get().activeSessions === 1, 'sessions populated');
  check(overview.store.get().throughput.perMinute === 42, 'msg/min populated');
  check(overview.store.get().quarantine.count === 2, 'quarantine count populated');
  check(overview.store.get().loading === false, 'loading cleared');
  check(overview.store.get().error === null, 'no error');

  await service.fetchAuditEvents(overview);
  check(overview.store.get().recentAuditEvents.length === 2, 'audit events populated');

  service.destroy();
});

await group('DataService: fetchConnections populates connections store', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/api/connections')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          connections: [
            { connectionId: 'c1', remoteAddress: '10.0.10.5', connectedAt: '2026-03-22T10:00:00Z', clientType: 'human', authenticated: true, messageCount: 15 },
            { connectionId: 'c2', remoteAddress: '10.0.50.10', connectedAt: '2026-03-22T10:01:00Z', clientType: 'ai', authenticated: true, providerId: 'anthropic', messageCount: 12 },
          ],
          total: 2,
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: mockFetch,
  });

  const service = new DataService({ client });
  const connections = createConnectionsStore();

  await service.fetchConnections(connections);
  check(connections.totalCount.get() === 2, 'connections populated');
  check(connections.humanCount.get() === 1, 'human count correct');
  check(connections.aiCount.get() === 1, 'ai count correct');
  check(connections.store.get().loading === false, 'loading cleared');

  service.destroy();
});

await group('DataService: fetchProviders and approveProvider', async () => {
  let approveCount = 0;
  const mockFetch = async (url, opts) => {
    if (url.includes('/api/providers') && opts?.method === 'POST') {
      approveCount++;
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: 'new-provider', name: 'New Provider', active: true }),
      };
    }
    if (url.includes('/api/providers')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          providers: approveCount > 0
            ? [{ id: 'new-provider', name: 'New Provider', active: true, capabilities: [], approvedAt: '2026-03-22T10:00:00Z', approvedBy: 'admin' }]
            : [],
          total: approveCount > 0 ? 1 : 0,
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: mockFetch,
  });

  const service = new DataService({ client });
  const providers = createProvidersStore();

  await service.fetchProviders(providers);
  check(providers.totalCount.get() === 0, 'initially empty');

  const ok = await service.approveProvider(providers, 'new-provider', 'New Provider');
  check(ok === true, 'approve returned true');
  check(providers.totalCount.get() === 1, 'provider added after approve');

  service.destroy();
});

await group('DataService: error handling surfaces in stores', async () => {
  const failFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: 'Internal server error' }),
  });

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: failFetch,
  });

  const service = new DataService({ client });
  const overview = createOverviewStore();

  await service.fetchStatus(overview);
  check(overview.store.get().error !== null, 'error set on failure');
  check(overview.store.get().error.includes('Internal server error'), 'error message propagated');
  check(overview.store.get().loading === false, 'loading cleared on error');

  service.destroy();
});

await group('DataService: fetchConfig populates config store', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/api/audit/integrity')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          totalEntries: 150,
          chainValid: true,
          lastVerifiedAt: '2026-03-22T12:00:00Z',
          genesisHash: 'genesis-abc',
          lastHash: 'last-xyz',
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: mockFetch,
  });

  const service = new DataService({ client });
  const config = createConfigStore();

  await service.fetchConfig(config);
  check(config.store.get().auditChainIntegrity.totalEntries === 150, 'integrity entries populated');
  check(config.store.get().auditChainIntegrity.chainValid === true, 'chain valid populated');
  check(config.chainHealthy.get() === true, 'chainHealthy derived true');

  service.destroy();
});

// ---------------------------------------------------------------------------
// Test 22: Session token expiry tracking
// ---------------------------------------------------------------------------
await group('API client: session token expiry tracking', async () => {
  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  });

  // No session initially
  check(client.getSessionExpiresAt() === null, 'no session → expiresAt null');
  check(client.getSessionRemainingMs() === null, 'no session → remainingMs null');

  // Set session expiring in 30 minutes
  const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  client.setSessionToken('test-token', future);
  check(client.hasSession === true, 'session set and valid');
  check(client.getSessionExpiresAt() !== null, 'expiresAt set');

  const remaining = client.getSessionRemainingMs();
  check(remaining !== null && remaining > 0, 'remaining > 0 for future expiry');
  check(remaining <= 30 * 60 * 1000, 'remaining <= 30 minutes');

  // Set an already-expired session
  const past = new Date(Date.now() - 1000).toISOString();
  client.setSessionToken('expired-token', past);
  check(client.hasSession === false, 'expired session → hasSession false');
  check(client.getSessionRemainingMs() === 0, 'expired session → remainingMs 0');

  // Clear session
  client.clearSessionToken();
  check(client.getSessionExpiresAt() === null, 'cleared → expiresAt null');
  check(client.getSessionRemainingMs() === null, 'cleared → remainingMs null');
});

// ---------------------------------------------------------------------------
// Test 23: Session token refresh via API
// ---------------------------------------------------------------------------
await group('API client: session refresh exchanges token', async () => {
  const requests = [];
  const mockFetch = async (url, opts) => {
    requests.push({ url, opts });
    if (url.includes('/api/admin/refresh')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          token: 'new-fresh-token',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: mockFetch,
  });

  // Set initial session
  const initial = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  client.setSessionToken('old-token', initial);
  check(client.hasSession === true, 'initial session valid');

  // Refresh
  const result = await client.refresh();
  check(result.ok === true, 'refresh succeeded');
  check(requests.some(r => r.url.includes('/api/admin/refresh')), 'refresh endpoint called');
  check(requests.find(r => r.url.includes('/api/admin/refresh'))?.opts.method === 'POST', 'refresh uses POST');

  // Verify new token was set
  check(client.hasSession === true, 'session still valid after refresh');
  const newRemaining = client.getSessionRemainingMs();
  check(newRemaining !== null && newRemaining > 25 * 60 * 1000, 'new token has ~30 min remaining');
});

// ---------------------------------------------------------------------------
// Test 24: Session refresh failure does not set token
// ---------------------------------------------------------------------------
await group('API client: failed refresh preserves state', async () => {
  const failFetch = async (url) => {
    if (url.includes('/api/admin/refresh')) {
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid or expired token', reason: 'expired' }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: failFetch,
  });

  // Set a session that's about to expire
  const nearFuture = new Date(Date.now() + 30 * 1000).toISOString();
  client.setSessionToken('expiring-token', nearFuture);
  const expiryBefore = client.getSessionExpiresAt();

  const result = await client.refresh();
  check(result.ok === false, 'refresh failed');
  check(result.status === 401, 'status 401');

  // Token should NOT have been updated (no new token in failed response)
  check(client.getSessionExpiresAt() === expiryBefore, 'expiry unchanged after failed refresh');
});

// ---------------------------------------------------------------------------
// Test 25: Login sets session and tracks expiry
// ---------------------------------------------------------------------------
await group('API client: login sets session with expiry tracking', async () => {
  const loginExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const mockFetch = async (url, opts) => {
    if (url.includes('/api/admin/login')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          token: 'login-session-token',
          expiresAt: loginExpiry,
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: mockFetch,
  });

  check(client.hasSession === false, 'no session before login');
  check(client.getSessionExpiresAt() === null, 'no expiry before login');

  await client.login('admin', 'securepass', '123456');
  check(client.hasSession === true, 'session set after login');
  check(client.getSessionExpiresAt() !== null, 'expiry tracked after login');

  const remaining = client.getSessionRemainingMs();
  check(remaining !== null && remaining > 0, 'remaining time positive after login');
});

// ---------------------------------------------------------------------------
// Test 26: Extensions store
// ---------------------------------------------------------------------------
await group('Extensions store: state management and derived values', async () => {
  const extensions = createExtensionsStore();
  const state = extensions.store.get();

  check(state.extensions.length === 0, 'initially empty');
  check(state.selectedNamespace === null, 'no selection');
  check(state.selectedDetail === null, 'no detail');
  check(state.loading === false, 'not loading');
  check(state.detailLoading === false, 'not detail loading');
  check(extensions.totalCount.get() === 0, 'totalCount = 0');
  check(extensions.totalMessageTypes.get() === 0, 'totalMessageTypes = 0');

  const ext1 = {
    namespace: 'games', name: 'Games Extension', version: '1.0.0',
    description: 'Board games', author: 'bastion', messageTypeCount: 3,
  };
  const ext2 = {
    namespace: 'analytics', name: 'Analytics', version: '2.1.0',
    description: 'Usage tracking', author: 'community', messageTypeCount: 5,
  };

  extensions.setExtensions([ext1, ext2]);
  check(extensions.totalCount.get() === 2, '2 extensions');
  check(extensions.totalMessageTypes.get() === 8, '3+5 = 8 message types');
  check(extensions.store.get().error === null, 'no error after set');

  // Select namespace
  extensions.selectNamespace('games');
  check(extensions.store.get().selectedNamespace === 'games', 'games selected');

  // Set detail
  const detail = {
    namespace: 'games', name: 'Games Extension', version: '1.0.0',
    description: 'Board games', author: 'bastion',
    messageTypes: [
      { name: 'move', description: 'A game move', safety: 'passthrough', direction: 'bidirectional' },
    ],
    dependencies: [],
    uiComponents: [{ id: 'board', name: 'Game Board', placement: 'main', size: 'medium' }],
    conversationRenderers: [{ messageType: 'games:move', style: 'compact' }],
  };
  extensions.setSelectedDetail(detail);
  check(extensions.store.get().selectedDetail !== null, 'detail set');
  check(extensions.store.get().selectedDetail.messageTypes.length === 1, '1 message type in detail');
  check(extensions.store.get().selectedDetail.uiComponents.length === 1, '1 UI component');
  check(extensions.store.get().selectedDetail.conversationRenderers.length === 1, '1 renderer');

  // Deselect clears detail
  extensions.selectNamespace(null);
  check(extensions.store.get().selectedNamespace === null, 'deselected');
  check(extensions.store.get().selectedDetail === null, 'detail cleared');

  // Loading states
  extensions.setLoading(true);
  check(extensions.store.get().loading === true, 'loading set');
  extensions.setDetailLoading(true);
  check(extensions.store.get().detailLoading === true, 'detail loading set');

  // Error
  extensions.setError('fetch failed');
  check(extensions.store.get().error === 'fetch failed', 'error set');

  // Reset
  extensions.reset();
  check(extensions.totalCount.get() === 0, 'reset clears all');
  check(extensions.store.get().selectedNamespace === null, 'reset clears selection');
});

// ---------------------------------------------------------------------------
// Test 27: Tools store
// ---------------------------------------------------------------------------
await group('Tools store: state management and derived values', async () => {
  const tools = createToolsStore();
  const state = tools.store.get();

  check(state.providers.length === 0, 'initially empty');
  check(state.totalTools === 0, 'totalTools = 0');
  check(state.message === '', 'no message');
  check(tools.providerCount.get() === 0, 'providerCount = 0');
  check(tools.dangerousToolCount.get() === 0, 'dangerousToolCount = 0');

  const response = {
    providers: [
      {
        id: 'mcp-local', name: 'Local MCP', endpoint: 'ws://localhost:3001',
        authType: 'no_auth',
        tools: [
          { name: 'read_file', description: 'Read a file', source: 'mcp', category: 'read', dangerous: false, trustLevel: 'trusted' },
          { name: 'delete_file', description: 'Delete a file', source: 'mcp', category: 'destructive', dangerous: true, trustLevel: 'untrusted' },
        ],
      },
    ],
    totalTools: 2,
    message: 'Tool registry configured via tools.json',
  };

  tools.setToolsResponse(response);
  check(tools.providerCount.get() === 1, '1 provider');
  check(tools.store.get().totalTools === 2, '2 tools');
  check(tools.dangerousToolCount.get() === 1, '1 dangerous tool');
  check(tools.store.get().message === 'Tool registry configured via tools.json', 'message set');
  check(tools.store.get().error === null, 'no error');

  // Loading
  tools.setLoading(true);
  check(tools.store.get().loading === true, 'loading set');

  // Error
  tools.setError('connection refused');
  check(tools.store.get().error === 'connection refused', 'error set');

  // Reset
  tools.reset();
  check(tools.providerCount.get() === 0, 'reset clears providers');
  check(tools.store.get().totalTools === 0, 'reset clears totalTools');
});

// ---------------------------------------------------------------------------
// Test 28: API client — extensions and tools endpoints
// ---------------------------------------------------------------------------
await group('API client: extensions and tools endpoint URLs', async () => {
  const requests = [];
  const mockFetch = async (url, opts) => {
    requests.push({ url, opts });
    return {
      ok: true,
      status: 200,
      json: async () => ({ extensions: [], totalCount: 0 }),
    };
  };

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'secret', totpCode: '123456' },
    fetchImpl: mockFetch,
  });

  await client.listExtensions();
  check(requests[0].url === 'https://127.0.0.1:9444/api/extensions', 'listExtensions URL');
  check(requests[0].opts.method === 'GET', 'listExtensions GET');

  await client.getExtension('games');
  check(requests[1].url === 'https://127.0.0.1:9444/api/extensions/games', 'getExtension URL');
  check(requests[1].opts.method === 'GET', 'getExtension GET');

  // Namespace with special characters
  await client.getExtension('my/ext');
  check(requests[2].url === 'https://127.0.0.1:9444/api/extensions/my%2Fext', 'getExtension encodes namespace');

  await client.listTools();
  check(requests[3].url === 'https://127.0.0.1:9444/api/tools', 'listTools URL');
  check(requests[3].opts.method === 'GET', 'listTools GET');
});

// ---------------------------------------------------------------------------
// Test 29: DataService — fetchExtensions populates store
// ---------------------------------------------------------------------------
await group('DataService: fetchExtensions populates extensions store', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/api/extensions') && !url.includes('/api/extensions/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          extensions: [
            { namespace: 'games', name: 'Games', version: '1.0.0', description: 'Games ext', author: 'bastion', messageTypeCount: 4 },
            { namespace: 'tools', name: 'Tools', version: '0.5.0', description: 'MCP tools', author: 'community', messageTypeCount: 2 },
          ],
          totalCount: 2,
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: mockFetch,
  });

  const service = new DataService({ client });
  const extensions = createExtensionsStore();

  await service.fetchExtensions(extensions);
  check(extensions.totalCount.get() === 2, '2 extensions populated');
  check(extensions.totalMessageTypes.get() === 6, '4+2 = 6 message types');
  check(extensions.store.get().loading === false, 'loading cleared');
  check(extensions.store.get().error === null, 'no error');

  service.destroy();
});

// ---------------------------------------------------------------------------
// Test 30: DataService — fetchExtensionDetail populates detail
// ---------------------------------------------------------------------------
await group('DataService: fetchExtensionDetail populates detail', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/api/extensions/games')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          namespace: 'games',
          name: 'Games Extension',
          version: '1.0.0',
          description: 'Board games',
          author: 'bastion',
          messageTypes: [
            { name: 'move', description: 'Game move', safety: 'passthrough', direction: 'bidirectional' },
            { name: 'state', description: 'Game state', safety: 'task' },
          ],
          dependencies: ['core'],
          ui: {
            pages: [{
              id: 'game-page',
              name: 'Game',
              icon: 'gamepad',
              components: [
                { id: 'board', name: 'Board', file: 'board.js', description: 'Game board', function: 'render', messageTypes: ['games:move'], size: 'large', placement: 'main', dangerous: false, audit: {} },
              ],
            }],
          },
          conversationRenderers: {
            'games:move': { html: '<div>move</div>', style: 'compact' },
            'games:state': { html: '<div>state</div>', style: 'full' },
          },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: mockFetch,
  });

  const service = new DataService({ client });
  const extensions = createExtensionsStore();

  await service.fetchExtensionDetail(extensions, 'games');
  const detail = extensions.store.get().selectedDetail;
  check(detail !== null, 'detail populated');
  check(detail.namespace === 'games', 'correct namespace');
  check(detail.messageTypes.length === 2, '2 message types');
  check(detail.messageTypes[0].name === 'move', 'first message type = move');
  check(detail.messageTypes[0].safety === 'passthrough', 'move safety = passthrough');
  check(detail.messageTypes[1].direction === undefined, 'state has no direction');
  check(detail.uiComponents.length === 1, '1 UI component');
  check(detail.uiComponents[0].name === 'Board', 'component name = Board');
  check(detail.uiComponents[0].placement === 'main', 'placement = main');
  check(detail.conversationRenderers.length === 2, '2 renderers');
  check(detail.conversationRenderers[0].messageType === 'games:move', 'renderer for games:move');
  check(detail.dependencies.length === 1, '1 dependency');
  check(detail.dependencies[0] === 'core', 'dependency = core');
  check(extensions.store.get().detailLoading === false, 'detail loading cleared');

  service.destroy();
});

// ---------------------------------------------------------------------------
// Test 31: DataService — fetchTools populates store
// ---------------------------------------------------------------------------
await group('DataService: fetchTools populates tools store', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/api/tools')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          providers: [],
          totalTools: 0,
          message: 'Tool registry configured via tools.json',
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: mockFetch,
  });

  const service = new DataService({ client });
  const tools = createToolsStore();

  await service.fetchTools(tools);
  check(tools.providerCount.get() === 0, 'no providers');
  check(tools.store.get().totalTools === 0, '0 tools');
  check(tools.store.get().message === 'Tool registry configured via tools.json', 'message populated');
  check(tools.store.get().loading === false, 'loading cleared');
  check(tools.store.get().error === null, 'no error');

  service.destroy();
});

// ---------------------------------------------------------------------------
// Test 32: DataService — fetchExtensions error handling
// ---------------------------------------------------------------------------
await group('DataService: fetchExtensions error surfaces in store', async () => {
  const failFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: 'Extension registry unavailable' }),
  });

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: failFetch,
  });

  const service = new DataService({ client });
  const extensions = createExtensionsStore();

  await service.fetchExtensions(extensions);
  check(extensions.store.get().error !== null, 'error set on failure');
  check(extensions.store.get().error.includes('Extension registry unavailable'), 'error message propagated');
  check(extensions.store.get().loading === false, 'loading cleared on error');

  service.destroy();
});

// ---------------------------------------------------------------------------
// Test 33: DataService — fetchTools error handling
// ---------------------------------------------------------------------------
await group('DataService: fetchTools error surfaces in store', async () => {
  const failFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: 'Tool registry error' }),
  });

  const client = new AdminApiClient({
    baseUrl: 'https://127.0.0.1:9444',
    credentials: { username: 'admin', password: 'pass', totpCode: '123456' },
    fetchImpl: failFetch,
  });

  const service = new DataService({ client });
  const tools = createToolsStore();

  await service.fetchTools(tools);
  check(tools.store.get().error !== null, 'error set on failure');
  check(tools.store.get().error.includes('Tool registry error'), 'error message propagated');
  check(tools.store.get().loading === false, 'loading cleared on error');

  service.destroy();
});

// ---------------------------------------------------------------------------
// Test 34: Extensions store — setExtensions clears error
// ---------------------------------------------------------------------------
await group('Extensions store: setExtensions clears prior error', async () => {
  const extensions = createExtensionsStore();

  extensions.setError('previous error');
  check(extensions.store.get().error === 'previous error', 'error set');

  extensions.setExtensions([
    { namespace: 'test', name: 'Test', version: '1.0.0', description: 'Test', author: 'test', messageTypeCount: 1 },
  ]);
  check(extensions.store.get().error === null, 'error cleared on setExtensions');
  check(extensions.totalCount.get() === 1, '1 extension');
});

// ---------------------------------------------------------------------------
// Test 35: Tools store — setToolsResponse clears error
// ---------------------------------------------------------------------------
await group('Tools store: setToolsResponse clears prior error', async () => {
  const tools = createToolsStore();

  tools.setError('previous error');
  check(tools.store.get().error === 'previous error', 'error set');

  tools.setToolsResponse({ providers: [], totalTools: 0, message: 'ok' });
  check(tools.store.get().error === null, 'error cleared on setToolsResponse');
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
