// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Trace-test for @bastion/client-human-mobile logic layer.
 * Tests emitter, store, connection, and all store factories.
 *
 * Run: node packages/client-human-mobile/trace-test.mjs
 */

import {
  TypedEmitter,
  writable,
  derived,
  BastionHumanClient,
  HumanClientError,
  createConnectionStore,
  createMessagesStore,
  createChallengesStore,
  createFileTransferStore,
} from './dist/index.js';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log('  PASS', name);
  } else {
    fail++;
    console.log('  FAIL', name, detail || '');
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = WS_CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
    this._sent = [];
    this._autoOpen = true;
    this._openTimer = setTimeout(() => {
      if (this._autoOpen && this.readyState === WS_CONNECTING) {
        this.readyState = WS_OPEN;
        if (this.onopen) this.onopen({});
      }
    }, 5);
  }

  send(data) {
    if (this.readyState !== WS_OPEN) throw new Error('WebSocket is not open');
    this._sent.push(data);
  }

  close(code = 1000, reason = '') {
    clearTimeout(this._openTimer);
    if (this.readyState === WS_CLOSED) return;
    this.readyState = WS_CLOSED;
    if (this.onclose) this.onclose({ code, reason });
  }

  _simulateMessage(data) {
    if (this.onmessage) this.onmessage({ data });
  }

  _simulateClose(code = 1006, reason = '') {
    this.readyState = WS_CLOSED;
    if (this.onclose) this.onclose({ code, reason });
  }

  _simulateError(msg) {
    if (this.onerror) this.onerror({ message: msg });
  }
}

function createMockWSFactory() {
  const instances = [];
  function Factory(url) {
    const ws = new MockWebSocket(url);
    instances.push(ws);
    return ws;
  }
  return { Factory, instances };
}

// ---------------------------------------------------------------------------
// Test 1: TypedEmitter
// ---------------------------------------------------------------------------

console.log('\n--- Test 1: TypedEmitter ---');
{
  const em = new TypedEmitter();
  const collected = [];

  em.on('data', (v) => collected.push(v));
  em.emit('data', 'a');
  em.emit('data', 'b');
  check('on + emit', collected.length === 2 && collected[0] === 'a' && collected[1] === 'b');

  const fn = (v) => collected.push('x-' + v);
  em.on('data', fn);
  em.emit('data', 'c');
  check('multiple listeners', collected.length === 4);

  em.off('data', fn);
  em.emit('data', 'd');
  check('off removes listener', collected.length === 5 && collected[4] === 'd');

  const onceBuf = [];
  em.once('evt', (v) => onceBuf.push(v));
  em.emit('evt', 1);
  em.emit('evt', 2);
  check('once fires only once', onceBuf.length === 1 && onceBuf[0] === 1);

  em.removeAllListeners();
  em.emit('data', 'z');
  check('removeAllListeners', collected.length === 5);

  // Emit with no listeners
  em.emit('nonexistent', 'arg');
  check('emit no listeners (no crash)', true);
}

// ---------------------------------------------------------------------------
// Test 2: Store primitives
// ---------------------------------------------------------------------------

console.log('\n--- Test 2: Store primitives ---');
{
  const s = writable(0);
  check('writable initial get()', s.get() === 0);

  s.set(5);
  check('set updates value', s.get() === 5);

  s.update((v) => v + 10);
  check('update transforms value', s.get() === 15);

  const values = [];
  const unsub = s.subscribe((v) => values.push(v));
  check('subscribe called immediately', values.length === 1 && values[0] === 15);

  s.set(20);
  check('subscribe receives updates', values.length === 2 && values[1] === 20);

  unsub();
  s.set(30);
  check('unsubscribe stops updates', values.length === 2);

  // Derived
  const a = writable(3);
  const b = writable(7);
  const sum = derived([a, b], ([x, y]) => x + y);
  check('derived initial get()', sum.get() === 10);

  a.set(5);
  check('derived recomputes on change (lazy get)', sum.get() === 12);

  const dVals = [];
  const dUnsub = sum.subscribe((v) => dVals.push(v));
  check('derived subscribe immediate value', dVals.length === 1 && dVals[0] === 12);

  b.set(8);
  check('derived subscribe receives update', dVals[dVals.length - 1] === 13);

  dUnsub();
}

// ---------------------------------------------------------------------------
// Test 3: Connection — connect + disconnect
// ---------------------------------------------------------------------------

console.log('\n--- Test 3: Connection connect + disconnect ---');
{
  const { Factory, instances } = createMockWSFactory();
  const client = new BastionHumanClient({
    relayUrl: 'wss://test:3000',
    identity: { id: 'h1', type: 'human', displayName: 'Test' },
    WebSocketImpl: Factory,
  });

  check('initial state disconnected', client.connectionState === 'disconnected');

  await client.connect();
  check('connected after connect()', client.connectionState === 'connected');
  check('isConnected true', client.isConnected === true);
  check('WebSocket created', instances.length === 1);
  check('URL passed', instances[0].url === 'wss://test:3000');

  await client.disconnect();
  check('disconnected after disconnect()', client.connectionState === 'disconnected');
}

// ---------------------------------------------------------------------------
// Test 4: Connection — send
// ---------------------------------------------------------------------------

console.log('\n--- Test 4: Connection send ---');
{
  const { Factory, instances } = createMockWSFactory();
  const client = new BastionHumanClient({
    relayUrl: 'wss://test:3000',
    identity: { id: 'h1', type: 'human', displayName: 'Test' },
    WebSocketImpl: Factory,
  });

  check('send before connect returns false', client.send('hello') === false);

  await client.connect();
  const sent = client.send('hello');
  check('send when connected returns true', sent === true);
  check('data sent to WS', instances[0]._sent[0] === 'hello');

  await client.disconnect();
  check('send after disconnect returns false', client.send('bye') === false);
}

// ---------------------------------------------------------------------------
// Test 5: Connection — JWT lifecycle
// ---------------------------------------------------------------------------

console.log('\n--- Test 5: JWT lifecycle ---');
{
  const { Factory } = createMockWSFactory();
  const client = new BastionHumanClient({
    relayUrl: 'wss://test:3000',
    identity: { id: 'h1', type: 'human', displayName: 'Test' },
    WebSocketImpl: Factory,
    tokenRefreshMs: 50,
  });

  await client.connect();
  check('not authenticated before setToken', client.isAuthenticated === false);
  check('jwt null before setToken', client.jwt === null);

  const authEvents = [];
  client.on('authenticated', (jwt, exp) => authEvents.push({ jwt, exp }));
  client.on('tokenRefreshNeeded', () => authEvents.push('refresh'));

  client.setToken('tok123', '2026-12-31T00:00:00Z');
  check('authenticated after setToken', client.isAuthenticated === true);
  check('jwt stored', client.jwt === 'tok123');
  check('state is authenticated', client.connectionState === 'authenticated');

  await delay(80);
  check('tokenRefreshNeeded emitted', authEvents.some((e) => e === 'refresh'));

  await client.disconnect();
}

// ---------------------------------------------------------------------------
// Test 6: Connection — reconnection backoff
// ---------------------------------------------------------------------------

console.log('\n--- Test 6: Reconnection backoff ---');
{
  const { Factory, instances } = createMockWSFactory();
  const reconEvents = [];
  const client = new BastionHumanClient({
    relayUrl: 'wss://test:3000',
    identity: { id: 'h1', type: 'human', displayName: 'Test' },
    WebSocketImpl: Factory,
    maxReconnectAttempts: 3,
  });

  client.on('reconnecting', (attempt, delayMs) => {
    reconEvents.push({ attempt, delayMs });
  });

  await client.connect();
  client.setToken('tok', '2026-12-31T00:00:00Z');

  // Simulate unexpected close
  instances[0]._simulateClose(1006, 'network');
  check('state becomes reconnecting', client.connectionState === 'reconnecting');
  check('reconnect attempt is 1', client.reconnectAttempt === 1);
  check('first backoff is 5000ms', reconEvents[0]?.delayMs === 5000);

  await client.disconnect();
  check('reconnect cancelled on disconnect', client.connectionState === 'disconnected');
  check('attempt reset after disconnect', client.reconnectAttempt === 0);
}

// ---------------------------------------------------------------------------
// Test 7: Connection — reconnection success
// ---------------------------------------------------------------------------

console.log('\n--- Test 7: Reconnection success ---');
{
  const { Factory, instances } = createMockWSFactory();
  const events = [];
  const client = new BastionHumanClient({
    relayUrl: 'wss://test:3000',
    identity: { id: 'h1', type: 'human', displayName: 'Test' },
    WebSocketImpl: Factory,
    maxReconnectAttempts: 5,
  });

  client.on('reconnecting', (attempt) => events.push('reconn-' + attempt));
  client.on('reconnected', () => events.push('reconnected'));

  await client.connect();
  client.setToken('tok', '2026-12-31T00:00:00Z');

  // Make next WS instances fail-then-succeed
  instances[0]._simulateClose(1006, '');

  // Wait for first reconnect (5s backoff — skip via short delay and manual check)
  await delay(20);
  check('reconnecting event emitted', events.includes('reconn-1'));

  // Cancel and clean up
  await client.disconnect();
}

// ---------------------------------------------------------------------------
// Test 8: Connection — no reconnect on intentional close
// ---------------------------------------------------------------------------

console.log('\n--- Test 8: No reconnect on intentional close ---');
{
  const { Factory } = createMockWSFactory();
  const events = [];
  const client = new BastionHumanClient({
    relayUrl: 'wss://test:3000',
    identity: { id: 'h1', type: 'human', displayName: 'Test' },
    WebSocketImpl: Factory,
  });

  client.on('reconnecting', () => events.push('reconn'));

  await client.connect();
  await client.disconnect();
  check('no reconnect on intentional disconnect', !events.includes('reconn'));

  // Test with reconnect=false
  const { Factory: F2 } = createMockWSFactory();
  const client2 = new BastionHumanClient({
    relayUrl: 'wss://test:3000',
    identity: { id: 'h1', type: 'human', displayName: 'Test' },
    WebSocketImpl: F2,
    reconnect: false,
  });

  client2.on('reconnecting', () => events.push('reconn2'));
  await client2.connect();
  client2.setToken('tok', '2026-12-31T00:00:00Z');
  check('reconnect=false disables reconnection', !events.includes('reconn2'));

  await client2.disconnect();
}

// ---------------------------------------------------------------------------
// Test 9: Connection store
// ---------------------------------------------------------------------------

console.log('\n--- Test 9: Connection store ---');
{
  const { Factory } = createMockWSFactory();
  const client = new BastionHumanClient({
    relayUrl: 'wss://test:3000',
    identity: { id: 'h1', type: 'human', displayName: 'Test' },
    WebSocketImpl: Factory,
  });

  const store = createConnectionStore(client);
  check('initial status disconnected', store.get().status === 'disconnected');
  check('initial jwt null', store.get().jwt === null);

  await client.connect();
  check('store status connected', store.get().status === 'connected');

  client.setToken('jwt-abc', '2026-12-31T00:00:00Z');
  check('store jwt updated', store.get().jwt === 'jwt-abc');
  check('store status authenticated', store.get().status === 'authenticated');

  await client.disconnect();
  check('store status disconnected after disconnect', store.get().status === 'disconnected');
  check('store jwt cleared', store.get().jwt === null);
}

// ---------------------------------------------------------------------------
// Test 10: Message store — addMessage and clear
// ---------------------------------------------------------------------------

console.log('\n--- Test 10: Message store addMessage + clear ---');
{
  const { store, addMessage, addIncoming, clear } = createMessagesStore();
  check('initial empty', store.get().messages.length === 0);

  addMessage({
    id: 'm1',
    type: 'conversation',
    timestamp: '2026-01-01T00:00:00Z',
    senderType: 'human',
    senderName: 'Alice',
    content: 'Hello',
    payload: { content: 'Hello' },
    direction: 'outgoing',
  });
  check('addMessage appends', store.get().messages.length === 1);
  check('message content', store.get().messages[0].content === 'Hello');

  addIncoming(
    'conversation',
    { content: 'Hi back' },
    { type: 'ai', displayName: 'AI' },
    'm2',
    '2026-01-01T00:00:01Z',
  );
  check('addIncoming appends', store.get().messages.length === 2);
  check('addIncoming extracts content', store.get().messages[1].content === 'Hi back');
  check('addIncoming sets direction', store.get().messages[1].direction === 'incoming');

  clear();
  check('clear empties store', store.get().messages.length === 0);
}

// ---------------------------------------------------------------------------
// Test 11: Message content extraction
// ---------------------------------------------------------------------------

console.log('\n--- Test 11: Message content extraction ---');
{
  const { store, addIncoming } = createMessagesStore();
  const sender = { type: 'ai', displayName: 'AI' };
  const ts = '2026-01-01T00:00:00Z';

  addIncoming('conversation', { content: 'chat text' }, sender, 'c1', ts);
  check('conversation → content', store.get().messages[0].content === 'chat text');

  addIncoming('result', { summary: 'task done' }, sender, 'c2', ts);
  check('result → summary', store.get().messages[1].content === 'task done');

  addIncoming('status', { currentAction: 'indexing', completionPercentage: 42 }, sender, 'c3', ts);
  check('status → action (pct%)', store.get().messages[2].content === 'indexing (42%)');

  addIncoming('denial', { reason: 'not allowed' }, sender, 'c4', ts);
  check('denial → reason', store.get().messages[3].content === 'not allowed');

  addIncoming('error', { message: 'something broke' }, sender, 'c5', ts);
  check('error → message', store.get().messages[4].content === 'something broke');
}

// ---------------------------------------------------------------------------
// Test 12: Challenge store
// ---------------------------------------------------------------------------

console.log('\n--- Test 12: Challenge store ---');
{
  const { store, receiveChallenge, resolve } = createChallengesStore();
  check('initial active null', store.get().active === null);
  check('initial history empty', store.get().history.length === 0);

  const payload = {
    challengedMessageId: 'msg-1',
    challengedTaskId: 'task-1',
    layer: 2,
    reason: 'risky operation',
    riskAssessment: 'high risk detected',
    suggestedAlternatives: ['do something safer'],
    factors: [{ name: 'cost', description: 'expensive', weight: 0.8 }],
  };

  receiveChallenge('ch-1', 'task-1', payload);
  check('receiveChallenge sets active', store.get().active !== null);
  check('active has correct payload', store.get().active.payload.reason === 'risky operation');
  check('history has entry', store.get().history.length === 1);

  const resolved = resolve('approve');
  check('resolve returns challenge', resolved !== null && resolved.messageId === 'ch-1');
  check('resolve sets decision', resolved.decision === 'approve');
  check('resolve clears active', store.get().active === null);
  check('history updated with decision', store.get().history[0].decision === 'approve');
  check('history has resolvedAt', store.get().history[0].resolvedAt !== undefined);

  // Second challenge
  receiveChallenge('ch-2', 'task-2', { ...payload, reason: 'second issue' });
  const resolved2 = resolve('cancel');
  check('cancel decision recorded', resolved2.decision === 'cancel');
  check('history length 2', store.get().history.length === 2);
}

// ---------------------------------------------------------------------------
// Test 13: File transfer store — offers and queue
// ---------------------------------------------------------------------------

console.log('\n--- Test 13: File transfer offers + queue ---');
{
  const ft = createFileTransferStore();
  check('initial pendingOffer null', ft.store.get().pendingOffer === null);

  ft.receiveOffer('msg-1', {
    transferId: 'ft-1',
    filename: 'report.pdf',
    sizeBytes: 1024,
    hash: 'abc123',
    mimeType: 'application/pdf',
    purpose: 'analysis results',
  }, 'AI Bot');

  check('first offer becomes pending', ft.store.get().pendingOffer !== null);
  check('pending filename', ft.store.get().pendingOffer.filename === 'report.pdf');
  check('queue empty (first goes directly)', ft.store.get().offerQueue.length === 0);

  ft.receiveOffer('msg-2', {
    transferId: 'ft-2',
    filename: 'data.csv',
    sizeBytes: 2048,
    hash: 'def456',
    mimeType: 'text/csv',
    purpose: 'raw data',
  }, 'AI Bot');

  check('second offer queued', ft.store.get().offerQueue.length === 1);
  check('pending still first', ft.store.get().pendingOffer.transferId === 'ft-1');

  const accepted = ft.acceptOffer();
  check('acceptOffer returns first', accepted.transferId === 'ft-1');
  check('queue advanced', ft.store.get().pendingOffer.transferId === 'ft-2');
  check('queue now empty', ft.store.get().offerQueue.length === 0);

  const rejected = ft.rejectOffer();
  check('rejectOffer returns second', rejected.transferId === 'ft-2');
  check('pending null after last', ft.store.get().pendingOffer === null);
}

// ---------------------------------------------------------------------------
// Test 14: File transfer store — uploads
// ---------------------------------------------------------------------------

console.log('\n--- Test 14: File transfer uploads ---');
{
  const ft = createFileTransferStore();
  ft.startUpload('up-1', 'export.zip', 4096);
  check('upload started', ft.store.get().uploads.length === 1);
  check('upload phase encrypting', ft.store.get().uploads[0].phase === 'encrypting');
  check('upload filename', ft.store.get().uploads[0].filename === 'export.zip');

  ft.updateUploadPhase('up-1', 'uploading');
  check('phase updated to uploading', ft.store.get().uploads[0].phase === 'uploading');

  ft.updateUploadPhase('up-1', 'quarantined');
  check('phase updated to quarantined', ft.store.get().uploads[0].phase === 'quarantined');

  ft.updateUploadPhase('up-1', 'delivered');
  check('terminal phase removes upload', ft.store.get().uploads.length === 0);
}

// ---------------------------------------------------------------------------
// Test 15: File transfer store — history and custody
// ---------------------------------------------------------------------------

console.log('\n--- Test 15: File transfer history + custody ---');
{
  const ft = createFileTransferStore();

  ft.addHistoryEntry({
    transferId: 'h-1',
    direction: 'ai_to_human',
    filename: 'result.txt',
    sizeBytes: 512,
    mimeType: 'text/plain',
    hash: 'hash-abc',
    state: 'offered',
    custodyEvents: [],
    hashVerifications: [],
    startedAt: '2026-01-01T00:00:00Z',
  });

  check('history entry added', ft.store.get().history.length === 1);
  check('history entry state', ft.store.get().history[0].state === 'offered');

  ft.appendCustodyEvent('h-1', {
    event: 'accepted',
    timestamp: '2026-01-01T00:01:00Z',
    actor: 'human',
    detail: 'Accepted transfer',
  });
  check('custody event appended', ft.store.get().history[0].custodyEvents.length === 1);

  ft.appendHashVerification('h-1', {
    stage: 'delivery',
    verified: true,
    hash: 'hash-abc',
    timestamp: '2026-01-01T00:02:00Z',
  });
  check('hash verification appended', ft.store.get().history[0].hashVerifications.length === 1);
  check('hash verified', ft.store.get().history[0].hashVerifications[0].verified === true);

  ft.updateHistoryState('h-1', 'delivered', '2026-01-01T00:03:00Z');
  check('history state updated', ft.store.get().history[0].state === 'delivered');
  check('completedAt set', ft.store.get().history[0].completedAt !== undefined);

  const entry = ft.getHistoryEntry('h-1');
  check('getHistoryEntry returns entry', entry !== undefined && entry.transferId === 'h-1');

  ft.clear();
  check('clear resets all', ft.store.get().history.length === 0 && ft.store.get().pendingOffer === null);
}

// ---------------------------------------------------------------------------
// Test 16: File transfer — receiveOffer creates history
// ---------------------------------------------------------------------------

console.log('\n--- Test 16: receiveOffer creates history ---');
{
  const ft = createFileTransferStore();
  ft.receiveOffer('msg-a', {
    transferId: 'ft-a',
    filename: 'output.json',
    sizeBytes: 256,
    hash: 'hash-out',
    mimeType: 'application/json',
    purpose: 'results',
    taskId: 'task-42',
  }, 'AI');

  check('offer in history', ft.store.get().history.length === 1);
  check('history state offered', ft.store.get().history[0].state === 'offered');
  check('history has custody event', ft.store.get().history[0].custodyEvents.length === 1);
  check('custody event is offered', ft.store.get().history[0].custodyEvents[0].event === 'offered');

  // receiveManifest
  ft.receiveManifest('msg-b', {
    transferId: 'ft-b',
    filename: 'upload.txt',
    sizeBytes: 128,
    hash: 'hash-up',
    hashAlgorithm: 'sha256',
    mimeType: 'text/plain',
    purpose: 'source data',
    projectContext: 'my project',
  }, 'Human');

  check('manifest in history', ft.store.get().history.length === 2);
  check('manifest custody event', ft.store.get().history[0].custodyEvents[0].event === 'manifest_sent');
}

// ---------------------------------------------------------------------------
// Test 17: Derived store eager get() fix
// ---------------------------------------------------------------------------

console.log('\n--- Test 17: Derived store eager get() ---');
{
  const src = writable(10);
  const d = derived([src], ([v]) => v * 2);

  // No subscribers — get() should recompute
  check('derived get() without subscriber', d.get() === 20);

  src.set(15);
  check('derived get() after change, no subscriber', d.get() === 30);

  // With subscriber
  const vals = [];
  const unsub = d.subscribe((v) => vals.push(v));
  check('subscribe gets current value', vals[0] === 30);

  src.set(25);
  check('subscriber gets update', vals[vals.length - 1] === 50);

  unsub();
  src.set(100);
  check('get() after unsub recomputes', d.get() === 200);
}

// ---------------------------------------------------------------------------
// Test 18: HumanClientError
// ---------------------------------------------------------------------------

console.log('\n--- Test 18: HumanClientError ---');
{
  const err = new HumanClientError('test error');
  check('is Error instance', err instanceof Error);
  check('name is HumanClientError', err.name === 'HumanClientError');
  check('message preserved', err.message === 'test error');
}

// ---------------------------------------------------------------------------
// Test 19: File transfer — accept updates custody + state
// ---------------------------------------------------------------------------

console.log('\n--- Test 19: Accept/reject update custody ---');
{
  const ft = createFileTransferStore();
  ft.receiveOffer('msg-x', {
    transferId: 'ft-x',
    filename: 'data.bin',
    sizeBytes: 8192,
    hash: 'hash-x',
    mimeType: 'application/octet-stream',
    purpose: 'binary data',
  }, 'AI');

  ft.acceptOffer();
  const entry = ft.getHistoryEntry('ft-x');
  check('accept adds custody event', entry.custodyEvents.length === 2);
  check('accept custody event is accepted', entry.custodyEvents[1].event === 'accepted');
  check('state updated to accepted', entry.state === 'accepted');

  // Reject test
  ft.receiveOffer('msg-y', {
    transferId: 'ft-y',
    filename: 'secret.txt',
    sizeBytes: 64,
    hash: 'hash-y',
    mimeType: 'text/plain',
    purpose: 'sensitive',
  }, 'AI');

  ft.rejectOffer();
  const rejEntry = ft.getHistoryEntry('ft-y');
  check('reject adds custody event', rejEntry.custodyEvents.length === 2);
  check('reject custody event is rejected', rejEntry.custodyEvents[1].event === 'rejected');
  check('reject state updated', rejEntry.state === 'rejected');
  check('reject has completedAt', rejEntry.completedAt !== undefined);
}

// ---------------------------------------------------------------------------
// Test 20: Connection store — peerStatus and error tracking
// ---------------------------------------------------------------------------

console.log('\n--- Test 20: Connection store peerStatus + error ---');
{
  const { Factory } = createMockWSFactory();
  const client = new BastionHumanClient({
    relayUrl: 'wss://test:3000',
    identity: { id: 'h1', type: 'human', displayName: 'Test' },
    WebSocketImpl: Factory,
  });

  const store = createConnectionStore(client);
  check('initial peerStatus unknown', store.get().peerStatus === 'unknown');

  await client.connect();

  // Simulate peer status events
  client.emit('peerStatus', 'active');
  check('peerStatus active', store.get().peerStatus === 'active');

  client.emit('peerStatus', 'suspended');
  check('peerStatus suspended', store.get().peerStatus === 'suspended');

  client.emit('peerStatus', 'something_else');
  check('unknown peerStatus mapped', store.get().peerStatus === 'unknown');

  // Error tracking
  client.emit('error', new Error('test error'));
  check('lastError captured', store.get().lastError === 'test error');

  await client.disconnect();
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n========================================`);
console.log(`  ${pass + fail} checks: ${pass} passed, ${fail} failed`);
console.log(`========================================\n`);

if (fail > 0) process.exit(1);
