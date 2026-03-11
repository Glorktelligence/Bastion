// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Trace tests for AI client file handling (Tasks 2.6–2.8).
 *
 * Tests:
 *   1. IntakeDirectory — receive and read files
 *   2. IntakeDirectory — read-only enforcement (no mutation)
 *   3. IntakeDirectory — capacity limit
 *   4. IntakeDirectory — task-based listing
 *   5. IntakeDirectory — duplicate rejection
 *   6. IntakeDirectory — destroy safety
 *   7. OutboundStaging — stage files
 *   8. OutboundStaging — write-only enforcement (no read-back)
 *   9. OutboundStaging — submit extracts data once
 *  10. OutboundStaging — capacity limit
 *  11. OutboundStaging — task-based listing
 *  12. OutboundStaging — destroy safety
 *  13. FilePurgeManager — register and purge on completion
 *  14. FilePurgeManager — purge on cancellation
 *  15. FilePurgeManager — timeout detection and purge
 *  16. FilePurgeManager — purge callback invocation
 *  17. FilePurgeManager — purge clears both intake and staging
 *  18. FilePurgeManager — multiple tasks tracked independently
 *  19. FilePurgeManager — destroy safety
 *  20. Full lifecycle — receive, stage, complete, verify purged
 *  21. Full lifecycle — timeout purges all files
 *  22. Permission enforcement — intake read returns copies
 *
 * Run: node packages/client-ai/file-handling-trace-test.mjs
 */

import {
  IntakeDirectory,
  IntakeError,
  OutboundStaging,
  OutboundError,
  FilePurgeManager,
  PurgeError,
} from './dist/files/index.js';

// ---------------------------------------------------------------------------
// Test harness
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

function group(name) {
  console.log(`\n--- ${name} ---`);
}

// Helpers
function makeData(content) {
  return new TextEncoder().encode(content);
}

function readData(data) {
  return new TextDecoder().decode(data);
}

// ============================================================================
// Test 1: IntakeDirectory — receive and read files
// ============================================================================
group('Test 1: IntakeDirectory — receive and read');

{
  const intake = new IntakeDirectory();

  const result = intake.receive(
    'transfer-001',
    'task-001',
    'report.txt',
    makeData('Hello from human'),
    'text/plain',
    'abc123hash',
  );

  check('receive returns received status', result.status === 'received');
  check('metadata has correct transferId', result.status === 'received' && result.metadata.transferId === 'transfer-001');
  check('metadata has correct taskId', result.status === 'received' && result.metadata.taskId === 'task-001');
  check('metadata has correct filename', result.status === 'received' && result.metadata.filename === 'report.txt');
  check('metadata has correct sizeBytes', result.status === 'received' && result.metadata.sizeBytes === 16);
  check('metadata has correct mimeType', result.status === 'received' && result.metadata.mimeType === 'text/plain');
  check('metadata has hash', result.status === 'received' && result.metadata.hash === 'abc123hash');
  check('metadata has receivedAt', result.status === 'received' && typeof result.metadata.receivedAt === 'string');

  // Read file data
  const data = intake.read('transfer-001');
  check('read returns data', data !== undefined);
  check('read data matches original', data && readData(data) === 'Hello from human');

  // Get metadata
  const meta = intake.getMetadata('transfer-001');
  check('getMetadata returns metadata', meta !== undefined);
  check('getMetadata filename matches', meta?.filename === 'report.txt');

  // Count
  check('count is 1', intake.count === 1);
  check('has returns true', intake.has('transfer-001'));
  check('has returns false for unknown', !intake.has('transfer-999'));

  intake.destroy();
}

// ============================================================================
// Test 2: IntakeDirectory — read-only enforcement
// ============================================================================
group('Test 2: IntakeDirectory — read-only enforcement');

{
  const intake = new IntakeDirectory();

  intake.receive(
    'transfer-002',
    'task-001',
    'data.json',
    makeData('{"key":"value"}'),
    'application/json',
    'hash002',
  );

  // Verify no write/modify/delete methods exist on the public API
  check('no write method', typeof intake.write === 'undefined');
  check('no modify method', typeof intake.modify === 'undefined');
  check('no delete method', typeof intake.delete === 'undefined');
  check('no remove method', typeof intake.remove === 'undefined');

  // Read returns data (read-only access works)
  const data = intake.read('transfer-002');
  check('read works', data && readData(data) === '{"key":"value"}');

  // Metadata is accessible
  const meta = intake.getMetadata('transfer-002');
  check('metadata accessible', meta?.filename === 'data.json');

  intake.destroy();
}

// ============================================================================
// Test 3: IntakeDirectory — capacity limit
// ============================================================================
group('Test 3: IntakeDirectory — capacity limit');

{
  const intake = new IntakeDirectory({ maxFiles: 3 });

  intake.receive('t1', 'task-1', 'f1.txt', makeData('a'), 'text/plain', 'h1');
  intake.receive('t2', 'task-1', 'f2.txt', makeData('b'), 'text/plain', 'h2');
  intake.receive('t3', 'task-1', 'f3.txt', makeData('c'), 'text/plain', 'h3');

  check('count at capacity', intake.count === 3);
  check('isFull is true', intake.isFull);

  const overflow = intake.receive('t4', 'task-1', 'f4.txt', makeData('d'), 'text/plain', 'h4');
  check('overflow returns full', overflow.status === 'full');
  check('full reports maxFiles', overflow.status === 'full' && overflow.maxFiles === 3);
  check('count still 3', intake.count === 3);

  intake.destroy();
}

// ============================================================================
// Test 4: IntakeDirectory — task-based listing
// ============================================================================
group('Test 4: IntakeDirectory — task-based listing');

{
  const intake = new IntakeDirectory();

  intake.receive('t1', 'task-A', 'a1.txt', makeData('1'), 'text/plain', 'h1');
  intake.receive('t2', 'task-A', 'a2.txt', makeData('2'), 'text/plain', 'h2');
  intake.receive('t3', 'task-B', 'b1.txt', makeData('3'), 'text/plain', 'h3');

  const taskAFiles = intake.listByTask('task-A');
  check('task-A has 2 files', taskAFiles.length === 2);
  check('task-A filenames', taskAFiles.map(f => f.filename).sort().join(',') === 'a1.txt,a2.txt');

  const taskBFiles = intake.listByTask('task-B');
  check('task-B has 1 file', taskBFiles.length === 1);
  check('task-B filename', taskBFiles[0].filename === 'b1.txt');

  const noFiles = intake.listByTask('task-C');
  check('unknown task has 0 files', noFiles.length === 0);

  const taskIds = intake.getTaskIds();
  check('getTaskIds returns both tasks', taskIds.length === 2);
  check('getTaskIds contains task-A', taskIds.includes('task-A'));
  check('getTaskIds contains task-B', taskIds.includes('task-B'));

  intake.destroy();
}

// ============================================================================
// Test 5: IntakeDirectory — duplicate rejection
// ============================================================================
group('Test 5: IntakeDirectory — duplicate rejection');

{
  const intake = new IntakeDirectory();

  const first = intake.receive('dup-id', 'task-1', 'file.txt', makeData('data'), 'text/plain', 'hash');
  check('first receive succeeds', first.status === 'received');

  const second = intake.receive('dup-id', 'task-1', 'file.txt', makeData('data'), 'text/plain', 'hash');
  check('duplicate returns duplicate status', second.status === 'duplicate');
  check('duplicate reports transferId', second.status === 'duplicate' && second.transferId === 'dup-id');
  check('count still 1', intake.count === 1);

  intake.destroy();
}

// ============================================================================
// Test 6: IntakeDirectory — destroy safety
// ============================================================================
group('Test 6: IntakeDirectory — destroy safety');

{
  const intake = new IntakeDirectory();
  intake.receive('t1', 'task-1', 'f1.txt', makeData('data'), 'text/plain', 'h1');

  intake.destroy();

  let threw = false;
  try {
    intake.receive('t2', 'task-1', 'f2.txt', makeData('data'), 'text/plain', 'h2');
  } catch (e) {
    threw = true;
    check('destroy error is IntakeError', e instanceof IntakeError);
    check('error message mentions destroyed', e.message.includes('destroyed'));
  }
  check('receive after destroy throws', threw);

  let threwRead = false;
  try { intake.read('t1'); } catch { threwRead = true; }
  check('read after destroy throws', threwRead);
}

// ============================================================================
// Test 7: OutboundStaging — stage files
// ============================================================================
group('Test 7: OutboundStaging — stage files');

{
  const staging = new OutboundStaging();

  const result = staging.stage(
    'task-001',
    'output.csv',
    makeData('col1,col2\na,b'),
    'text/csv',
    'Analysis results',
  );

  check('stage returns staged status', result.status === 'staged');
  check('metadata has transferId', result.status === 'staged' && typeof result.metadata.transferId === 'string');
  check('metadata has correct taskId', result.status === 'staged' && result.metadata.taskId === 'task-001');
  check('metadata has correct filename', result.status === 'staged' && result.metadata.filename === 'output.csv');
  check('metadata has correct sizeBytes', result.status === 'staged' && result.metadata.sizeBytes === 13);
  check('metadata has correct mimeType', result.status === 'staged' && result.metadata.mimeType === 'text/csv');
  check('metadata has purpose', result.status === 'staged' && result.metadata.purpose === 'Analysis results');
  check('metadata state is staged', result.status === 'staged' && result.metadata.state === 'staged');
  check('metadata has stagedAt', result.status === 'staged' && typeof result.metadata.stagedAt === 'string');

  check('count is 1', staging.count === 1);
  check('has returns true', result.status === 'staged' && staging.has(result.metadata.transferId));

  staging.destroy();
}

// ============================================================================
// Test 8: OutboundStaging — write-only enforcement (no read-back)
// ============================================================================
group('Test 8: OutboundStaging — write-only enforcement');

{
  const staging = new OutboundStaging();

  const result = staging.stage(
    'task-001',
    'secret.txt',
    makeData('sensitive AI output'),
    'text/plain',
    'Generated report',
  );

  const transferId = result.status === 'staged' ? result.metadata.transferId : null;

  // No read method exists
  check('no read method', typeof staging.read === 'undefined');
  check('no getData method', typeof staging.getData === 'undefined');

  // Metadata IS accessible (not file data)
  const meta = staging.getMetadata(transferId);
  check('getMetadata works', meta?.filename === 'secret.txt');
  check('metadata does not contain data', !('data' in (meta || {})));

  staging.destroy();
}

// ============================================================================
// Test 9: OutboundStaging — submit extracts data once
// ============================================================================
group('Test 9: OutboundStaging — submit extracts data once');

{
  const staging = new OutboundStaging();

  const stageResult = staging.stage(
    'task-001',
    'report.pdf',
    makeData('PDF content here'),
    'application/pdf',
    'Final report',
  );

  const transferId = stageResult.status === 'staged' ? stageResult.metadata.transferId : '';

  // First submit extracts data
  const submit1 = staging.submit(transferId);
  check('first submit succeeds', submit1.status === 'submitted');
  check('submit returns data', submit1.status === 'submitted' && readData(submit1.data) === 'PDF content here');
  check('submit returns metadata', submit1.status === 'submitted' && submit1.metadata.filename === 'report.pdf');
  check('submit metadata state is submitted', submit1.status === 'submitted' && submit1.metadata.state === 'submitted');

  // Second submit fails (data already extracted)
  const submit2 = staging.submit(transferId);
  check('second submit returns already_submitted', submit2.status === 'already_submitted');

  // Metadata still accessible after submit
  const meta = staging.getMetadata(transferId);
  check('metadata still accessible after submit', meta?.state === 'submitted');

  // Not found
  const submit3 = staging.submit('nonexistent');
  check('submit unknown returns not_found', submit3.status === 'not_found');

  staging.destroy();
}

// ============================================================================
// Test 10: OutboundStaging — capacity limit
// ============================================================================
group('Test 10: OutboundStaging — capacity limit');

{
  const staging = new OutboundStaging({ maxFiles: 2 });

  staging.stage('task-1', 'f1.txt', makeData('a'), 'text/plain', 'p1');
  staging.stage('task-1', 'f2.txt', makeData('b'), 'text/plain', 'p2');

  check('count at capacity', staging.count === 2);
  check('isFull is true', staging.isFull);

  const overflow = staging.stage('task-1', 'f3.txt', makeData('c'), 'text/plain', 'p3');
  check('overflow returns full', overflow.status === 'full');
  check('full reports maxFiles', overflow.status === 'full' && overflow.maxFiles === 2);

  staging.destroy();
}

// ============================================================================
// Test 11: OutboundStaging — task-based listing
// ============================================================================
group('Test 11: OutboundStaging — task-based listing');

{
  const staging = new OutboundStaging();

  staging.stage('task-X', 'x1.txt', makeData('1'), 'text/plain', 'p1');
  staging.stage('task-X', 'x2.txt', makeData('2'), 'text/plain', 'p2');
  staging.stage('task-Y', 'y1.txt', makeData('3'), 'text/plain', 'p3');

  const taskXFiles = staging.listByTask('task-X');
  check('task-X has 2 files', taskXFiles.length === 2);

  const taskYFiles = staging.listByTask('task-Y');
  check('task-Y has 1 file', taskYFiles.length === 1);

  const noFiles = staging.listByTask('task-Z');
  check('unknown task has 0 files', noFiles.length === 0);

  const taskIds = staging.getTaskIds();
  check('getTaskIds returns both tasks', taskIds.length === 2);

  staging.destroy();
}

// ============================================================================
// Test 12: OutboundStaging — destroy safety
// ============================================================================
group('Test 12: OutboundStaging — destroy safety');

{
  const staging = new OutboundStaging();
  staging.stage('task-1', 'f1.txt', makeData('data'), 'text/plain', 'p');

  staging.destroy();

  let threw = false;
  try {
    staging.stage('task-1', 'f2.txt', makeData('data'), 'text/plain', 'p');
  } catch (e) {
    threw = true;
    check('destroy error is OutboundError', e instanceof OutboundError);
  }
  check('stage after destroy throws', threw);
}

// ============================================================================
// Test 13: FilePurgeManager — register and purge on completion
// ============================================================================
group('Test 13: FilePurgeManager — register and purge on completion');

{
  const intake = new IntakeDirectory();
  const staging = new OutboundStaging();
  const purger = new FilePurgeManager(intake, staging);

  // Register task
  const task = purger.registerTask('task-100');
  check('registerTask returns TrackedTask', task.taskId === 'task-100');
  check('task has registeredAt', typeof task.registeredAt === 'string');
  check('task has timeoutAt', typeof task.timeoutAt === 'string');
  check('task has default timeoutMs', task.timeoutMs === 3_600_000);
  check('trackedTaskCount is 1', purger.trackedTaskCount === 1);
  check('isTracked returns true', purger.isTracked('task-100'));

  // Add files
  intake.receive('t1', 'task-100', 'in1.txt', makeData('data1'), 'text/plain', 'h1');
  intake.receive('t2', 'task-100', 'in2.txt', makeData('data2'), 'text/plain', 'h2');
  staging.stage('task-100', 'out1.txt', makeData('data3'), 'text/plain', 'p1');

  // Complete task
  const result = purger.onTaskComplete('task-100');
  check('purge returns result', result !== null);
  check('reason is completed', result?.reason === 'completed');
  check('intakePurged is 2', result?.intakePurged === 2);
  check('stagingPurged is 1', result?.stagingPurged === 1);
  check('totalPurged is 3', result?.totalPurged === 3);
  check('timestamp present', typeof result?.timestamp === 'string');

  // Verify files are gone
  check('intake empty', intake.count === 0);
  check('staging empty', staging.count === 0);
  check('task no longer tracked', !purger.isTracked('task-100'));

  purger.destroy();
  intake.destroy();
  staging.destroy();
}

// ============================================================================
// Test 14: FilePurgeManager — purge on cancellation
// ============================================================================
group('Test 14: FilePurgeManager — purge on cancellation');

{
  const intake = new IntakeDirectory();
  const staging = new OutboundStaging();
  const purger = new FilePurgeManager(intake, staging);

  purger.registerTask('task-200');
  intake.receive('t1', 'task-200', 'file.txt', makeData('data'), 'text/plain', 'h');
  staging.stage('task-200', 'out.txt', makeData('data'), 'text/plain', 'p');

  const result = purger.onTaskCancelled('task-200');
  check('cancel reason is cancelled', result?.reason === 'cancelled');
  check('cancel purges intake', result?.intakePurged === 1);
  check('cancel purges staging', result?.stagingPurged === 1);
  check('intake empty after cancel', intake.count === 0);
  check('staging empty after cancel', staging.count === 0);

  purger.destroy();
  intake.destroy();
  staging.destroy();
}

// ============================================================================
// Test 15: FilePurgeManager — timeout detection and purge
// ============================================================================
group('Test 15: FilePurgeManager — timeout detection and purge');

{
  const intake = new IntakeDirectory();
  const staging = new OutboundStaging();
  const purger = new FilePurgeManager(intake, staging, {
    defaultTimeoutMs: 100, // 100ms timeout for testing
  });

  purger.registerTask('task-300');
  intake.receive('t1', 'task-300', 'file.txt', makeData('data'), 'text/plain', 'h');

  // Check before timeout — nothing should be purged
  const beforeResults = purger.checkTimeouts(new Date());
  check('no timeouts before deadline', beforeResults.length === 0);
  check('intake still has file', intake.count === 1);

  // Check after timeout
  const future = new Date(Date.now() + 200);
  const afterResults = purger.checkTimeouts(future);
  check('1 timeout detected', afterResults.length === 1);
  check('timeout reason is timed_out', afterResults[0]?.reason === 'timed_out');
  check('timeout purges intake', afterResults[0]?.intakePurged === 1);
  check('intake empty after timeout', intake.count === 0);
  check('task untracked after timeout', !purger.isTracked('task-300'));

  purger.destroy();
  intake.destroy();
  staging.destroy();
}

// ============================================================================
// Test 16: FilePurgeManager — purge callback invocation
// ============================================================================
group('Test 16: FilePurgeManager — purge callback');

{
  const intake = new IntakeDirectory();
  const staging = new OutboundStaging();
  const callbacks = [];
  const purger = new FilePurgeManager(intake, staging, {
    onPurge: (result) => callbacks.push(result),
  });

  purger.registerTask('task-400');
  intake.receive('t1', 'task-400', 'file.txt', makeData('data'), 'text/plain', 'h');

  purger.onTaskComplete('task-400');
  check('callback invoked once', callbacks.length === 1);
  check('callback has correct taskId', callbacks[0]?.taskId === 'task-400');
  check('callback has correct reason', callbacks[0]?.reason === 'completed');
  check('callback has totalPurged', callbacks[0]?.totalPurged === 1);

  // Manual purge also triggers callback
  purger.registerTask('task-401');
  staging.stage('task-401', 'out.txt', makeData('data'), 'text/plain', 'p');
  purger.purgeManual('task-401');
  check('manual purge triggers callback', callbacks.length === 2);
  check('manual purge reason is manual', callbacks[1]?.reason === 'manual');

  purger.destroy();
  intake.destroy();
  staging.destroy();
}

// ============================================================================
// Test 17: FilePurgeManager — purge clears both intake and staging
// ============================================================================
group('Test 17: FilePurgeManager — both directories cleared');

{
  const intake = new IntakeDirectory();
  const staging = new OutboundStaging();
  const purger = new FilePurgeManager(intake, staging);

  purger.registerTask('task-500');

  // Multiple files in both locations
  intake.receive('in-1', 'task-500', 'in1.txt', makeData('1'), 'text/plain', 'h1');
  intake.receive('in-2', 'task-500', 'in2.txt', makeData('2'), 'text/plain', 'h2');
  intake.receive('in-3', 'task-500', 'in3.txt', makeData('3'), 'text/plain', 'h3');
  staging.stage('task-500', 'out1.txt', makeData('a'), 'text/plain', 'p1');
  staging.stage('task-500', 'out2.txt', makeData('b'), 'text/plain', 'p2');

  check('intake has 3 files', intake.count === 3);
  check('staging has 2 files', staging.count === 2);

  const result = purger.onTaskComplete('task-500');
  check('intakePurged is 3', result?.intakePurged === 3);
  check('stagingPurged is 2', result?.stagingPurged === 2);
  check('totalPurged is 5', result?.totalPurged === 5);
  check('intake empty', intake.count === 0);
  check('staging empty', staging.count === 0);

  purger.destroy();
  intake.destroy();
  staging.destroy();
}

// ============================================================================
// Test 18: FilePurgeManager — multiple tasks tracked independently
// ============================================================================
group('Test 18: FilePurgeManager — multiple tasks independent');

{
  const intake = new IntakeDirectory();
  const staging = new OutboundStaging();
  const purger = new FilePurgeManager(intake, staging);

  purger.registerTask('task-A');
  purger.registerTask('task-B');

  intake.receive('t1', 'task-A', 'a.txt', makeData('a'), 'text/plain', 'h1');
  intake.receive('t2', 'task-B', 'b.txt', makeData('b'), 'text/plain', 'h2');
  staging.stage('task-A', 'ao.txt', makeData('ao'), 'text/plain', 'p1');
  staging.stage('task-B', 'bo.txt', makeData('bo'), 'text/plain', 'p2');

  check('trackedTaskCount is 2', purger.trackedTaskCount === 2);

  // Complete task-A only
  const resultA = purger.onTaskComplete('task-A');
  check('task-A purged', resultA?.totalPurged === 2);
  check('task-A intake purged', resultA?.intakePurged === 1);
  check('task-A staging purged', resultA?.stagingPurged === 1);

  // Task-B files survive
  check('intake still has task-B file', intake.count === 1);
  check('staging still has task-B file', staging.count === 1);
  check('task-B read works', intake.read('t2') !== undefined);
  check('task-B still tracked', purger.isTracked('task-B'));
  check('trackedTaskCount is 1', purger.trackedTaskCount === 1);

  // Now complete task-B
  const resultB = purger.onTaskComplete('task-B');
  check('task-B purged', resultB?.totalPurged === 2);
  check('all empty', intake.count === 0 && staging.count === 0);

  purger.destroy();
  intake.destroy();
  staging.destroy();
}

// ============================================================================
// Test 19: FilePurgeManager — destroy safety
// ============================================================================
group('Test 19: FilePurgeManager — destroy safety');

{
  const intake = new IntakeDirectory();
  const staging = new OutboundStaging();
  const purger = new FilePurgeManager(intake, staging);

  purger.registerTask('task-600');
  purger.start();
  check('isRunning is true', purger.isRunning);

  purger.destroy();
  check('isRunning is false after destroy', !purger.isRunning);
  check('trackedTaskCount is 0 after destroy', purger.trackedTaskCount === 0);

  let threw = false;
  try {
    purger.registerTask('task-601');
  } catch (e) {
    threw = true;
    check('destroy error is PurgeError', e instanceof PurgeError);
  }
  check('registerTask after destroy throws', threw);

  intake.destroy();
  staging.destroy();
}

// ============================================================================
// Test 20: Full lifecycle — receive, stage, complete, verify purged
// ============================================================================
group('Test 20: Full lifecycle — completion');

{
  const intake = new IntakeDirectory();
  const staging = new OutboundStaging();
  const purger = new FilePurgeManager(intake, staging);

  // Step 1: Register task
  purger.registerTask('lifecycle-task');

  // Step 2: Receive file from human (via relay quarantine)
  const receiveResult = intake.receive(
    'ft-in-001',
    'lifecycle-task',
    'input-data.json',
    makeData('{"query":"analyze this"}'),
    'application/json',
    'sha256-input-hash',
  );
  check('lifecycle: file received', receiveResult.status === 'received');

  // Step 3: AI reads the file (read-only)
  const inputData = intake.read('ft-in-001');
  check('lifecycle: AI can read input', inputData !== undefined);
  check('lifecycle: input content correct', inputData && readData(inputData) === '{"query":"analyze this"}');

  // Step 4: AI stages output file (write-only)
  const stageResult = staging.stage(
    'lifecycle-task',
    'analysis-result.json',
    makeData('{"result":"42","confidence":0.95}'),
    'application/json',
    'Analysis output',
  );
  check('lifecycle: file staged', stageResult.status === 'staged');

  const stagedId = stageResult.status === 'staged' ? stageResult.metadata.transferId : '';

  // Step 5: Transport submits staged file to relay
  const submitResult = staging.submit(stagedId);
  check('lifecycle: file submitted', submitResult.status === 'submitted');
  check('lifecycle: submit data correct', submitResult.status === 'submitted' && readData(submitResult.data) === '{"result":"42","confidence":0.95}');

  // Step 6: Task completes — all files purged
  const purgeResult = purger.onTaskComplete('lifecycle-task');
  check('lifecycle: purge result', purgeResult !== null);
  check('lifecycle: intake purged', purgeResult?.intakePurged === 1);
  check('lifecycle: staging purged', purgeResult?.stagingPurged === 1);

  // Step 7: Verify everything is cleaned up
  check('lifecycle: intake empty', intake.count === 0);
  check('lifecycle: staging empty', staging.count === 0);
  check('lifecycle: intake read returns undefined', intake.read('ft-in-001') === undefined);
  check('lifecycle: task not tracked', !purger.isTracked('lifecycle-task'));

  purger.destroy();
  intake.destroy();
  staging.destroy();
}

// ============================================================================
// Test 21: Full lifecycle — timeout purges all files
// ============================================================================
group('Test 21: Full lifecycle — timeout');

{
  const intake = new IntakeDirectory();
  const staging = new OutboundStaging();
  const callbacks = [];
  const purger = new FilePurgeManager(intake, staging, {
    defaultTimeoutMs: 50,
    onPurge: (r) => callbacks.push(r),
  });

  purger.registerTask('timeout-task');

  intake.receive('ft-t1', 'timeout-task', 'doc.txt', makeData('content'), 'text/plain', 'h');
  staging.stage('timeout-task', 'out.txt', makeData('output'), 'text/plain', 'p');

  check('timeout: files present', intake.count === 1 && staging.count === 1);

  // Simulate time passing beyond timeout
  const future = new Date(Date.now() + 100);
  const results = purger.checkTimeouts(future);

  check('timeout: 1 task timed out', results.length === 1);
  check('timeout: reason is timed_out', results[0]?.reason === 'timed_out');
  check('timeout: intake purged', results[0]?.intakePurged === 1);
  check('timeout: staging purged', results[0]?.stagingPurged === 1);
  check('timeout: callback fired', callbacks.length === 1);
  check('timeout: intake empty', intake.count === 0);
  check('timeout: staging empty', staging.count === 0);

  purger.destroy();
  intake.destroy();
  staging.destroy();
}

// ============================================================================
// Test 22: Permission enforcement — intake read returns copies
// ============================================================================
group('Test 22: Permission enforcement — data isolation');

{
  const intake = new IntakeDirectory();

  intake.receive('iso-1', 'task-1', 'original.txt', makeData('immutable'), 'text/plain', 'h');

  // Read returns a copy — mutating it should not affect the stored data
  const copy1 = intake.read('iso-1');
  check('first read returns data', copy1 !== undefined);
  if (copy1) {
    copy1[0] = 0xFF; // Mutate the copy
  }

  const copy2 = intake.read('iso-1');
  check('second read unaffected by mutation', copy2 && readData(copy2) === 'immutable');

  // External data mutation after receive should not affect stored data
  const originalData = makeData('external');
  intake.receive('iso-2', 'task-1', 'ext.txt', originalData, 'text/plain', 'h2');
  originalData[0] = 0xFF; // Mutate the original

  const storedData = intake.read('iso-2');
  check('stored data unaffected by external mutation', storedData && readData(storedData) === 'external');

  // Staging also copies on stage
  const staging = new OutboundStaging();
  const stageData = makeData('staged-content');
  const result = staging.stage('task-1', 'out.txt', stageData, 'text/plain', 'p');
  stageData[0] = 0xFF; // Mutate original

  const stagedId = result.status === 'staged' ? result.metadata.transferId : '';
  const submitResult = staging.submit(stagedId);
  check('staged data unaffected by external mutation', submitResult.status === 'submitted' && readData(submitResult.data) === 'staged-content');

  intake.destroy();
  staging.destroy();
}

// ============================================================================
// Summary
// ============================================================================

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
console.log(`${'='.repeat(60)}`);

if (fail > 0) process.exit(1);
