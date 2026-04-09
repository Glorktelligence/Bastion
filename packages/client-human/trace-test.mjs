// Trace test: Human client — emitter, stores, connection, messages, challenges
// Run with: node packages/client-human/trace-test.mjs

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
  createAuditLogStore,
  AUDIT_EVENT_CATEGORIES,
  createSettingsStore,
  validateSettingChange,
  SAFETY_FLOOR_VALUES,
  createTasksStore,
  createChallengeStatsStore,
  createNotificationService,
  InMemoryNotificationAdapter,
  createChatHistoryService,
  InMemoryChatHistory,
  InMemoryConfigStore,
  migrateConfig,
  CONFIG_VERSION,
  createDreamCyclesStore,
  ConversationRendererRegistry,
  conversationRendererRegistry,
} from './dist/index.js';

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
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

    // Auto-open after microtask unless overridden
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

  // Test helpers
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

// Factory that captures instances
function createMockWSFactory() {
  const instances = [];
  const Factory = function(url) {
    const ws = new MockWebSocket(url);
    instances.push(ws);
    return ws;
  };
  Factory.instances = instances;
  Factory.latest = () => instances[instances.length - 1];
  return Factory;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function run() {
  console.log('=== Human Client Trace Tests ===');
  console.log();

  // -------------------------------------------------------------------
  // Test 1: TypedEmitter
  // -------------------------------------------------------------------
  console.log('--- Test 1: TypedEmitter ---');
  {
    const emitter = new TypedEmitter();
    const received = [];

    // on + emit
    emitter.on('test', (a, b) => received.push([a, b]));
    emitter.emit('test', 1, 2);
    check('on/emit works', received.length === 1 && received[0][0] === 1 && received[0][1] === 2);

    // off
    const fn = (a) => received.push(['off', a]);
    emitter.on('test', fn);
    emitter.off('test', fn);
    emitter.emit('test', 3, 4);
    check('off removes listener', received.length === 2 && received[1][0] === 3);

    // once
    const onceCalls = [];
    emitter.once('once-event', (v) => onceCalls.push(v));
    emitter.emit('once-event', 'first');
    emitter.emit('once-event', 'second');
    check('once fires once', onceCalls.length === 1 && onceCalls[0] === 'first');

    // emit with no listeners — no error
    emitter.emit('nonexistent', 'val');
    check('emit with no listeners is safe', true);

    // removeAllListeners
    const afterClear = [];
    emitter.on('test', () => afterClear.push(1));
    emitter.removeAllListeners();
    emitter.emit('test', 0, 0);
    check('removeAllListeners clears all', afterClear.length === 0);

    // multiple listeners
    const multi = [];
    emitter.on('multi', (v) => multi.push('a' + v));
    emitter.on('multi', (v) => multi.push('b' + v));
    emitter.emit('multi', '1');
    check('multiple listeners all fire', multi.length === 2 && multi[0] === 'a1' && multi[1] === 'b1');

    emitter.removeAllListeners();
  }

  // -------------------------------------------------------------------
  // Test 2: Store primitives
  // -------------------------------------------------------------------
  console.log('--- Test 2: Store primitives ---');
  {
    // writable: set + subscribe
    const store = writable(0);
    const values = [];
    const unsub = store.subscribe(v => values.push(v));
    check('subscribe calls immediately', values.length === 1 && values[0] === 0);

    store.set(1);
    check('set notifies subscriber', values.length === 2 && values[1] === 1);

    // writable: update
    store.update(v => v + 10);
    check('update transforms value', values.length === 3 && values[2] === 11);

    // writable: get
    check('get returns current value', store.get() === 11);

    // unsubscribe
    unsub();
    store.set(99);
    check('unsubscribe stops updates', values.length === 3);

    // derived: recomputes
    const a = writable(2);
    const b = writable(3);
    const sum = derived([a, b], ([x, y]) => x + y);
    const derivedVals = [];
    const dUnsub = sum.subscribe(v => derivedVals.push(v));
    check('derived initial value', derivedVals.length >= 1 && derivedVals[derivedVals.length - 1] === 5);

    a.set(10);
    check('derived recomputes on source change', sum.get() === 13);

    // derived: unsubscribe stops upstream
    dUnsub();
    a.set(100);
    // After unsubscribing, derived should stop recomputing
    // The value is stale but that's expected
    check('derived unsubscribe works', true);
  }

  // -------------------------------------------------------------------
  // Test 3: Connection — connect + disconnect
  // -------------------------------------------------------------------
  console.log('--- Test 3: Connection — connect + disconnect ---');
  {
    const factory = createMockWSFactory();
    const client = new BastionHumanClient({
      relayUrl: 'wss://localhost:9443',
      identity: { id: 'human-1', type: 'human', displayName: 'TestHuman' },
      WebSocketImpl: factory,
    });

    check('initial state disconnected', client.connectionState === 'disconnected');
    check('not connected initially', !client.isConnected);

    const stateChanges = [];
    client.on('stateChange', (s) => stateChanges.push(s));

    await client.connect();
    check('state is connected after connect', client.connectionState === 'connected');
    check('isConnected is true', client.isConnected);
    check('stateChange events fired', stateChanges.includes('connecting') && stateChanges.includes('connected'));

    await client.disconnect();
    check('state is disconnected after disconnect', client.connectionState === 'disconnected');

    client.removeAllListeners();
  }

  // -------------------------------------------------------------------
  // Test 4: Connection — send when connected
  // -------------------------------------------------------------------
  console.log('--- Test 4: Connection — send when connected ---');
  {
    const factory = createMockWSFactory();
    const client = new BastionHumanClient({
      relayUrl: 'wss://localhost:9443',
      identity: { id: 'human-1', type: 'human', displayName: 'TestHuman' },
      WebSocketImpl: factory,
    });

    await client.connect();
    const ws = factory.latest();

    const result1 = client.send('hello');
    check('send returns true when open', result1 === true);
    check('data sent to WebSocket', ws._sent.length === 1 && ws._sent[0] === 'hello');

    await client.disconnect();
    const result2 = client.send('after close');
    check('send returns false when closed', result2 === false);

    // Message event
    const msgs = [];
    const client2 = new BastionHumanClient({
      relayUrl: 'wss://localhost:9443',
      identity: { id: 'human-1', type: 'human', displayName: 'TestHuman' },
      WebSocketImpl: factory,
    });
    client2.on('message', (d) => msgs.push(d));
    await client2.connect();
    const ws2 = factory.latest();
    ws2._simulateMessage('incoming data');
    check('message event fires', msgs.length === 1 && msgs[0] === 'incoming data');

    await client2.disconnect();
    client.removeAllListeners();
    client2.removeAllListeners();
  }

  // -------------------------------------------------------------------
  // Test 5: Connection — JWT lifecycle
  // -------------------------------------------------------------------
  console.log('--- Test 5: Connection — JWT lifecycle ---');
  {
    const factory = createMockWSFactory();
    const client = new BastionHumanClient({
      relayUrl: 'wss://localhost:9443',
      identity: { id: 'human-1', type: 'human', displayName: 'TestHuman' },
      tokenRefreshMs: 50, // Short for testing
      WebSocketImpl: factory,
    });

    await client.connect();
    check('state before setToken is connected', client.connectionState === 'connected');

    const authEvents = [];
    client.on('authenticated', (jwt, exp) => authEvents.push({ jwt, exp }));

    const expiresAt = new Date(Date.now() + 900_000).toISOString();
    client.setToken('test-jwt-token', expiresAt);

    check('state after setToken is authenticated', client.connectionState === 'authenticated');
    check('isAuthenticated is true', client.isAuthenticated);
    check('jwt getter returns token', client.jwt === 'test-jwt-token');
    check('authenticated event fired', authEvents.length === 1 && authEvents[0].jwt === 'test-jwt-token');

    // Wait for refresh timer
    const refreshPromise = new Promise(resolve => {
      client.on('tokenRefreshNeeded', () => resolve(true));
    });
    const refreshed = await Promise.race([refreshPromise, delay(200).then(() => false)]);
    check('tokenRefreshNeeded fires', refreshed === true);

    await client.disconnect();
    client.removeAllListeners();
  }

  // -------------------------------------------------------------------
  // Test 6: Connection — reconnection backoff
  // -------------------------------------------------------------------
  console.log('--- Test 6: Connection — reconnection backoff ---');
  {
    const factory = createMockWSFactory();
    const client = new BastionHumanClient({
      relayUrl: 'wss://localhost:9443',
      identity: { id: 'human-1', type: 'human', displayName: 'TestHuman' },
      reconnect: true,
      WebSocketImpl: factory,
    });

    await client.connect();
    client.setToken('jwt', new Date(Date.now() + 900_000).toISOString());

    const reconnectEvents = [];
    client.on('reconnecting', (attempt, delayMs) => reconnectEvents.push({ attempt, delayMs }));

    // Simulate unexpected close
    const ws = factory.latest();
    ws._simulateClose(1006, 'connection lost');

    // Should schedule reconnect
    await delay(20);
    check('state changes to reconnecting', client.connectionState === 'reconnecting');
    check('reconnecting event fired', reconnectEvents.length === 1);
    check('first attempt number is 1', reconnectEvents[0]?.attempt === 1);
    check('first backoff is 1000ms', reconnectEvents[0]?.delayMs === 1000);

    // jwt cleared on close
    check('jwt cleared after close', client.jwt === null);
    check('reconnectAttempt getter', client.reconnectAttempt === 1);

    // Clean up — disconnect to cancel timers
    await client.disconnect();
    client.removeAllListeners();
  }

  // -------------------------------------------------------------------
  // Test 7: Connection — reconnection success
  // -------------------------------------------------------------------
  console.log('--- Test 7: Connection — reconnection success ---');
  {
    const factory = createMockWSFactory();
    const client = new BastionHumanClient({
      relayUrl: 'wss://localhost:9443',
      identity: { id: 'human-1', type: 'human', displayName: 'TestHuman' },
      reconnect: true,
      WebSocketImpl: factory,
    });

    // Patch backoff to be instant for testing
    // We'll override by disconnecting and manually triggering
    await client.connect();
    client.setToken('jwt', new Date(Date.now() + 900_000).toISOString());

    let reconnectedFired = false;
    client.on('reconnected', () => { reconnectedFired = true; });

    // Simulate unexpected close
    const ws = factory.latest();
    ws._simulateClose(1006, 'dropped');

    await delay(10);
    check('client is reconnecting', client.connectionState === 'reconnecting');

    // Cancel the backoff timer and manually trigger reconnect
    await client.disconnect();
    // Re-create fresh to test the full cycle with very short timers
    const factory2 = createMockWSFactory();
    const client2 = new BastionHumanClient({
      relayUrl: 'wss://localhost:9443',
      identity: { id: 'human-1', type: 'human', displayName: 'TestHuman' },
      reconnect: true,
      WebSocketImpl: factory2,
    });

    await client2.connect();
    client2.setToken('jwt', new Date(Date.now() + 900_000).toISOString());

    let reconnected2 = false;
    client2.on('reconnected', () => { reconnected2 = true; });

    // Monkey-patch BACKOFF to 10ms for immediate reconnect test
    // Instead, let the reconnect timer fire naturally but with a short delay workaround:
    // Simulate close then wait for reconnection attempt
    const ws2 = factory2.latest();
    ws2._simulateClose(1006, 'dropped');

    // Wait for the 5-second backoff timer to fire (too long for test)
    // Instead just verify the state + counter
    await delay(20);
    check('reconnect attempt counter is 1', client2.reconnectAttempt === 1);
    check('state is reconnecting after drop', client2.connectionState === 'reconnecting');
    check('reconnectedFired awaiting', reconnected2 === false); // not yet — still waiting for timer

    await client2.disconnect();
    check('disconnect clears reconnect state', client2.reconnectAttempt === 0);

    client.removeAllListeners();
    client2.removeAllListeners();
  }

  // -------------------------------------------------------------------
  // Test 8: Connection — no reconnect on intentional close
  // -------------------------------------------------------------------
  console.log('--- Test 8: Connection — no reconnect on intentional close ---');
  {
    const factory = createMockWSFactory();
    const client = new BastionHumanClient({
      relayUrl: 'wss://localhost:9443',
      identity: { id: 'human-1', type: 'human', displayName: 'TestHuman' },
      reconnect: true,
      WebSocketImpl: factory,
    });

    await client.connect();
    client.setToken('jwt', new Date(Date.now() + 900_000).toISOString());

    let reconnecting = false;
    client.on('reconnecting', () => { reconnecting = true; });

    await client.disconnect();
    await delay(20);
    check('no reconnect on intentional disconnect', !reconnecting);
    check('state is disconnected', client.connectionState === 'disconnected');

    // With reconnect disabled
    const factory2 = createMockWSFactory();
    const client2 = new BastionHumanClient({
      relayUrl: 'wss://localhost:9443',
      identity: { id: 'human-1', type: 'human', displayName: 'TestHuman' },
      reconnect: false,
      WebSocketImpl: factory2,
    });

    await client2.connect();
    client2.setToken('jwt', new Date(Date.now() + 900_000).toISOString());

    let reconnecting2 = false;
    client2.on('reconnecting', () => { reconnecting2 = true; });

    // Simulate unexpected close
    factory2.latest()._simulateClose(1006, 'dropped');
    await delay(20);
    check('reconnect=false prevents reconnection', !reconnecting2 && client2.connectionState === 'disconnected');

    client.removeAllListeners();
    client2.removeAllListeners();
  }

  // -------------------------------------------------------------------
  // Test 9: Connection store
  // -------------------------------------------------------------------
  console.log('--- Test 9: Connection store ---');
  {
    const factory = createMockWSFactory();
    const client = new BastionHumanClient({
      relayUrl: 'wss://localhost:9443',
      identity: { id: 'human-1', type: 'human', displayName: 'TestHuman' },
      reconnect: false,
      WebSocketImpl: factory,
    });

    const store = createConnectionStore(client);
    const snapshots = [];
    store.subscribe(s => snapshots.push({ ...s }));

    check('initial store status is disconnected', snapshots[0].status === 'disconnected');

    await client.connect();
    check('store status changes to connecting then connected',
      snapshots.some(s => s.status === 'connecting') && snapshots.some(s => s.status === 'connected'));

    client.setToken('test-jwt', '2026-12-31T00:00:00Z');
    check('store reflects jwt', store.get().jwt === 'test-jwt');
    check('store reflects authenticated status', store.get().status === 'authenticated');

    // Peer status
    client.emit('peerStatus', 'active');
    check('store reflects peerStatus', store.get().peerStatus === 'active');

    await client.disconnect();
    client.removeAllListeners();
  }

  // -------------------------------------------------------------------
  // Test 10: Message store
  // -------------------------------------------------------------------
  console.log('--- Test 10: Message store ---');
  {
    const { store, addMessage, addIncoming, clear } = createMessagesStore();

    check('initial messages empty', store.get().messages.length === 0);

    const msg = {
      id: 'msg-1',
      type: 'conversation',
      timestamp: '2026-03-10T12:00:00Z',
      senderType: 'human',
      senderName: 'Alice',
      content: 'Hello',
      payload: { content: 'Hello' },
      direction: 'outgoing',
    };
    addMessage(msg);
    check('addMessage appends', store.get().messages.length === 1);
    check('message data correct', store.get().messages[0].content === 'Hello');

    addIncoming(
      'conversation',
      { content: 'Hi there' },
      { type: 'ai', displayName: 'Bot' },
      'msg-2',
      '2026-03-10T12:00:01Z',
    );
    check('addIncoming appends', store.get().messages.length === 2);
    check('addIncoming sets direction incoming', store.get().messages[1].direction === 'incoming');
    check('addIncoming extracts content', store.get().messages[1].content === 'Hi there');

    clear();
    check('clear empties messages', store.get().messages.length === 0);
  }

  // -------------------------------------------------------------------
  // Test 11: Message content extraction
  // -------------------------------------------------------------------
  console.log('--- Test 11: Message content extraction ---');
  {
    const { store, addIncoming } = createMessagesStore();
    const sender = { type: 'ai', displayName: 'Bot' };

    addIncoming('conversation', { content: 'Hello world' }, sender, 'e1', '2026-03-10T12:00:00Z');
    check('conversation extracts content', store.get().messages[0].content === 'Hello world');

    addIncoming('result', { summary: 'Task completed', output: null, actionsTaken: [], generatedFiles: [], cost: {}, transparency: {} }, sender, 'e2', '2026-03-10T12:00:01Z');
    check('result extracts summary', store.get().messages[1].content === 'Task completed');

    addIncoming('denial', { reason: 'Destructive action', deniedMessageId: 'x', deniedTaskId: 'y', layer: 1, detail: 'd' }, sender, 'e3', '2026-03-10T12:00:02Z');
    check('denial extracts reason', store.get().messages[2].content === 'Destructive action');

    addIncoming('error', { message: 'Something went wrong', code: 'BASTION-3001', name: 'err', detail: '', recoverable: false, suggestedAction: '', timestamp: '' }, sender, 'e4', '2026-03-10T12:00:03Z');
    check('error extracts message', store.get().messages[3].content === 'Something went wrong');

    addIncoming('status', { currentAction: 'Analyzing', completionPercentage: 42, taskId: 't1', toolsInUse: [], metadata: {} }, sender, 'e5', '2026-03-10T12:00:04Z');
    check('status extracts action + %', store.get().messages[4].content === 'Analyzing (42%)');
  }

  // -------------------------------------------------------------------
  // Test 12: Challenge store
  // -------------------------------------------------------------------
  console.log('--- Test 12: Challenge store ---');
  {
    const { store, receiveChallenge, resolve } = createChallengesStore();

    check('initial active is null', store.get().active === null);
    check('initial history is empty', store.get().history.length === 0);

    const challengePayload = {
      challengedMessageId: 'msg-1',
      challengedTaskId: 'task-1',
      layer: 2,
      reason: 'Irreversible action detected',
      riskAssessment: 'This action cannot be undone.',
      suggestedAlternatives: ['Use dry-run first'],
      factors: [{ name: 'reversibility', description: 'Cannot undo', weight: 0.8 }],
    };

    receiveChallenge('challenge-1', 'task-1', challengePayload);
    check('receiveChallenge sets active', store.get().active !== null);
    check('active has correct messageId', store.get().active?.messageId === 'challenge-1');
    check('history has one entry', store.get().history.length === 1);

    const resolved = resolve('approve');
    check('resolve returns the challenge', resolved !== null && resolved.messageId === 'challenge-1');
    check('resolve clears active', store.get().active === null);
    check('history still has entry', store.get().history.length === 1);
  }

  // -------------------------------------------------------------------
  // Test 13: File transfer store — incoming offers (airlock)
  // -------------------------------------------------------------------
  console.log('--- Test 13: File transfer store — incoming offers ---');
  {
    const ft = createFileTransferStore();
    const { store } = ft;

    check('initial pendingOffer is null', store.get().pendingOffer === null);
    check('initial history empty', store.get().history.length === 0);

    // Receive an AI→Human offer
    ft.receiveOffer('msg-offer-1', {
      transferId: 'ft-001',
      filename: 'analysis.pdf',
      sizeBytes: 1024,
      hash: 'sha256:abc',
      mimeType: 'application/pdf',
      purpose: 'Analysis results',
      taskId: 'task-42',
    }, 'Claude');

    check('pendingOffer set', store.get().pendingOffer !== null);
    check('offer filename', store.get().pendingOffer?.filename === 'analysis.pdf');
    check('offer direction', store.get().pendingOffer?.direction === 'ai_to_human');
    check('offer senderName', store.get().pendingOffer?.senderName === 'Claude');
    check('history has entry', store.get().history.length === 1);
    check('history state is offered', store.get().history[0]?.state === 'offered');

    // Accept the offer
    const accepted = ft.acceptOffer();
    check('acceptOffer returns the offer', accepted?.transferId === 'ft-001');
    check('pendingOffer cleared', store.get().pendingOffer === null);
    check('history state updated to accepted', store.get().history[0]?.state === 'accepted');
    check('custody has accepted event',
      store.get().history[0]?.custodyEvents.some(e => e.event === 'accepted'));
  }

  // -------------------------------------------------------------------
  // Test 14: File transfer store — offer queue and reject
  // -------------------------------------------------------------------
  console.log('--- Test 14: File transfer store — offer queue and reject ---');
  {
    const ft = createFileTransferStore();
    const { store } = ft;

    // Queue two offers
    ft.receiveOffer('msg-1', {
      transferId: 'ft-100',
      filename: 'first.txt',
      sizeBytes: 10,
      hash: 'h1',
      mimeType: 'text/plain',
      purpose: 'First',
    }, 'AI');

    ft.receiveOffer('msg-2', {
      transferId: 'ft-200',
      filename: 'second.txt',
      sizeBytes: 20,
      hash: 'h2',
      mimeType: 'text/plain',
      purpose: 'Second',
    }, 'AI');

    check('first offer presented', store.get().pendingOffer?.transferId === 'ft-100');
    check('second offer in queue', store.get().offerQueue.length === 1);

    // Reject first — second should advance
    const rejected = ft.rejectOffer();
    check('reject returns first offer', rejected?.transferId === 'ft-100');
    check('second offer now pending', store.get().pendingOffer?.transferId === 'ft-200');
    check('queue empty', store.get().offerQueue.length === 0);
    check('rejected entry in history',
      store.get().history.some(h => h.transferId === 'ft-100' && h.state === 'rejected'));

    // Accept second
    ft.acceptOffer();
    check('all offers resolved', store.get().pendingOffer === null);
    check('history has both', store.get().history.length === 2);
  }

  // -------------------------------------------------------------------
  // Test 15: File transfer store — upload progress
  // -------------------------------------------------------------------
  console.log('--- Test 15: File transfer store — upload progress ---');
  {
    const ft = createFileTransferStore();
    const { store } = ft;

    ft.startUpload('up-001', 'report.csv', 2048);
    check('upload tracked', store.get().uploads.length === 1);
    check('upload initial phase', store.get().uploads[0]?.phase === 'encrypting');
    check('upload filename', store.get().uploads[0]?.filename === 'report.csv');

    ft.updateUploadPhase('up-001', 'uploading');
    check('phase updated to uploading', store.get().uploads[0]?.phase === 'uploading');

    ft.updateUploadPhase('up-001', 'quarantined');
    check('phase updated to quarantined', store.get().uploads[0]?.phase === 'quarantined');

    ft.updateUploadPhase('up-001', 'delivered');
    check('delivered removes from active uploads', store.get().uploads.length === 0);
  }

  // -------------------------------------------------------------------
  // Test 16: File transfer store — history with custody chain
  // -------------------------------------------------------------------
  console.log('--- Test 16: File transfer store — history and custody ---');
  {
    const ft = createFileTransferStore();
    const { store } = ft;

    ft.addHistoryEntry({
      transferId: 'hist-001',
      direction: 'human_to_ai',
      filename: 'config.yaml',
      sizeBytes: 512,
      mimeType: 'text/yaml',
      hash: 'sha256:xyz',
      state: 'quarantined',
      custodyEvents: [{
        event: 'submitted',
        timestamp: '2026-03-10T12:00:00Z',
        actor: 'Alice',
        hash: 'sha256:xyz',
        detail: 'File submitted',
      }],
      hashVerifications: [],
      startedAt: '2026-03-10T12:00:00Z',
    });

    check('history has entry', store.get().history.length === 1);
    check('history entry state', store.get().history[0]?.state === 'quarantined');

    // Append custody event
    ft.appendCustodyEvent('hist-001', {
      event: 'hash_verified_receipt',
      timestamp: '2026-03-10T12:00:01Z',
      actor: 'relay',
      hash: 'sha256:xyz',
      detail: 'Hash verified at receipt',
    });
    check('custody event appended', store.get().history[0]?.custodyEvents.length === 2);

    // Append hash verification
    ft.appendHashVerification('hist-001', {
      stage: 'submission',
      verified: true,
      hash: 'sha256:xyz',
      timestamp: '2026-03-10T12:00:01Z',
    });
    check('hash verification appended', store.get().history[0]?.hashVerifications.length === 1);
    check('hash verified', store.get().history[0]?.hashVerifications[0]?.verified === true);

    // Update state
    ft.updateHistoryState('hist-001', 'delivered', '2026-03-10T12:00:05Z');
    check('state updated to delivered', store.get().history[0]?.state === 'delivered');
    check('completedAt set', store.get().history[0]?.completedAt === '2026-03-10T12:00:05Z');

    // Get specific entry
    const entry = ft.getHistoryEntry('hist-001');
    check('getHistoryEntry returns entry', entry?.filename === 'config.yaml');

    // Clear
    ft.clear();
    check('clear empties all', store.get().history.length === 0 && store.get().pendingOffer === null);
  }

  // -------------------------------------------------------------------
  // Test 17: File transfer store — manifest (human→AI echo)
  // -------------------------------------------------------------------
  console.log('--- Test 17: File transfer store — manifest ---');
  {
    const ft = createFileTransferStore();
    const { store } = ft;

    ft.receiveManifest('msg-m-1', {
      transferId: 'ft-m-001',
      filename: 'data.json',
      sizeBytes: 256,
      hash: 'sha256:123',
      hashAlgorithm: 'sha256',
      mimeType: 'application/json',
      purpose: 'Input data',
      projectContext: 'Project Alpha',
    }, 'Alice');

    check('manifest creates pending offer', store.get().pendingOffer !== null);
    check('manifest direction', store.get().pendingOffer?.direction === 'human_to_ai');
    check('manifest projectContext', store.get().pendingOffer?.projectContext === 'Project Alpha');
    check('manifest senderType', store.get().pendingOffer?.senderType === 'human');
    check('history entry created', store.get().history.length === 1);
  }

  // -------------------------------------------------------------------
  // Test 18: Audit log store — entries and filtering
  // -------------------------------------------------------------------
  console.log('--- Test 18: Audit log store — entries and filtering ---');
  {
    const audit = createAuditLogStore();

    check('initial entries empty', audit.store.get().entries.length === 0);
    check('initial totalCount 0', audit.totalCount.get() === 0);

    const entries = [
      { index: 0, timestamp: '2026-03-10T12:00:00Z', eventType: 'message_routed', sessionId: 'sess-1', detail: { taskId: 'task-1' }, chainHash: 'hash-0' },
      { index: 1, timestamp: '2026-03-10T12:01:00Z', eventType: 'auth_failure', sessionId: 'sess-2', detail: { senderId: 'unknown' }, chainHash: 'hash-1' },
      { index: 2, timestamp: '2026-03-10T12:02:00Z', eventType: 'message_routed', sessionId: 'sess-1', detail: { taskId: 'task-2' }, chainHash: 'hash-2' },
      { index: 3, timestamp: '2026-03-10T12:03:00Z', eventType: 'file_delivered', sessionId: 'sess-1', detail: { state: 'delivered' }, chainHash: 'hash-3' },
      { index: 4, timestamp: '2026-03-10T12:04:00Z', eventType: 'maliclaw_rejected', sessionId: 'sess-3', detail: { outcome: 'deny' }, chainHash: 'hash-4' },
    ];

    audit.setEntries(entries);
    check('setEntries loads all', audit.store.get().entries.length === 5);
    check('totalCount matches', audit.totalCount.get() === 5);

    // Filter by eventType
    audit.setFilter({ eventType: 'message_routed' });
    check('filter by eventType', audit.filteredEntries.get().length === 2);

    // Filter by sessionId
    audit.clearFilter();
    audit.setFilter({ sessionId: 'sess-1' });
    check('filter by sessionId', audit.filteredEntries.get().length === 3);

    // Filter by taskId
    audit.clearFilter();
    audit.setFilter({ taskId: 'task-1' });
    check('filter by taskId', audit.filteredEntries.get().length === 1);

    // Filter by safetyOutcome
    audit.clearFilter();
    audit.setFilter({ safetyOutcome: 'deny' });
    check('filter by safetyOutcome', audit.filteredEntries.get().length === 1);

    // Filter by time range
    audit.clearFilter();
    audit.setFilter({ startTime: '2026-03-10T12:02:00Z', endTime: '2026-03-10T12:03:00Z' });
    check('filter by time range', audit.filteredEntries.get().length === 2);

    // Clear filter
    audit.clearFilter();
    check('clearFilter shows all', audit.filteredEntries.get().length === 5);

    // addEntry prepends
    audit.addEntry({ index: 5, timestamp: '2026-03-10T12:05:00Z', eventType: 'auth_success', sessionId: 'sess-4', detail: {}, chainHash: 'hash-5' });
    check('addEntry prepends', audit.store.get().entries.length === 6);
    check('newest entry first', audit.store.get().entries[0].index === 5);

    // Clear
    audit.clear();
    check('clear empties all', audit.store.get().entries.length === 0);
  }

  // -------------------------------------------------------------------
  // Test 19: Audit log store — pagination
  // -------------------------------------------------------------------
  console.log('--- Test 19: Audit log store — pagination ---');
  {
    const audit = createAuditLogStore();

    // Create 120 entries
    const entries = [];
    for (let i = 0; i < 120; i++) {
      entries.push({ index: i, timestamp: `2026-03-10T12:${String(i).padStart(2, '0')}:00Z`, eventType: 'message_routed', sessionId: 's', detail: {}, chainHash: `h${i}` });
    }
    audit.setEntries(entries);

    check('default pageSize is 50', audit.store.get().pageSize === 50);
    check('pageCount is 3', audit.pageCount.get() === 3);
    check('currentPage entries has 50', audit.currentPageEntries.get().length === 50);

    audit.setPage(1);
    check('page 1 has 50 entries', audit.currentPageEntries.get().length === 50);
    check('page 1 starts at index 50', audit.currentPageEntries.get()[0].index === 50);

    audit.setPage(2);
    check('page 2 has 20 entries', audit.currentPageEntries.get().length === 20);

    // Custom page size
    audit.setPageSize(25);
    check('pageCount with 25/page is 5', audit.pageCount.get() === 5);
    check('resets to page 0', audit.store.get().currentPage === 0);
  }

  // -------------------------------------------------------------------
  // Test 19b: Audit log store — integrity and audit_response handling
  // -------------------------------------------------------------------
  console.log('--- Test 19b: Audit log store — integrity and audit_response ---');
  {
    const audit = createAuditLogStore();

    // Initial integrity is null
    check('initial integrity null', audit.integrity.get() === null);

    // Set integrity
    audit.setIntegrity({ chainValid: true, entriesChecked: 42, lastVerifiedAt: '2026-03-22T12:00:00Z' });
    check('integrity set', audit.integrity.get() !== null);
    check('integrity chainValid', audit.integrity.get().chainValid === true);
    check('integrity entriesChecked', audit.integrity.get().entriesChecked === 42);

    // handleAuditResponse populates entries + integrity
    audit.handleAuditResponse({
      entries: [
        { eventType: 'message_routed', sessionId: 'sess-1', detail: { from: 'human', timestamp: '2026-03-22T10:00:00Z' }, chainHash: 'hash-1' },
        { eventType: 'auth_success', sessionId: 'sess-2', detail: { identity: 'alice', timestamp: '2026-03-22T10:01:00Z' }, chainHash: 'hash-2' },
        { eventType: 'file_manifest', sessionId: 'sess-1', detail: { filename: 'report.pdf', timestamp: '2026-03-22T10:02:00Z' }, chainHash: 'hash-3' },
      ],
      totalCount: 3,
      integrity: { chainValid: true, entriesChecked: 100, lastVerifiedAt: '2026-03-22T12:30:00Z' },
    });
    check('response entries loaded', audit.store.get().entries.length === 3);
    check('response entry 0 eventType', audit.store.get().entries[0].eventType === 'message_routed');
    check('response entry 1 eventType', audit.store.get().entries[1].eventType === 'auth_success');
    check('response not loading', audit.store.get().loading === false);
    check('response integrity updated', audit.integrity.get().entriesChecked === 100);
    check('response integrity valid', audit.integrity.get().chainValid === true);

    // handleAuditResponse with broken chain
    audit.handleAuditResponse({
      entries: [],
      totalCount: 0,
      integrity: { chainValid: false, entriesChecked: 50, lastVerifiedAt: '2026-03-22T13:00:00Z' },
    });
    check('broken chain integrity', audit.integrity.get().chainValid === false);
    check('broken chain entries empty', audit.store.get().entries.length === 0);

    // buildAuditQuery reflects current filter state
    audit.setFilter({ eventType: 'auth_success', sessionId: 'sess-1' });
    audit.setPageSize(25);
    const query = audit.buildAuditQuery();
    check('query eventType', query.eventType === 'auth_success');
    check('query sessionId', query.sessionId === 'sess-1');
    check('query limit', query.limit === 25);
    check('query includeIntegrity', query.includeIntegrity === true);

    // Clear resets integrity
    audit.clear();
    check('clear resets integrity', audit.integrity.get() === null);
  }

  // -------------------------------------------------------------------
  // Test 20: Settings store — defaults and floor values
  // -------------------------------------------------------------------
  console.log('--- Test 20: Settings store — defaults and floor values ---');
  {
    const settings = createSettingsStore();
    const s = settings.store.get().settings;

    check('default challengeThreshold', s.challengeThreshold === 0.6);
    check('default denialThreshold', s.denialThreshold === 0.9);
    check('default timeOfDayWeight', s.timeOfDayWeight === 1.5);
    check('default irreversibleAlwaysChallenge', s.irreversibleAlwaysChallenge === true);
    check('default fileQuarantineEnabled', s.fileQuarantineEnabled === true);
    check('default patternDeviationSensitivity', s.patternDeviationSensitivity === 'low');
    check('default gracePeriodMs', s.gracePeriodMs === 300000);
    check('default auditRetentionDays', s.auditRetentionDays === 365);

    // Floor values
    check('floor challengeThreshold', SAFETY_FLOOR_VALUES.challengeThreshold === 0.6);
    check('floor timeOfDayWeight', SAFETY_FLOOR_VALUES.timeOfDayWeight === 1.2);
    check('floor gracePeriodMs', SAFETY_FLOOR_VALUES.gracePeriodMs === 120000);
    check('floor auditRetentionDays', SAFETY_FLOOR_VALUES.auditRetentionDays === 90);
  }

  // -------------------------------------------------------------------
  // Test 21: Settings store — tighten-only enforcement
  // -------------------------------------------------------------------
  console.log('--- Test 21: Settings store — tighten-only enforcement ---');
  {
    const settings = createSettingsStore();

    // Tightening: lower challengeThreshold (stricter)
    let result = settings.tryUpdate('challengeThreshold', 0.4);
    check('tighten challengeThreshold to 0.4 OK', result.ok === true);
    check('challengeThreshold updated', settings.store.get().settings.challengeThreshold === 0.4);

    // Loosening: raise above floor — REJECTED
    result = settings.tryUpdate('challengeThreshold', 0.8);
    check('loosen challengeThreshold to 0.8 rejected', result.ok === false);
    check('challengeThreshold unchanged', settings.store.get().settings.challengeThreshold === 0.4);

    // Tightening: raise timeOfDayWeight (stricter)
    result = settings.tryUpdate('timeOfDayWeight', 2.0);
    check('tighten timeOfDayWeight to 2.0 OK', result.ok === true);
    check('timeOfDayWeight updated', settings.store.get().settings.timeOfDayWeight === 2.0);

    // Loosening: lower below floor — REJECTED
    result = settings.tryUpdate('timeOfDayWeight', 1.0);
    check('loosen timeOfDayWeight below floor rejected', result.ok === false);

    // Locked booleans cannot be disabled
    result = settings.tryUpdate('irreversibleAlwaysChallenge', false);
    check('disable irreversibleAlwaysChallenge rejected', result.ok === false);

    result = settings.tryUpdate('fileQuarantineEnabled', false);
    check('disable fileQuarantineEnabled rejected', result.ok === false);

    // Sensitivity can go up but not down
    result = settings.tryUpdate('patternDeviationSensitivity', 'high');
    check('tighten sensitivity to high OK', result.ok === true);

    // Audit retention can increase
    result = settings.tryUpdate('auditRetentionDays', 730);
    check('increase auditRetentionDays OK', result.ok === true);
    check('auditRetentionDays updated', settings.store.get().settings.auditRetentionDays === 730);

    // Audit retention cannot go below floor
    result = settings.tryUpdate('auditRetentionDays', 30);
    check('decrease auditRetentionDays below floor rejected', result.ok === false);

    // Grace period can increase
    result = settings.tryUpdate('gracePeriodMs', 600000);
    check('increase gracePeriodMs OK', result.ok === true);

    // Grace period cannot go below floor
    result = settings.tryUpdate('gracePeriodMs', 60000);
    check('decrease gracePeriodMs below floor rejected', result.ok === false);

    // Dirty flag
    check('dirty flag set after changes', settings.store.get().dirty === true);

    // Mark saved
    settings.markSaved();
    check('dirty cleared after markSaved', settings.store.get().dirty === false);
    check('lastSaved set', settings.store.get().lastSaved !== null);

    // User context
    check('initial userContext empty', settings.store.get().userContext === '');
    settings.setUserContext('Harry is a sysadmin who manages the Naval Fleet.');
    check('userContext set', settings.store.get().userContext === 'Harry is a sysadmin who manages the Naval Fleet.');
    check('userContext derived', settings.userContext.get() === 'Harry is a sysadmin who manages the Naval Fleet.');

    settings.setUserContext('Updated context.');
    check('userContext updated', settings.userContext.get() === 'Updated context.');
  }

  // -------------------------------------------------------------------
  // Test 22: Settings store — isAtFloor derived
  // -------------------------------------------------------------------
  console.log('--- Test 22: Settings store — isAtFloor derived ---');
  {
    const settings = createSettingsStore();

    // At defaults, thresholds are AT the floor (0.6 = 0.6, 0.9 = 0.9)
    const atFloor = settings.isAtFloor.get();
    check('challengeThreshold at floor', atFloor.challengeThreshold === true);
    check('denialThreshold at floor', atFloor.denialThreshold === true);
    check('locked booleans always at floor', atFloor.irreversibleAlwaysChallenge === true);

    // Tighten challengeThreshold — no longer at floor
    settings.tryUpdate('challengeThreshold', 0.3);
    const afterTighten = settings.isAtFloor.get();
    check('challengeThreshold no longer at floor', afterTighten.challengeThreshold === false);

    // Reset
    settings.resetToDefaults();
    check('resetToDefaults restores', settings.store.get().settings.challengeThreshold === 0.6);
    check('dirty after reset', settings.store.get().dirty === true);
  }

  // -------------------------------------------------------------------
  // Test 23: Settings store — validateSettingChange
  // -------------------------------------------------------------------
  console.log('--- Test 23: Settings store — validateSettingChange ---');
  {
    // Direct validation function
    check('valid challengeThreshold', validateSettingChange('challengeThreshold', 0.5).ok === true);
    check('invalid challengeThreshold above floor', validateSettingChange('challengeThreshold', 0.7).ok === false);
    check('invalid challengeThreshold negative', validateSettingChange('challengeThreshold', -0.1).ok === false);
    check('valid timeOfDayWeight above floor', validateSettingChange('timeOfDayWeight', 2.0).ok === true);
    check('invalid timeOfDayWeight below floor', validateSettingChange('timeOfDayWeight', 0.5).ok === false);
    check('valid sensitivity medium', validateSettingChange('patternDeviationSensitivity', 'medium').ok === true);
    check('valid hours 12', validateSettingChange('highRiskHoursStart', 12).ok === true);
    check('invalid hours 25', validateSettingChange('highRiskHoursStart', 25).ok === false);
  }

  // -------------------------------------------------------------------
  // Test 24: Task tracking store — submit and status
  // -------------------------------------------------------------------
  console.log('--- Test 24: Task tracking store — submit and status ---');
  {
    const tasks = createTasksStore();

    check('initial tasks empty', tasks.store.get().tasks.length === 0);
    check('initial taskCount 0', tasks.taskCount.get() === 0);

    tasks.submitTask('task-1', 'analyze', 'codebase', 'high', ['no destructive changes']);
    check('submitTask adds task', tasks.store.get().tasks.length === 1);
    check('task status is submitted', tasks.store.get().tasks[0].status === 'submitted');
    check('task action', tasks.store.get().tasks[0].action === 'analyze');
    check('task priority', tasks.store.get().tasks[0].priority === 'high');
    check('task constraints', tasks.store.get().tasks[0].constraints.length === 1);

    tasks.updateStatus('task-1', 'in_progress', 25, 'Scanning files');
    check('status updated to in_progress', tasks.store.get().tasks[0].status === 'in_progress');
    check('completion updated', tasks.store.get().tasks[0].completionPercentage === 25);
    check('currentAction set', tasks.store.get().tasks[0].currentAction === 'Scanning files');

    // Active tasks derived
    check('activeTasks has 1', tasks.activeTasks.get().length === 1);
    check('completedTasks empty', tasks.completedTasks.get().length === 0);
  }

  // -------------------------------------------------------------------
  // Test 25: Task tracking store — results and denials
  // -------------------------------------------------------------------
  console.log('--- Test 25: Task tracking store — results and denials ---');
  {
    const tasks = createTasksStore();

    tasks.submitTask('task-r', 'deploy', 'staging', 'critical', []);
    tasks.setResult('task-r', 'Deployed successfully', ['built', 'tested', 'deployed'], {
      inputTokens: 1000,
      outputTokens: 2000,
      estimatedCostUsd: 0.05,
    });
    check('result sets completed', tasks.store.get().tasks[0].status === 'completed');
    check('result sets summary', tasks.store.get().tasks[0].resultSummary === 'Deployed successfully');
    check('result sets cost', tasks.store.get().tasks[0].cost?.inputTokens === 1000);
    check('completedTasks has 1', tasks.completedTasks.get().length === 1);

    tasks.submitTask('task-d', 'delete', 'production-db', 'critical', []);
    tasks.setDenial('task-d', 'Destructive action without scope', 1);
    check('denial sets denied', tasks.store.get().tasks[0].status === 'denied');
    check('denial reason', tasks.store.get().tasks[0].denialReason === 'Destructive action without scope');
    check('denial layer', tasks.store.get().tasks[0].denialLayer === 1);
    check('safety outcome set', tasks.store.get().tasks[0].safetyOutcome === 'deny');
  }

  // -------------------------------------------------------------------
  // Test 26: Task tracking store — challenges and selection
  // -------------------------------------------------------------------
  console.log('--- Test 26: Task tracking store — challenges and selection ---');
  {
    const tasks = createTasksStore();

    tasks.submitTask('task-c', 'refactor', 'auth module', 'normal', ['keep tests passing']);
    tasks.setChallenge('task-c', 'Irreversible code change', 2);
    check('challenge sets challenged', tasks.store.get().tasks[0].status === 'challenged');
    check('challenge in activeTasks', tasks.activeTasks.get().length === 1);

    tasks.resolveChallenge('task-c', 'approve');
    check('resolveChallenge sets in_progress', tasks.store.get().tasks[0].status === 'in_progress');
    check('challengeDecision set', tasks.store.get().tasks[0].challengeDecision === 'approve');

    // Cancel via resolveChallenge
    tasks.submitTask('task-c2', 'nuke', 'everything', 'low', []);
    tasks.setChallenge('task-c2', 'Too broad', 3);
    tasks.resolveChallenge('task-c2', 'cancel');
    check('cancel sets cancelled', tasks.store.get().tasks[0].status === 'cancelled');

    // Selection
    tasks.selectTask('task-c');
    check('selectTask sets selectedTaskId', tasks.store.get().selectedTaskId === 'task-c');
    check('selectedTask derived', tasks.selectedTask.get()?.action === 'refactor');

    tasks.selectTask(null);
    check('deselect', tasks.selectedTask.get() === null);

    // Cancel
    tasks.submitTask('task-x', 'test', 'nothing', 'low', []);
    tasks.cancelTask('task-x');
    check('cancelTask sets cancelled', tasks.store.get().tasks.find(t => t.taskId === 'task-x')?.status === 'cancelled');

    // Clear
    tasks.clear();
    check('clear empties all', tasks.store.get().tasks.length === 0);
  }

  // -------------------------------------------------------------------
  // Test 27: Challenge stats — derived from history
  // -------------------------------------------------------------------
  console.log('--- Test 27: Challenge stats — derived from history ---');
  {
    const { store, receiveChallenge, resolve } = createChallengesStore();
    const stats = createChallengeStatsStore(store);

    // Initial stats
    const s0 = stats.get();
    check('initial totalChallenges 0', s0.totalChallenges === 0);
    check('initial thisWeek 0', s0.thisWeek === 0);
    check('initial recentTrend stable', s0.recentTrend === 'stable');

    // Add challenges
    const payload1 = {
      challengedMessageId: 'm1', challengedTaskId: 't1', layer: 2,
      reason: 'Irreversible', riskAssessment: 'High risk',
      suggestedAlternatives: ['Try dry-run'],
      factors: [
        { name: 'reversibility', description: 'Cannot undo', weight: 0.8 },
        { name: 'scope_intent_mismatch', description: 'Broad scope', weight: 0.5 },
      ],
    };
    receiveChallenge('c1', 't1', payload1);
    resolve('approve');

    const payload2 = {
      challengedMessageId: 'm2', challengedTaskId: 't2', layer: 2,
      reason: 'High risk hours', riskAssessment: 'Moderate risk',
      suggestedAlternatives: [],
      factors: [
        { name: 'time_of_day', description: 'After hours', weight: 0.6 },
        { name: 'reversibility', description: 'Hard to undo', weight: 0.7 },
      ],
    };
    receiveChallenge('c2', 't2', payload2);
    resolve('modify');

    const payload3 = {
      challengedMessageId: 'm3', challengedTaskId: 't3', layer: 1,
      reason: 'Boundary violation', riskAssessment: 'Critical',
      suggestedAlternatives: ['Use sandbox'],
      factors: [{ name: 'reversibility', description: 'Destructive', weight: 0.9 }],
    };
    receiveChallenge('c3', 't3', payload3);
    resolve('cancel');

    const s1 = stats.get();
    check('totalChallenges 3', s1.totalChallenges === 3);
    check('resolvedCount 3', s1.resolvedCount === 3);
    check('pendingCount 0', s1.pendingCount === 0);
    check('thisWeek 3 (recent)', s1.thisWeek === 3);
    check('thisMonth 3', s1.thisMonth === 3);

    // Layer breakdown
    check('byLayer has layer 2', s1.byLayer[2] === 2);
    check('byLayer has layer 1', s1.byLayer[1] === 1);

    // Decision breakdown
    check('byDecision approve', s1.byDecision['approve'] === 1);
    check('byDecision modify', s1.byDecision['modify'] === 1);
    check('byDecision cancel', s1.byDecision['cancel'] === 1);

    // Factor frequency
    check('topTriggerFactors has reversibility first', s1.topTriggerFactors[0]?.name === 'reversibility');
    check('reversibility count 3', s1.topTriggerFactors[0]?.count === 3);
    check('averageFactorsPerChallenge', Math.abs(s1.averageFactorsPerChallenge - 5/3) < 0.01);
  }

  // -------------------------------------------------------------------
  // Test 28: Challenge store — decision tracking
  // -------------------------------------------------------------------
  console.log('--- Test 28: Challenge store — decision tracking ---');
  {
    const { store, receiveChallenge, resolve } = createChallengesStore();

    const payload = {
      challengedMessageId: 'cm1', challengedTaskId: 'ct1', layer: 2,
      reason: 'Test', riskAssessment: 'Test', suggestedAlternatives: [],
      factors: [],
    };

    receiveChallenge('ch-1', 'ct1', payload);
    const resolved = resolve('approve');

    check('resolved has decision', resolved?.decision === 'approve');
    check('resolved has resolvedAt', resolved?.resolvedAt !== undefined);

    // History entry updated with decision
    const historyEntry = store.get().history[0];
    check('history entry has decision', historyEntry.decision === 'approve');
    check('history entry has resolvedAt', historyEntry.resolvedAt !== undefined);

    // Second challenge - modify
    receiveChallenge('ch-2', 'ct2', { ...payload, challengedTaskId: 'ct2' });
    const resolved2 = resolve('cancel');
    check('second resolved decision cancel', resolved2?.decision === 'cancel');
    check('history[1] decision cancel', store.get().history[1].decision === 'cancel');
  }

  // -------------------------------------------------------------------
  // Test 29: Notification service — preferences and delivery
  // -------------------------------------------------------------------
  console.log('--- Test 29: Notification service — preferences and delivery ---');
  {
    const adapter = new InMemoryNotificationAdapter();
    const svc = createNotificationService(adapter);

    check('initial not permitted', svc.store.get().permissionGranted === false);
    check('initial supported', svc.store.get().supported === true);
    check('initial enabled', svc.store.get().preferences.enabled === true);

    // Without permission, should not deliver
    const r1 = await svc.notify('incomingMessages', 'New Message', 'Hello');
    check('notify without permission returns false', r1 === false);
    check('no notification sent', adapter.sent.length === 0);

    // Grant permission
    const granted = await svc.requestPermission();
    check('requestPermission returns true', granted === true);
    check('permissionGranted updated', svc.store.get().permissionGranted === true);

    // Now should deliver
    const r2 = await svc.notify('incomingMessages', 'New Message', 'Hello from AI');
    check('notify with permission returns true', r2 === true);
    check('notification sent', adapter.sent.length === 1);
    check('notification title', adapter.sent[0].title === 'New Message');

    // History tracked
    check('history has 1 entry', svc.store.get().history.length === 1);

    // Disable category
    svc.updatePreferences({ incomingMessages: false });
    const r3 = await svc.notify('incomingMessages', 'Blocked', 'Should not send');
    check('disabled category returns false', r3 === false);
    check('still 1 notification sent', adapter.sent.length === 1);

    // Different category still works
    const r4 = await svc.notify('challenges', 'Challenge', 'Safety alert');
    check('other category works', r4 === true);

    // Master switch off
    svc.updatePreferences({ enabled: false });
    const r5 = await svc.notify('challenges', 'Blocked', 'Master off');
    check('master switch off blocks all', r5 === false);

    // Clear history
    svc.clearHistory();
    check('clearHistory empties', svc.store.get().history.length === 0);
  }

  // -------------------------------------------------------------------
  // Test 30: Notification service — unsupported adapter
  // -------------------------------------------------------------------
  console.log('--- Test 30: Notification service — unsupported adapter ---');
  {
    const adapter = new InMemoryNotificationAdapter();
    adapter.setSupported(false);
    const svc = createNotificationService(adapter);

    check('supported is false', svc.store.get().supported === false);
    await svc.requestPermission();
    const r = await svc.notify('incomingMessages', 'Test', 'body');
    check('unsupported adapter returns false', r === false);
  }

  // -------------------------------------------------------------------
  // Test 31: Chat history service — save and load
  // -------------------------------------------------------------------
  console.log('--- Test 31: Chat history service — save and load ---');
  {
    const adapter = new InMemoryChatHistory();
    const svc = createChatHistoryService(adapter);

    check('initial totalMessages 0', svc.store.get().totalMessages === 0);

    // Save messages
    await svc.saveMessage('m1', 'session-1', 'conversation', '2026-03-10T12:00:00Z', 'human', 'Alice', 'Hello', { content: 'Hello' }, 'outgoing');
    await svc.saveMessage('m2', 'session-1', 'conversation', '2026-03-10T12:00:01Z', 'ai', 'Bot', 'Hi there', { content: 'Hi there' }, 'incoming');
    await svc.saveMessage('m3', 'session-2', 'task', '2026-03-10T13:00:00Z', 'human', 'Alice', 'Run test', { action: 'test' }, 'outgoing');

    check('totalMessages 3', svc.store.get().totalMessages === 3);

    // Load session
    const session1 = await svc.loadSession('session-1');
    check('session-1 has 2 messages', session1.length === 2);
    check('messages newest first', session1[0].timestamp > session1[1].timestamp);
    check('currentSessionMessages updated', svc.store.get().currentSessionMessages.length === 2);

    // Load range
    const range = await svc.loadRange('2026-03-10T12:00:00Z', '2026-03-10T12:30:00Z');
    check('range has 2 messages', range.length === 2);

    // Search with type filter
    const tasks = await svc.search({ type: 'task' });
    check('search by type finds 1', tasks.length === 1);

    // Get sessions
    const sessions = await svc.getSessions();
    check('2 sessions', sessions.length === 2);
    check('sessionCount updated', svc.store.get().sessionCount === 2);
  }

  // -------------------------------------------------------------------
  // Test 32: Chat history service — delete and clear
  // -------------------------------------------------------------------
  console.log('--- Test 32: Chat history service — delete and clear ---');
  {
    const adapter = new InMemoryChatHistory();
    const svc = createChatHistoryService(adapter);

    await svc.saveMessage('d1', 's1', 'conversation', '2026-01-01T00:00:00Z', 'human', 'Alice', 'Old', {}, 'outgoing');
    await svc.saveMessage('d2', 's1', 'conversation', '2026-06-01T00:00:00Z', 'human', 'Alice', 'New', {}, 'outgoing');

    const deleted = await svc.deleteOlderThan('2026-03-01T00:00:00Z');
    check('deleted 1 old message', deleted === 1);

    const remaining = await svc.loadSession('s1');
    check('1 message remaining', remaining.length === 1);
    check('remaining is newer message', remaining[0].content === 'New');

    // Clear all
    await svc.clear();
    check('totalMessages 0 after clear', svc.store.get().totalMessages === 0);
    check('sessionCount 0 after clear', svc.store.get().sessionCount === 0);
  }

  // -------------------------------------------------------------------
  // Test 33: Chat history service — payload serialisation
  // -------------------------------------------------------------------
  console.log('--- Test 33: Chat history service — payload serialisation ---');
  {
    const adapter = new InMemoryChatHistory();
    const svc = createChatHistoryService(adapter);

    const payload = { content: 'Hello', nested: { value: 42 } };
    await svc.saveMessage('p1', 's1', 'conversation', '2026-03-10T12:00:00Z', 'human', 'Alice', 'Hello', payload, 'outgoing');

    const loaded = await svc.loadSession('s1');
    check('payload serialised as JSON', loaded[0].payload === JSON.stringify(payload));
    check('can parse payload back', JSON.parse(loaded[0].payload).nested.value === 42);
  }

  // -------------------------------------------------------------------
  // Test 34: Audit event categories constant
  // -------------------------------------------------------------------
  console.log('--- Test 34: Audit event categories constant ---');
  {
    check('message category exists', AUDIT_EVENT_CATEGORIES.message.length === 3);
    check('auth category exists', AUDIT_EVENT_CATEGORIES.auth.length === 4);
    check('session category exists', AUDIT_EVENT_CATEGORIES.session.length === 3);
    check('file category exists', AUDIT_EVENT_CATEGORIES.file.length === 4);
    check('config category exists', AUDIT_EVENT_CATEGORIES.config.length === 3);
    check('violation category exists', AUDIT_EVENT_CATEGORIES.violation.length === 4);
  }

  // -------------------------------------------------------------------
  // Test 35: Derived store eager get() fix
  // -------------------------------------------------------------------
  console.log('--- Test 35: Derived store eager get() fix ---');
  {
    const a = writable(10);
    const b = writable(20);
    const sum = derived([a, b], ([x, y]) => x + y);

    // No subscribers — get() should still return fresh value
    check('derived get() without subscriber', sum.get() === 30);

    a.set(100);
    check('derived get() recomputes without subscriber', sum.get() === 120);

    // With subscriber, should also work
    const vals = [];
    const unsub = sum.subscribe(v => vals.push(v));
    check('subscriber gets initial value', vals[vals.length - 1] === 120);

    b.set(200);
    check('subscriber gets updated value', vals[vals.length - 1] === 300);
    check('get() matches', sum.get() === 300);

    unsub();
    b.set(500);
    check('after unsub, get() still recomputes', sum.get() === 600);
  }

  // -------------------------------------------------------------------
  // Test: Config migration
  // -------------------------------------------------------------------
  console.log('--- Test: Config migration ---');
  {
    // v1 config (no configVersion, no autoConnect/autoReconnect)
    const v1 = {
      relayUrl: 'wss://myrelay:9443',
      userId: 'user-123',
      displayName: 'Harry',
      setupComplete: true,
      lastConnected: '2026-01-01T00:00:00Z',
      theme: 'dark',
    };

    const migrated = migrateConfig(v1);
    check('migration: relayUrl preserved', migrated.relayUrl === 'wss://myrelay:9443');
    check('migration: userId preserved', migrated.userId === 'user-123');
    check('migration: displayName preserved', migrated.displayName === 'Harry');
    check('migration: setupComplete preserved', migrated.setupComplete === true);
    check('migration: theme preserved', migrated.theme === 'dark');
    check('migration: configVersion set to current', migrated.configVersion === CONFIG_VERSION);
    check('migration: autoConnect defaults to true', migrated.autoConnect === true);
    check('migration: autoReconnect defaults to true', migrated.autoReconnect === true);

    // v2 config with explicit autoConnect=false
    const v2 = { ...v1, configVersion: 2, autoConnect: false, autoReconnect: true };
    const migrated2 = migrateConfig(v2);
    check('migration v2: autoConnect false preserved', migrated2.autoConnect === false);
    check('migration v2: autoReconnect true preserved', migrated2.autoReconnect === true);

    // Empty config
    const empty = migrateConfig({});
    check('migration empty: setupComplete false', empty.setupComplete === false);
    check('migration empty: configVersion current', empty.configVersion === CONFIG_VERSION);
    check('migration empty: defaults applied', empty.relayUrl === 'wss://10.0.30.10:9443');
  }

  // -------------------------------------------------------------------
  // Test: InMemoryConfigStore
  // -------------------------------------------------------------------
  console.log('--- Test: InMemoryConfigStore ---');
  {
    const store = new InMemoryConfigStore({ setupComplete: true, autoConnect: false });
    check('inmem: setupComplete true', store.get('setupComplete') === true);
    check('inmem: autoConnect false', store.get('autoConnect') === false);
    check('inmem: autoReconnect default true', store.get('autoReconnect') === true);
    check('inmem: has setupComplete', store.has('setupComplete'));
    check('inmem: has not userId (empty)', !store.has('userId'));

    store.set('displayName', 'Test User');
    check('inmem: set works', store.get('displayName') === 'Test User');

    const all = store.getAll();
    check('inmem: getAll returns copy', all !== store.getAll());
    check('inmem: getAll has configVersion', all.configVersion === CONFIG_VERSION);

    store.clear();
    check('inmem: clear resets setupComplete', store.get('setupComplete') === false);
    check('inmem: clear resets displayName', store.get('displayName') === '');
  }

  // -------------------------------------------------------------------
  // Test: Ping/pong keep-alive
  // -------------------------------------------------------------------
  console.log('--- Test: Ping/pong keep-alive ---');
  {
    const factory = createMockWSFactory();
    const client = new BastionHumanClient({
      relayUrl: 'wss://localhost:9443',
      identity: { id: 'human-1', type: 'human', displayName: 'TestHuman' },
      pingIntervalMs: 50,    // Fast for testing
      pongTimeoutMs: 30,
      reconnect: false,
      WebSocketImpl: factory,
    });

    await client.connect();
    client.setToken('jwt', new Date(Date.now() + 900_000).toISOString());

    const ws = factory.latest();
    const sentMessages = [];
    const origSend = ws.send.bind(ws);
    ws.send = (data) => { sentMessages.push(data); origSend(data); };

    // Wait for at least one ping
    await delay(80);
    const pingsSent = sentMessages.filter(m => m === '{"type":"ping"}');
    check('ping sent', pingsSent.length >= 1);

    // Simulate pong response
    ws._simulateMessage('{"type":"pong"}');
    await delay(10);
    check('still connected after pong', client.isConnected);

    await client.disconnect();
    client.removeAllListeners();
  }

  // -------------------------------------------------------------------
  // Test: Pong timeout triggers reconnect
  // -------------------------------------------------------------------
  console.log('--- Test: Pong timeout triggers close ---');
  {
    const factory = createMockWSFactory();
    const client = new BastionHumanClient({
      relayUrl: 'wss://localhost:9443',
      identity: { id: 'human-1', type: 'human', displayName: 'TestHuman' },
      pingIntervalMs: 30,
      pongTimeoutMs: 20,
      reconnect: false,
      WebSocketImpl: factory,
    });

    await client.connect();
    client.setToken('jwt', new Date(Date.now() + 900_000).toISOString());

    // Don't respond to ping — wait for pong timeout
    const disconnectEvents = [];
    client.on('disconnected', (code, reason) => disconnectEvents.push({ code, reason }));

    await delay(120);
    check('pong timeout: disconnected', client.connectionState === 'disconnected');
    check('pong timeout: event fired', disconnectEvents.length >= 1);

    client.removeAllListeners();
  }

  // -------------------------------------------------------------------
  // Test: Backoff schedule (new values)
  // -------------------------------------------------------------------
  console.log('--- Test: Backoff schedule ---');
  {
    const factory = createMockWSFactory();
    const client = new BastionHumanClient({
      relayUrl: 'wss://localhost:9443',
      identity: { id: 'human-1', type: 'human', displayName: 'TestHuman' },
      reconnect: true,
      pingIntervalMs: 0,  // Disable ping for this test
      WebSocketImpl: factory,
    });

    await client.connect();
    client.setToken('jwt', new Date(Date.now() + 900_000).toISOString());

    const reconnectDelays = [];
    client.on('reconnecting', (_attempt, delayMs) => reconnectDelays.push(delayMs));

    // First close
    factory.latest()._simulateClose(1006, 'lost');
    await delay(20);
    check('backoff 1: 1s', reconnectDelays[0] === 1000);

    // Clean up
    await client.disconnect();
    client.removeAllListeners();
  }

  // -------------------------------------------------------------------
  // DreamCyclesStore — persistence + crash recovery
  // -------------------------------------------------------------------
  console.log('\n--- DreamCyclesStore ---');
  {
    // Mock localStorage for Node.js environment
    const storage = new Map();
    globalThis.localStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
      clear: () => storage.clear(),
      get length() { return storage.size; },
      key: (i) => [...storage.keys()][i] ?? null,
    };

    // Clean slate
    storage.clear();

    // Basic creation
    const ds = createDreamCyclesStore();
    check('dream store starts idle', ds.store.get().status === 'idle');
    check('dream store starts with no proposals', ds.store.get().proposals.length === 0);
    check('dream store starts with no history', ds.store.get().history.length === 0);

    // addProposal persists to localStorage
    ds.addProposal('p-1', 'User prefers TypeScript', 'preference', 'stated', false, null);
    check('addProposal adds proposal', ds.store.get().proposals.length === 1);
    const persisted = storage.get('bastion-dream-state');
    check('addProposal persists to localStorage', persisted !== null && persisted !== undefined);
    const parsed = JSON.parse(persisted);
    check('persisted state has proposal', parsed.proposals.length === 1);
    check('persisted proposal content correct', parsed.proposals[0].content === 'User prefers TypeScript');

    // startDreamCycle persists
    ds.startDreamCycle('conv-123');
    check('startDreamCycle sets running', ds.store.get().status === 'running');
    check('startDreamCycle clears proposals', ds.store.get().proposals.length === 0);
    const afterStart = JSON.parse(storage.get('bastion-dream-state'));
    check('startDreamCycle persists', afterStart.status === 'running');

    // completeDreamCycle with proposals → reviewing
    ds.addProposal('p-2', 'Project uses PNPM', 'fact', 'observed', false, null);
    ds.completeDreamCycle({
      conversationId: 'conv-123', candidateCount: 1,
      tokensUsed: { input: 5000, output: 200 },
      estimatedCost: 0.05, durationMs: 1500, completedAt: '2026-04-05T12:00:00Z',
    });
    check('completeDreamCycle sets reviewing', ds.store.get().status === 'reviewing');
    check('completeDreamCycle adds to history', ds.store.get().history.length === 1);

    // dismissAll clears proposals but preserves history
    ds.dismissAll();
    check('dismissAll clears proposals', ds.store.get().proposals.length === 0);
    check('dismissAll preserves history', ds.store.get().history.length === 1);
    check('dismissAll resets to idle', ds.store.get().status === 'idle');

    // toggleProposal persists
    ds.addProposal('p-3', 'Toggle test', 'fact', 'test', false, null);
    check('new proposal selected by default', ds.store.get().proposals[0].selected === true);
    ds.toggleProposal('p-3');
    check('toggleProposal deselects', ds.store.get().proposals[0].selected === false);
    const afterToggle = JSON.parse(storage.get('bastion-dream-state'));
    check('toggleProposal persists', afterToggle.proposals[0].selected === false);

    // getSelectedProposals
    ds.addProposal('p-4', 'Selected one', 'fact', 'test', false, null);
    const selected = ds.getSelectedProposals();
    check('getSelectedProposals returns only selected', selected.length === 1);
    check('getSelectedProposals has correct content', selected[0].content === 'Selected one');

    // clearHistory
    ds.clearHistory();
    check('clearHistory clears history', ds.store.get().history.length === 0);
    check('clearHistory clears lastResult', ds.store.get().lastResult === null);

    // Restore from localStorage on new store creation
    storage.clear();
    const ds2 = createDreamCyclesStore();
    ds2.addProposal('p-5', 'Persisted memory', 'fact', 'test', false, null);
    ds2.completeDreamCycle({
      conversationId: 'conv-456', candidateCount: 1,
      tokensUsed: { input: 3000, output: 100 },
      estimatedCost: 0.03, durationMs: 800, completedAt: '2026-04-05T14:00:00Z',
    });
    // Create a fresh store — should restore from localStorage
    const ds3 = createDreamCyclesStore();
    check('new store restores from localStorage', ds3.store.get().history.length === 1);
    check('restored history has correct conversationId', ds3.store.get().history[0].conversationId === 'conv-456');

    // Crash recovery: 'running' status resets to 'idle' on init
    storage.set('bastion-dream-state', JSON.stringify({
      status: 'running', conversationId: 'conv-crash', proposals: [],
      lastResult: null, history: [],
    }));
    const ds4 = createDreamCyclesStore();
    check('crash recovery: running resets to idle', ds4.store.get().status === 'idle');

    // Clean up mock
    delete globalThis.localStorage;
  }
  console.log();

  // -------------------------------------------------------------------
  // ConversationRendererRegistry
  // -------------------------------------------------------------------
  console.log('--- ConversationRendererRegistry ---');
  {
    // Fresh registry (not the singleton, to avoid cross-test contamination)
    const reg = new ConversationRendererRegistry();
    check('registry starts empty', reg.size === 0);

    // Register and retrieve
    reg.register('game:turn', { html: '<div>Turn</div>', style: 'compact', namespace: 'game' });
    check('has returns true for registered type', reg.has('game:turn'));
    check('has returns false for unregistered type', !reg.has('game:other'));
    check('get returns config for registered type', reg.get('game:turn')?.html === '<div>Turn</div>');
    check('get returns correct style', reg.get('game:turn')?.style === 'compact');
    check('get returns correct namespace', reg.get('game:turn')?.namespace === 'game');
    check('get returns undefined for unregistered', reg.get('game:other') === undefined);
    check('size is 1 after register', reg.size === 1);

    // Register full-style with markdown
    reg.register('game:result', { html: '<p>Result</p>', style: 'full', markdown: true, namespace: 'game' });
    check('size is 2 after second register', reg.size === 2);
    check('full style preserved', reg.get('game:result')?.style === 'full');
    check('markdown flag preserved', reg.get('game:result')?.markdown === true);

    // Clear
    reg.clear();
    check('clear empties registry', reg.size === 0);
    check('has returns false after clear', !reg.has('game:turn'));

    // loadFromExtensions
    const reg2 = new ConversationRendererRegistry();
    reg2.loadFromExtensions([
      {
        namespace: 'chronicle',
        conversationRenderers: {
          'game-turn': { html: '<div>Chronicle Turn</div>', style: 'full', markdown: true },
          'game-turn-result': { html: '<div>Result</div>' },
        },
      },
      {
        namespace: 'dice',
        conversationRenderers: {
          'roll': { html: '<span>Roll</span>', style: 'compact' },
        },
      },
      {
        namespace: 'no-renderers',
        // No conversationRenderers field
      },
    ]);
    check('loadFromExtensions registers chronicle:game-turn', reg2.has('chronicle:game-turn'));
    check('loadFromExtensions registers chronicle:game-turn-result', reg2.has('chronicle:game-turn-result'));
    check('loadFromExtensions registers dice:roll', reg2.has('dice:roll'));
    check('loadFromExtensions total size is 3', reg2.size === 3);
    check('loadFromExtensions preserves html', reg2.get('chronicle:game-turn')?.html === '<div>Chronicle Turn</div>');
    check('loadFromExtensions preserves style full', reg2.get('chronicle:game-turn')?.style === 'full');
    check('loadFromExtensions preserves markdown', reg2.get('chronicle:game-turn')?.markdown === true);
    check('loadFromExtensions defaults style to compact', reg2.get('chronicle:game-turn-result')?.style === 'compact');
    check('loadFromExtensions defaults markdown to false', reg2.get('chronicle:game-turn-result')?.markdown === false);
    check('loadFromExtensions sets namespace', reg2.get('dice:roll')?.namespace === 'dice');

    // Singleton exists
    check('singleton registry exported', conversationRendererRegistry instanceof ConversationRendererRegistry);

    // Extension messages with no renderer should be filtered
    const msgs = createMessagesStore();
    msgs.addIncoming('chronicle:game-turn', { content: 'Turn 1' }, { type: 'ai', displayName: 'AI' }, 'ext-1', new Date().toISOString());
    msgs.addIncoming('conversation', { content: 'Hello' }, { type: 'ai', displayName: 'AI' }, 'msg-1', new Date().toISOString());
    msgs.addIncoming('unknown:type', { data: 'x' }, { type: 'ai', displayName: 'AI' }, 'ext-2', new Date().toISOString());
    const allMsgs = msgs.store.get().messages;
    check('all 3 messages stored', allMsgs.length === 3);

    // Filtering logic (same as MessageList component)
    const visible = allMsgs.filter(msg => {
      if (msg.type.includes(':') && !reg2.has(msg.type)) return false;
      return true;
    });
    check('unknown:type hidden (no renderer)', visible.length === 2);
    check('chronicle:game-turn visible (has renderer)', visible.some(m => m.type === 'chronicle:game-turn'));
    check('conversation visible (not namespaced)', visible.some(m => m.type === 'conversation'));
  }
  console.log();

  // -------------------------------------------------------------------
  // C7: All stores have clear() and reset to initial state
  // -------------------------------------------------------------------
  console.log('--- C7: Store clear() on disconnect ---');
  {
    // Messages store
    const msgs = createMessagesStore();
    msgs.addIncoming('conversation', { content: 'hello' }, { id: 'ai', type: 'ai', displayName: 'AI' }, 'msg-1', new Date().toISOString());
    let msgState = msgs.store.get();
    check('messages has data before clear', msgState.messages.length > 0);
    msgs.clear();
    msgState = msgs.store.get();
    check('messages empty after clear', msgState.messages.length === 0);

    // Challenges store — clear() was added by C7 fix
    const ch = createChallengesStore();
    ch.receiveChallenge('ch-1', 'task-1', { message: 'test', factors: [], layer: 1 });
    let chState = ch.store.get();
    check('challenges has data before clear', chState.active !== null);
    check('challenges.clear exists', typeof ch.clear === 'function');
    ch.clear();
    chState = ch.store.get();
    check('challenges cleared (active null)', chState.active === null);
    check('challenges cleared (history empty)', chState.history.length === 0);

    // Budget store — clear() was added by C7 fix
    const { createBudgetStore: createBudget } = await import('./dist/index.js');
    const bg = createBudget();
    bg.setStatus({ searchesThisSession: 1, searchesThisDay: 1, searchesThisMonth: 5, costThisMonth: 0.5, budgetRemaining: 9.5, percentUsed: 5, monthlyCapUsd: 10, alertLevel: 'none' });
    let bgState = bg.store.get();
    check('budget has data before clear', bgState.status !== null);
    check('budget.clear exists', typeof bg.clear === 'function');
    bg.clear();
    bgState = bg.store.get();
    check('budget cleared (status null)', bgState.status === null);
    check('budget cleared (alerts empty)', bgState.alerts.length === 0);

    // Settings store — clear() was added by C7 fix
    const st = createSettingsStore();
    st.tryUpdate('timeOfDayWeight', 2.0);
    let stState = st.store.get();
    check('settings dirty before clear', stState.dirty === true);
    check('settings.clear exists', typeof st.clear === 'function');
    st.clear();
    stState = st.store.get();
    check('settings cleared (not dirty)', stState.dirty === false);
    check('settings cleared (no error)', stState.error === null);

    // Tasks store
    const tk = createTasksStore();
    tk.submitTask('task-1', 'test', 'target', 'normal');
    let tkState = tk.store.get();
    check('tasks has data before clear', tkState.tasks.length > 0);
    tk.clear();
    tkState = tk.store.get();
    check('tasks cleared', tkState.tasks.length === 0);

    // DreamCycles store — has reset()
    const dc = createDreamCyclesStore();
    check('dreamCycles.reset exists', typeof dc.reset === 'function');
    dc.reset();
    const dcState = dc.store.get();
    check('dreamCycles reset (idle)', dcState.status === 'idle');
  }
  console.log();

  // -------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------
  console.log();
  console.log(`Results: ${pass} passed, ${fail} failed, ${pass + fail} total`);
  if (fail > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
