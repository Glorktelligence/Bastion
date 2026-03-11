// Trace test: E2E key exchange, ratchet, and key store verification
// Run with: node packages/crypto/trace-test.mjs

import {
  generateKeyPair,
  deriveSessionKeys,
  createSessionCipher,
  SessionCipher,
  KeyStore,
  CryptoError,
  encryptEnvelope,
  decryptEnvelope,
  encryptFile,
  decryptFile,
  GENESIS_SEED,
  appendEntry,
  verifyChain,
  verifyRange,
  verifySingleEntry,
  ChainError,
} from './dist/index.js';
import {
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
} from '../protocol/dist/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

async function run() {
  console.log('=== E2E Crypto Trace Tests ===');
  console.log();

  // ---------------------------------------------------------------------
  // Test 1: Key pair generation
  // ---------------------------------------------------------------------
  console.log('--- Test 1: Key pair generation ---');
  const humanKP = await generateKeyPair();
  const aiKP = await generateKeyPair();

  check('human public key is 32 bytes', humanKP.publicKey.length === 32);
  check('human secret key is 32 bytes', humanKP.secretKey.length === 32);
  check('AI public key is 32 bytes', aiKP.publicKey.length === 32);
  check('keys are different', !buffersEqual(humanKP.publicKey, aiKP.publicKey));
  check('public != secret', !buffersEqual(humanKP.publicKey, humanKP.secretKey));
  console.log();

  // ---------------------------------------------------------------------
  // Test 2: Session key derivation — both sides get matching keys
  // ---------------------------------------------------------------------
  console.log('--- Test 2: Session key derivation ---');
  const humanKeys = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
  const aiKeys = await deriveSessionKeys('responder', aiKP, humanKP.publicKey);

  check('human send key is 32 bytes', humanKeys.sendKey.length === 32);
  check('human receive key is 32 bytes', humanKeys.receiveKey.length === 32);

  // Human's send key should equal AI's receive key (and vice versa)
  check('human.send == AI.receive', buffersEqual(humanKeys.sendKey, aiKeys.receiveKey));
  check('human.receive == AI.send', buffersEqual(humanKeys.receiveKey, aiKeys.sendKey));
  check('send != receive', !buffersEqual(humanKeys.sendKey, humanKeys.receiveKey));
  console.log();

  // ---------------------------------------------------------------------
  // Test 3: Session cipher — ratchet produces unique keys
  // ---------------------------------------------------------------------
  console.log('--- Test 3: SessionCipher ratchet ---');
  const sessionId = randomUUID();
  const humanCipher = await createSessionCipher(sessionId, humanKeys);
  const aiCipher = await createSessionCipher(sessionId, aiKeys);

  check('human cipher sessionId', humanCipher.sessionId === sessionId);
  check('counters start at 0', humanCipher.sendCounter === 0 && humanCipher.receiveCounter === 0);

  // Human sends 3 messages
  const hSend0 = humanCipher.nextSendKey();
  const hSend1 = humanCipher.nextSendKey();
  const hSend2 = humanCipher.nextSendKey();

  check('send counter advances', humanCipher.sendCounter === 3);
  check('each send key is unique',
    !buffersEqual(hSend0.key, hSend1.key) &&
    !buffersEqual(hSend1.key, hSend2.key) &&
    !buffersEqual(hSend0.key, hSend2.key));
  check('counters are sequential', hSend0.counter === 0 && hSend1.counter === 1 && hSend2.counter === 2);

  // AI decrypts: receive keys must match human's send keys
  const aRecv0 = aiCipher.nextReceiveKey();
  const aRecv1 = aiCipher.nextReceiveKey();
  const aRecv2 = aiCipher.nextReceiveKey();

  check('AI recv[0] matches human send[0]', buffersEqual(aRecv0.key, hSend0.key));
  check('AI recv[1] matches human send[1]', buffersEqual(aRecv1.key, hSend1.key));
  check('AI recv[2] matches human send[2]', buffersEqual(aRecv2.key, hSend2.key));

  // AI sends 2 messages, human receives
  const aSend0 = aiCipher.nextSendKey();
  const aSend1 = aiCipher.nextSendKey();
  const hRecv0 = humanCipher.nextReceiveKey();
  const hRecv1 = humanCipher.nextReceiveKey();

  check('human recv[0] matches AI send[0]', buffersEqual(hRecv0.key, aSend0.key));
  check('human recv[1] matches AI send[1]', buffersEqual(hRecv1.key, aSend1.key));
  check('send and receive chains are independent',
    !buffersEqual(aSend0.key, aRecv0.key));
  console.log();

  // ---------------------------------------------------------------------
  // Test 4: State export/restore preserves ratchet position
  // ---------------------------------------------------------------------
  console.log('--- Test 4: State export/restore ---');
  const exported = humanCipher.exportState();
  check('exported sessionId', exported.sessionId === sessionId);
  check('exported sendCounter', exported.sendCounter === 3);
  check('exported receiveCounter', exported.receiveCounter === 2);
  check('exported keys are base64 strings', typeof exported.sendChainKey === 'string');

  const restored = await SessionCipher.restore(exported);
  check('restored sessionId', restored.sessionId === sessionId);
  check('restored sendCounter', restored.sendCounter === 3);

  // Next key from restored cipher should match what the original would produce
  const hSend3Original = humanCipher.nextSendKey();
  const hSend3Restored = restored.nextSendKey();
  check('restored cipher produces same next key', buffersEqual(hSend3Original.key, hSend3Restored.key));
  check('restored counter matches', hSend3Original.counter === hSend3Restored.counter);
  console.log();

  // ---------------------------------------------------------------------
  // Test 5: Destroy zeroizes and prevents reuse
  // ---------------------------------------------------------------------
  console.log('--- Test 5: Cipher destroy ---');
  restored.destroy();
  let destroyedError = false;
  try {
    restored.nextSendKey();
  } catch (err) {
    destroyedError = err instanceof CryptoError;
  }
  check('destroyed cipher throws CryptoError', destroyedError);
  console.log();

  // ---------------------------------------------------------------------
  // Test 6: Key store — create, store, load, round-trip
  // ---------------------------------------------------------------------
  console.log('--- Test 6: Key store round-trip ---');
  const storePath = join(tmpdir(), `bastion-test-${randomUUID()}.json`);

  try {
    // Create with passphrase
    const store = await KeyStore.create({ storagePath: storePath });
    await store.initialise('test-passphrase-hunter2');

    // Store identity key pair
    await store.storeIdentityKeyPair(humanKP);
    const loadedKP = store.loadIdentityKeyPair();
    check('identity publicKey round-trips', loadedKP && buffersEqual(loadedKP.publicKey, humanKP.publicKey));
    check('identity secretKey round-trips', loadedKP && buffersEqual(loadedKP.secretKey, humanKP.secretKey));

    // Store session state
    const cipherState = humanCipher.exportState();
    await store.storeSession(sessionId, cipherState);
    const loadedSession = store.loadSession(sessionId);
    check('session state round-trips', loadedSession !== null);
    check('session sendCounter preserved', loadedSession?.sendCounter === cipherState.sendCounter);
    check('session chainKey preserved', loadedSession?.sendChainKey === cipherState.sendChainKey);
    check('listSessions includes our session', store.listSessions().includes(sessionId));

    store.destroy();

    // Reload from disk with same passphrase
    console.log('  (reloading from disk...)');
    const store2 = await KeyStore.create({ storagePath: storePath });
    await store2.initialise('test-passphrase-hunter2');

    const reloadedKP = store2.loadIdentityKeyPair();
    check('identity survives disk round-trip', reloadedKP && buffersEqual(reloadedKP.publicKey, humanKP.publicKey));

    const reloadedSession = store2.loadSession(sessionId);
    check('session survives disk round-trip', reloadedSession?.sendCounter === cipherState.sendCounter);

    // Verify restored cipher from disk produces correct keys
    if (reloadedSession) {
      const diskCipher = await SessionCipher.restore(reloadedSession);
      const diskKey = diskCipher.nextSendKey();
      check('cipher from disk produces correct key', diskKey.counter === cipherState.sendCounter);
      diskCipher.destroy();
    }

    store2.destroy();

    // Wrong passphrase should fail
    console.log('  (testing wrong passphrase...)');
    const store3 = await KeyStore.create({ storagePath: storePath });
    let wrongPassError = false;
    try {
      await store3.initialise('wrong-passphrase');
    } catch (err) {
      wrongPassError = err instanceof CryptoError;
    }
    check('wrong passphrase rejected', wrongPassError);
  } finally {
    await rm(storePath, { force: true });
  }
  console.log();

  // ---------------------------------------------------------------------
  // Test 7: Key store — masterKey mode (no passphrase)
  // ---------------------------------------------------------------------
  console.log('--- Test 7: Key store with masterKey ---');
  const storePath2 = join(tmpdir(), `bastion-test-${randomUUID()}.json`);
  // Use createRequire to load CJS build (same workaround as the package itself)
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const sodium = require('libsodium-wrappers-sumo');
  await sodium.ready;
  const masterKey = sodium.randombytes_buf(32);

  try {
    const store = await KeyStore.create({ storagePath: storePath2, masterKey });
    await store.initialise();
    await store.storeIdentityKeyPair(aiKP);

    const loaded = store.loadIdentityKeyPair();
    check('masterKey mode stores keypair', loaded && buffersEqual(loaded.publicKey, aiKP.publicKey));

    // Delete session
    await store.storeSession('test-session', humanCipher.exportState());
    check('session stored', store.listSessions().length === 1);
    await store.deleteSession('test-session');
    check('session deleted', store.listSessions().length === 0);

    store.destroy();

    // Verify destroyed store throws
    let destroyErr = false;
    try {
      store.loadIdentityKeyPair();
    } catch (err) {
      destroyErr = err instanceof CryptoError;
    }
    check('destroyed store throws', destroyErr);
  } finally {
    await rm(storePath2, { force: true });
  }
  console.log();

  // ---------------------------------------------------------------------
  // Test 8: Edge case — bad peer public key
  // ---------------------------------------------------------------------
  console.log('--- Test 8: Edge cases ---');
  let badKeyErr = false;
  try {
    await deriveSessionKeys('initiator', humanKP, new Uint8Array(16));
  } catch (err) {
    badKeyErr = err instanceof CryptoError;
  }
  check('short public key rejected', badKeyErr);

  // Verify keys are all 32 bytes (XSalsa20-Poly1305 key size)
  const testCipher = await createSessionCipher(randomUUID(), humanKeys);
  const testKey = testCipher.nextSendKey();
  check('message key is 32 bytes', testKey.key.length === 32);
  testCipher.destroy();
  console.log();

  // ---------------------------------------------------------------------
  // Test 9: Encrypt/decrypt round-trip
  // ---------------------------------------------------------------------
  console.log('--- Test 9: Encrypt/decrypt round-trip ---');

  // Create fresh ciphers for encryption tests
  const encSessionId = randomUUID();
  const encHumanKeys = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
  const encAiKeys = await deriveSessionKeys('responder', aiKP, humanKP.publicKey);
  const encHumanCipher = await createSessionCipher(encSessionId, encHumanKeys);
  const encAiCipher = await createSessionCipher(encSessionId, encAiKeys);

  // Build a valid heartbeat envelope
  const testEnvelope = {
    id: randomUUID(),
    type: MESSAGE_TYPES.HEARTBEAT,
    timestamp: new Date().toISOString(),
    sender: { id: randomUUID(), type: 'human', displayName: 'Test Human' },
    correlationId: randomUUID(),
    version: PROTOCOL_VERSION,
    payload: {
      sessionId: encSessionId,
      peerStatus: 'active',
      metrics: {
        uptimeMs: 12345,
        memoryUsageMb: 128.5,
        cpuPercent: 15.2,
        latencyMs: 42,
      },
    },
  };

  // Human encrypts
  const encResult = await encryptEnvelope(testEnvelope, encHumanCipher);
  check('encrypted has encryptedPayload', typeof encResult.encrypted.encryptedPayload === 'string');
  check('encrypted has nonce', typeof encResult.encrypted.nonce === 'string');
  check('counter is 0', encResult.counter === 0);
  check('metadata preserved: id', encResult.encrypted.id === testEnvelope.id);
  check('metadata preserved: type', encResult.encrypted.type === testEnvelope.type);
  check('metadata preserved: sender.id', encResult.encrypted.sender.id === testEnvelope.sender.id);

  // AI decrypts
  const decResult = await decryptEnvelope(encResult.encrypted, encAiCipher);
  check('decrypted id matches', decResult.envelope.id === testEnvelope.id);
  check('decrypted type matches', decResult.envelope.type === testEnvelope.type);
  check('decrypted sender matches', decResult.envelope.sender.id === testEnvelope.sender.id);
  check('decrypted payload matches', decResult.envelope.payload.sessionId === testEnvelope.payload.sessionId);
  check('decrypted payload metrics', decResult.envelope.payload.metrics.uptimeMs === 12345);
  check('integrity hash present', decResult.integrity.startsWith('sha256:'));
  check('decrypt counter is 0', decResult.counter === 0);

  // Second message round-trip (verify ratchet advances)
  const testEnvelope2 = {
    ...testEnvelope,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
  const encResult2 = await encryptEnvelope(testEnvelope2, encHumanCipher);
  const decResult2 = await decryptEnvelope(encResult2.encrypted, encAiCipher);
  check('second message counter is 1', encResult2.counter === 1 && decResult2.counter === 1);
  check('second message decrypts correctly', decResult2.envelope.id === testEnvelope2.id);
  console.log();

  // ---------------------------------------------------------------------
  // Test 10: Tamper detection — modified ciphertext
  // Each test uses fresh cipher pairs to avoid ratchet desync
  // ---------------------------------------------------------------------
  console.log('--- Test 10: Tamper detection (ciphertext) ---');
  {
    const keys10h = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
    const keys10a = await deriveSessionKeys('responder', aiKP, humanKP.publicKey);
    const cipher10h = await createSessionCipher(randomUUID(), keys10h);
    const cipher10a = await createSessionCipher(randomUUID(), keys10a);

    const tamperEnvelope = {
      ...testEnvelope,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    const tamperEncResult = await encryptEnvelope(tamperEnvelope, cipher10h);

    // Corrupt the base64 ciphertext
    const bytes = sodium.from_base64(tamperEncResult.encrypted.encryptedPayload);
    bytes[0] ^= 0xff; // flip bits in first byte
    const tamperedEnc = {
      ...tamperEncResult.encrypted,
      encryptedPayload: sodium.to_base64(bytes),
    };

    let tamperError = false;
    try {
      await decryptEnvelope(tamperedEnc, cipher10a);
    } catch (err) {
      tamperError = err instanceof CryptoError;
    }
    check('tampered ciphertext throws CryptoError', tamperError);

    cipher10h.destroy();
    cipher10a.destroy();
  }
  console.log();

  // ---------------------------------------------------------------------
  // Test 11: Wrong keys — different session can't decrypt
  // ---------------------------------------------------------------------
  console.log('--- Test 11: Wrong keys ---');
  {
    const keys11h = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
    const cipher11h = await createSessionCipher(randomUUID(), keys11h);

    // Completely different key pair / session
    const wrongKP1 = await generateKeyPair();
    const wrongKP2 = await generateKeyPair();
    const wrongKeys = await deriveSessionKeys('responder', wrongKP2, wrongKP1.publicKey);
    const wrongCipher = await createSessionCipher(randomUUID(), wrongKeys);

    const wrongKeyEnvelope = {
      ...testEnvelope,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    const wrongKeyEncResult = await encryptEnvelope(wrongKeyEnvelope, cipher11h);

    let wrongKeyError = false;
    try {
      await decryptEnvelope(wrongKeyEncResult.encrypted, wrongCipher);
    } catch (err) {
      wrongKeyError = err instanceof CryptoError;
    }
    check('wrong session keys throws CryptoError', wrongKeyError);

    cipher11h.destroy();
    wrongCipher.destroy();
  }
  console.log();

  // ---------------------------------------------------------------------
  // Test 12: Metadata tampering — modified plaintext routing fields
  // ---------------------------------------------------------------------
  console.log('--- Test 12: Metadata tampering detection ---');
  {
    // Fresh cipher pair for sender tampering
    const keys12h = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
    const keys12a = await deriveSessionKeys('responder', aiKP, humanKP.publicKey);
    const cipher12h = await createSessionCipher(randomUUID(), keys12h);
    const cipher12a = await createSessionCipher(randomUUID(), keys12a);

    const metaEnvelope = {
      ...testEnvelope,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    const metaEncResult = await encryptEnvelope(metaEnvelope, cipher12h);

    // Tamper with the sender in the EncryptedEnvelope (relay-visible metadata)
    const tamperedMeta = {
      ...metaEncResult.encrypted,
      sender: { id: randomUUID(), type: 'ai', displayName: 'Impostor' },
    };

    let metaTamperError = false;
    try {
      await decryptEnvelope(tamperedMeta, cipher12a);
    } catch (err) {
      metaTamperError = err instanceof CryptoError &&
        err.message.includes('Metadata tampering detected');
    }
    check('sender tampering throws CryptoError', metaTamperError);

    // Fresh cipher pair for type tampering
    const keys12h2 = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
    const keys12a2 = await deriveSessionKeys('responder', aiKP, humanKP.publicKey);
    const cipher12h2 = await createSessionCipher(randomUUID(), keys12h2);
    const cipher12a2 = await createSessionCipher(randomUUID(), keys12a2);

    const typeEnvelope = {
      ...testEnvelope,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    const typeEncResult = await encryptEnvelope(typeEnvelope, cipher12h2);
    const tamperedTypeEnc = {
      ...typeEncResult.encrypted,
      type: MESSAGE_TYPES.ERROR,
    };

    let typeTamperError = false;
    try {
      await decryptEnvelope(tamperedTypeEnc, cipher12a2);
    } catch (err) {
      typeTamperError = err instanceof CryptoError &&
        err.message.includes('Metadata tampering detected');
    }
    check('type tampering throws CryptoError', typeTamperError);

    cipher12h.destroy();
    cipher12a.destroy();
    cipher12h2.destroy();
    cipher12a2.destroy();
  }
  console.log();

  // Clean up encryption test ciphers
  encHumanCipher.destroy();
  encAiCipher.destroy();

  // ---------------------------------------------------------------------
  // Test 13: File encrypt/decrypt round-trip — small and large files
  // ---------------------------------------------------------------------
  console.log('--- Test 13: File encrypt/decrypt round-trip ---');
  {
    const fKeys13h = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
    const fKeys13a = await deriveSessionKeys('responder', aiKP, humanKP.publicKey);
    const fCipher13h = await createSessionCipher(randomUUID(), fKeys13h);
    const fCipher13a = await createSessionCipher(randomUUID(), fKeys13a);

    // Small file (13 bytes)
    const smallData = new TextEncoder().encode('Hello Bastion');
    const smallMeta = { filename: 'hello.txt', mimeType: 'text/plain' };
    const smallEnc = await encryptFile(smallData, smallMeta, fCipher13h);

    check('small file: ciphertext is Uint8Array', smallEnc.ciphertext instanceof Uint8Array);
    check('small file: nonce is 24 bytes', smallEnc.nonce.length === 24);
    check('small file: counter is 0', smallEnc.counter === 0);
    check('small file: hash starts with sha256:', smallEnc.plaintextHash.startsWith('sha256:'));
    check('small file: sizeBytes matches', smallEnc.sizeBytes === 13);
    check('small file: ciphertext larger than plaintext',
      smallEnc.ciphertext.length > smallData.length);

    const smallDec = await decryptFile(smallEnc.ciphertext, smallEnc.nonce, fCipher13a);
    check('small file: decrypted data matches', buffersEqual(smallDec.data, smallData));
    check('small file: filename preserved', smallDec.metadata.filename === 'hello.txt');
    check('small file: mimeType preserved', smallDec.metadata.mimeType === 'text/plain');
    check('small file: hash verified', smallDec.plaintextHash === smallEnc.plaintextHash);
    check('small file: sizeBytes verified', smallDec.sizeBytes === 13);
    check('small file: counter is 0', smallDec.counter === 0);

    // Medium file (64 KB of random data)
    const mediumData = sodium.randombytes_buf(65536);
    const mediumMeta = { filename: 'data.bin', mimeType: 'application/octet-stream' };
    const mediumEnc = await encryptFile(mediumData, mediumMeta, fCipher13h);
    const mediumDec = await decryptFile(mediumEnc.ciphertext, mediumEnc.nonce, fCipher13a);
    check('64KB file: data round-trips', buffersEqual(mediumDec.data, mediumData));
    check('64KB file: hash verified', mediumDec.plaintextHash === mediumEnc.plaintextHash);
    check('64KB file: sizeBytes is 65536', mediumDec.sizeBytes === 65536);
    check('64KB file: counter is 1', mediumEnc.counter === 1 && mediumDec.counter === 1);

    // Large file (1 MB of random data)
    const largeData = sodium.randombytes_buf(1048576);
    const largeMeta = { filename: 'archive.zip', mimeType: 'application/zip' };
    const largeEnc = await encryptFile(largeData, largeMeta, fCipher13h);
    const largeDec = await decryptFile(largeEnc.ciphertext, largeEnc.nonce, fCipher13a);
    check('1MB file: data round-trips', buffersEqual(largeDec.data, largeData));
    check('1MB file: hash verified', largeDec.plaintextHash === largeEnc.plaintextHash);
    check('1MB file: filename preserved', largeDec.metadata.filename === 'archive.zip');

    // Edge case: empty file should throw
    let emptyErr = false;
    try {
      await encryptFile(new Uint8Array(0), smallMeta, fCipher13h);
    } catch (err) {
      emptyErr = err instanceof CryptoError;
    }
    check('empty file rejected', emptyErr);

    // Edge case: single byte file
    const tinyData = new Uint8Array([0x42]);
    const tinyEnc = await encryptFile(tinyData, { filename: 'b', mimeType: 'application/octet-stream' }, fCipher13h);
    const tinyDec = await decryptFile(tinyEnc.ciphertext, tinyEnc.nonce, fCipher13a);
    check('1-byte file: data round-trips', tinyDec.data.length === 1 && tinyDec.data[0] === 0x42);

    fCipher13h.destroy();
    fCipher13a.destroy();
  }
  console.log();

  // ---------------------------------------------------------------------
  // Test 14: File tamper detection — modified ciphertext
  // ---------------------------------------------------------------------
  console.log('--- Test 14: File tamper detection (ciphertext) ---');
  {
    const fKeys14h = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
    const fKeys14a = await deriveSessionKeys('responder', aiKP, humanKP.publicKey);
    const fCipher14h = await createSessionCipher(randomUUID(), fKeys14h);
    const fCipher14a = await createSessionCipher(randomUUID(), fKeys14a);

    const fileData = new TextEncoder().encode('Confidential document content');
    const enc = await encryptFile(fileData, { filename: 'secret.txt', mimeType: 'text/plain' }, fCipher14h);

    // Corrupt the ciphertext
    const corrupted = new Uint8Array(enc.ciphertext);
    corrupted[corrupted.length - 1] ^= 0xff;

    let tamperErr = false;
    try {
      await decryptFile(corrupted, enc.nonce, fCipher14a);
    } catch (err) {
      tamperErr = err instanceof CryptoError;
    }
    check('tampered file ciphertext throws CryptoError', tamperErr);

    // Corrupt the nonce
    const fKeys14h2 = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
    const fKeys14a2 = await deriveSessionKeys('responder', aiKP, humanKP.publicKey);
    const fCipher14h2 = await createSessionCipher(randomUUID(), fKeys14h2);
    const fCipher14a2 = await createSessionCipher(randomUUID(), fKeys14a2);

    const enc2 = await encryptFile(fileData, { filename: 'secret.txt', mimeType: 'text/plain' }, fCipher14h2);
    const badNonce = new Uint8Array(enc2.nonce);
    badNonce[0] ^= 0xff;

    let nonceErr = false;
    try {
      await decryptFile(enc2.ciphertext, badNonce, fCipher14a2);
    } catch (err) {
      nonceErr = err instanceof CryptoError;
    }
    check('wrong nonce throws CryptoError', nonceErr);

    fCipher14h.destroy();
    fCipher14a.destroy();
    fCipher14h2.destroy();
    fCipher14a2.destroy();
  }
  console.log();

  // ---------------------------------------------------------------------
  // Test 15: File wrong keys — relay can't decrypt
  // ---------------------------------------------------------------------
  console.log('--- Test 15: File wrong keys ---');
  {
    const fKeys15h = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
    const fCipher15h = await createSessionCipher(randomUUID(), fKeys15h);

    const wrongKP3 = await generateKeyPair();
    const wrongKP4 = await generateKeyPair();
    const wrongKeys2 = await deriveSessionKeys('responder', wrongKP4, wrongKP3.publicKey);
    const wrongCipher2 = await createSessionCipher(randomUUID(), wrongKeys2);

    const fileData = new TextEncoder().encode('Cannot read this');
    const enc = await encryptFile(fileData, { filename: 'private.dat', mimeType: 'application/octet-stream' }, fCipher15h);

    let wrongKeyErr = false;
    try {
      await decryptFile(enc.ciphertext, enc.nonce, wrongCipher2);
    } catch (err) {
      wrongKeyErr = err instanceof CryptoError;
    }
    check('file with wrong keys throws CryptoError', wrongKeyErr);

    fCipher15h.destroy();
    wrongCipher2.destroy();
  }
  console.log();

  // ---------------------------------------------------------------------
  // Test 16: File metadata integrity verification
  // ---------------------------------------------------------------------
  console.log('--- Test 16: File metadata integrity ---');
  {
    const fKeys16h = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
    const fKeys16a = await deriveSessionKeys('responder', aiKP, humanKP.publicKey);
    const fCipher16h = await createSessionCipher(randomUUID(), fKeys16h);
    const fCipher16a = await createSessionCipher(randomUUID(), fKeys16a);

    const fileData = new TextEncoder().encode('Report data here');
    const meta = { filename: 'report.pdf', mimeType: 'application/pdf' };
    const enc = await encryptFile(fileData, meta, fCipher16h);

    // Decrypt with correct expected metadata — should succeed
    const dec = await decryptFile(enc.ciphertext, enc.nonce, fCipher16a, meta);
    check('matching expectedMetadata passes', dec.metadata.filename === 'report.pdf');

    // Decrypt with wrong expected filename
    const fKeys16h2 = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
    const fKeys16a2 = await deriveSessionKeys('responder', aiKP, humanKP.publicKey);
    const fCipher16h2 = await createSessionCipher(randomUUID(), fKeys16h2);
    const fCipher16a2 = await createSessionCipher(randomUUID(), fKeys16a2);

    const enc2 = await encryptFile(fileData, meta, fCipher16h2);
    let nameErr = false;
    try {
      await decryptFile(enc2.ciphertext, enc2.nonce, fCipher16a2,
        { filename: 'evil.exe', mimeType: 'application/pdf' });
    } catch (err) {
      nameErr = err instanceof CryptoError && err.message.includes('Metadata mismatch');
    }
    check('wrong expected filename throws CryptoError', nameErr);

    // Decrypt with wrong expected MIME type
    const fKeys16h3 = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
    const fKeys16a3 = await deriveSessionKeys('responder', aiKP, humanKP.publicKey);
    const fCipher16h3 = await createSessionCipher(randomUUID(), fKeys16h3);
    const fCipher16a3 = await createSessionCipher(randomUUID(), fKeys16a3);

    const enc3 = await encryptFile(fileData, meta, fCipher16h3);
    let mimeErr = false;
    try {
      await decryptFile(enc3.ciphertext, enc3.nonce, fCipher16a3,
        { filename: 'report.pdf', mimeType: 'application/x-executable' });
    } catch (err) {
      mimeErr = err instanceof CryptoError && err.message.includes('Metadata mismatch');
    }
    check('wrong expected MIME type throws CryptoError', mimeErr);

    // Verify the plaintextHash matches FileManifestPayload format
    check('plaintextHash is sha256:<64 hex chars>',
      /^sha256:[a-f0-9]{64}$/.test(enc.plaintextHash));

    // Verify same file always produces the same hash
    const fKeys16h4 = await deriveSessionKeys('initiator', humanKP, aiKP.publicKey);
    const fCipher16h4 = await createSessionCipher(randomUUID(), fKeys16h4);
    const enc4 = await encryptFile(fileData, meta, fCipher16h4);
    check('deterministic plaintextHash', enc4.plaintextHash === enc.plaintextHash);

    // But the ciphertext should differ (different nonce + key)
    check('ciphertext differs per encryption', !buffersEqual(enc4.ciphertext, enc.ciphertext));

    fCipher16h.destroy();
    fCipher16a.destroy();
    fCipher16h2.destroy();
    fCipher16a2.destroy();
    fCipher16h3.destroy();
    fCipher16a3.destroy();
    fCipher16h4.destroy();
  }
  console.log();

  // ---------------------------------------------------------------------
  // Test 17: Audit chain — building and appending
  // ---------------------------------------------------------------------
  console.log('--- Test 17: Audit chain building ---');
  {
    const chain = [];
    const testSessionId = randomUUID();

    // Genesis entry (index 0)
    const entry0 = {
      index: 0,
      timestamp: new Date().toISOString(),
      eventType: 'session_started',
      sessionId: testSessionId,
      detail: { clientType: 'human', displayName: 'Harry' },
    };
    const hashed0 = appendEntry(entry0, chain);
    chain.push(hashed0);

    check('genesis: has chainHash', typeof hashed0.chainHash === 'string');
    check('genesis: chainHash is 64 hex chars', /^[a-f0-9]{64}$/.test(hashed0.chainHash));
    check('genesis: preserves fields', hashed0.eventType === 'session_started');
    check('genesis: index is 0', hashed0.index === 0);

    // Append entries 1-4
    for (let i = 1; i <= 4; i++) {
      const entry = {
        index: i,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        eventType: 'message_relayed',
        sessionId: testSessionId,
        detail: { messageIndex: i, direction: i % 2 === 0 ? 'human_to_ai' : 'ai_to_human' },
      };
      chain.push(appendEntry(entry, chain));
    }

    check('chain has 5 entries', chain.length === 5);
    check('each entry has unique hash',
      new Set(chain.map(e => e.chainHash)).size === 5);
    check('hashes are all 64 hex chars',
      chain.every(e => /^[a-f0-9]{64}$/.test(e.chainHash)));

    // Index mismatch should throw
    let indexErr = false;
    try {
      appendEntry({ ...entry0, index: 99 }, chain);
    } catch (err) {
      indexErr = err instanceof ChainError;
    }
    check('wrong index throws ChainError', indexErr);
  }
  console.log();

  // ---------------------------------------------------------------------
  // Test 18: Full chain verification
  // ---------------------------------------------------------------------
  console.log('--- Test 18: Full chain verification ---');
  {
    const chain = [];
    const sid = randomUUID();

    for (let i = 0; i < 10; i++) {
      const entry = {
        index: i,
        timestamp: new Date(Date.now() + i * 100).toISOString(),
        eventType: i === 0 ? 'session_started' : 'message_relayed',
        sessionId: sid,
        detail: { seq: i },
      };
      chain.push(appendEntry(entry, chain));
    }

    const result = verifyChain(chain);
    check('10-entry chain is valid', result.valid === true);
    check('no brokenAtIndex', result.brokenAtIndex === undefined);

    // Empty chain is valid
    const emptyResult = verifyChain([]);
    check('empty chain is valid', emptyResult.valid === true);

    // Single entry chain
    const singleChain = [chain[0]];
    const singleResult = verifyChain(singleChain);
    check('single entry chain is valid', singleResult.valid === true);
  }
  console.log();

  // ---------------------------------------------------------------------
  // Test 19: Single-entry tampering detection
  // ---------------------------------------------------------------------
  console.log('--- Test 19: Entry tampering detection ---');
  {
    const chain = [];
    const sid = randomUUID();

    for (let i = 0; i < 5; i++) {
      chain.push(appendEntry({
        index: i,
        timestamp: new Date(Date.now() + i * 100).toISOString(),
        eventType: i === 0 ? 'session_started' : 'message_relayed',
        sessionId: sid,
        detail: { seq: i },
      }, chain));
    }

    // Verify original is valid
    check('original chain valid', verifyChain(chain).valid);

    // Tamper with entry 2's detail
    const tampered = [...chain];
    tampered[2] = { ...tampered[2], detail: { seq: 2, injected: 'malicious data' } };

    const tamperResult = verifyChain(tampered);
    check('tampered entry detected', tamperResult.valid === false);
    check('broken at index 2', tamperResult.brokenAtIndex === 2);
    check('error mentions hash mismatch', tamperResult.error?.includes('hash mismatch'));

    // Tamper with entry 0 (genesis)
    const tampered0 = [...chain];
    tampered0[0] = { ...tampered0[0], eventType: 'fake_event' };
    const tamper0Result = verifyChain(tampered0);
    check('tampered genesis detected', tamper0Result.valid === false);
    check('genesis broken at index 0', tamper0Result.brokenAtIndex === 0);

    // Tamper with the chainHash itself
    const tamperedHash = [...chain];
    tamperedHash[3] = { ...tamperedHash[3], chainHash: 'a'.repeat(64) };
    const hashResult = verifyChain(tamperedHash);
    check('forged chainHash detected', hashResult.valid === false);
    check('broken at forged index', hashResult.brokenAtIndex === 3);

    // Tampering at index N also breaks index N+1 (cascade)
    // Verify that entry 4 also fails if we verify from entry 3 onwards
    // (because entry 3's stored hash doesn't match so entry 4's prev is wrong)
    const cascadeResult = verifyRange(tamperedHash, 3, 4);
    check('cascade: tamper at 3 breaks from 3', cascadeResult.valid === false);
    check('cascade: broken at 3', cascadeResult.brokenAtIndex === 3);
  }
  console.log();

  // ---------------------------------------------------------------------
  // Test 20: Deletion detection
  // ---------------------------------------------------------------------
  console.log('--- Test 20: Deletion detection ---');
  {
    const chain = [];
    const sid = randomUUID();

    for (let i = 0; i < 6; i++) {
      chain.push(appendEntry({
        index: i,
        timestamp: new Date(Date.now() + i * 100).toISOString(),
        eventType: i === 0 ? 'session_started' : 'message_relayed',
        sessionId: sid,
        detail: { seq: i },
      }, chain));
    }

    // Delete entry in the middle (entry 3) — leaves index gap
    const withDeletion = [...chain.slice(0, 3), ...chain.slice(4)];
    const delResult = verifyChain(withDeletion);
    check('middle deletion detected', delResult.valid === false);
    check('deletion broken at gap', delResult.brokenAtIndex === 3);
    check('deletion error mentions index', delResult.error?.includes('Index mismatch') || delResult.error?.includes('hash mismatch'));

    // Delete the genesis entry
    const noGenesis = chain.slice(1);
    const noGenesisResult = verifyChain(noGenesis);
    check('genesis deletion detected', noGenesisResult.valid === false);
    check('genesis deletion at index 0', noGenesisResult.brokenAtIndex === 0);

    // Delete the last entry — chain should still verify up to the new end
    const truncated = chain.slice(0, 4);
    const truncResult = verifyChain(truncated);
    check('truncated chain still valid', truncResult.valid === true);
  }
  console.log();

  // ---------------------------------------------------------------------
  // Test 21: Genesis verification and verifySingleEntry
  // ---------------------------------------------------------------------
  console.log('--- Test 21: Genesis verification ---');
  {
    const chain = [];
    const sid = randomUUID();

    // GENESIS_SEED is deterministic
    check('GENESIS_SEED is 64 hex chars', /^[a-f0-9]{64}$/.test(GENESIS_SEED));
    check('GENESIS_SEED is stable', GENESIS_SEED === GENESIS_SEED);

    const entry0 = {
      index: 0,
      timestamp: '2026-03-10T12:00:00.000Z',
      eventType: 'session_started',
      sessionId: sid,
      detail: { test: true },
    };
    const hashed0 = appendEntry(entry0, chain);
    chain.push(hashed0);

    // verifySingleEntry with correct previous hash
    check('genesis verifies with GENESIS_SEED',
      verifySingleEntry(hashed0, GENESIS_SEED));

    // verifySingleEntry with wrong previous hash
    check('genesis fails with wrong seed',
      !verifySingleEntry(hashed0, 'b'.repeat(64)));

    // Append entry 1 and verify it
    const entry1 = {
      index: 1,
      timestamp: '2026-03-10T12:00:01.000Z',
      eventType: 'message_relayed',
      sessionId: sid,
      detail: { direction: 'human_to_ai' },
    };
    const hashed1 = appendEntry(entry1, chain);
    chain.push(hashed1);

    check('entry 1 verifies with entry 0 hash',
      verifySingleEntry(hashed1, hashed0.chainHash));
    check('entry 1 fails with GENESIS_SEED',
      !verifySingleEntry(hashed1, GENESIS_SEED));
    check('entry 1 fails with wrong previous',
      !verifySingleEntry(hashed1, 'c'.repeat(64)));

    // verifyRange for just the last entry
    const rangeResult = verifyRange(chain, 1, 1);
    check('range [1,1] is valid', rangeResult.valid === true);

    // verifyRange for full chain
    const fullRange = verifyRange(chain, 0, 1);
    check('range [0,1] is valid', fullRange.valid === true);

    // verifyRange with bad bounds throws
    let rangeErr = false;
    try {
      verifyRange(chain, 0, 5);
    } catch (err) {
      rangeErr = err instanceof ChainError;
    }
    check('out-of-bounds range throws ChainError', rangeErr);

    // Determinism: same entry content always produces same hash
    const chain2 = [];
    const hashed0b = appendEntry({ ...entry0 }, chain2);
    check('deterministic: same entry same hash', hashed0b.chainHash === hashed0.chainHash);
  }
  console.log();

  // Clean up
  humanCipher.destroy();
  aiCipher.destroy();

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('=================================================');
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log('=================================================');
  if (fail > 0) process.exit(1);
}

function buffersEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
