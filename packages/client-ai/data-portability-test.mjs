// Trace test: Data portability — DataExporter, BastionImportAdapter, ImportExecutor
// Run with: node packages/client-ai/data-portability-test.mjs

import {
  DataExporter,
  ImportRegistry,
  BastionImportAdapter,
  ImportExecutor,
  MemoryStore,
  ProjectStore,
  ConversationStore,
  SkillStore,
  ChallengeManager,
  scanContent,
} from './dist/index.js';
import {
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  DataExportRequestPayloadSchema,
  DataExportProgressPayloadSchema,
  DataExportReadyPayloadSchema,
  DataImportValidatePayloadSchema,
  DataImportConfirmPayloadSchema,
  DataImportCompletePayloadSchema,
} from '@bastion/protocol';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// Create temporary directories for test stores
function createTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), `bastion-test-${prefix}-`));
}

async function run() {
  console.log('\n=== Data Portability Tests ===\n');

  // -------------------------------------------------------------------------
  // Setup — create stores with test data
  // -------------------------------------------------------------------------

  const tempDirs = [];
  function makeTempDir(prefix) {
    const d = createTempDir(prefix);
    tempDirs.push(d);
    return d;
  }

  // Conversation store
  const convDir = makeTempDir('conv');
  const convStore = new ConversationStore({ path: join(convDir, 'conversations.db') });
  const conv1 = convStore.createConversation('Test Chat', 'normal');
  convStore.setActiveConversation(conv1.id);
  convStore.addMessage(conv1.id, 'user', 'conversation', 'Hello world');
  convStore.addMessage(conv1.id, 'assistant', 'conversation', 'Hi there!');
  convStore.addMessage(conv1.id, 'user', 'conversation', 'How are you?');

  const conv2 = convStore.createConversation('Game Session', 'game');
  convStore.addMessage(conv2.id, 'user', 'conversation', 'Start game');
  convStore.addMessage(conv2.id, 'assistant', 'conversation', 'Welcome to the dungeon!');

  // Memory store
  const memDir = makeTempDir('mem');
  const memoryStore = new MemoryStore({ path: join(memDir, 'memories.db') });
  memoryStore.addMemory('User prefers dark mode', 'preference', 'test', null);
  memoryStore.addMemory('User is a sysadmin', 'fact', 'test', null);
  memoryStore.addMemory('Use concise responses', 'workflow', 'test', null);

  // Project store
  const projDir = makeTempDir('proj');
  const projectStore = new ProjectStore({ rootDir: projDir });
  projectStore.saveFile('readme.md', '# Test Project\nHello world', 'text/markdown');
  projectStore.saveFile('config.json', '{"key": "value"}', 'application/json');

  // Skill store (empty — skills require on-disk manifests, test with empty)
  const skillDir = makeTempDir('skill');
  const skillStore = new SkillStore({ skillsDir: skillDir });

  // Challenge manager
  const challengeDir = makeTempDir('challenge');
  const challengeManager = new ChallengeManager({
    configPath: join(challengeDir, 'challenge-config.json'),
    timezone: 'UTC',
  });

  console.log('--- Protocol Schema Tests ---');

  // -------------------------------------------------------------------------
  // Protocol schema tests
  // -------------------------------------------------------------------------

  check('MESSAGE_TYPES has DATA_EXPORT_REQUEST',
    MESSAGE_TYPES.DATA_EXPORT_REQUEST === 'data_export_request', MESSAGE_TYPES.DATA_EXPORT_REQUEST);

  check('MESSAGE_TYPES has DATA_EXPORT_PROGRESS',
    MESSAGE_TYPES.DATA_EXPORT_PROGRESS === 'data_export_progress', MESSAGE_TYPES.DATA_EXPORT_PROGRESS);

  check('MESSAGE_TYPES has DATA_EXPORT_READY',
    MESSAGE_TYPES.DATA_EXPORT_READY === 'data_export_ready', MESSAGE_TYPES.DATA_EXPORT_READY);

  check('MESSAGE_TYPES has DATA_IMPORT_VALIDATE',
    MESSAGE_TYPES.DATA_IMPORT_VALIDATE === 'data_import_validate', MESSAGE_TYPES.DATA_IMPORT_VALIDATE);

  check('MESSAGE_TYPES has DATA_IMPORT_CONFIRM',
    MESSAGE_TYPES.DATA_IMPORT_CONFIRM === 'data_import_confirm', MESSAGE_TYPES.DATA_IMPORT_CONFIRM);

  check('MESSAGE_TYPES has DATA_IMPORT_COMPLETE',
    MESSAGE_TYPES.DATA_IMPORT_COMPLETE === 'data_import_complete', MESSAGE_TYPES.DATA_IMPORT_COMPLETE);

  // Validate schemas accept correct data
  const exportReqResult = DataExportRequestPayloadSchema.safeParse({ format: 'bdp' });
  check('DataExportRequestPayloadSchema validates correct data', exportReqResult.success);

  const exportReqBad = DataExportRequestPayloadSchema.safeParse({ format: 'csv' });
  check('DataExportRequestPayloadSchema rejects invalid format', !exportReqBad.success);

  const progressResult = DataExportProgressPayloadSchema.safeParse({ percentage: 50, phase: 'Exporting' });
  check('DataExportProgressPayloadSchema validates correct data', progressResult.success);

  const readyResult = DataExportReadyPayloadSchema.safeParse({
    transferId: 'abc', filename: 'test.bdp', sizeBytes: 1024, hash: 'deadbeef',
    contentCounts: { conversations: 1, memories: 2, projectFiles: 3, skills: 0 },
  });
  check('DataExportReadyPayloadSchema validates correct data', readyResult.success);

  const validateResult = DataImportValidatePayloadSchema.safeParse({
    valid: true, format: 'bdp', version: '0.7.3', exportedAt: '2026-01-01',
    contents: { conversations: 1, memories: 2, projectFiles: 3, skills: 0, hasConfig: true },
    conflicts: [{ type: 'project_file', path: 'readme.md', detail: 'exists' }],
    errors: [],
  });
  check('DataImportValidatePayloadSchema validates correct data', validateResult.success);

  const confirmResult = DataImportConfirmPayloadSchema.safeParse({
    importConversations: true, importMemories: true, importProjectFiles: true,
    importSkills: false, importConfig: false,
    conflictResolutions: [{ type: 'project_file', path: 'readme.md', action: 'skip' }],
  });
  check('DataImportConfirmPayloadSchema validates correct data', confirmResult.success);

  const completeResult = DataImportCompletePayloadSchema.safeParse({
    imported: { conversations: 1, memories: 2, projectFiles: 0, skills: 0, configSections: 0 },
    skipped: { conversations: 0, memories: 1, projectFiles: 2, skills: 0 },
    errors: ['one error'],
  });
  check('DataImportCompletePayloadSchema validates correct data', completeResult.success);

  // Sender type restrictions — verify human-only for request/confirm
  check('DataImportConfirmPayloadSchema rejects missing fields',
    !DataImportConfirmPayloadSchema.safeParse({}).success);

  console.log('\n--- DataExporter Tests ---');

  // -------------------------------------------------------------------------
  // DataExporter tests
  // -------------------------------------------------------------------------

  const exporter = new DataExporter({
    conversationStore: convStore,
    memoryStore,
    projectStore,
    skillStore,
    challengeManager,
  });

  // Content counts
  const counts = exporter.getContentCounts();
  check('getContentCounts returns conversation count', counts.conversations === 2, `got ${counts.conversations}`);
  check('getContentCounts returns memory count', counts.memories === 3, `got ${counts.memories}`);
  check('getContentCounts returns project file count', counts.projectFiles === 2, `got ${counts.projectFiles}`);
  check('getContentCounts returns skill count', counts.skills === 0, `got ${counts.skills}`);

  // Full export
  let exportBuffer;
  const progressUpdates = [];
  try {
    exportBuffer = await exporter.exportAll((p) => progressUpdates.push(p));
    check('exportAll returns a Buffer', Buffer.isBuffer(exportBuffer));
    check('exportAll sends progress updates', progressUpdates.length > 0, `got ${progressUpdates.length}`);
    check('progress reaches 100%', progressUpdates.some(p => p.percentage === 100));
  } catch (err) {
    check('exportAll succeeds', false, err.message);
  }

  // Verify ZIP structure
  if (exportBuffer) {
    let zip;
    try {
      zip = new AdmZip(exportBuffer);
      check('export is valid ZIP', true);
    } catch (err) {
      check('export is valid ZIP', false, err.message);
    }

    if (zip) {
      const entryNames = zip.getEntries().map(e => e.entryName);

      check('ZIP has manifest.json', entryNames.includes('manifest.json'));
      check('ZIP has conversations/index.json', entryNames.includes('conversations/index.json'));
      check('ZIP has memories/memories.json', entryNames.includes('memories/memories.json'));
      check('ZIP has project/bastion-project.json', entryNames.includes('project/bastion-project.json'));
      check('ZIP has skills/index.json', entryNames.includes('skills/index.json'));
      check('ZIP has config/challenge-config.json', entryNames.includes('config/challenge-config.json'));
      check('ZIP has config/preferences.json', entryNames.includes('config/preferences.json'));
      check('ZIP has config/safety-config.json', entryNames.includes('config/safety-config.json'));
      check('ZIP has audit/audit-metadata.json', entryNames.includes('audit/audit-metadata.json'));
      check('ZIP has checksum.sha256', entryNames.includes('checksum.sha256'));

      // Verify manifest
      const manifest = JSON.parse(zip.getEntry('manifest.json').getData().toString('utf-8'));
      check('manifest format is bdp', manifest.format === 'bdp');
      check('manifest has version', typeof manifest.version === 'string' && manifest.version.length > 0);
      check('manifest has exportedAt', typeof manifest.exportedAt === 'string');
      check('manifest contentCounts.conversations', manifest.contentCounts.conversations === 2);
      check('manifest contentCounts.memories', manifest.contentCounts.memories === 3);
      check('manifest contentCounts.projectFiles', manifest.contentCounts.projectFiles === 2);

      // Verify checksum
      const manifestForHash = JSON.stringify({ ...manifest, checksum: undefined });
      const expectedChecksum = createHash('sha256').update(manifestForHash).digest('hex');
      check('manifest checksum is correct', manifest.checksum === expectedChecksum);

      const checksumFile = zip.getEntry('checksum.sha256').getData().toString('utf-8');
      check('checksum.sha256 matches manifest', checksumFile === manifest.checksum);

      // Verify conversations
      const convIndex = JSON.parse(zip.getEntry('conversations/index.json').getData().toString('utf-8'));
      check('conversation index has 2 entries', convIndex.length === 2, `got ${convIndex.length}`);

      const convData = JSON.parse(zip.getEntry(`conversations/${conv1.id}.json`).getData().toString('utf-8'));
      check('conversation has messages', convData.messages.length === 3, `got ${convData.messages.length}`);

      // Verify memories
      const memories = JSON.parse(zip.getEntry('memories/memories.json').getData().toString('utf-8'));
      check('memories has 3 entries', memories.length === 3, `got ${memories.length}`);

      // Verify project files
      const projFiles = entryNames.filter(n => n.startsWith('project/files/'));
      check('project has 2 files', projFiles.length === 2, `got ${projFiles.length}`);
    }
  }

  console.log('\n--- BastionImportAdapter Tests ---');

  // -------------------------------------------------------------------------
  // BastionImportAdapter tests
  // -------------------------------------------------------------------------

  const adapter = new BastionImportAdapter();
  check('adapter id is bastion', adapter.id === 'bastion');
  check('adapter supports bdp', adapter.supportedFormats.includes('bdp'));

  // Create a fresh set of stores for import testing
  const importConvDir = makeTempDir('import-conv');
  const importConvStore = new ConversationStore({ path: join(importConvDir, 'conversations.db') });
  importConvStore.createConversation('Existing', 'normal');

  const importMemDir = makeTempDir('import-mem');
  const importMemStore = new MemoryStore({ path: join(importMemDir, 'memories.db') });
  // Add one memory that overlaps with export
  importMemStore.addMemory('User prefers dark mode', 'preference', 'existing', null);

  const importProjDir = makeTempDir('import-proj');
  const importProjStore = new ProjectStore({ rootDir: importProjDir });
  // Add one file that conflicts
  importProjStore.saveFile('readme.md', '# Existing', 'text/markdown');

  const importSkillDir = makeTempDir('import-skill');
  const importSkillStore = new SkillStore({ skillsDir: importSkillDir });

  const storeRefs = {
    conversationStore: importConvStore,
    memoryStore: importMemStore,
    projectStore: importProjStore,
    skillStore: importSkillStore,
  };

  if (exportBuffer) {
    // Validate exported file
    const validation = await adapter.validate(exportBuffer, storeRefs);
    check('validation.valid is true', validation.valid);
    check('validation.format is bdp', validation.format === 'bdp');
    check('validation.contents.conversations is 2', validation.contents.conversations === 2);
    check('validation.contents.memories is 3', validation.contents.memories === 3);
    check('validation.contents.projectFiles is 2', validation.contents.projectFiles === 2);
    check('validation detects project file conflict', validation.conflicts.some(c => c.type === 'project_file' && c.path === 'readme.md'));
    check('validation detects memory duplicate', validation.conflicts.some(c => c.type === 'memory'));

    // Test tampered file rejection
    const tamperedBuffer = Buffer.from(exportBuffer);
    const tampered = new AdmZip(tamperedBuffer);
    const manifestEntry = tampered.getEntry('manifest.json');
    const manifestData = JSON.parse(manifestEntry.getData().toString('utf-8'));
    manifestData.checksum = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    tampered.updateFile(manifestEntry, Buffer.from(JSON.stringify(manifestData)));
    const tamperedValidation = await adapter.validate(tampered.toBuffer(), storeRefs);
    check('tampered file rejected (bad checksum)', !tamperedValidation.valid);
    check('tampered file has error message', tamperedValidation.errors.length > 0, `errors: ${JSON.stringify(tamperedValidation.errors)}`);

    // Test invalid file rejection
    const invalidValidation = await adapter.validate(Buffer.from('not a zip'), storeRefs);
    check('invalid file rejected', !invalidValidation.valid);
    check('invalid file error mentions ZIP', invalidValidation.errors.some(e => e.includes('ZIP') || e.includes('archive')));

    // Extract data
    const extracted = await adapter.extract(exportBuffer);
    check('extract returns conversations', extracted.conversations.length === 2);
    check('extract returns memories', extracted.memories.length === 3);
    check('extract returns project files', extracted.projectFiles.length === 2);
    check('extract returns config', extracted.config !== null);

    console.log('\n--- ImportExecutor Tests ---');

    // Import executor — test merge behaviour
    const executor = new ImportExecutor(storeRefs);

    // Import all with skip for conflicts
    const importResult = executor.execute(extracted, {
      importConversations: true,
      importMemories: true,
      importProjectFiles: true,
      importSkills: true,
      importConfig: false,
      conflictResolutions: [
        { type: 'project_file', path: 'readme.md', action: 'skip' },
      ],
    });

    // Conversations are appended
    check('import appends conversations', importResult.imported.conversations === 2, `imported ${importResult.imported.conversations}`);
    const allConvs = importConvStore.listConversations();
    check('total conversations after import is 3', allConvs.length === 3, `got ${allConvs.length}`);
    check('imported conversation names prefixed', allConvs.some(c => c.name.startsWith('[Imported]')));

    // Memories are deduplicated
    check('memories deduplicated', importResult.imported.memories === 2, `imported ${importResult.imported.memories}`);
    check('duplicate memory skipped', importResult.skipped.memories === 1, `skipped ${importResult.skipped.memories}`);

    // Project file conflict resolution
    check('project file conflict skipped', importResult.skipped.projectFiles >= 1, `skipped ${importResult.skipped.projectFiles}`);
    check('non-conflicting project file imported', importResult.imported.projectFiles >= 1, `imported ${importResult.imported.projectFiles}`);

    // Test content scanning on import
    console.log('\n--- Content Scanning on Import ---');

    const maliciousData = {
      conversations: [{
        id: 'evil', name: 'Evil', type: 'normal',
        messages: [{ role: 'user', type: 'conversation', content: '<script>alert("xss")</script>', timestamp: new Date().toISOString() }],
      }],
      memories: [{ content: '!!python/object:os.system', category: 'fact', source: 'evil' }],
      projectFiles: [{ path: 'evil.txt', content: 'javascript:void(0)', mimeType: 'text/plain' }],
      skills: [],
      config: null,
    };

    const scanResult = executor.execute(maliciousData, {
      importConversations: true,
      importMemories: true,
      importProjectFiles: true,
      importSkills: true,
      importConfig: false,
      conflictResolutions: [],
    });

    check('malicious conversation blocked', scanResult.skipped.conversations === 1);
    check('malicious memory blocked', scanResult.skipped.memories === 1);
    check('malicious project file blocked', scanResult.skipped.projectFiles === 1);
    check('content scan errors reported', scanResult.errors.length >= 3, `got ${scanResult.errors.length} errors`);

    // Test selective import (conversations only)
    console.log('\n--- Selective Import ---');

    const selectiveResult = executor.execute(extracted, {
      importConversations: true,
      importMemories: false,
      importProjectFiles: false,
      importSkills: false,
      importConfig: false,
      conflictResolutions: [],
    });
    check('selective import imports conversations', selectiveResult.imported.conversations > 0);
    check('selective import skips memories', selectiveResult.skipped.memories === extracted.memories.length);
    check('selective import skips project files', selectiveResult.skipped.projectFiles === extracted.projectFiles.length);
  }

  console.log('\n--- ImportRegistry Tests ---');

  // -------------------------------------------------------------------------
  // ImportRegistry tests
  // -------------------------------------------------------------------------

  const registry = new ImportRegistry();
  registry.register(new BastionImportAdapter());

  check('registry has 1 adapter', registry.listAdapters().length === 1);
  check('registry getAdapter works', registry.getAdapter('bastion')?.id === 'bastion');
  check('registry getAdapter returns undefined for unknown', registry.getAdapter('unknown') === undefined);

  if (exportBuffer) {
    const detected = registry.detectAdapter(exportBuffer);
    check('detectAdapter finds bastion adapter for ZIP', detected?.id === 'bastion');
  }

  const nonZip = Buffer.from('not a zip file');
  const detected2 = registry.detectAdapter(nonZip);
  // Non-ZIP should still fallback to available adapter
  check('detectAdapter returns adapter for non-ZIP (fallback)', detected2 !== null);

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  convStore.close?.();
  memoryStore.close?.();
  importConvStore.close?.();
  importMemStore.close?.();

  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  console.log('');
  if (fail > 0) process.exit(1);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
