// Integration test: Full round-trip — human ↔ relay ↔ AI client
// Tests happy path (allow), challenge path, and denial path.
// Run with: node packages/tests/integration-test.mjs

import {
  BastionRelay,
  generateSelfSigned,
  MessageRouter,
  JwtService,
} from '@bastion/relay';

import {
  BastionAiClient,
  evaluateSafety,
  generateSafetyResponse,
  createPatternHistory,
} from '@bastion/client-ai';

import {
  BastionHumanClient,
} from '@bastion/client-human';

import {
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  validateMessage,
  validatePayload,
  serialise,
  deserialise,
  sha256,
} from '@bastion/protocol';

import { WebSocket } from 'ws';
import { randomUUID, randomBytes } from 'node:crypto';

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForEvent(emitter, event, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
    // Support both Node EventEmitter (.once) and TypedEmitter (.once)
    emitter.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const uuid = () => randomUUID();
const ts = () => new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');

const HUMAN_IDENTITY = { id: uuid(), type: 'human', displayName: 'Alice' };
const AI_IDENTITY = { id: uuid(), type: 'ai', displayName: 'Claude' };

/**
 * Build a MessageEnvelope ready for serialise().
 */
function makeEnvelope(type, payload, sender, correlationId) {
  return {
    id: uuid(),
    type,
    timestamp: ts(),
    sender,
    correlationId: correlationId || uuid(),
    version: PROTOCOL_VERSION,
    payload,
  };
}

/**
 * Build an EncryptedEnvelope from an envelope (simulating E2E encryption
 * by base64-encoding the payload — NOT real encryption, just for routing test).
 */
function toEncryptedEnvelope(envelope) {
  const payloadStr = JSON.stringify(envelope.payload);
  return JSON.stringify({
    id: envelope.id,
    type: envelope.type,
    timestamp: envelope.timestamp,
    sender: envelope.sender,
    correlationId: envelope.correlationId,
    version: envelope.version,
    encryptedPayload: Buffer.from(payloadStr).toString('base64'),
    nonce: Buffer.from(randomBytes(24)).toString('base64'),
  });
}

/**
 * Extract payload from an "encrypted" envelope (reverse of toEncryptedEnvelope).
 */
function fromEncryptedEnvelope(data) {
  const parsed = JSON.parse(data);
  const payloadStr = Buffer.from(parsed.encryptedPayload, 'base64').toString('utf-8');
  return {
    ...parsed,
    payload: JSON.parse(payloadStr),
  };
}

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------

async function run() {
  console.log('=== Integration Round-Trip Tests ===');
  console.log();

  // -----------------------------------------------------------------------
  // Setup: TLS cert, relay, JWT service, router
  // -----------------------------------------------------------------------
  let tls;
  try {
    tls = generateSelfSigned('localhost');
  } catch (err) {
    console.error('SKIP: Cannot generate self-signed cert (OpenSSL required):', err.message);
    console.log('=================================================');
    console.log('Results: SKIPPED (OpenSSL not available)');
    console.log('=================================================');
    return;
  }

  const PORT = 29443;
  const jwtSecret = randomBytes(32);
  const jwtService = new JwtService({
    issuer: 'bastion-integration-test',
    secret: jwtSecret,
  });

  // =========================================================================
  // Test 1: Full relay setup + both clients connect
  // =========================================================================
  console.log('--- Test 1: Relay + dual client connection ---');

  const relay = new BastionRelay({
    port: PORT,
    host: '127.0.0.1',
    tls: { cert: tls.cert, key: tls.key },
  });

  // Track connections on the relay side
  const relayConnections = new Map(); // connectionId → { identity, ws }

  // MessageRouter with SendFn wired to relay
  const router = new MessageRouter({
    send: (connectionId, data) => relay.send(connectionId, data),
    log: (entry) => {
      // Silent in test — could log for debugging
    },
  });

  // On relay connection: track and register with router
  relay.on('connection', (ws, info) => {
    relayConnections.set(info.id, { info, identified: false });
  });

  relay.on('disconnection', (info) => {
    router.unregisterClient(info.id);
    relayConnections.delete(info.id);
  });

  // Start relay
  await relay.start();
  check('relay started', relay.isRunning);

  // Connect AI client
  const aiClient = new BastionAiClient({
    relayUrl: `wss://127.0.0.1:${PORT}`,
    identity: AI_IDENTITY,
    providerId: 'anthropic-test',
    rejectUnauthorized: false,
    connectTimeoutMs: 5000,
  });

  // Wait for relay to see the AI connection
  const aiConnPromise = waitForEvent(relay, 'connection');
  await aiClient.connect();
  const [, aiConnInfo] = await aiConnPromise;
  check('AI client connected', aiClient.isConnected);

  // Register AI client in router
  router.registerClient(aiConnInfo.id, AI_IDENTITY);

  // Connect human client (uses browser WebSocket API — we use ws as substitute)
  const humanClient = new BastionHumanClient({
    relayUrl: `wss://127.0.0.1:${PORT}`,
    identity: HUMAN_IDENTITY,
    connectTimeoutMs: 5000,
    WebSocketImpl: class extends WebSocket {
      constructor(url) {
        super(url, { rejectUnauthorized: false });
      }
    },
  });

  const humanConnPromise = waitForEvent(relay, 'connection');
  await humanClient.connect();
  const [, humanConnInfo] = await humanConnPromise;
  check('human client connected', humanClient.isConnected);

  // Register human client in router
  router.registerClient(humanConnInfo.id, HUMAN_IDENTITY);

  // Pair them
  router.pairClients(humanConnInfo.id, aiConnInfo.id);
  check('clients paired', router.getPeer(humanConnInfo.id) === aiConnInfo.id);
  check('reverse pairing correct', router.getPeer(aiConnInfo.id) === humanConnInfo.id);
  console.log();

  // =========================================================================
  // Test 2: JWT authentication for both clients
  // =========================================================================
  console.log('--- Test 2: JWT authentication ---');
  {
    const humanToken = await jwtService.issueToken({
      sub: HUMAN_IDENTITY.id,
      clientType: 'human',
      sessionId: uuid(),
      capabilities: ['send', 'receive'],
    });
    humanClient.setToken(humanToken.jwt, humanToken.expiresAt);
    check('human client authenticated', humanClient.isAuthenticated);

    const aiToken = await jwtService.issueToken({
      sub: AI_IDENTITY.id,
      clientType: 'ai',
      sessionId: uuid(),
      capabilities: ['send', 'receive', 'tool_use'],
    });
    aiClient.setToken(aiToken.jwt, aiToken.expiresAt);
    check('AI client authenticated', aiClient.isAuthenticated);

    // Validate tokens
    const humanValid = await jwtService.validateToken(humanToken.jwt);
    check('human JWT valid', humanValid.valid);
    const aiValid = await jwtService.validateToken(aiToken.jwt);
    check('AI JWT valid', aiValid.valid);
  }
  console.log();

  // =========================================================================
  // Test 3: Happy path — human sends task, AI processes, responds
  // =========================================================================
  console.log('--- Test 3: Happy path round-trip (task → result) ---');
  {
    const correlationId = uuid();
    const taskId = uuid();

    // Build task message from human
    const taskPayload = {
      taskId,
      action: 'analyse',
      target: '/data/report.csv',
      parameters: { depth: 'summary' },
      priority: 'normal',
      constraints: ['read-only'],
    };

    // Validate the task payload
    check('task payload validates', validatePayload('task', taskPayload).valid);

    const taskEnvelope = makeEnvelope('task', taskPayload, HUMAN_IDENTITY, correlationId);
    const encryptedTask = toEncryptedEnvelope(taskEnvelope);

    // AI client listens for message
    const aiMsgPromise = waitForEvent(aiClient, 'message');

    // Route through relay (relay receives from human, routes to AI)
    relay.on('message', function taskHandler(data, info) {
      if (info.id === humanConnInfo.id) {
        const result = router.route(data, humanConnInfo.id);
        if (result.status === 'routed') {
          // remove this one-shot handler
          relay.off('message', taskHandler);
        }
      }
    });

    // Human sends
    const sent = humanClient.send(encryptedTask);
    check('human client sent task', sent);

    // AI receives
    const [aiData] = await aiMsgPromise;
    const receivedEnvelope = fromEncryptedEnvelope(aiData);
    check('AI received correct message type', receivedEnvelope.type === 'task');
    check('AI received correct taskId', receivedEnvelope.payload.taskId === taskId);
    check('AI received correct action', receivedEnvelope.payload.action === 'analyse');

    // AI runs safety evaluation
    const evaluation = evaluateSafety(taskPayload);
    check('safety evaluation outcome is allow', evaluation.outcome === 'allow');

    const safetyResponse = generateSafetyResponse(evaluation, taskEnvelope.id);
    check('safety response type is allow', safetyResponse.type === 'allow');

    // AI builds result
    const resultPayload = {
      taskId,
      summary: 'CSV analysis complete — 3000 rows processed',
      output: { totalRows: 3000, columns: 5 },
      actionsTaken: ['read_file', 'parse_csv', 'summarise'],
      generatedFiles: [],
      cost: { inputTokens: 500, outputTokens: 200, estimatedCostUsd: 0.003 },
      transparency: {
        confidenceLevel: 'high',
        safetyEvaluation: 'allow',
        permissionsUsed: ['file_read'],
        reasoningNotes: 'Standard file analysis task',
      },
    };

    check('result payload validates', validatePayload('result', resultPayload).valid);

    const resultEnvelope = makeEnvelope('result', resultPayload, AI_IDENTITY, correlationId);
    const encryptedResult = toEncryptedEnvelope(resultEnvelope);

    // Human client listens for message
    const humanMsgPromise = waitForEvent(humanClient, 'message');

    // Route through relay (relay receives from AI, routes to human)
    relay.on('message', function resultHandler(data, info) {
      if (info.id === aiConnInfo.id) {
        const result = router.route(data, aiConnInfo.id);
        if (result.status === 'routed') {
          relay.off('message', resultHandler);
        }
      }
    });

    // AI sends result
    const aiSent = aiClient.send(encryptedResult);
    check('AI client sent result', aiSent);

    // Human receives
    const [humanData] = await humanMsgPromise;
    const receivedResult = fromEncryptedEnvelope(humanData);
    check('human received result type', receivedResult.type === 'result');
    check('human received correct taskId', receivedResult.payload.taskId === taskId);
    check('human received summary', receivedResult.payload.summary.includes('3000 rows'));
    check('round-trip correlation preserved', receivedResult.correlationId === correlationId);
  }
  console.log();

  // =========================================================================
  // Test 4: Challenge path — human sends risky task, AI challenges
  // =========================================================================
  console.log('--- Test 4: Challenge path (deploy → challenge → confirm → result) ---');
  {
    const correlationId = uuid();
    const taskId = uuid();

    // Build a risky task that triggers L2 challenge (irreversible action)
    const riskyTaskPayload = {
      taskId,
      action: 'deploy',
      target: 'production-cluster',
      parameters: { version: '2.0.0', region: 'us-east-1' },
      priority: 'high',
      constraints: [],
    };

    check('risky task payload validates', validatePayload('task', riskyTaskPayload).valid);

    const taskEnvelope = makeEnvelope('task', riskyTaskPayload, HUMAN_IDENTITY, correlationId);
    const encryptedTask = toEncryptedEnvelope(taskEnvelope);

    // AI listens
    const aiMsgPromise = waitForEvent(aiClient, 'message');

    relay.on('message', function riskyHandler(data, info) {
      if (info.id === humanConnInfo.id) {
        const result = router.route(data, humanConnInfo.id);
        if (result.status === 'routed') {
          relay.off('message', riskyHandler);
        }
      }
    });

    humanClient.send(encryptedTask);
    const [aiData] = await aiMsgPromise;
    const receivedTask = fromEncryptedEnvelope(aiData);
    check('AI received deploy task', receivedTask.payload.action === 'deploy');

    // AI runs safety evaluation — deploy should trigger L2 challenge
    const evaluation = evaluateSafety(riskyTaskPayload);
    check('risky task outcome is challenge', evaluation.outcome === 'challenge');
    check('deciding layer is L2', evaluation.decidingLayer === 2);

    // AI generates challenge response
    const safetyResponse = generateSafetyResponse(evaluation, taskEnvelope.id);
    check('safety response type is challenge', safetyResponse.type === 'challenge');
    check('challenge has factors', safetyResponse.payload.factors.length > 0);
    check('challenge has reason', safetyResponse.payload.reason.length > 0);
    check('challenge payload validates', validatePayload('challenge', safetyResponse.payload).valid);

    // AI sends challenge back to human
    const challengeEnvelope = makeEnvelope('challenge', safetyResponse.payload, AI_IDENTITY, correlationId);
    const encryptedChallenge = toEncryptedEnvelope(challengeEnvelope);

    const humanChallengePromise = waitForEvent(humanClient, 'message');

    relay.on('message', function challengeHandler(data, info) {
      if (info.id === aiConnInfo.id) {
        const result = router.route(data, aiConnInfo.id);
        if (result.status === 'routed') {
          relay.off('message', challengeHandler);
        }
      }
    });

    aiClient.send(encryptedChallenge);
    const [humanChallengeData] = await humanChallengePromise;
    const receivedChallenge = fromEncryptedEnvelope(humanChallengeData);
    check('human received challenge', receivedChallenge.type === 'challenge');
    check('challenge references correct task', receivedChallenge.payload.challengedTaskId === taskId);

    // Human approves the challenge
    const confirmPayload = {
      challengeMessageId: challengeEnvelope.id,
      decision: 'approve',
      reason: 'Reviewed and approved by senior engineer',
    };
    check('confirmation payload validates', validatePayload('confirmation', confirmPayload).valid);

    const confirmEnvelope = makeEnvelope('confirmation', confirmPayload, HUMAN_IDENTITY, correlationId);
    const encryptedConfirm = toEncryptedEnvelope(confirmEnvelope);

    const aiConfirmPromise = waitForEvent(aiClient, 'message');

    relay.on('message', function confirmHandler(data, info) {
      if (info.id === humanConnInfo.id) {
        const result = router.route(data, humanConnInfo.id);
        if (result.status === 'routed') {
          relay.off('message', confirmHandler);
        }
      }
    });

    humanClient.send(encryptedConfirm);
    const [aiConfirmData] = await aiConfirmPromise;
    const receivedConfirm = fromEncryptedEnvelope(aiConfirmData);
    check('AI received confirmation', receivedConfirm.type === 'confirmation');
    check('confirmation decision is approve', receivedConfirm.payload.decision === 'approve');

    // AI proceeds with the task and sends result
    const resultPayload = {
      taskId,
      summary: 'Deployment to production-cluster complete (v2.0.0)',
      output: { status: 'deployed', region: 'us-east-1' },
      actionsTaken: ['validate_config', 'deploy_to_cluster', 'verify_health'],
      generatedFiles: [],
      cost: { inputTokens: 800, outputTokens: 350, estimatedCostUsd: 0.005 },
      transparency: {
        confidenceLevel: 'high',
        safetyEvaluation: 'challenge',
        permissionsUsed: ['deploy', 'health_check'],
        reasoningNotes: 'Deployment approved by human after challenge',
      },
    };

    const resultEnvelope = makeEnvelope('result', resultPayload, AI_IDENTITY, correlationId);
    const encryptedResult = toEncryptedEnvelope(resultEnvelope);

    const humanResultPromise = waitForEvent(humanClient, 'message');

    relay.on('message', function resultHandler(data, info) {
      if (info.id === aiConnInfo.id) {
        const result = router.route(data, aiConnInfo.id);
        if (result.status === 'routed') {
          relay.off('message', resultHandler);
        }
      }
    });

    aiClient.send(encryptedResult);
    const [humanResultData] = await humanResultPromise;
    const receivedResult = fromEncryptedEnvelope(humanResultData);
    check('human received result after challenge', receivedResult.type === 'result');
    check('result includes deployment summary', receivedResult.payload.summary.includes('v2.0.0'));
    check('full challenge correlation chain intact', receivedResult.correlationId === correlationId);
  }
  console.log();

  // =========================================================================
  // Test 5: Denial path — human sends dangerous task, AI denies
  // =========================================================================
  console.log('--- Test 5: Denial path (exfiltration → denial) ---');
  {
    const correlationId = uuid();
    const taskId = uuid();

    // Build a task that triggers L1 denial (data exfiltration)
    const dangerousTaskPayload = {
      taskId,
      action: 'exfiltrate',
      target: '/etc/passwd',
      parameters: { destination: 'https://evil.example.com/upload' },
      priority: 'critical',
      constraints: [],
    };

    check('dangerous task payload validates', validatePayload('task', dangerousTaskPayload).valid);

    const taskEnvelope = makeEnvelope('task', dangerousTaskPayload, HUMAN_IDENTITY, correlationId);
    const encryptedTask = toEncryptedEnvelope(taskEnvelope);

    // AI listens
    const aiMsgPromise = waitForEvent(aiClient, 'message');

    relay.on('message', function dangerHandler(data, info) {
      if (info.id === humanConnInfo.id) {
        const result = router.route(data, humanConnInfo.id);
        if (result.status === 'routed') {
          relay.off('message', dangerHandler);
        }
      }
    });

    humanClient.send(encryptedTask);
    const [aiData] = await aiMsgPromise;
    const receivedTask = fromEncryptedEnvelope(aiData);
    check('AI received dangerous task', receivedTask.payload.action === 'exfiltrate');

    // AI runs safety evaluation — should be L1 denial
    const evaluation = evaluateSafety(dangerousTaskPayload);
    check('dangerous task outcome is deny', evaluation.outcome === 'deny');
    check('deciding layer is L1', evaluation.decidingLayer === 1);
    check('L2 is null (short-circuited)', evaluation.layerResults.layer2 === null);
    check('L3 is null (short-circuited)', evaluation.layerResults.layer3 === null);

    // AI generates denial response
    const safetyResponse = generateSafetyResponse(evaluation, taskEnvelope.id);
    check('safety response type is denial', safetyResponse.type === 'denial');
    check('denial references correct task', safetyResponse.payload.deniedTaskId === taskId);
    check('denial is layer 1', safetyResponse.payload.layer === 1);
    check('denial has reason', safetyResponse.payload.reason.length > 0);
    check('denial payload validates', validatePayload('denial', safetyResponse.payload).valid);

    // AI sends denial back to human
    const denialEnvelope = makeEnvelope('denial', safetyResponse.payload, AI_IDENTITY, correlationId);
    const encryptedDenial = toEncryptedEnvelope(denialEnvelope);

    const humanDenialPromise = waitForEvent(humanClient, 'message');

    relay.on('message', function denialHandler(data, info) {
      if (info.id === aiConnInfo.id) {
        const result = router.route(data, aiConnInfo.id);
        if (result.status === 'routed') {
          relay.off('message', denialHandler);
        }
      }
    });

    aiClient.send(encryptedDenial);
    const [humanDenialData] = await humanDenialPromise;
    const receivedDenial = fromEncryptedEnvelope(humanDenialData);
    check('human received denial', receivedDenial.type === 'denial');
    check('denial references correct task', receivedDenial.payload.deniedTaskId === taskId);
    check('denial is non-negotiable (layer 1)', receivedDenial.payload.layer === 1);
    check('denial correlation preserved', receivedDenial.correlationId === correlationId);
  }
  console.log();

  // =========================================================================
  // Test 6: Serialisation round-trip across the wire
  // =========================================================================
  console.log('--- Test 6: Serialised envelope round-trip ---');
  {
    // Test that serialise → wire → deserialise works for a full envelope
    const taskPayload = {
      taskId: uuid(),
      action: 'scan',
      target: '/tmp/data',
      parameters: {},
      priority: 'low',
      constraints: ['timeout:30s'],
    };

    const envelope = makeEnvelope('task', taskPayload, HUMAN_IDENTITY);
    const serialised = serialise(envelope);
    check('serialise produces wire string', typeof serialised.wire === 'string');

    // Simulate wire transport
    const desResult = deserialise(serialised.wire);
    check('deserialise succeeds', desResult.success);
    if (desResult.success) {
      check('deserialised type matches', desResult.envelope.type === 'task');
      check('deserialised taskId matches', desResult.envelope.payload.taskId === taskPayload.taskId);
      check('integrity hash matches', desResult.integrity === serialised.integrity);

      // Validate the deserialised message
      const validation = validateMessage(desResult.envelope);
      check('deserialised message validates', validation.valid);
    }
  }
  console.log();

  // =========================================================================
  // Test 7: Router anti-spoofing — type mismatch rejection
  // =========================================================================
  console.log('--- Test 7: Router anti-spoofing ---');
  {
    // Human tries to send a message with AI sender identity
    const spoofedEnvelope = {
      id: uuid(), type: 'result', timestamp: ts(),
      sender: AI_IDENTITY, // Wrong! Human is sending with AI identity
      correlationId: uuid(), version: PROTOCOL_VERSION,
      encryptedPayload: Buffer.from('fake').toString('base64'),
      nonce: Buffer.from(randomBytes(24)).toString('base64'),
    };

    const routeResult = router.route(JSON.stringify(spoofedEnvelope), humanConnInfo.id);
    check('spoofed sender detected', routeResult.status === 'sender_mismatch');
    check('mismatch shows expected type', routeResult.expected === 'human');
    check('mismatch shows actual type', routeResult.actual === 'ai');
  }
  console.log();

  // =========================================================================
  // Test 8: Router — message to disconnected peer
  // =========================================================================
  console.log('--- Test 8: Router edge cases ---');
  {
    // Valid envelope from human but test infrastructure
    const validEnvelope = {
      id: uuid(), type: 'conversation', timestamp: ts(),
      sender: HUMAN_IDENTITY,
      correlationId: uuid(), version: PROTOCOL_VERSION,
      encryptedPayload: Buffer.from(JSON.stringify({ content: 'test' })).toString('base64'),
      nonce: Buffer.from(randomBytes(24)).toString('base64'),
    };

    // Route from unknown connection
    const unknownResult = router.route(JSON.stringify(validEnvelope), 'nonexistent-id');
    check('unknown sender rejected', unknownResult.status === 'unknown_sender');

    // Invalid JSON
    const invalidResult = router.route('not valid json', humanConnInfo.id);
    check('invalid JSON rejected', invalidResult.status === 'validation_failed');

    // Valid message routes successfully — consume the message on AI side to avoid
    // it leaking into Test 9's listener
    const drainPromise = waitForEvent(aiClient, 'message');
    const validResult = router.route(JSON.stringify(validEnvelope), humanConnInfo.id);
    check('valid message routes', validResult.status === 'routed');
    await drainPromise; // consume the routed message so it doesn't leak
  }
  console.log();

  // =========================================================================
  // Test 9: Conversation round-trip (chat message)
  // =========================================================================
  console.log('--- Test 9: Conversation round-trip ---');
  {
    const correlationId = uuid();

    // Human sends a conversation message
    const convPayload = { content: 'What can you do?' };
    const convEnvelope = makeEnvelope('conversation', convPayload, HUMAN_IDENTITY, correlationId);
    const encryptedConv = toEncryptedEnvelope(convEnvelope);

    const aiMsgPromise = waitForEvent(aiClient, 'message');

    relay.on('message', function convHandler(data, info) {
      if (info.id === humanConnInfo.id) {
        router.route(data, humanConnInfo.id);
        relay.off('message', convHandler);
      }
    });

    humanClient.send(encryptedConv);
    const [aiData] = await aiMsgPromise;
    const received = fromEncryptedEnvelope(aiData);
    check('AI received conversation', received.type === 'conversation');
    check('conversation content intact', received.payload.content === 'What can you do?');

    // AI replies
    const replyPayload = { content: 'I can analyse files, run tasks, and more.', replyTo: convEnvelope.id };
    check('reply payload validates', validatePayload('conversation', replyPayload).valid);

    const replyEnvelope = makeEnvelope('conversation', replyPayload, AI_IDENTITY, correlationId);
    const encryptedReply = toEncryptedEnvelope(replyEnvelope);

    const humanMsgPromise = waitForEvent(humanClient, 'message');

    relay.on('message', function replyHandler(data, info) {
      if (info.id === aiConnInfo.id) {
        router.route(data, aiConnInfo.id);
        relay.off('message', replyHandler);
      }
    });

    aiClient.send(encryptedReply);
    const [humanData] = await humanMsgPromise;
    const receivedReply = fromEncryptedEnvelope(humanData);
    check('human received reply', receivedReply.type === 'conversation');
    check('reply content intact', receivedReply.payload.content.includes('analyse files'));
    check('replyTo references original', receivedReply.payload.replyTo === convEnvelope.id);
    check('conversation correlation preserved', receivedReply.correlationId === correlationId);
  }
  console.log();

  // =========================================================================
  // Test 10: Status updates during task execution
  // =========================================================================
  console.log('--- Test 10: Status updates during task ---');
  {
    const correlationId = uuid();
    const taskId = uuid();

    // AI sends status updates (simulating task progress)
    const statusPayloads = [
      { taskId, completionPercentage: 25, currentAction: 'Reading input', toolsInUse: ['file_read'], metadata: {} },
      { taskId, completionPercentage: 50, currentAction: 'Processing data', toolsInUse: ['data_transform'], metadata: { rowsProcessed: 1500 } },
      { taskId, completionPercentage: 100, currentAction: 'Complete', toolsInUse: [], metadata: { totalRows: 3000 } },
    ];

    for (let i = 0; i < statusPayloads.length; i++) {
      const sp = statusPayloads[i];
      check(`status ${sp.completionPercentage}% validates`, validatePayload('status', sp).valid);

      const statusEnvelope = makeEnvelope('status', sp, AI_IDENTITY, correlationId);
      const encryptedStatus = toEncryptedEnvelope(statusEnvelope);

      const humanMsgPromise = waitForEvent(humanClient, 'message');

      relay.on('message', function statusHandler(data, info) {
        if (info.id === aiConnInfo.id) {
          router.route(data, aiConnInfo.id);
          relay.off('message', statusHandler);
        }
      });

      aiClient.send(encryptedStatus);
      const [humanData] = await humanMsgPromise;
      const received = fromEncryptedEnvelope(humanData);
      check(`human received ${sp.completionPercentage}% status`, received.payload.completionPercentage === sp.completionPercentage);
    }
  }
  console.log();

  // =========================================================================
  // Test 11: Tool message flow (9 types)
  // =========================================================================
  console.log('--- Test 11: Tool message flow (9 types) ---');
  {
    // Helper: route from sender to peer
    async function routeAndReceive(senderConnId, receiverClient, data) {
      const promise = waitForEvent(receiverClient, 'message');
      relay.on('message', function handler(d, info) {
        if (info.id === senderConnId) {
          router.route(d, senderConnId);
          relay.off('message', handler);
        }
      });
      relay.emit('message', data, { id: senderConnId });
      const [received] = await promise;
      return fromEncryptedEnvelope(received);
    }

    const toolCorrelation = uuid();

    // tool_registry_sync: AI → Human (share available tools)
    const registryPayload = { tools: [{ toolId: 'mcp:search', name: 'search', category: 'read' }], totalCount: 1 };
    const registryEnv = toEncryptedEnvelope(makeEnvelope('tool_registry_sync', registryPayload, AI_IDENTITY, toolCorrelation));
    const registryReceived = await routeAndReceive(aiConnInfo.id, humanClient, registryEnv);
    check('tool_registry_sync: human received', registryReceived.type === 'tool_registry_sync');
    check('tool_registry_sync: has tools', registryReceived.payload.totalCount === 1);

    // tool_registry_ack: Human → AI
    const ackPayload = { acknowledged: true };
    const ackEnv = toEncryptedEnvelope(makeEnvelope('tool_registry_ack', ackPayload, HUMAN_IDENTITY, toolCorrelation));
    const ackReceived = await routeAndReceive(humanConnInfo.id, aiClient, ackEnv);
    check('tool_registry_ack: AI received', ackReceived.type === 'tool_registry_ack');

    // tool_request: AI → Human (request permission)
    const requestId = uuid();
    const toolReqPayload = { requestId, toolId: 'mcp:search', action: 'web_search', parameters: { query: 'test' }, mode: 'conversation', dangerous: false, category: 'read' };
    const reqEnv = toEncryptedEnvelope(makeEnvelope('tool_request', toolReqPayload, AI_IDENTITY, toolCorrelation));
    const reqReceived = await routeAndReceive(aiConnInfo.id, humanClient, reqEnv);
    check('tool_request: human received', reqReceived.type === 'tool_request');
    check('tool_request: correct requestId', reqReceived.payload.requestId === requestId);

    // tool_approved: Human → AI
    const approvePayload = { requestId, toolId: 'mcp:search', trustLevel: 7, scope: 'session', reason: 'Trusted for search' };
    const approveEnv = toEncryptedEnvelope(makeEnvelope('tool_approved', approvePayload, HUMAN_IDENTITY, toolCorrelation));
    const approveReceived = await routeAndReceive(humanConnInfo.id, aiClient, approveEnv);
    check('tool_approved: AI received', approveReceived.type === 'tool_approved');
    check('tool_approved: correct trustLevel', approveReceived.payload.trustLevel === 7);

    // tool_result: AI → Human
    const resultPayload = { requestId, toolId: 'mcp:search', result: { items: ['result1'] }, durationMs: 150, success: true };
    const resultEnv = toEncryptedEnvelope(makeEnvelope('tool_result', resultPayload, AI_IDENTITY, toolCorrelation));
    const resultReceived = await routeAndReceive(aiConnInfo.id, humanClient, resultEnv);
    check('tool_result: human received', resultReceived.type === 'tool_result');
    check('tool_result: success flag preserved', resultReceived.payload.success === true);

    // tool_denied: Human → AI (test alternate path)
    const denyPayload = { requestId: uuid(), toolId: 'mcp:delete', reason: 'Too dangerous' };
    const denyEnv = toEncryptedEnvelope(makeEnvelope('tool_denied', denyPayload, HUMAN_IDENTITY, toolCorrelation));
    const denyReceived = await routeAndReceive(humanConnInfo.id, aiClient, denyEnv);
    check('tool_denied: AI received', denyReceived.type === 'tool_denied');

    // tool_revoke: Human → AI
    const revokePayload = { toolId: 'mcp:search', reason: 'Session ended' };
    const revokeEnv = toEncryptedEnvelope(makeEnvelope('tool_revoke', revokePayload, HUMAN_IDENTITY, toolCorrelation));
    const revokeReceived = await routeAndReceive(humanConnInfo.id, aiClient, revokeEnv);
    check('tool_revoke: AI received', revokeReceived.type === 'tool_revoke');
    check('tool_revoke: correct toolId', revokeReceived.payload.toolId === 'mcp:search');

    // tool_alert: AI → Human
    const alertPayload = { alertType: 'new_tool', toolId: 'mcp:calendar', message: 'New tool discovered' };
    const alertEnv = toEncryptedEnvelope(makeEnvelope('tool_alert', alertPayload, AI_IDENTITY, toolCorrelation));
    const alertReceived = await routeAndReceive(aiConnInfo.id, humanClient, alertEnv);
    check('tool_alert: human received', alertReceived.type === 'tool_alert');
    check('tool_alert: correct alertType', alertReceived.payload.alertType === 'new_tool');

    // tool_alert_response: Human → AI
    const alertRespPayload = { toolId: 'mcp:calendar', acknowledged: true };
    const alertRespEnv = toEncryptedEnvelope(makeEnvelope('tool_alert_response', alertRespPayload, HUMAN_IDENTITY, toolCorrelation));
    const alertRespReceived = await routeAndReceive(humanConnInfo.id, aiClient, alertRespEnv);
    check('tool_alert_response: AI received', alertRespReceived.type === 'tool_alert_response');
  }
  console.log();

  // =========================================================================
  // Test 12: Memory message flow (6 types)
  // =========================================================================
  console.log('--- Test 12: Memory message flow (6 types) ---');
  {
    async function routeAndReceive(senderConnId, receiverClient, data) {
      const promise = waitForEvent(receiverClient, 'message');
      relay.on('message', function handler(d, info) {
        if (info.id === senderConnId) {
          router.route(d, senderConnId);
          relay.off('message', handler);
        }
      });
      relay.emit('message', data, { id: senderConnId });
      const [received] = await promise;
      return fromEncryptedEnvelope(received);
    }

    const memCorrelation = uuid();
    const proposalId = uuid();

    // memory_proposal: Human → AI
    const proposalPayload = { proposalId, content: 'User prefers concise answers', category: 'preference', sourceMessageId: uuid() };
    const proposalEnv = toEncryptedEnvelope(makeEnvelope('memory_proposal', proposalPayload, HUMAN_IDENTITY, memCorrelation));
    const proposalReceived = await routeAndReceive(humanConnInfo.id, aiClient, proposalEnv);
    check('memory_proposal: AI received', proposalReceived.type === 'memory_proposal');
    check('memory_proposal: correct category', proposalReceived.payload.category === 'preference');

    // memory_decision: AI → Human
    const decisionPayload = { proposalId, decision: 'approve', memoryId: uuid() };
    const decisionEnv = toEncryptedEnvelope(makeEnvelope('memory_decision', decisionPayload, AI_IDENTITY, memCorrelation));
    const decisionReceived = await routeAndReceive(aiConnInfo.id, humanClient, decisionEnv);
    check('memory_decision: human received', decisionReceived.type === 'memory_decision');
    check('memory_decision: approved', decisionReceived.payload.decision === 'approve');

    // memory_list: Human → AI
    const listPayload = { category: 'preference' };
    const listEnv = toEncryptedEnvelope(makeEnvelope('memory_list', listPayload, HUMAN_IDENTITY, memCorrelation));
    const listReceived = await routeAndReceive(humanConnInfo.id, aiClient, listEnv);
    check('memory_list: AI received', listReceived.type === 'memory_list');

    // memory_list_response: AI → Human
    const listRespPayload = { memories: [{ id: uuid(), content: 'Prefers concise', category: 'preference', createdAt: ts(), updatedAt: ts() }], totalCount: 1 };
    const listRespEnv = toEncryptedEnvelope(makeEnvelope('memory_list_response', listRespPayload, AI_IDENTITY, memCorrelation));
    const listRespReceived = await routeAndReceive(aiConnInfo.id, humanClient, listRespEnv);
    check('memory_list_response: human received', listRespReceived.type === 'memory_list_response');
    check('memory_list_response: has memories', listRespReceived.payload.totalCount === 1);

    // memory_update: Human → AI
    const updatePayload = { memoryId: uuid(), content: 'User prefers very concise answers' };
    const updateEnv = toEncryptedEnvelope(makeEnvelope('memory_update', updatePayload, HUMAN_IDENTITY, memCorrelation));
    const updateReceived = await routeAndReceive(humanConnInfo.id, aiClient, updateEnv);
    check('memory_update: AI received', updateReceived.type === 'memory_update');

    // memory_delete: Human → AI
    const deletePayload = { memoryId: uuid() };
    const deleteEnv = toEncryptedEnvelope(makeEnvelope('memory_delete', deletePayload, HUMAN_IDENTITY, memCorrelation));
    const deleteReceived = await routeAndReceive(humanConnInfo.id, aiClient, deleteEnv);
    check('memory_delete: AI received', deleteReceived.type === 'memory_delete');
  }
  console.log();

  // =========================================================================
  // Test 13: Project message flow (7 types)
  // =========================================================================
  console.log('--- Test 13: Project message flow (7 types) ---');
  {
    async function routeAndReceive(senderConnId, receiverClient, data) {
      const promise = waitForEvent(receiverClient, 'message');
      relay.on('message', function handler(d, info) {
        if (info.id === senderConnId) {
          router.route(d, senderConnId);
          relay.off('message', handler);
        }
      });
      relay.emit('message', data, { id: senderConnId });
      const [received] = await promise;
      return fromEncryptedEnvelope(received);
    }

    const projCorrelation = uuid();

    // project_sync: Human → AI
    const syncPayload = { path: 'factions/iron-league.md', content: '# Iron League\nA major faction.', mimeType: 'text/markdown' };
    const syncEnv = toEncryptedEnvelope(makeEnvelope('project_sync', syncPayload, HUMAN_IDENTITY, projCorrelation));
    const syncReceived = await routeAndReceive(humanConnInfo.id, aiClient, syncEnv);
    check('project_sync: AI received', syncReceived.type === 'project_sync');
    check('project_sync: correct path', syncReceived.payload.path === 'factions/iron-league.md');

    // project_sync_ack: AI → Human
    const syncAckPayload = { path: 'factions/iron-league.md', size: 33, timestamp: ts() };
    const syncAckEnv = toEncryptedEnvelope(makeEnvelope('project_sync_ack', syncAckPayload, AI_IDENTITY, projCorrelation));
    const syncAckReceived = await routeAndReceive(aiConnInfo.id, humanClient, syncAckEnv);
    check('project_sync_ack: human received', syncAckReceived.type === 'project_sync_ack');
    check('project_sync_ack: correct path', syncAckReceived.payload.path === 'factions/iron-league.md');

    // project_list: Human → AI
    const listPayload = { directory: '/' };
    const listEnv = toEncryptedEnvelope(makeEnvelope('project_list', listPayload, HUMAN_IDENTITY, projCorrelation));
    const listReceived = await routeAndReceive(humanConnInfo.id, aiClient, listEnv);
    check('project_list: AI received', listReceived.type === 'project_list');

    // project_list_response: AI → Human
    const listRespPayload = { files: [{ path: 'factions/iron-league.md', size: 33, mimeType: 'text/markdown' }], totalSize: 33, totalCount: 1 };
    const listRespEnv = toEncryptedEnvelope(makeEnvelope('project_list_response', listRespPayload, AI_IDENTITY, projCorrelation));
    const listRespReceived = await routeAndReceive(aiConnInfo.id, humanClient, listRespEnv);
    check('project_list_response: human received', listRespReceived.type === 'project_list_response');
    check('project_list_response: has files', listRespReceived.payload.totalCount === 1);

    // project_delete: Human → AI
    const deletePayload = { path: 'factions/iron-league.md' };
    const deleteEnv = toEncryptedEnvelope(makeEnvelope('project_delete', deletePayload, HUMAN_IDENTITY, projCorrelation));
    const deleteReceived = await routeAndReceive(humanConnInfo.id, aiClient, deleteEnv);
    check('project_delete: AI received', deleteReceived.type === 'project_delete');
    check('project_delete: correct path', deleteReceived.payload.path === 'factions/iron-league.md');

    // project_config: Human → AI
    const configPayload = { alwaysLoaded: ['factions/iron-league.md'], available: ['notes/session-log.md'] };
    const configEnv = toEncryptedEnvelope(makeEnvelope('project_config', configPayload, HUMAN_IDENTITY, projCorrelation));
    const configReceived = await routeAndReceive(humanConnInfo.id, aiClient, configEnv);
    check('project_config: AI received', configReceived.type === 'project_config');
    check('project_config: alwaysLoaded count', configReceived.payload.alwaysLoaded.length === 1);

    // project_config_ack: AI → Human
    const configAckPayload = { alwaysLoaded: ['factions/iron-league.md'], available: ['notes/session-log.md'], timestamp: ts() };
    const configAckEnv = toEncryptedEnvelope(makeEnvelope('project_config_ack', configAckPayload, AI_IDENTITY, projCorrelation));
    const configAckReceived = await routeAndReceive(aiConnInfo.id, humanClient, configAckEnv);
    check('project_config_ack: human received', configAckReceived.type === 'project_config_ack');
  }
  console.log();

  // =========================================================================
  // Cleanup
  // =========================================================================
  console.log('--- Cleanup ---');
  await humanClient.disconnect();
  check('human client disconnected', humanClient.connectionState === 'disconnected');

  await aiClient.disconnect();
  check('AI client disconnected', aiClient.connectionState === 'disconnected');

  router.destroy();
  check('router destroyed', router.isDestroyed);

  await relay.shutdown(5000);
  check('relay shut down', !relay.isRunning);
  console.log();

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('=================================================');
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log('=================================================');
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
