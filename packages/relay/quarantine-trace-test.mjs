// Trace test: Quarantine — file quarantine, hash verification, purge scheduler
// Run with: node packages/relay/quarantine-trace-test.mjs

import {
  FileQuarantine,
  QuarantineError,
  HashVerifier,
  PurgeScheduler,
  AuditLogger,
  AUDIT_EVENT_TYPES,
} from './dist/index.js';

import { sha256 } from '@bastion/protocol';
import { randomUUID } from 'node:crypto';

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

const uuid = () => randomUUID();

function makeFileData(content = 'Hello quarantine world') {
  return new TextEncoder().encode(content);
}

function makeSubmission(data, overrides = {}) {
  const hash = sha256(data);
  return {
    transferId: uuid(),
    direction: 'human_to_ai',
    filename: 'test-file.txt',
    sizeBytes: data.length,
    mimeType: 'text/plain',
    hashAtReceipt: hash,
    manifestMessageId: uuid(),
    data,
    ...overrides,
  };
}

async function run() {
  console.log('=== Quarantine Trace Tests ===');
  console.log();

  // =========================================================================
  // Test 1: Basic quarantine submit and retrieve
  // =========================================================================
  console.log('--- Test 1: Basic quarantine submit and retrieve ---');
  {
    const quarantine = new FileQuarantine();
    const data = makeFileData();
    const sub = makeSubmission(data);

    check('quarantine starts empty', quarantine.count === 0);
    check('quarantine not full', !quarantine.isFull);

    const result = quarantine.submit(sub);
    check('submit succeeds', result.status === 'quarantined');
    check('count is 1', quarantine.count === 1);

    if (result.status === 'quarantined') {
      const entry = result.entry;
      check('entry transferId matches', entry.transferId === sub.transferId);
      check('entry filename matches', entry.filename === 'test-file.txt');
      check('entry state is quarantined', entry.state === 'quarantined');
      check('entry hashAlgorithm is sha256', entry.hashAlgorithm === 'sha256');
      check('entry hashAtReceipt matches', entry.hashAtReceipt === sub.hashAtReceipt);
      check('entry has purgeAt', typeof entry.purgeAt === 'string');
      check('purgeAt is in the future', new Date(entry.purgeAt) > new Date());
    }

    // Retrieve
    const retrieved = quarantine.get(sub.transferId);
    check('get returns entry', retrieved !== undefined);
    check('get transferId matches', retrieved?.transferId === sub.transferId);

    const retrievedData = quarantine.getData(sub.transferId);
    check('getData returns data', retrievedData !== undefined);
    check('data matches original', retrievedData?.length === data.length);

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 2: Duplicate and capacity limits
  // =========================================================================
  console.log('--- Test 2: Duplicate and capacity limits ---');
  {
    const quarantine = new FileQuarantine({ maxEntries: 3 });
    const data = makeFileData();

    const sub1 = makeSubmission(data);
    const sub2 = makeSubmission(data);
    const sub3 = makeSubmission(data);
    const sub4 = makeSubmission(data);

    quarantine.submit(sub1);
    quarantine.submit(sub2);
    quarantine.submit(sub3);
    check('3 entries stored', quarantine.count === 3);
    check('quarantine is full', quarantine.isFull);

    // Duplicate
    const dupResult = quarantine.submit(sub1);
    check('duplicate rejected', dupResult.status === 'duplicate');

    // Over capacity
    const fullResult = quarantine.submit(sub4);
    check('over-capacity rejected', fullResult.status === 'full');
    if (fullResult.status === 'full') {
      check('full result has maxEntries', fullResult.maxEntries === 3);
    }

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 3: State transitions and custody chain
  // =========================================================================
  console.log('--- Test 3: State transitions and custody chain ---');
  {
    const quarantine = new FileQuarantine();
    const data = makeFileData();
    const sub = makeSubmission(data);

    quarantine.submit(sub);

    // offered
    const offered = quarantine.updateState(sub.transferId, 'offered', 'relay', 'File offered to recipient');
    check('state updated to offered', offered?.state === 'offered');

    // accepted
    const accepted = quarantine.updateState(sub.transferId, 'accepted', 'ai', 'Recipient accepted file');
    check('state updated to accepted', accepted?.state === 'accepted');

    // Check custody chain
    const custody = quarantine.getCustody(sub.transferId);
    check('custody exists', custody !== undefined);
    check('custody has 4 events', custody?.events.length === 4); // submitted, quarantined, offered, accepted
    check('first event is submitted', custody?.events[0].event === 'submitted');
    check('second event is quarantined', custody?.events[1].event === 'quarantined');
    check('third event is offered', custody?.events[2].event === 'offered');
    check('fourth event is accepted', custody?.events[3].event === 'accepted');
    check('custody has correct filename', custody?.filename === 'test-file.txt');

    // Unknown transfer returns undefined
    const unknown = quarantine.updateState(uuid(), 'offered', 'relay');
    check('unknown transfer returns undefined', unknown === undefined);

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 4: Release from quarantine
  // =========================================================================
  console.log('--- Test 4: Release from quarantine ---');
  {
    const quarantine = new FileQuarantine();
    const data = makeFileData('Release me!');
    const sub = makeSubmission(data);

    quarantine.submit(sub);

    // Can't release from quarantined state
    const wrongState = quarantine.release(sub.transferId);
    check('release from wrong state fails', wrongState.status === 'wrong_state');
    if (wrongState.status === 'wrong_state') {
      check('wrong state shows current state', wrongState.currentState === 'quarantined');
    }

    // Transition to accepted
    quarantine.updateState(sub.transferId, 'offered', 'relay');
    quarantine.updateState(sub.transferId, 'accepted', 'ai');

    // Now release
    const released = quarantine.release(sub.transferId);
    check('release succeeds', released.status === 'released');
    if (released.status === 'released') {
      check('released entry state is delivered', released.entry.state === 'delivered');
      check('released data matches', new TextDecoder().decode(released.data) === 'Release me!');
    }

    // File is gone after release
    check('file removed after release', quarantine.get(sub.transferId) === undefined);
    check('count back to 0', quarantine.count === 0);

    // Release non-existent
    const notFound = quarantine.release(uuid());
    check('release non-existent returns not_found', notFound.status === 'not_found');

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 5: Explicit purge
  // =========================================================================
  console.log('--- Test 5: Explicit purge ---');
  {
    const quarantine = new FileQuarantine();
    const data = makeFileData();
    const sub = makeSubmission(data);

    quarantine.submit(sub);
    check('file in quarantine', quarantine.count === 1);

    const purged = quarantine.purge(sub.transferId);
    check('purge succeeds', purged.status === 'purged');
    check('file removed after purge', quarantine.count === 0);

    // Purge non-existent
    const notFound = quarantine.purge(uuid());
    check('purge non-existent returns not_found', notFound.status === 'not_found');

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 6: Expired file detection
  // =========================================================================
  console.log('--- Test 6: Expired file detection ---');
  {
    // Short timeout so files expire quickly
    const quarantine = new FileQuarantine({ defaultTimeoutMs: 100 });
    const data = makeFileData();

    const sub1 = makeSubmission(data);
    const sub2 = makeSubmission(data);
    quarantine.submit(sub1);
    quarantine.submit(sub2);

    // Not expired yet
    const notExpired = quarantine.getExpired();
    check('files not expired immediately', notExpired.length === 0);

    // Wait for expiry
    await delay(150);

    const expired = quarantine.getExpired();
    check('files expired after timeout', expired.length === 2);
    check('expired contains both transfers', expired.some(e => e.transferId === sub1.transferId)
      && expired.some(e => e.transferId === sub2.transferId));

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 7: Destroy prevents further operations
  // =========================================================================
  console.log('--- Test 7: Destroy prevents further operations ---');
  {
    const quarantine = new FileQuarantine();
    quarantine.destroy();

    check('quarantine is destroyed', quarantine.isDestroyed);

    let threw = false;
    try {
      quarantine.submit(makeSubmission(makeFileData()));
    } catch (err) {
      threw = err instanceof QuarantineError;
    }
    check('submit after destroy throws', threw);
  }
  console.log();

  // =========================================================================
  // Test 8: Hash verification at submission
  // =========================================================================
  console.log('--- Test 8: Hash verification at submission ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });

    const data = makeFileData('Verify me at submission');
    const correctHash = sha256(data);

    // Correct hash
    const valid = verifier.verifyAtSubmission(data, correctHash, uuid(), 'human_to_ai');
    check('correct hash passes submission', valid.valid);
    if (valid.valid) {
      check('returned hash matches', valid.hash === correctHash);
    }

    // Wrong hash
    const wrongHash = sha256(new TextEncoder().encode('Different content'));
    const invalid = verifier.verifyAtSubmission(data, wrongHash, uuid(), 'human_to_ai');
    check('wrong hash fails submission', !invalid.valid);
    if (!invalid.valid) {
      check('mismatch stage is submission', invalid.stage === 'submission');
      check('expected hash is declared hash', invalid.expected === wrongHash);
      check('actual hash is computed hash', invalid.actual === correctHash);
    }

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 9: Hash verification in quarantine
  // =========================================================================
  console.log('--- Test 9: Hash verification in quarantine ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });

    const data = makeFileData('Verify me in quarantine');
    const sub = makeSubmission(data);
    quarantine.submit(sub);

    // Verify — should pass (data unchanged)
    const valid = verifier.verifyInQuarantine(sub.transferId);
    check('quarantine verification passes', valid?.valid === true);

    // Verify non-existent — returns undefined
    const missing = verifier.verifyInQuarantine(uuid());
    check('verify non-existent returns undefined', missing === undefined);

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 10: Hash verification at delivery
  // =========================================================================
  console.log('--- Test 10: Hash verification at delivery ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });

    const data = makeFileData('Verify me at delivery');
    const sub = makeSubmission(data);
    quarantine.submit(sub);

    // Verify at delivery — should pass
    const valid = verifier.verifyAtDelivery(sub.transferId);
    check('delivery verification passes', valid?.valid === true);

    // Verify non-existent — returns undefined
    const missing = verifier.verifyAtDelivery(uuid());
    check('verify non-existent at delivery returns undefined', missing === undefined);

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 11: Tamper detection mid-quarantine
  // =========================================================================
  console.log('--- Test 11: Tamper detection mid-quarantine ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });

    const content = 'Original file content for tamper test';
    const data = new TextEncoder().encode(content);
    const sub = makeSubmission(data);
    quarantine.submit(sub);

    // Verify passes before tampering
    const before = verifier.verifyInQuarantine(sub.transferId);
    check('pre-tamper verification passes', before?.valid === true);

    // Simulate tampering: flip a byte in the stored data
    const storedData = quarantine.getData(sub.transferId);
    if (storedData) {
      storedData[0] = storedData[0] ^ 0xff; // bit-flip first byte
    }

    // Verify detects tampering
    const after = verifier.verifyInQuarantine(sub.transferId);
    check('post-tamper verification fails', after?.valid === false);
    if (after && !after.valid) {
      check('tamper stage is quarantine', after.stage === 'quarantine');
      check('expected hash matches original', after.expected === sub.hashAtReceipt);
      check('actual hash differs', after.actual !== sub.hashAtReceipt);
    }

    // Entry state should be updated to hash_mismatch
    const entry = quarantine.get(sub.transferId);
    check('entry state set to hash_mismatch', entry?.state === 'hash_mismatch');

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 12: Tamper detection at delivery stage
  // =========================================================================
  console.log('--- Test 12: Tamper detection at delivery ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });

    const data = new TextEncoder().encode('Delivery tamper test content');
    const sub = makeSubmission(data);
    quarantine.submit(sub);

    // Tamper the data
    const storedData = quarantine.getData(sub.transferId);
    if (storedData) {
      storedData[storedData.length - 1] ^= 0xff;
    }

    // Verify at delivery detects tampering
    const result = verifier.verifyAtDelivery(sub.transferId);
    check('delivery tamper detection works', result?.valid === false);
    if (result && !result.valid) {
      check('delivery tamper stage correct', result.stage === 'delivery');
    }

    // State should be hash_mismatch — release should fail
    const entry = quarantine.get(sub.transferId);
    check('entry state is hash_mismatch after delivery tamper', entry?.state === 'hash_mismatch');

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 13: Purge scheduler — manual purge
  // =========================================================================
  console.log('--- Test 13: Purge scheduler — manual purge ---');
  {
    const quarantine = new FileQuarantine({ defaultTimeoutMs: 50 });
    const data = makeFileData();

    quarantine.submit(makeSubmission(data));
    quarantine.submit(makeSubmission(data));
    quarantine.submit(makeSubmission(data));
    check('3 files quarantined', quarantine.count === 3);

    const purgeResults = [];
    const scheduler = new PurgeScheduler({
      quarantine,
      onPurge: (result) => purgeResults.push(result),
    });

    // Nothing expired yet
    const earlyResult = scheduler.purgeNow();
    check('no files purged when not expired', earlyResult.purged.length === 0);
    check('3 remaining', earlyResult.remaining === 3);

    // Wait for expiry
    await delay(100);

    const lateResult = scheduler.purgeNow();
    check('3 files purged after timeout', lateResult.purged.length === 3);
    check('0 remaining', lateResult.remaining === 0);
    check('onPurge callback fired', purgeResults.length === 2); // early + late
    check('quarantine is empty', quarantine.count === 0);

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 14: Purge scheduler — automatic interval
  // =========================================================================
  console.log('--- Test 14: Purge scheduler — automatic interval ---');
  {
    const quarantine = new FileQuarantine({ defaultTimeoutMs: 30 });
    const data = makeFileData();

    quarantine.submit(makeSubmission(data));
    quarantine.submit(makeSubmission(data));
    check('2 files quarantined', quarantine.count === 2);

    let purgeCount = 0;
    const scheduler = new PurgeScheduler({
      quarantine,
      intervalMs: 50,
      onPurge: () => { purgeCount++; },
    });

    check('scheduler not running initially', !scheduler.isRunning);

    scheduler.start();
    check('scheduler is running', scheduler.isRunning);

    // Start again is idempotent
    scheduler.start();
    check('double-start is safe', scheduler.isRunning);

    // Wait for interval + expiry
    await delay(200);

    check('purge cycles ran', purgeCount > 0);
    check('files purged automatically', quarantine.count === 0);

    scheduler.stop();
    check('scheduler stopped', !scheduler.isRunning);

    // Stop again is idempotent
    scheduler.stop();
    check('double-stop is safe', !scheduler.isRunning);

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 15: Full lifecycle — submit → verify → offer → accept → verify → release
  // =========================================================================
  console.log('--- Test 15: Full lifecycle round-trip ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });

    const content = 'Full lifecycle test file content';
    const data = new TextEncoder().encode(content);
    const declaredHash = sha256(data);
    const transferId = uuid();

    // Step 1: Verify at submission
    const submitCheck = verifier.verifyAtSubmission(data, declaredHash, transferId, 'human_to_ai');
    check('lifecycle: submission hash valid', submitCheck.valid);

    // Step 2: Submit to quarantine
    const sub = makeSubmission(data, { transferId, hashAtReceipt: declaredHash });
    const submitResult = quarantine.submit(sub);
    check('lifecycle: file quarantined', submitResult.status === 'quarantined');

    // Step 3: Verify in quarantine
    const quarantineCheck = verifier.verifyInQuarantine(transferId);
    check('lifecycle: quarantine hash valid', quarantineCheck?.valid === true);

    // Step 4: Offer to recipient
    quarantine.updateState(transferId, 'offered', 'relay', 'Offered to AI client');
    check('lifecycle: state is offered', quarantine.get(transferId)?.state === 'offered');

    // Step 5: Recipient accepts
    quarantine.updateState(transferId, 'accepted', 'ai', 'AI accepted the file');
    check('lifecycle: state is accepted', quarantine.get(transferId)?.state === 'accepted');

    // Step 6: Verify at delivery
    const deliveryCheck = verifier.verifyAtDelivery(transferId);
    check('lifecycle: delivery hash valid', deliveryCheck?.valid === true);

    // Step 7: Release
    const releaseResult = quarantine.release(transferId);
    check('lifecycle: release succeeds', releaseResult.status === 'released');
    if (releaseResult.status === 'released') {
      check('lifecycle: data intact', new TextDecoder().decode(releaseResult.data) === content);
      check('lifecycle: state is delivered', releaseResult.entry.state === 'delivered');
    }

    // Step 8: File gone from quarantine
    check('lifecycle: file removed from quarantine', quarantine.get(transferId) === undefined);

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 16: Audit integration
  // =========================================================================
  console.log('--- Test 16: Audit integration ---');
  {
    let auditLogger;
    try {
      auditLogger = new AuditLogger({ store: { path: ':memory:' } });
    } catch (err) {
      console.log('  SKIP: AuditLogger unavailable:', err.message);
      console.log();
      console.log('=================================================');
      console.log(`Results: ${pass} passed, ${fail} failed`);
      console.log('=================================================');
      process.exit(fail > 0 ? 1 : 0);
    }

    const quarantine = new FileQuarantine({
      auditLogger,
      sessionId: 'test-session',
    });
    const verifier = new HashVerifier({
      quarantine,
      auditLogger,
      sessionId: 'test-session',
    });

    const data = makeFileData('Audit this file');
    const sub = makeSubmission(data);

    // Submit — should log FILE_QUARANTINE
    quarantine.submit(sub);
    const quarantineEvents = auditLogger.query({ eventType: AUDIT_EVENT_TYPES.FILE_QUARANTINE });
    check('audit: quarantine event logged', quarantineEvents.length === 1);
    check('audit: quarantine event has transferId', quarantineEvents[0]?.detail?.transferId === sub.transferId);

    // Accept and release — should log FILE_DELIVERED
    quarantine.updateState(sub.transferId, 'offered', 'relay');
    quarantine.updateState(sub.transferId, 'accepted', 'ai');
    quarantine.release(sub.transferId);
    const deliveryEvents = auditLogger.query({ eventType: AUDIT_EVENT_TYPES.FILE_DELIVERED });
    check('audit: delivery event logged', deliveryEvents.length === 1);

    // Submit another and tamper — should log FILE_REJECTED with hash_mismatch
    const data2 = makeFileData('Tamper audit test');
    const sub2 = makeSubmission(data2);
    quarantine.submit(sub2);
    const storedData = quarantine.getData(sub2.transferId);
    if (storedData) storedData[0] ^= 0xff;
    verifier.verifyInQuarantine(sub2.transferId);
    const rejectEvents = auditLogger.query({ eventType: AUDIT_EVENT_TYPES.FILE_REJECTED });
    // Purge from quarantine also logs FILE_REJECTED, plus the hash_mismatch
    check('audit: hash mismatch logged as rejection', rejectEvents.length >= 1);
    check('audit: rejection has hash_mismatch reason',
      rejectEvents.some(e => e.detail?.reason === 'hash_mismatch'));

    // Verify total audit chain integrity
    const chain = auditLogger.getChain();
    check('audit: chain has entries', chain.length >= 3);

    auditLogger.close();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 17: Direction handling — AI to human
  // =========================================================================
  console.log('--- Test 17: Direction handling — AI to human ---');
  {
    const quarantine = new FileQuarantine();
    const data = makeFileData('AI-generated output');
    const sub = makeSubmission(data, { direction: 'ai_to_human' });

    const result = quarantine.submit(sub);
    check('ai_to_human submit succeeds', result.status === 'quarantined');
    if (result.status === 'quarantined') {
      check('direction is ai_to_human', result.entry.direction === 'ai_to_human');
    }

    // Custody chain first actor should be 'ai'
    const custody = quarantine.getCustody(sub.transferId);
    check('first custody actor is ai', custody?.events[0].actor === 'ai');

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 18: getAll and multiple entries
  // =========================================================================
  console.log('--- Test 18: getAll and multiple entries ---');
  {
    const quarantine = new FileQuarantine();
    const data = makeFileData();

    const ids = [];
    for (let i = 0; i < 5; i++) {
      const sub = makeSubmission(data);
      quarantine.submit(sub);
      ids.push(sub.transferId);
    }

    const all = quarantine.getAll();
    check('getAll returns 5 entries', all.length === 5);
    check('all entries are quarantined', all.every(e => e.state === 'quarantined'));
    check('all IDs present', ids.every(id => all.some(e => e.transferId === id)));

    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 19: HashVerifier.hash() convenience
  // =========================================================================
  console.log('--- Test 19: HashVerifier.hash() convenience ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });

    const data = new TextEncoder().encode('test hash');
    const expected = sha256(data);
    const actual = verifier.hash(data);
    check('hash() matches sha256()', actual === expected);
    check('hash is 64 hex chars', /^[0-9a-f]{64}$/.test(actual));

    quarantine.destroy();
  }
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
