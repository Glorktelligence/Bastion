// Trace test: File transfer routing — manifest/offer/request workflow
// Run with: node packages/relay/file-transfer-trace-test.mjs

import {
  FileQuarantine,
  HashVerifier,
  FileTransferRouter,
} from './dist/index.js';

import { sha256, MESSAGE_TYPES, PROTOCOL_VERSION } from '@bastion/protocol';
import { randomUUID } from 'node:crypto';

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

const uuid = () => randomUUID();

function makeFileData(content = 'Test file content for transfer') {
  return new TextEncoder().encode(content);
}

/**
 * Mock send function that captures sent messages.
 */
function createMockSend() {
  const sent = [];
  const send = (connectionId, data) => {
    sent.push({ connectionId, data, parsed: JSON.parse(data) });
    return true;
  };
  return { send, sent };
}

/**
 * Extract payload from a relay-generated envelope.
 * Relay envelopes carry the payload as base64-encoded JSON in encryptedPayload.
 */
function extractPayload(envelope) {
  const parsed = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
  if (parsed.encryptedPayload) {
    return JSON.parse(Buffer.from(parsed.encryptedPayload, 'base64').toString('utf-8'));
  }
  return parsed.payload;
}

async function run() {
  console.log('=== File Transfer Routing Tests ===');
  console.log();

  // =========================================================================
  // Test 1: Human→AI — submit file, manifest sent to AI (no file content)
  // =========================================================================
  console.log('--- Test 1: Human→AI file submission ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    const { send, sent } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const data = makeFileData('Report data for analysis');
    const transferId = uuid();
    const recipientId = 'ai-conn-1';

    const result = ftr.submitFile({
      transferId,
      direction: 'human_to_ai',
      sender: { id: uuid(), type: 'human', displayName: 'Alice' },
      filename: 'report.csv',
      sizeBytes: data.length,
      mimeType: 'text/csv',
      declaredHash: sha256(data),
      data,
      purpose: 'Data analysis',
      projectContext: 'Q4 review',
      recipientConnectionId: recipientId,
    });

    check('submit succeeds', result.status === 'submitted');
    check('manifest message ID returned', result.status === 'submitted' && typeof result.manifestMessageId === 'string');
    check('one message sent', sent.length === 1);
    check('sent to correct recipient', sent[0].connectionId === recipientId);

    // Verify the manifest envelope
    const envelope = sent[0].parsed;
    check('envelope type is file_manifest', envelope.type === MESSAGE_TYPES.FILE_MANIFEST);
    check('envelope sender is relay', envelope.sender.type === 'relay');
    check('envelope has version', envelope.version === PROTOCOL_VERSION);

    // Verify the manifest payload contains ONLY metadata, NO file content
    const payload = extractPayload(envelope);
    check('manifest has transferId', payload.transferId === transferId);
    check('manifest has filename', payload.filename === 'report.csv');
    check('manifest has sizeBytes', payload.sizeBytes === data.length);
    check('manifest has hash', payload.hash === sha256(data));
    check('manifest has hashAlgorithm', payload.hashAlgorithm === 'sha256');
    check('manifest has mimeType', payload.mimeType === 'text/csv');
    check('manifest has purpose', payload.purpose === 'Data analysis');
    check('manifest has projectContext', payload.projectContext === 'Q4 review');

    // CRITICAL: No file content in manifest
    check('manifest has NO fileData', payload.fileData === undefined);
    check('manifest has NO data field', payload.data === undefined);

    // Verify quarantine state
    const entry = quarantine.get(transferId);
    check('quarantine entry exists', entry !== undefined);
    check('quarantine state is offered', entry?.state === 'offered');

    // Verify pending transfer tracked
    check('active transfer count is 1', ftr.activeTransferCount === 1);
    check('transfer is tracked', ftr.getTransfer(transferId) !== undefined);

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 2: AI→Human — submit file, offer sent to human (no file content)
  // =========================================================================
  console.log('--- Test 2: AI→Human file submission ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    const { send, sent } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const data = makeFileData('Generated analysis output');
    const transferId = uuid();
    const recipientId = 'human-conn-1';
    const taskId = uuid();

    const result = ftr.submitFile({
      transferId,
      direction: 'ai_to_human',
      sender: { id: uuid(), type: 'ai', displayName: 'Claude' },
      filename: 'analysis.json',
      sizeBytes: data.length,
      mimeType: 'application/json',
      declaredHash: sha256(data),
      data,
      purpose: 'Analysis results',
      taskId,
      recipientConnectionId: recipientId,
    });

    check('submit succeeds', result.status === 'submitted');
    check('one message sent', sent.length === 1);
    check('sent to human', sent[0].connectionId === recipientId);

    // Verify the offer envelope
    const envelope = sent[0].parsed;
    check('envelope type is file_offer', envelope.type === MESSAGE_TYPES.FILE_OFFER);

    // Verify the offer payload
    const payload = extractPayload(envelope);
    check('offer has transferId', payload.transferId === transferId);
    check('offer has filename', payload.filename === 'analysis.json');
    check('offer has sizeBytes', payload.sizeBytes === data.length);
    check('offer has hash', payload.hash === sha256(data));
    check('offer has mimeType', payload.mimeType === 'application/json');
    check('offer has purpose', payload.purpose === 'Analysis results');
    check('offer has taskId', payload.taskId === taskId);

    // CRITICAL: No file content in offer
    check('offer has NO fileData', payload.fileData === undefined);
    check('offer has NO data field', payload.data === undefined);

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 3: Human→AI — full acceptance flow
  // =========================================================================
  console.log('--- Test 3: Human→AI acceptance flow ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    const { send, sent } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const content = 'Secret file content for AI to read';
    const data = makeFileData(content);
    const transferId = uuid();
    const aiConnId = 'ai-conn-2';

    // Step 1: Human submits file
    ftr.submitFile({
      transferId,
      direction: 'human_to_ai',
      sender: { id: uuid(), type: 'human', displayName: 'Alice' },
      filename: 'secret.txt',
      sizeBytes: data.length,
      mimeType: 'text/plain',
      declaredHash: sha256(data),
      data,
      purpose: 'Confidential analysis',
      projectContext: 'Internal',
      recipientConnectionId: aiConnId,
    });

    check('manifest sent to AI', sent.length === 1);
    const manifestPayload = extractPayload(sent[0].parsed);
    check('manifest has no file content', manifestPayload.fileData === undefined && manifestPayload.data === undefined);

    // Step 2: AI requests the file
    const reqResult = ftr.handleFileRequest(transferId, aiConnId);
    check('request succeeds', reqResult.status === 'delivered');
    check('delivered size matches', reqResult.status === 'delivered' && reqResult.sizeBytes === data.length);

    // Step 3: Verify file data was sent to AI
    check('two messages total (manifest + file data)', sent.length === 2);
    const fileDelivery = sent[1].parsed;
    check('file delivery sent to AI', sent[1].connectionId === aiConnId);
    check('file delivery has fileData', typeof fileDelivery.fileData === 'string');
    check('file delivery has transferId', fileDelivery.transferId === transferId);
    check('file delivery has hash', fileDelivery.hash === sha256(data));

    // Decode the file data and verify content
    const decodedData = Buffer.from(fileDelivery.fileData, 'base64');
    check('decoded data matches original', new TextDecoder().decode(decodedData) === content);

    // Quarantine should be empty now (released)
    check('quarantine empty after release', quarantine.count === 0);
    check('transfer tracking cleared', ftr.activeTransferCount === 0);

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 4: AI→Human — full acceptance flow
  // =========================================================================
  console.log('--- Test 4: AI→Human acceptance flow ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    const { send, sent } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const content = 'AI-generated report content';
    const data = makeFileData(content);
    const transferId = uuid();
    const humanConnId = 'human-conn-2';

    // Step 1: AI submits file
    ftr.submitFile({
      transferId,
      direction: 'ai_to_human',
      sender: { id: uuid(), type: 'ai', displayName: 'Claude' },
      filename: 'report.pdf',
      sizeBytes: data.length,
      mimeType: 'application/pdf',
      declaredHash: sha256(data),
      data,
      purpose: 'Analysis report',
      recipientConnectionId: humanConnId,
    });

    check('offer sent to human', sent.length === 1);
    check('offer type is file_offer', sent[0].parsed.type === MESSAGE_TYPES.FILE_OFFER);

    // Step 2: Human accepts (requests) the file
    const reqResult = ftr.handleFileRequest(transferId, humanConnId);
    check('request succeeds', reqResult.status === 'delivered');

    // Step 3: Verify file data was sent to human
    check('two messages total', sent.length === 2);
    const fileDelivery = sent[1].parsed;
    check('file data sent to human', sent[1].connectionId === humanConnId);
    const decodedData = Buffer.from(fileDelivery.fileData, 'base64');
    check('decoded data matches', new TextDecoder().decode(decodedData) === content);

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 5: Rejection flow — recipient declines file
  // =========================================================================
  console.log('--- Test 5: Rejection flow ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    const { send, sent } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const data = makeFileData('Unwanted file');
    const transferId = uuid();
    const aiConnId = 'ai-conn-3';

    // Submit
    ftr.submitFile({
      transferId,
      direction: 'human_to_ai',
      sender: { id: uuid(), type: 'human', displayName: 'Alice' },
      filename: 'unwanted.bin',
      sizeBytes: data.length,
      mimeType: 'application/octet-stream',
      declaredHash: sha256(data),
      data,
      purpose: 'Test',
      projectContext: 'Test',
      recipientConnectionId: aiConnId,
    });

    check('file submitted', quarantine.count === 1);
    check('manifest sent', sent.length === 1);

    // Reject
    const rejectResult = ftr.handleFileReject(transferId);
    check('reject succeeds', rejectResult.status === 'rejected');
    check('quarantine empty after reject', quarantine.count === 0);
    check('transfer tracking cleared', ftr.activeTransferCount === 0);

    // Only manifest was sent — no file data sent
    check('only 1 message sent (manifest only)', sent.length === 1);

    // Requesting after rejection fails
    const reqResult = ftr.handleFileRequest(transferId, aiConnId);
    check('request after rejection fails', reqResult.status === 'not_found');

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 6: Hash mismatch at submission — file rejected before quarantine
  // =========================================================================
  console.log('--- Test 6: Hash mismatch at submission ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    const { send, sent } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const data = makeFileData('Real content');
    const wrongHash = sha256(makeFileData('Different content'));

    const result = ftr.submitFile({
      transferId: uuid(),
      direction: 'human_to_ai',
      sender: { id: uuid(), type: 'human', displayName: 'Alice' },
      filename: 'tampered.txt',
      sizeBytes: data.length,
      mimeType: 'text/plain',
      declaredHash: wrongHash, // Wrong hash!
      data,
      purpose: 'Test',
      projectContext: 'Test',
      recipientConnectionId: 'ai-conn-4',
    });

    check('submission rejected for hash mismatch', result.status === 'hash_mismatch');
    if (result.status === 'hash_mismatch') {
      check('expected hash is declared', result.expected === wrongHash);
      check('actual hash is computed', result.actual === sha256(data));
    }
    check('nothing sent on hash mismatch', sent.length === 0);
    check('nothing quarantined on hash mismatch', quarantine.count === 0);

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 7: Tamper detection at delivery — file tampered in quarantine
  // =========================================================================
  console.log('--- Test 7: Tamper detection at delivery ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    const { send, sent } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const data = makeFileData('File that will be tampered');
    const transferId = uuid();
    const aiConnId = 'ai-conn-5';

    // Submit normally
    ftr.submitFile({
      transferId,
      direction: 'human_to_ai',
      sender: { id: uuid(), type: 'human', displayName: 'Alice' },
      filename: 'tampered-later.txt',
      sizeBytes: data.length,
      mimeType: 'text/plain',
      declaredHash: sha256(data),
      data,
      purpose: 'Test',
      projectContext: 'Test',
      recipientConnectionId: aiConnId,
    });

    // Tamper the stored data
    const storedData = quarantine.getData(transferId);
    if (storedData) {
      storedData[0] ^= 0xff; // bit-flip
    }

    // Request should fail due to hash mismatch at delivery
    const reqResult = ftr.handleFileRequest(transferId, aiConnId);
    check('delivery blocked on tamper', reqResult.status === 'hash_mismatch_at_delivery');

    // Only manifest was sent — no file data leaked
    check('only manifest sent (no file data leaked)', sent.length === 1);
    check('manifest has no fileData', extractPayload(sent[0].parsed).fileData === undefined);

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 8: Quarantine full — submission rejected
  // =========================================================================
  console.log('--- Test 8: Quarantine full ---');
  {
    const quarantine = new FileQuarantine({ maxEntries: 1 });
    const verifier = new HashVerifier({ quarantine });
    const { send, sent } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const data = makeFileData('File 1');

    // First file succeeds
    ftr.submitFile({
      transferId: uuid(),
      direction: 'human_to_ai',
      sender: { id: uuid(), type: 'human', displayName: 'Alice' },
      filename: 'first.txt',
      sizeBytes: data.length,
      mimeType: 'text/plain',
      declaredHash: sha256(data),
      data,
      purpose: 'Test',
      projectContext: 'Test',
      recipientConnectionId: 'ai-conn-6',
    });

    // Second file fails — quarantine full
    const data2 = makeFileData('File 2');
    const result = ftr.submitFile({
      transferId: uuid(),
      direction: 'human_to_ai',
      sender: { id: uuid(), type: 'human', displayName: 'Alice' },
      filename: 'second.txt',
      sizeBytes: data2.length,
      mimeType: 'text/plain',
      declaredHash: sha256(data2),
      data: data2,
      purpose: 'Test',
      projectContext: 'Test',
      recipientConnectionId: 'ai-conn-6',
    });

    check('quarantine full rejection', result.status === 'quarantine_full');

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 9: Send failure — rollback quarantine
  // =========================================================================
  console.log('--- Test 9: Send failure rollback ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    // Send always fails
    const failSend = (_connectionId, _data) => false;
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send: failSend });

    const data = makeFileData('File for failed send');
    const transferId = uuid();

    const result = ftr.submitFile({
      transferId,
      direction: 'human_to_ai',
      sender: { id: uuid(), type: 'human', displayName: 'Alice' },
      filename: 'unsendable.txt',
      sizeBytes: data.length,
      mimeType: 'text/plain',
      declaredHash: sha256(data),
      data,
      purpose: 'Test',
      projectContext: 'Test',
      recipientConnectionId: 'ai-conn-7',
    });

    check('send failure detected', result.status === 'send_failed');
    check('quarantine rolled back', quarantine.count === 0);
    check('no pending transfers', ftr.activeTransferCount === 0);

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 10: Request non-existent transfer
  // =========================================================================
  console.log('--- Test 10: Request / reject non-existent ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    const { send } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const reqResult = ftr.handleFileRequest(uuid(), 'conn-x');
    check('request non-existent returns not_found', reqResult.status === 'not_found');

    const rejResult = ftr.handleFileReject(uuid());
    check('reject non-existent returns not_found', rejResult.status === 'not_found');

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 11: No file content in manifest — deep verification
  // =========================================================================
  console.log('--- Test 11: No file content leak — deep check ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    const { send, sent } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const secretContent = 'TOP SECRET FILE DATA — MUST NOT APPEAR IN MANIFEST';
    const data = makeFileData(secretContent);
    const secretBase64 = Buffer.from(data).toString('base64');

    ftr.submitFile({
      transferId: uuid(),
      direction: 'human_to_ai',
      sender: { id: uuid(), type: 'human', displayName: 'Alice' },
      filename: 'secret.txt',
      sizeBytes: data.length,
      mimeType: 'text/plain',
      declaredHash: sha256(data),
      data,
      purpose: 'Top secret analysis',
      projectContext: 'Classified',
      recipientConnectionId: 'ai-conn-8',
    });

    // The raw JSON of the manifest message must not contain the file content
    const rawJson = sent[0].data;
    check('raw manifest does not contain secret text', !rawJson.includes(secretContent));
    check('raw manifest does not contain base64 file data', !rawJson.includes(secretBase64));

    // Decode the encrypted payload and verify it's just metadata
    const payload = extractPayload(sent[0].parsed);
    const payloadStr = JSON.stringify(payload);
    check('payload JSON does not contain secret text', !payloadStr.includes(secretContent));
    check('payload JSON does not contain base64 file data', !payloadStr.includes(secretBase64));

    // Verify only expected keys in payload
    const payloadKeys = Object.keys(payload).sort();
    const expectedKeys = ['filename', 'hash', 'hashAlgorithm', 'mimeType', 'projectContext', 'purpose', 'sizeBytes', 'transferId'].sort();
    check('manifest payload has exactly expected keys', JSON.stringify(payloadKeys) === JSON.stringify(expectedKeys));

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 12: No file content in offer — deep verification
  // =========================================================================
  console.log('--- Test 12: No file content in offer — deep check ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    const { send, sent } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const secretContent = 'AI GENERATED SECRET OUTPUT — MUST NOT LEAK';
    const data = makeFileData(secretContent);
    const secretBase64 = Buffer.from(data).toString('base64');

    ftr.submitFile({
      transferId: uuid(),
      direction: 'ai_to_human',
      sender: { id: uuid(), type: 'ai', displayName: 'Claude' },
      filename: 'output.json',
      sizeBytes: data.length,
      mimeType: 'application/json',
      declaredHash: sha256(data),
      data,
      purpose: 'Generated output',
      taskId: uuid(),
      recipientConnectionId: 'human-conn-8',
    });

    const rawJson = sent[0].data;
    check('raw offer does not contain secret text', !rawJson.includes(secretContent));
    check('raw offer does not contain base64 file data', !rawJson.includes(secretBase64));

    const payload = extractPayload(sent[0].parsed);
    const payloadStr = JSON.stringify(payload);
    check('offer payload does not contain secret text', !payloadStr.includes(secretContent));
    check('offer payload does not contain base64 file data', !payloadStr.includes(secretBase64));

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 13: Multiple concurrent transfers
  // =========================================================================
  console.log('--- Test 13: Multiple concurrent transfers ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    const { send, sent } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const ids = [];
    for (let i = 0; i < 5; i++) {
      const data = makeFileData(`File ${i} content`);
      const transferId = uuid();
      ids.push(transferId);

      ftr.submitFile({
        transferId,
        direction: i % 2 === 0 ? 'human_to_ai' : 'ai_to_human',
        sender: { id: uuid(), type: i % 2 === 0 ? 'human' : 'ai', displayName: 'Sender' },
        filename: `file-${i}.txt`,
        sizeBytes: data.length,
        mimeType: 'text/plain',
        declaredHash: sha256(data),
        data,
        purpose: `Transfer ${i}`,
        projectContext: 'Test',
        recipientConnectionId: `conn-${i}`,
      });
    }

    check('5 transfers active', ftr.activeTransferCount === 5);
    check('5 files quarantined', quarantine.count === 5);
    check('5 manifests/offers sent', sent.length === 5);

    // Accept first 3
    for (let i = 0; i < 3; i++) {
      const result = ftr.handleFileRequest(ids[i], `conn-${i}`);
      check(`transfer ${i} delivered`, result.status === 'delivered');
    }

    check('2 transfers remaining', ftr.activeTransferCount === 2);
    check('2 files in quarantine', quarantine.count === 2);

    // Reject remaining 2
    for (let i = 3; i < 5; i++) {
      ftr.handleFileReject(ids[i]);
    }

    check('0 transfers remaining', ftr.activeTransferCount === 0);
    check('quarantine empty', quarantine.count === 0);

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 14: Duplicate transfer submission
  // =========================================================================
  console.log('--- Test 14: Duplicate transfer submission ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    const { send } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const data = makeFileData('Duplicate test');
    const transferId = uuid();
    const sub = {
      transferId,
      direction: 'human_to_ai',
      sender: { id: uuid(), type: 'human', displayName: 'Alice' },
      filename: 'dup.txt',
      sizeBytes: data.length,
      mimeType: 'text/plain',
      declaredHash: sha256(data),
      data,
      purpose: 'Test',
      projectContext: 'Test',
      recipientConnectionId: 'ai-conn-9',
    };

    const first = ftr.submitFile(sub);
    check('first submission succeeds', first.status === 'submitted');

    const second = ftr.submitFile(sub);
    check('duplicate submission rejected', second.status === 'quarantine_duplicate');

    ftr.destroy();
    quarantine.destroy();
  }
  console.log();

  // =========================================================================
  // Test 15: Destroy cleans up
  // =========================================================================
  console.log('--- Test 15: Destroy cleans up ---');
  {
    const quarantine = new FileQuarantine();
    const verifier = new HashVerifier({ quarantine });
    const { send } = createMockSend();
    const ftr = new FileTransferRouter({ quarantine, hashVerifier: verifier, send });

    const data = makeFileData('Cleanup test');
    ftr.submitFile({
      transferId: uuid(),
      direction: 'human_to_ai',
      sender: { id: uuid(), type: 'human', displayName: 'Alice' },
      filename: 'cleanup.txt',
      sizeBytes: data.length,
      mimeType: 'text/plain',
      declaredHash: sha256(data),
      data,
      purpose: 'Test',
      projectContext: 'Test',
      recipientConnectionId: 'ai-conn-10',
    });

    check('transfer pending before destroy', ftr.activeTransferCount === 1);
    ftr.destroy();
    check('no transfers after destroy', ftr.activeTransferCount === 0);

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
