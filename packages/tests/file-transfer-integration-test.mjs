// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * File Transfer Integration Test (Task 2.11)
 *
 * Full round-trip in both directions:
 *   1. Human → AI: encrypt file, upload to relay, quarantine, manifest
 *      to AI, AI requests, relay delivers, AI decrypts + verifies.
 *   2. AI → Human: AI encrypts file, submits to relay, quarantine, offer
 *      to human, human accepts, relay delivers, human decrypts + verifies.
 *   3. Rejection flow: offer sent, recipient rejects, file purged.
 *   4. Hash verification at every stage.
 *   5. Automatic purge on timeout.
 *
 * Run: node packages/tests/file-transfer-integration-test.mjs
 */

import {
  BastionRelay,
  generateSelfSigned,
  MessageRouter,
  JwtService,
  FileQuarantine,
  HashVerifier,
  FileTransferRouter,
  PurgeScheduler,
} from '@bastion/relay';

import {
  BastionAiClient,
  IntakeDirectory,
  OutboundStaging,
  FilePurgeManager,
} from '@bastion/client-ai';

import {
  BastionHumanClient,
  createFileTransferStore,
} from '@bastion/client-human';

import {
  generateKeyPair,
  deriveSessionKeys,
  createSessionCipher,
  encryptFile,
  decryptFile,
} from '@bastion/crypto';

import {
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  sha256,
} from '@bastion/protocol';

import { WebSocket } from 'ws';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForEvent(emitter, event, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
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

const HUMAN_IDENTITY = { id: uuid(), type: 'human', displayName: 'Alice' };
const AI_IDENTITY = { id: uuid(), type: 'ai', displayName: 'Claude' };

/** Compute sha256 hex hash of data (matching @bastion/protocol sha256 format). */
function computeHash(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** Parse relay-originated envelope (base64-encoded payload). */
function parseRelayEnvelope(data) {
  const parsed = JSON.parse(data);
  if (parsed.encryptedPayload) {
    const payload = JSON.parse(Buffer.from(parsed.encryptedPayload, 'base64').toString('utf-8'));
    return { ...parsed, payload };
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log('=== File Transfer Integration Tests ===');
  console.log();

  // -----------------------------------------------------------------------
  // Setup: TLS, relay, router, quarantine, JWT
  // -----------------------------------------------------------------------
  let tls;
  try {
    tls = generateSelfSigned('localhost');
  } catch (err) {
    console.error('SKIP: Cannot generate self-signed cert (OpenSSL required):', err.message);
    console.log('Results: SKIPPED (OpenSSL not available)');
    return;
  }

  const PORT = 39443;
  const jwtSecret = randomBytes(32);
  const jwtService = new JwtService({
    issuer: 'bastion-file-transfer-test',
    secret: jwtSecret,
  });

  // Quarantine + hash verifier + transfer router
  const quarantine = new FileQuarantine({
    maxEntries: 50,
    defaultTimeoutMs: 60_000, // 1 min for test
  });

  const hashVerifier = new HashVerifier({ quarantine });

  // Track connection IDs for routing
  let humanConnId = '';
  let aiConnId = '';

  // =========================================================================
  // Test 1: Setup — relay, clients, pairing
  // =========================================================================
  console.log('--- Test 1: Relay + client setup ---');

  const relay = new BastionRelay({
    port: PORT,
    host: '127.0.0.1',
    tls: { cert: tls.cert, key: tls.key },
  });

  const router = new MessageRouter({
    send: (connectionId, data) => relay.send(connectionId, data),
  });

  // File transfer router using relay's send
  const fileRouter = new FileTransferRouter({
    quarantine,
    hashVerifier,
    send: (connectionId, data) => relay.send(connectionId, data),
  });

  relay.on('disconnection', (info) => {
    router.unregisterClient(info.id);
  });

  await relay.start();
  check('relay started', relay.isRunning);

  // Connect AI client
  const aiClient = new BastionAiClient({
    relayUrl: `wss://127.0.0.1:${PORT}`,
    identity: AI_IDENTITY,
    providerId: 'test-provider',
    rejectUnauthorized: false,
    connectTimeoutMs: 5000,
  });

  const aiConnPromise = waitForEvent(relay, 'connection');
  await aiClient.connect();
  const [, aiConnInfo] = await aiConnPromise;
  aiConnId = aiConnInfo.id;
  check('AI client connected', aiClient.isConnected);

  router.registerClient(aiConnId, AI_IDENTITY);

  // Connect human client
  const humanClient = new BastionHumanClient({
    relayUrl: `wss://127.0.0.1:${PORT}`,
    identity: HUMAN_IDENTITY,
    connectTimeoutMs: 5000,
    reconnect: false,
    WebSocketImpl: class extends WebSocket {
      constructor(url) { super(url, { rejectUnauthorized: false }); }
    },
  });

  const humanConnPromise = waitForEvent(relay, 'connection');
  await humanClient.connect();
  const [, humanConnInfo] = await humanConnPromise;
  humanConnId = humanConnInfo.id;
  check('human client connected', humanClient.isConnected);

  router.registerClient(humanConnId, HUMAN_IDENTITY);
  router.pairClients(humanConnId, aiConnId);
  check('clients paired', router.getPeer(humanConnId) === aiConnId);

  // Authenticate both
  const humanToken = await jwtService.issueToken({
    sub: HUMAN_IDENTITY.id,
    clientType: 'human',
    sessionId: uuid(),
    capabilities: ['send', 'receive'],
  });
  humanClient.setToken(humanToken.jwt, humanToken.expiresAt);

  const aiToken = await jwtService.issueToken({
    sub: AI_IDENTITY.id,
    clientType: 'ai',
    sessionId: uuid(),
    capabilities: ['send', 'receive', 'tool_use'],
  });
  aiClient.setToken(aiToken.jwt, aiToken.expiresAt);
  check('both clients authenticated', humanClient.isAuthenticated && aiClient.isAuthenticated);

  // Set up E2E encryption (session cipher pair)
  const humanKP = await generateKeyPair();
  const aiKP = await generateKeyPair();
  const humanSessionKeys = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
  const aiSessionKeys = await deriveSessionKeys('responder', aiKP, humanKP.publicKey);
  const sessionId = uuid();
  const humanCipher = await createSessionCipher(sessionId, humanSessionKeys);
  const aiCipher = await createSessionCipher(sessionId, aiSessionKeys);
  check('E2E ciphers established', true);
  console.log();

  // =========================================================================
  // Test 2: Human → AI file transfer — full round-trip
  // =========================================================================
  console.log('--- Test 2: Human → AI file transfer ---');
  {
    const fileContent = new TextEncoder().encode('Hello AI, this is a test configuration file with sensitive data.');
    const filename = 'config.yaml';
    const mimeType = 'text/yaml';
    const transferId = uuid();
    const fileHash = computeHash(fileContent);

    // Step 1: Human encrypts file
    const encrypted = await encryptFile(fileContent, { filename, mimeType }, humanCipher);
    check('file encrypted', encrypted.ciphertext.length > 0);
    // encryptFile returns 'sha256:<hex>' format, computeHash returns raw hex
    check('plaintext hash computed', encrypted.plaintextHash === `sha256:${fileHash}`);

    // Step 2: Human submits encrypted file to relay quarantine
    // In a real system, the human client would send the encrypted blob
    // to the relay via a file upload message. Here we simulate the relay
    // receiving the encrypted data and putting it into quarantine.
    const submitResult = fileRouter.submitFile({
      transferId,
      direction: 'human_to_ai',
      sender: HUMAN_IDENTITY,
      filename,
      sizeBytes: encrypted.ciphertext.length,
      mimeType,
      declaredHash: computeHash(encrypted.ciphertext),
      data: encrypted.ciphertext,
      purpose: 'Configuration file for analysis',
      projectContext: 'Bastion test',
      recipientConnectionId: aiConnId,
    });

    check('file submitted to quarantine', submitResult.status === 'submitted');

    // Step 3: AI should receive a file_manifest message (metadata only)
    // The FileTransferRouter sent it via relay.send → AI client receives it
    const [aiManifestData] = await waitForEvent(aiClient, 'message');
    const manifestMsg = parseRelayEnvelope(aiManifestData);
    check('AI receives file_manifest', manifestMsg.type === MESSAGE_TYPES.FILE_MANIFEST);
    check('manifest has correct filename', manifestMsg.payload.filename === filename);
    check('manifest has correct sizeBytes', manifestMsg.payload.sizeBytes === encrypted.ciphertext.length);
    check('manifest has hash', typeof manifestMsg.payload.hash === 'string');
    check('manifest has NO file content', manifestMsg.payload.fileData === undefined);
    check('manifest raw has NO ciphertext',
      !aiManifestData.includes(Buffer.from(encrypted.ciphertext).toString('base64').slice(0, 40)));

    // Step 4: AI accepts — sends file_request
    const requestResult = fileRouter.handleFileRequest(transferId, aiConnId);
    check('file request processed', requestResult.status === 'delivered');

    // Step 5: AI receives file data
    const [aiFileData] = await waitForEvent(aiClient, 'message');
    const fileDataMsg = JSON.parse(aiFileData);
    check('AI receives file_data', fileDataMsg.type === 'file_data');
    check('file_data has base64 content', typeof fileDataMsg.fileData === 'string');

    // Step 6: AI decrypts and verifies
    const receivedCiphertext = new Uint8Array(Buffer.from(fileDataMsg.fileData, 'base64'));
    const decrypted = await decryptFile(receivedCiphertext, encrypted.nonce, aiCipher);
    check('file decrypted successfully', decrypted.data.length > 0);
    check('decrypted content matches original',
      new TextDecoder().decode(decrypted.data) === new TextDecoder().decode(fileContent));
    check('decrypted hash matches', decrypted.plaintextHash === `sha256:${fileHash}`);
    check('decrypted filename matches', decrypted.metadata.filename === filename);
    check('decrypted mimeType matches', decrypted.metadata.mimeType === mimeType);

    // Step 7: Verify quarantine is cleared
    check('quarantine empty after delivery', quarantine.count === 0);
  }
  console.log();

  // =========================================================================
  // Test 3: AI → Human file transfer — full round-trip
  // =========================================================================
  console.log('--- Test 3: AI → Human file transfer ---');
  {
    const fileContent = new TextEncoder().encode('{"analysis":"complete","confidence":0.95,"items":[1,2,3]}');
    const filename = 'analysis-result.json';
    const mimeType = 'application/json';
    const transferId = uuid();

    // Step 1: AI encrypts file
    const encrypted = await encryptFile(fileContent, { filename, mimeType }, aiCipher);
    check('AI file encrypted', encrypted.ciphertext.length > 0);

    // Step 2: AI submits to relay quarantine
    const submitResult = fileRouter.submitFile({
      transferId,
      direction: 'ai_to_human',
      sender: AI_IDENTITY,
      filename,
      sizeBytes: encrypted.ciphertext.length,
      mimeType,
      declaredHash: computeHash(encrypted.ciphertext),
      data: encrypted.ciphertext,
      purpose: 'Analysis results',
      taskId: 'task-42',
      recipientConnectionId: humanConnId,
    });

    check('AI file submitted', submitResult.status === 'submitted');

    // Step 3: Human receives file_offer (metadata only)
    const [humanOfferData] = await waitForEvent(humanClient, 'message');
    const offerMsg = parseRelayEnvelope(humanOfferData);
    check('human receives file_offer', offerMsg.type === MESSAGE_TYPES.FILE_OFFER);
    check('offer has correct filename', offerMsg.payload.filename === filename);
    check('offer has purpose', offerMsg.payload.purpose === 'Analysis results');
    check('offer has NO file content', offerMsg.payload.fileData === undefined);

    // Step 4: Human uses file transfer store to track the offer
    const ftStore = createFileTransferStore();
    ftStore.receiveOffer(offerMsg.id, offerMsg.payload, AI_IDENTITY.displayName);

    const state = ftStore.store.get();
    check('store has pending offer', state.pendingOffer !== null);
    check('store offer filename', state.pendingOffer?.filename === filename);

    // Step 5: Human accepts
    const acceptedOffer = ftStore.acceptOffer();
    check('offer accepted from store', acceptedOffer?.transferId === transferId);

    // Step 6: Relay processes the request and delivers
    const requestResult = fileRouter.handleFileRequest(transferId, humanConnId);
    check('human file request processed', requestResult.status === 'delivered');

    // Step 7: Human receives file data
    const [humanFileData] = await waitForEvent(humanClient, 'message');
    const fileDataMsg = JSON.parse(humanFileData);
    check('human receives file_data', fileDataMsg.type === 'file_data');

    // Step 8: Human decrypts and verifies
    const receivedCiphertext = new Uint8Array(Buffer.from(fileDataMsg.fileData, 'base64'));
    const decrypted = await decryptFile(receivedCiphertext, encrypted.nonce, humanCipher);
    check('human decrypted file', decrypted.data.length > 0);
    check('human decrypted content matches',
      new TextDecoder().decode(decrypted.data) === new TextDecoder().decode(fileContent));
    check('human decrypted hash matches', decrypted.plaintextHash === encrypted.plaintextHash);

    // Update history
    ftStore.updateHistoryState(transferId, 'delivered', new Date().toISOString());
    ftStore.appendHashVerification(transferId, {
      stage: 'delivery',
      verified: true,
      hash: decrypted.plaintextHash,
      timestamp: new Date().toISOString(),
    });

    const histEntry = ftStore.getHistoryEntry(transferId);
    check('history state is delivered', histEntry?.state === 'delivered');
    check('history has hash verification', histEntry?.hashVerifications.length === 1);
    check('hash verification passed', histEntry?.hashVerifications[0]?.verified === true);

    check('quarantine empty', quarantine.count === 0);
  }
  console.log();

  // =========================================================================
  // Test 4: Rejection flow — AI → Human offer rejected
  // =========================================================================
  console.log('--- Test 4: Rejection flow ---');
  {
    const fileContent = new TextEncoder().encode('Unwanted file content');
    const transferId = uuid();
    const encrypted = await encryptFile(fileContent, { filename: 'spam.bin', mimeType: 'application/octet-stream' }, aiCipher);

    const submitResult = fileRouter.submitFile({
      transferId,
      direction: 'ai_to_human',
      sender: AI_IDENTITY,
      filename: 'spam.bin',
      sizeBytes: encrypted.ciphertext.length,
      mimeType: 'application/octet-stream',
      declaredHash: computeHash(encrypted.ciphertext),
      data: encrypted.ciphertext,
      purpose: 'Unsolicited output',
      recipientConnectionId: humanConnId,
    });

    check('rejection: file submitted', submitResult.status === 'submitted');
    check('rejection: quarantine has file', quarantine.count === 1);

    // Consume the offer message on human side
    const [humanOfferData] = await waitForEvent(humanClient, 'message');
    const offerMsg = parseRelayEnvelope(humanOfferData);
    check('rejection: human receives offer', offerMsg.type === MESSAGE_TYPES.FILE_OFFER);

    // Human rejects
    const rejectResult = fileRouter.handleFileReject(transferId);
    check('rejection: reject processed', rejectResult.status === 'rejected');
    check('rejection: quarantine empty after reject', quarantine.count === 0);

    // Track in store
    const ftStore = createFileTransferStore();
    ftStore.receiveOffer(offerMsg.id, offerMsg.payload, 'Claude');
    ftStore.rejectOffer();
    check('rejection: store reflects rejected',
      ftStore.store.get().history.some(h => h.transferId === transferId && h.state === 'rejected'));
  }
  console.log();

  // =========================================================================
  // Test 5: Hash verification at every stage
  // =========================================================================
  console.log('--- Test 5: Hash verification at every stage ---');
  {
    const fileContent = new TextEncoder().encode('Hash verified content');
    const transferId = uuid();
    const fileHash = computeHash(fileContent);

    // Submit with correct hash
    const submitResult = fileRouter.submitFile({
      transferId,
      direction: 'human_to_ai',
      sender: HUMAN_IDENTITY,
      filename: 'verified.txt',
      sizeBytes: fileContent.length,
      mimeType: 'text/plain',
      declaredHash: fileHash,
      data: fileContent,
      purpose: 'Hash test',
      recipientConnectionId: aiConnId,
    });

    check('hash: submission accepted', submitResult.status === 'submitted');

    // Drain the manifest message so it doesn't leak
    await waitForEvent(aiClient, 'message');

    // Verify in quarantine (via the HashVerifier)
    const quarantineCheck = hashVerifier.verifyInQuarantine(transferId);
    check('hash: quarantine verification passed', quarantineCheck?.valid === true);

    // Delivery (hash verified internally by handleFileRequest)
    const requestResult = fileRouter.handleFileRequest(transferId, aiConnId);
    check('hash: delivery succeeded', requestResult.status === 'delivered');

    // Drain the file data message
    await waitForEvent(aiClient, 'message');

    // Now test hash MISMATCH at submission
    const badTransferId = uuid();
    const mismatchResult = fileRouter.submitFile({
      transferId: badTransferId,
      direction: 'human_to_ai',
      sender: HUMAN_IDENTITY,
      filename: 'tampered.txt',
      sizeBytes: fileContent.length,
      mimeType: 'text/plain',
      declaredHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      data: fileContent,
      purpose: 'Mismatch test',
      recipientConnectionId: aiConnId,
    });

    check('hash: mismatch at submission rejected', mismatchResult.status === 'hash_mismatch');
    check('hash: mismatch reports expected', mismatchResult.status === 'hash_mismatch' && typeof mismatchResult.expected === 'string');
    check('hash: mismatch reports actual', mismatchResult.status === 'hash_mismatch' && typeof mismatchResult.actual === 'string');
  }
  console.log();

  // =========================================================================
  // Test 6: Hash mismatch at delivery (tamper detection)
  // =========================================================================
  console.log('--- Test 6: Hash mismatch at delivery (tamper detection) ---');
  {
    // We need to tamper with the quarantined data AFTER submission.
    // Use a separate quarantine to demonstrate this.
    const tamperQuarantine = new FileQuarantine({ maxEntries: 10 });
    const tamperVerifier = new HashVerifier({ quarantine: tamperQuarantine });
    const tamperRouter = new FileTransferRouter({
      quarantine: tamperQuarantine,
      hashVerifier: tamperVerifier,
      send: () => true, // stub — we only care about the delivery check
    });

    const fileContent = new TextEncoder().encode('Original content');
    const transferId = uuid();
    const fileHash = computeHash(fileContent);

    tamperRouter.submitFile({
      transferId,
      direction: 'human_to_ai',
      sender: HUMAN_IDENTITY,
      filename: 'tamper-test.txt',
      sizeBytes: fileContent.length,
      mimeType: 'text/plain',
      declaredHash: fileHash,
      data: fileContent,
      purpose: 'Tamper test',
      recipientConnectionId: 'fake-conn',
    });

    check('tamper: file in quarantine', tamperQuarantine.count === 1);

    // Tamper with the quarantined data directly
    const storedData = tamperQuarantine.getData(transferId);
    if (storedData && storedData.length > 0) {
      storedData[0] ^= 0xFF; // Flip bits
    }

    // Try to deliver — should fail hash check
    const deliveryResult = tamperRouter.handleFileRequest(transferId, 'fake-conn');
    check('tamper: delivery blocked', deliveryResult.status === 'hash_mismatch_at_delivery');

    tamperQuarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 7: Automatic purge on timeout
  // =========================================================================
  console.log('--- Test 7: Automatic purge on timeout ---');
  {
    const timeoutQuarantine = new FileQuarantine({
      maxEntries: 10,
      defaultTimeoutMs: 50, // 50ms for fast test
    });
    const timeoutVerifier = new HashVerifier({ quarantine: timeoutQuarantine });
    const timeoutRouter = new FileTransferRouter({
      quarantine: timeoutQuarantine,
      hashVerifier: timeoutVerifier,
      send: () => true,
    });

    const purgeScheduler = new PurgeScheduler({
      quarantine: timeoutQuarantine,
      intervalMs: 10_000, // won't auto-run in test
    });

    const fileContent = new TextEncoder().encode('Expiring content');
    const transferId = uuid();

    timeoutRouter.submitFile({
      transferId,
      direction: 'ai_to_human',
      sender: AI_IDENTITY,
      filename: 'expiring.txt',
      sizeBytes: fileContent.length,
      mimeType: 'text/plain',
      declaredHash: computeHash(fileContent),
      data: fileContent,
      purpose: 'Timeout test',
      recipientConnectionId: 'fake-conn',
    });

    check('timeout: file in quarantine', timeoutQuarantine.count === 1);

    // Wait for timeout
    await delay(100);

    // Manual purge cycle
    const purgeResult = purgeScheduler.purgeNow();
    check('timeout: purge cycle ran', purgeResult.purged.length > 0);
    check('timeout: quarantine empty after purge', timeoutQuarantine.count === 0);

    // Trying to request the purged file should fail
    const requestResult = timeoutRouter.handleFileRequest(transferId, 'fake-conn');
    check('timeout: request after purge fails', requestResult.status === 'not_found');

    timeoutQuarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 8: AI client intake + staging integration
  // =========================================================================
  console.log('--- Test 8: AI client file handling integration ---');
  {
    const intake = new IntakeDirectory();
    const staging = new OutboundStaging();
    const purgeManager = new FilePurgeManager(intake, staging, {
      defaultTimeoutMs: 60_000,
    });

    const taskId = 'task-integration-1';
    purgeManager.registerTask(taskId);

    // Simulate receiving a file into AI intake
    const fileContent = new TextEncoder().encode('Received file data');
    const transferId = uuid();
    const receiveResult = intake.receive(
      transferId, taskId, 'input.txt',
      fileContent, 'text/plain', computeHash(fileContent),
    );
    check('AI intake: file received', receiveResult.status === 'received');

    // AI reads the file (read-only)
    const readData = intake.read(transferId);
    check('AI intake: read succeeds', readData !== undefined);
    check('AI intake: content correct',
      readData && new TextDecoder().decode(readData) === 'Received file data');

    // AI stages an output file (write-only)
    const outputContent = new TextEncoder().encode('AI analysis output');
    const stageResult = staging.stage(taskId, 'output.json', outputContent, 'application/json', 'Results');
    check('AI staging: file staged', stageResult.status === 'staged');

    const stagedId = stageResult.status === 'staged' ? stageResult.metadata.transferId : '';

    // Submit staged file (one-time data extraction)
    const submitResult = staging.submit(stagedId);
    check('AI staging: submit extracts data', submitResult.status === 'submitted');
    check('AI staging: data correct',
      submitResult.status === 'submitted' && new TextDecoder().decode(submitResult.data) === 'AI analysis output');

    // Second submit fails
    const submitAgain = staging.submit(stagedId);
    check('AI staging: second submit blocked', submitAgain.status === 'already_submitted');

    // Task completes — purge all files
    const purgeResult = purgeManager.onTaskComplete(taskId);
    check('AI purge: task completed', purgeResult !== null);
    check('AI purge: intake cleared', purgeResult?.intakePurged === 1);
    check('AI purge: staging cleared', purgeResult?.stagingPurged === 1);
    check('AI purge: intake empty', intake.count === 0);
    check('AI purge: staging empty', staging.count === 0);

    purgeManager.destroy();
    intake.destroy();
    staging.destroy();
  }
  console.log();

  // =========================================================================
  // Test 9: Human client file transfer store integration
  // =========================================================================
  console.log('--- Test 9: Human client file transfer store ---');
  {
    const ftStore = createFileTransferStore();

    // Simulate full offer → accept → delivery cycle in the store
    const transferId = uuid();
    const offerPayload = {
      transferId,
      filename: 'report.pdf',
      sizeBytes: 4096,
      hash: 'sha256:abcdef',
      mimeType: 'application/pdf',
      purpose: 'Monthly report',
      taskId: 'task-99',
    };

    ftStore.receiveOffer('msg-1', offerPayload, 'Claude');
    check('store: offer received', ftStore.store.get().pendingOffer !== null);

    ftStore.acceptOffer();
    check('store: offer accepted', ftStore.store.get().pendingOffer === null);

    // Add hash verifications to history
    ftStore.appendHashVerification(transferId, {
      stage: 'submission',
      verified: true,
      hash: 'sha256:abcdef',
      timestamp: new Date().toISOString(),
    });
    ftStore.appendHashVerification(transferId, {
      stage: 'quarantine',
      verified: true,
      hash: 'sha256:abcdef',
      timestamp: new Date().toISOString(),
    });
    ftStore.appendHashVerification(transferId, {
      stage: 'delivery',
      verified: true,
      hash: 'sha256:abcdef',
      timestamp: new Date().toISOString(),
    });

    ftStore.appendCustodyEvent(transferId, {
      event: 'delivered',
      timestamp: new Date().toISOString(),
      actor: 'relay',
      hash: 'sha256:abcdef',
      detail: 'File delivered to human',
    });

    ftStore.updateHistoryState(transferId, 'delivered', new Date().toISOString());

    const entry = ftStore.getHistoryEntry(transferId);
    check('store: history has 3 hash verifications', entry?.hashVerifications.length === 3);
    check('store: all verifications passed',
      entry?.hashVerifications.every(v => v.verified));
    check('store: custody chain has events', (entry?.custodyEvents.length ?? 0) >= 3);
    check('store: final state is delivered', entry?.state === 'delivered');
    check('store: completedAt set', entry?.completedAt !== undefined);
  }
  console.log();

  // =========================================================================
  // Test 10: Upload progress tracking
  // =========================================================================
  console.log('--- Test 10: Upload progress tracking ---');
  {
    const ftStore = createFileTransferStore();
    const transferId = uuid();

    ftStore.startUpload(transferId, 'upload-test.zip', 10240);

    const uploads = ftStore.store.get().uploads;
    check('upload: tracked', uploads.length === 1);
    check('upload: initial phase encrypting', uploads[0]?.phase === 'encrypting');

    ftStore.updateUploadPhase(transferId, 'uploading');
    check('upload: phase uploading', ftStore.store.get().uploads[0]?.phase === 'uploading');

    ftStore.updateUploadPhase(transferId, 'quarantined');
    check('upload: phase quarantined', ftStore.store.get().uploads[0]?.phase === 'quarantined');

    ftStore.updateUploadPhase(transferId, 'offered');
    check('upload: phase offered', ftStore.store.get().uploads[0]?.phase === 'offered');

    ftStore.updateUploadPhase(transferId, 'accepted');
    check('upload: phase accepted', ftStore.store.get().uploads[0]?.phase === 'accepted');

    ftStore.updateUploadPhase(transferId, 'delivered');
    check('upload: removed on delivery', ftStore.store.get().uploads.length === 0);

    // Failed upload
    const failId = uuid();
    ftStore.startUpload(failId, 'fail.bin', 500);
    ftStore.updateUploadPhase(failId, 'failed', 'Hash mismatch at quarantine');
    check('upload: removed on failure', ftStore.store.get().uploads.length === 0);
  }
  console.log();

  // =========================================================================
  // Test 11: E2E encryption round-trip verification
  // =========================================================================
  console.log('--- Test 11: E2E encryption round-trip ---');
  {
    // Establish fresh ciphers for this test
    const hKP = await generateKeyPair();
    const aKP = await generateKeyPair();
    const hKeys = await deriveSessionKeys('initiator', hKP, aKP.publicKey);
    const aKeys = await deriveSessionKeys('responder', aKP, hKP.publicKey);
    const hCipher = await createSessionCipher('test-e2e', hKeys);
    const aCipher = await createSessionCipher('test-e2e', aKeys);

    // Large-ish file with varied content
    const largeContent = new Uint8Array(8192);
    for (let i = 0; i < largeContent.length; i++) {
      largeContent[i] = i % 256;
    }

    const encrypted = await encryptFile(
      largeContent,
      { filename: 'large-test.bin', mimeType: 'application/octet-stream' },
      hCipher,
    );

    check('e2e: encrypted size > original', encrypted.ciphertext.length > largeContent.length);
    check('e2e: nonce is 24 bytes', encrypted.nonce.length === 24);
    check('e2e: hash starts with sha256:', encrypted.plaintextHash.startsWith('sha256:'));

    const decrypted = await decryptFile(encrypted.ciphertext, encrypted.nonce, aCipher);
    check('e2e: decrypted size matches', decrypted.data.length === largeContent.length);
    check('e2e: decrypted content matches', (() => {
      for (let i = 0; i < largeContent.length; i++) {
        if (decrypted.data[i] !== largeContent[i]) return false;
      }
      return true;
    })());
    check('e2e: hash matches', decrypted.plaintextHash === encrypted.plaintextHash);
    check('e2e: filename preserved', decrypted.metadata.filename === 'large-test.bin');
    check('e2e: mimeType preserved', decrypted.metadata.mimeType === 'application/octet-stream');
    check('e2e: sizeBytes matches', decrypted.sizeBytes === 8192);

    hCipher.destroy();
    aCipher.destroy();
  }
  console.log();

  // =========================================================================
  // Test 12: Content leak prevention
  // =========================================================================
  console.log('--- Test 12: Content leak prevention ---');
  {
    const secretContent = new TextEncoder().encode('TOP_SECRET_CLASSIFIED_DATA_12345');
    const transferId = uuid();
    const secretHash = computeHash(secretContent);

    // Submit to quarantine
    const submitResult = fileRouter.submitFile({
      transferId,
      direction: 'ai_to_human',
      sender: AI_IDENTITY,
      filename: 'classified.bin',
      sizeBytes: secretContent.length,
      mimeType: 'application/octet-stream',
      declaredHash: secretHash,
      data: secretContent,
      purpose: 'Classified data',
      recipientConnectionId: humanConnId,
    });

    check('leak: file submitted', submitResult.status === 'submitted');

    // Human receives offer — check it contains NO file content
    const [humanOfferRaw] = await waitForEvent(humanClient, 'message');
    const offerStr = typeof humanOfferRaw === 'string' ? humanOfferRaw : '';

    check('leak: raw offer has no secret text',
      !offerStr.includes('TOP_SECRET_CLASSIFIED_DATA_12345'));
    check('leak: raw offer has no base64 of secret',
      !offerStr.includes(Buffer.from(secretContent).toString('base64')));

    const parsed = parseRelayEnvelope(offerStr);
    check('leak: parsed payload has no fileData', parsed.payload.fileData === undefined);
    check('leak: parsed payload has no data field', parsed.payload.data === undefined);
    check('leak: payload JSON has no secret',
      !JSON.stringify(parsed.payload).includes('TOP_SECRET'));

    // Clean up — reject the offer
    fileRouter.handleFileReject(transferId);
  }
  console.log();

  // =========================================================================
  // Cleanup
  // =========================================================================
  console.log('--- Cleanup ---');

  humanCipher.destroy();
  aiCipher.destroy();

  await humanClient.disconnect();
  check('human client disconnected', humanClient.connectionState === 'disconnected');

  await aiClient.disconnect();
  check('AI client disconnected', aiClient.connectionState === 'disconnected');

  fileRouter.destroy();
  quarantine.destroy();
  router.destroy();

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
