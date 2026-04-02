// Trace test: Protocol schema validation — every message type, envelope, edge cases
// Run with: node packages/tests/trace-test.mjs

import {
  // Constants
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  ALL_MESSAGE_TYPES,
  ERROR_CODES,
  SAFETY_LAYERS,
  SAFETY_OUTCOMES,

  // Schemas — common
  MessageIdSchema,
  SessionIdSchema,
  TaskIdSchema,
  FileTransferIdSchema,
  CorrelationIdSchema,
  TimestampSchema,
  ClientTypeSchema,
  SenderIdentitySchema,
  PrioritySchema,
  SessionStateSchema,
  ProviderStatusSchema as ProviderStatusEnumSchema,
  ConnectionQualitySchema,

  // Schemas — envelope
  MessageEnvelopeSchema,
  EncryptedEnvelopeSchema,

  // Schemas — message payloads
  TaskPayloadSchema,
  ConversationPayloadSchema,
  ChallengePayloadSchema,
  ChallengeFactorSchema,
  ConfirmationPayloadSchema,
  DenialPayloadSchema,
  StatusPayloadSchema,
  ResultPayloadSchema,
  CostMetadataSchema,
  TransparencyMetadataSchema,
  ErrorPayloadSchema,
  AuditPayloadSchema,
  HeartbeatPayloadSchema,
  HeartbeatMetricsSchema,
  FileManifestPayloadSchema,
  FileOfferPayloadSchema,
  FileRequestPayloadSchema,
  SessionEndPayloadSchema,
  SessionConflictPayloadSchema,
  SessionSupersededPayloadSchema,
  ReconnectPayloadSchema,
  ConfigUpdatePayloadSchema,
  ConfigAckPayloadSchema,
  ConfigNackPayloadSchema,
  TokenRefreshPayloadSchema,
  ProviderStatusPayloadSchema,
  BudgetAlertPayloadSchema,
  BudgetStatusPayloadSchema,
  BudgetConfigPayloadSchema,
  UpdateCheckPayloadSchema,
  UpdateAvailablePayloadSchema,
  UpdatePreparePayloadSchema,
  UpdatePrepareAckPayloadSchema,
  UpdateExecutePayloadSchema,
  UpdateBuildStatusPayloadSchema,
  UpdateRestartPayloadSchema,
  UpdateReconnectedPayloadSchema,
  UpdateCompletePayloadSchema,
  UpdateFailedPayloadSchema,

  // Schemas — file transfer
  FileTransferStateSchema,
  FileTransferDirectionSchema,
  CustodyEventSchema,
  FileChainOfCustodySchema,
  QuarantineEntrySchema,

  // Schemas — payload lookup
  PAYLOAD_SCHEMAS,

  // Utilities
  validateMessage,
  validatePayload,
  serialise,
  deserialise,
  canonicalise,
  sha256,
} from '@bastion/protocol';

import { randomUUID } from 'node:crypto';

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// ---------------------------------------------------------------------------
// Helpers — valid data factories
// ---------------------------------------------------------------------------

const uuid = () => randomUUID();
const ts = () => new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');

function makeSender(type = 'human') {
  const names = { human: 'Alice', ai: 'Claude', relay: 'Bastion Relay', updater: 'Bastion Updater' };
  return { id: uuid(), type, displayName: names[type] || type };
}

function makeEnvelope(type, payload, sender) {
  return {
    id: uuid(),
    type,
    timestamp: ts(),
    sender: sender || makeSender('human'),
    correlationId: uuid(),
    version: PROTOCOL_VERSION,
    payload,
  };
}

// Valid payloads for every message type
function validPayloads() {
  const taskId = uuid();
  const sessionId = uuid();
  const transferId = uuid();
  const messageId = uuid();
  const challengeMsgId = uuid();

  return {
    task: {
      taskId, action: 'analyse', target: '/data/report.csv',
      parameters: { depth: 'full' }, priority: 'normal', constraints: ['read-only'],
    },
    conversation: { content: 'Hello, world!' },
    challenge: {
      challengedMessageId: messageId, challengedTaskId: taskId,
      layer: 2, reason: 'High risk action', riskAssessment: 'Irreversible deployment detected',
      suggestedAlternatives: ['Use staging first'], factors: [{ name: 'scope', description: 'Wide blast radius', weight: 0.8 }],
    },
    confirmation: {
      challengeMessageId: challengeMsgId, decision: 'approve',
      modifiedParameters: { env: 'staging' }, reason: 'Approved after review',
    },
    denial: {
      deniedMessageId: messageId, deniedTaskId: taskId,
      layer: 1, reason: 'Absolute boundary violated', detail: 'Attempted data exfiltration',
    },
    status: {
      taskId, completionPercentage: 42, currentAction: 'Parsing CSV',
      toolsInUse: ['file_read'], metadata: { rowsProcessed: 1500 },
    },
    result: {
      taskId, summary: 'Analysis complete', output: { rows: 3000 },
      actionsTaken: ['read file', 'parse CSV'], generatedFiles: [],
      cost: { inputTokens: 500, outputTokens: 200, estimatedCostUsd: 0.003 },
      transparency: {
        confidenceLevel: 'high', safetyEvaluation: 'allow',
        permissionsUsed: ['file_read'], reasoningNotes: 'Straightforward file analysis',
      },
    },
    error: {
      code: 'BASTION-3001', name: 'SchemaValidationFailed',
      message: 'Payload validation failed', detail: 'Missing required field: taskId',
      recoverable: true, suggestedAction: 'Resend with valid taskId',
      timestamp: ts(),
    },
    audit: {
      eventType: 'message.routed', sessionId,
      detail: { from: 'human', to: 'ai' }, chainHash: sha256('test'),
    },
    heartbeat: {
      sessionId, peerStatus: 'active',
      metrics: { uptimeMs: 60000, memoryUsageMb: 128.5, cpuPercent: 12.3, latencyMs: 45 },
    },
    file_manifest: {
      transferId, filename: 'report.pdf', sizeBytes: 102400,
      hash: sha256('file-content'), hashAlgorithm: 'sha256',
      mimeType: 'application/pdf', purpose: 'Analysis input', projectContext: 'Q4 report',
    },
    file_offer: {
      transferId, filename: 'result.json', sizeBytes: 2048,
      hash: sha256('result'), mimeType: 'application/json',
      purpose: 'Analysis output', taskId,
    },
    file_request: { transferId, manifestMessageId: messageId },
    session_end: { sessionId, reason: 'User requested disconnect' },
    session_conflict: { existingSessionId: sessionId, newDeviceInfo: 'MacBook Pro M3' },
    session_superseded: { sessionId, supersededBy: uuid() },
    reconnect: { sessionId, lastReceivedMessageId: messageId, jwt: 'eyJhbGciOiJIUzI1NiJ9.test.sig' },
    config_update: { configType: 'api_key_rotation', encryptedPayload: 'base64encrypted==' },
    config_ack: { configType: 'api_key_rotation', appliedAt: ts() },
    config_nack: { configType: 'tool_registry', reason: 'Invalid schema', errorDetail: 'Missing tool name' },
    token_refresh: { currentJwt: 'eyJhbGciOiJIUzI1NiJ9.refresh.sig' },
    provider_status: { providerName: 'anthropic', status: 'available' },
    budget_alert: {
      alertLevel: 'urgent_80', message: 'Budget 80% used',
      budgetRemaining: 10.0, searchesRemaining: 100,
    },
    budget_status: {
      searchesThisSession: 5, searchesThisDay: 12,
      searchesThisMonth: 127, costThisMonth: 3.73,
      budgetRemaining: 6.27, percentUsed: 37.3,
      monthlyCapUsd: 10.0, alertLevel: 'none',
    },
    budget_config: {
      monthlyCapUsd: 10.0, maxPerMonth: 500,
      maxPerDay: 50, maxPerSession: 20,
      maxPerCall: 5, alertAtPercent: 50,
    },
    key_exchange: {
      publicKey: 'dGVzdC1wdWJsaWMta2V5LWJhc2U2NC1lbmNvZGVk',
    },
    audit_query: {
      startTime: '2026-03-01T00:00:00.000Z',
      endTime: '2026-03-22T23:59:59.999Z',
      eventType: 'message_routed',
      limit: 50,
      offset: 0,
      includeIntegrity: true,
    },
    audit_response: {
      entries: [{
        eventType: 'message_routed',
        sessionId: crypto.randomUUID(),
        detail: { from: 'human', to: 'ai' },
        chainHash: 'abc123def456',
      }],
      totalCount: 1,
      integrity: {
        chainValid: true,
        entriesChecked: 10,
        lastVerifiedAt: '2026-03-22T12:00:00.000Z',
      },
    },
    provider_register: {
      providerId: 'anthropic-bastion',
      providerName: 'Anthropic (Bastion Official)',
      capabilities: {
        conversation: true,
        taskExecution: true,
        fileTransfer: false,
      },
    },
    context_update: {
      content: 'Harry is the operator. He works on infrastructure and security projects.',
    },
    memory_proposal: {
      proposalId: crypto.randomUUID(),
      content: 'Harry prefers concise answers with command examples.',
      category: 'preference',
      sourceMessageId: crypto.randomUUID(),
    },
    memory_decision: {
      proposalId: crypto.randomUUID(),
      decision: 'approve',
      memoryId: crypto.randomUUID(),
    },
    memory_list: {},
    memory_list_response: {
      memories: [{
        id: crypto.randomUUID(),
        content: 'Harry prefers concise answers.',
        category: 'preference',
        createdAt: '2026-03-23T10:00:00.000Z',
        updatedAt: '2026-03-23T10:00:00.000Z',
      }],
      totalCount: 1,
    },
    memory_update: {
      memoryId: crypto.randomUUID(),
      content: 'Harry prefers concise answers with command examples.',
    },
    memory_delete: {
      memoryId: crypto.randomUUID(),
    },
    extension_query: {
      includeSchemas: false,
    },
    extension_list_response: {
      extensions: [{
        namespace: 'example-game',
        name: 'Example Chess',
        version: '0.1.0',
        messageTypes: ['chess-move', 'chess-start'],
      }],
      totalCount: 1,
    },
    project_sync: { path: 'world-rules.md', content: '# World Rules', mimeType: 'text/markdown' },
    project_sync_ack: { path: 'world-rules.md', size: 13, timestamp: '2026-03-26T10:00:00.000Z' },
    project_list: {},
    project_list_response: { files: [{ path: 'world-rules.md', size: 13, mimeType: 'text/markdown', lastModified: '2026-03-26T10:00:00.000Z' }], totalSize: 13, totalCount: 1 },
    project_delete: { path: 'world-rules.md' },
    project_config: { alwaysLoaded: ['world-rules.md'], available: ['economy/market.md'] },
    project_config_ack: { alwaysLoaded: ['world-rules.md'], available: ['economy/market.md'], timestamp: '2026-03-26T10:00:00.000Z' },
    tool_registry_sync: { providers: [{ id: 'obsidian', name: 'Obsidian', endpoint: 'http://localhost:3000', authType: 'api_key', tools: [{ name: 'read_note', description: 'Read a note', category: 'read', readOnly: true, dangerous: false, modes: ['conversation'] }] }], registryHash: 'abc123' },
    tool_registry_ack: { registryHash: 'abc123', toolCount: 1 },
    tool_request: { requestId: crypto.randomUUID(), toolId: 'obsidian:read_note', action: 'Read note', parameters: { path: 'test.md' }, mode: 'conversation', dangerous: false, category: 'read' },
    tool_approved: { requestId: crypto.randomUUID(), toolId: 'obsidian:read_note', trustLevel: 5, reason: 'Read-only, safe', scope: 'session' },
    tool_denied: { requestId: crypto.randomUUID(), toolId: 'obsidian:read_note', reason: 'Not needed' },
    tool_result: { requestId: crypto.randomUUID(), toolId: 'obsidian:read_note', result: { content: '# Note' }, durationMs: 150, success: true },
    tool_revoke: { toolId: 'obsidian:read_note', reason: 'Session cleanup' },
    tool_alert: { toolId: 'obsidian:new_tool', alertType: 'new_tool', details: 'New tool discovered' },
    tool_alert_response: { toolId: 'obsidian:new_tool', decision: 'accept' },
    challenge_status: { active: true, timezone: 'Europe/London', currentTime: '2026-03-26T23:00:00Z', periodEnd: '2026-03-27T06:00:00', restrictions: ['budget_change'] },
    challenge_config: { schedule: { weekdays: { start: '22:00', end: '06:00' }, weekends: { start: '23:00', end: '08:00' } }, cooldowns: { budgetChangeDays: 7, scheduleChangeDays: 7, toolRegistrationDays: 1 } },
    challenge_config_ack: { accepted: true, reason: 'Schedule updated', cooldownExpires: null },
    conversation_list: { includeArchived: false },
    conversation_list_response: { conversations: [{ id: crypto.randomUUID(), name: 'Default', type: 'normal', updatedAt: '2026-03-26T10:00:00.000Z', messageCount: 5, lastMessagePreview: 'Hello', archived: false }], totalCount: 1 },
    conversation_create: { name: 'New Game', type: 'game' },
    conversation_create_ack: { conversationId: crypto.randomUUID(), name: 'New Game', type: 'game', createdAt: '2026-03-26T10:00:00.000Z' },
    conversation_switch: { conversationId: crypto.randomUUID() },
    conversation_switch_ack: { conversationId: crypto.randomUUID(), name: 'Default', recentMessages: [{ id: crypto.randomUUID(), conversationId: crypto.randomUUID(), role: 'user', type: 'conversation', content: 'Hello', timestamp: '2026-03-26T10:00:00.000Z', hash: 'abc123', previousHash: null, pinned: false }], memories: [{ id: crypto.randomUUID(), content: 'Prefers concise answers', category: 'preference' }] },
    conversation_history: { conversationId: crypto.randomUUID(), limit: 50, offset: 0, direction: 'older' },
    conversation_history_response: { conversationId: crypto.randomUUID(), messages: [{ id: crypto.randomUUID(), conversationId: crypto.randomUUID(), role: 'assistant', type: 'conversation', content: 'Hi there', timestamp: '2026-03-26T10:00:00.000Z', hash: 'def456', previousHash: 'abc123', pinned: false }], hasMore: false, totalCount: 1 },
    conversation_archive: { conversationId: crypto.randomUUID() },
    conversation_delete: { conversationId: crypto.randomUUID() },
    conversation_compact: { conversationId: crypto.randomUUID() },
    conversation_compact_ack: { conversationId: crypto.randomUUID(), summaryPreview: 'Key decisions: chose SQLite...', messagesCovered: 25, tokensSaved: 3000 },
    conversation_stream: { conversationId: crypto.randomUUID(), chunk: 'Hello, ', index: 0, final: false },
    skill_list: {},
    skill_list_response: { skills: [{ id: 'test', name: 'Test', description: 'A test skill', version: '1.0.0', author: 'test', triggers: ['test'], modes: ['conversation'], estimatedTokens: 100 }], totalCount: 1, totalEstimatedTokens: 100 },
    skill_config: { skillId: 'test', alwaysLoad: true },
    ai_disclosure: { text: 'You are interacting with an AI system.', style: 'info', position: 'banner', dismissible: true, link: 'https://example.com/ai-policy', linkText: 'Learn more', jurisdiction: 'EU AI Act Article 50' },
    update_check: { source: 'github', repo: 'Glorktelligence/Bastion', currentVersion: '0.1.0' },
    update_available: { currentVersion: '0.1.0', availableVersion: '0.2.0', commitHash: 'abc123def456', changelog: ['feat: self-update system', 'fix: relay routing'], components: ['relay', 'ai-client', 'admin-ui'], estimatedBuildTime: 120 },
    update_prepare: { targetVersion: '0.2.0', commitHash: 'abc123def456', reason: 'Scheduled update' },
    update_prepare_ack: { component: 'relay', stateSaved: true, currentVersion: '0.1.0' },
    update_execute: { targetComponent: 'relay', commands: [{ type: 'git_pull' }, { type: 'pnpm_install' }, { type: 'pnpm_build', filter: '@bastion/relay' }], version: '0.2.0', commitHash: 'abc123def456' },
    update_build_status: { component: 'relay', phase: 'building', progress: 45, duration: 30 },
    update_restart: { targetComponent: 'relay', service: 'bastion-relay', timeout: 30 },
    update_reconnected: { component: 'relay', version: '0.2.0', previousVersion: '0.1.0' },
    update_complete: { fromVersion: '0.1.0', toVersion: '0.2.0', duration: 180, components: [{ name: 'relay', buildTime: 60, restartTime: 5 }, { name: 'ai-client', buildTime: 90, restartTime: 10 }] },
    update_failed: { phase: 'build', component: 'relay', error: 'TypeScript compilation failed', recoverable: true },
    data_export_request: { format: 'bdp' },
    data_export_progress: { percentage: 50, phase: 'Exporting conversations' },
    data_export_ready: { transferId: 'abc-123', filename: 'export.bdp', sizeBytes: 1024, hash: 'deadbeef', contentCounts: { conversations: 5, memories: 10, projectFiles: 3, skills: 2 } },
    data_import_validate: { valid: true, format: 'bdp', version: '0.7.3', exportedAt: '2026-04-02T00:00:00Z', contents: { conversations: 5, memories: 10, projectFiles: 3, skills: 2, hasConfig: true }, conflicts: [], errors: [] },
    data_import_confirm: { importConversations: true, importMemories: true, importProjectFiles: true, importSkills: false, importConfig: false, conflictResolutions: [] },
    data_import_complete: { imported: { conversations: 5, memories: 8, projectFiles: 3, skills: 0, configSections: 0 }, skipped: { conversations: 0, memories: 2, projectFiles: 0, skills: 2 }, errors: [] },
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function run() {
  console.log('=== Protocol Schema Validation Tests ===');
  console.log();

  const payloads = validPayloads();

  // =========================================================================
  // Test 1: Common schema primitives
  // =========================================================================
  console.log('--- Test 1: Common schema primitives ---');
  {
    // UUID v4
    check('valid UUID v4 passes', MessageIdSchema.safeParse(uuid()).success);
    check('invalid UUID fails', !MessageIdSchema.safeParse('not-a-uuid').success);
    check('UUID v1 fails (wrong variant)', !MessageIdSchema.safeParse('550e8400-e29b-11d4-a716-446655440000').success);
    check('empty string UUID fails', !MessageIdSchema.safeParse('').success);

    // Timestamp
    check('valid ISO 8601 timestamp passes', TimestampSchema.safeParse('2026-03-10T14:30:00.000Z').success);
    check('timestamp without ms passes', TimestampSchema.safeParse('2026-03-10T14:30:00Z').success);
    check('non-UTC timestamp fails', !TimestampSchema.safeParse('2026-03-10T14:30:00+05:00').success);
    check('date-only fails', !TimestampSchema.safeParse('2026-03-10').success);

    // Client type
    check('human client type passes', ClientTypeSchema.safeParse('human').success);
    check('ai client type passes', ClientTypeSchema.safeParse('ai').success);
    check('relay client type passes', ClientTypeSchema.safeParse('relay').success);
    check('updater client type passes', ClientTypeSchema.safeParse('updater').success);
    check('unknown client type fails', !ClientTypeSchema.safeParse('admin').success);

    // SenderIdentity
    check('valid sender identity passes', SenderIdentitySchema.safeParse(makeSender()).success);
    check('sender with empty id fails', !SenderIdentitySchema.safeParse({ id: '', type: 'human', displayName: 'x' }).success);
    check('sender with empty displayName fails', !SenderIdentitySchema.safeParse({ id: 'x', type: 'human', displayName: '' }).success);

    // Priority
    check('all priorities valid', ['low', 'normal', 'high', 'critical'].every(p => PrioritySchema.safeParse(p).success));
    check('invalid priority fails', !PrioritySchema.safeParse('medium').success);

    // Session state
    check('all session states valid', ['connecting', 'authenticating', 'key_exchange', 'active', 'suspended', 'terminated']
      .every(s => SessionStateSchema.safeParse(s).success));

    // Connection quality
    check('all connection qualities valid', ['good', 'fair', 'poor', 'offline']
      .every(q => ConnectionQualitySchema.safeParse(q).success));
  }
  console.log();

  // =========================================================================
  // Test 2: Message envelope schema
  // =========================================================================
  console.log('--- Test 2: Message envelope schema ---');
  {
    const env = makeEnvelope('conversation', { content: 'test' });
    check('valid envelope passes', MessageEnvelopeSchema.safeParse(env).success);

    // Missing fields
    const { id: _id, ...noId } = env;
    check('envelope without id fails', !MessageEnvelopeSchema.safeParse(noId).success);

    const { type: _type, ...noType } = env;
    check('envelope without type fails', !MessageEnvelopeSchema.safeParse(noType).success);

    const { sender: _sender, ...noSender } = env;
    check('envelope without sender fails', !MessageEnvelopeSchema.safeParse(noSender).success);

    // Invalid message type
    const badType = { ...env, type: 'nonexistent_type' };
    check('envelope with invalid type fails', !MessageEnvelopeSchema.safeParse(badType).success);

    // Invalid timestamp
    const badTs = { ...env, timestamp: 'yesterday' };
    check('envelope with bad timestamp fails', !MessageEnvelopeSchema.safeParse(badTs).success);

    // All 23 types accepted in envelope
    let allTypesValid = true;
    for (const mt of ALL_MESSAGE_TYPES) {
      if (!MessageEnvelopeSchema.safeParse(makeEnvelope(mt, {})).success) {
        allTypesValid = false;
        break;
      }
    }
    check('all 81 message types accepted in envelope', allTypesValid);
    check('ALL_MESSAGE_TYPES has 90 entries', ALL_MESSAGE_TYPES.length === 90);
  }
  console.log();

  // =========================================================================
  // Test 3: Encrypted envelope schema
  // =========================================================================
  console.log('--- Test 3: Encrypted envelope schema ---');
  {
    const enc = {
      id: uuid(), type: 'conversation', timestamp: ts(),
      sender: makeSender(), correlationId: uuid(), version: PROTOCOL_VERSION,
      encryptedPayload: 'base64ciphertexthere==', nonce: 'base64noncehere==',
    };
    check('valid encrypted envelope passes', EncryptedEnvelopeSchema.safeParse(enc).success);

    // Missing encryptedPayload
    const { encryptedPayload: _ep, ...noPayload } = enc;
    check('encrypted envelope without encryptedPayload fails', !EncryptedEnvelopeSchema.safeParse(noPayload).success);

    // Missing nonce
    const { nonce: _n, ...noNonce } = enc;
    check('encrypted envelope without nonce fails', !EncryptedEnvelopeSchema.safeParse(noNonce).success);

    // Empty strings
    check('empty encryptedPayload fails', !EncryptedEnvelopeSchema.safeParse({ ...enc, encryptedPayload: '' }).success);
    check('empty nonce fails', !EncryptedEnvelopeSchema.safeParse({ ...enc, nonce: '' }).success);
  }
  console.log();

  // =========================================================================
  // Test 4: All 23 payload schemas — valid data
  // =========================================================================
  console.log('--- Test 4: All 33 payload schemas accept valid data ---');
  {
    const typeKeys = Object.keys(MESSAGE_TYPES);
    check('MESSAGE_TYPES has 90 entries', typeKeys.length === 90);
    check('PAYLOAD_SCHEMAS has 90 entries', Object.keys(PAYLOAD_SCHEMAS).length === 90);

    for (const [key, type] of Object.entries(MESSAGE_TYPES)) {
      const payload = payloads[type];
      if (!payload) {
        check(`${type} payload exists`, false, 'missing from test data');
        continue;
      }
      const schema = PAYLOAD_SCHEMAS[type];
      const result = schema.safeParse(payload);
      check(`${type} payload validates`, result.success, result.error?.message);
    }
  }
  console.log();

  // =========================================================================
  // Test 5: validateMessage() — full envelope + payload validation
  // =========================================================================
  console.log('--- Test 5: validateMessage() full validation ---');
  {
    // Valid full message
    const msg = makeEnvelope('task', payloads.task);
    const r1 = validateMessage(msg);
    check('valid task message passes', r1.valid);
    check('no errors on valid message', r1.errors.length === 0);

    // Valid message for each core type
    const conv = makeEnvelope('conversation', payloads.conversation);
    check('conversation message passes', validateMessage(conv).valid);

    const chal = makeEnvelope('challenge', payloads.challenge, makeSender('ai'));
    check('challenge message passes', validateMessage(chal).valid);

    const deny = makeEnvelope('denial', payloads.denial, makeSender('ai'));
    check('denial message passes', validateMessage(deny).valid);

    const status = makeEnvelope('status', payloads.status, makeSender('ai'));
    check('status message passes', validateMessage(status).valid);

    const result = makeEnvelope('result', payloads.result, makeSender('ai'));
    check('result message passes', validateMessage(result).valid);

    // Invalid payload in valid envelope
    const badPayload = makeEnvelope('task', { taskId: 'not-a-uuid' });
    const r2 = validateMessage(badPayload);
    check('task with invalid taskId fails', !r2.valid);
    check('error path includes payload', r2.errors.some(e => e.path.startsWith('payload')));
  }
  console.log();

  // =========================================================================
  // Test 6: validatePayload() — payload-only validation
  // =========================================================================
  console.log('--- Test 6: validatePayload() payload-only ---');
  {
    check('valid task payload passes', validatePayload('task', payloads.task).valid);
    check('valid heartbeat payload passes', validatePayload('heartbeat', payloads.heartbeat).valid);

    // Empty object
    const r1 = validatePayload('task', {});
    check('empty object fails for task', !r1.valid);
    check('multiple errors for empty task', r1.errors.length > 0);

    // Unknown type
    const r2 = validatePayload('unknown_type', {});
    check('unknown type returns error', !r2.valid);
    check('unknown type error mentions type', r2.errors[0].message.includes('Unknown message type'));

    // All supplementary types validate
    for (const type of ['session_end', 'session_conflict', 'session_superseded', 'reconnect',
      'config_update', 'config_ack', 'config_nack', 'token_refresh', 'provider_status', 'budget_alert']) {
      check(`${type} payload validates`, validatePayload(type, payloads[type]).valid);
    }
  }
  console.log();

  // =========================================================================
  // Test 7: Task payload edge cases
  // =========================================================================
  console.log('--- Test 7: Task payload edge cases ---');
  {
    // Missing required fields
    check('task without taskId fails', !TaskPayloadSchema.safeParse({ action: 'x', target: 'y', parameters: {}, priority: 'normal', constraints: [] }).success);
    check('task without action fails', !TaskPayloadSchema.safeParse({ taskId: uuid(), target: 'y', parameters: {}, priority: 'normal', constraints: [] }).success);
    check('task with empty action fails', !TaskPayloadSchema.safeParse({ taskId: uuid(), action: '', target: 'y', parameters: {}, priority: 'normal', constraints: [] }).success);

    // Priority must be enum value
    check('task with invalid priority fails', !TaskPayloadSchema.safeParse({ ...payloads.task, priority: 'urgent' }).success);

    // Constraints must be string array
    check('task with number constraint fails', !TaskPayloadSchema.safeParse({ ...payloads.task, constraints: [123] }).success);

    // Parameters accepts nested objects
    const nested = { ...payloads.task, parameters: { config: { nested: { deep: true } } } };
    check('task with nested parameters passes', TaskPayloadSchema.safeParse(nested).success);
  }
  console.log();

  // =========================================================================
  // Test 8: Challenge + Confirmation + Denial edge cases
  // =========================================================================
  console.log('--- Test 8: Challenge/Confirmation/Denial edge cases ---');
  {
    // Challenge factor weight must be 0-1
    const badFactor = { ...payloads.challenge, factors: [{ name: 'x', description: 'y', weight: 1.5 }] };
    check('challenge factor weight > 1 fails', !ChallengePayloadSchema.safeParse(badFactor).success);

    const negFactor = { ...payloads.challenge, factors: [{ name: 'x', description: 'y', weight: -0.1 }] };
    check('challenge factor weight < 0 fails', !ChallengePayloadSchema.safeParse(negFactor).success);

    // Challenge layer must be 1, 2, or 3
    check('challenge layer 0 fails', !ChallengePayloadSchema.safeParse({ ...payloads.challenge, layer: 0 }).success);
    check('challenge layer 4 fails', !ChallengePayloadSchema.safeParse({ ...payloads.challenge, layer: 4 }).success);

    // Confirmation decision enum
    check('confirmation approve passes', ConfirmationPayloadSchema.safeParse({ ...payloads.confirmation, decision: 'approve' }).success);
    check('confirmation modify passes', ConfirmationPayloadSchema.safeParse({ ...payloads.confirmation, decision: 'modify' }).success);
    check('confirmation cancel passes', ConfirmationPayloadSchema.safeParse({ ...payloads.confirmation, decision: 'cancel' }).success);
    check('confirmation invalid decision fails', !ConfirmationPayloadSchema.safeParse({ ...payloads.confirmation, decision: 'reject' }).success);

    // Confirmation modifiedParameters and reason are optional
    const minConfirm = { challengeMessageId: uuid(), decision: 'approve' };
    check('confirmation without optional fields passes', ConfirmationPayloadSchema.safeParse(minConfirm).success);

    // Denial layer must be valid
    check('denial layer 1 valid', DenialPayloadSchema.safeParse({ ...payloads.denial, layer: 1 }).success);
    check('denial layer 3 valid', DenialPayloadSchema.safeParse({ ...payloads.denial, layer: 3 }).success);
  }
  console.log();

  // =========================================================================
  // Test 9: Result payload — cost and transparency metadata
  // =========================================================================
  console.log('--- Test 9: Result payload — cost and transparency ---');
  {
    // Cost must have non-negative integers for tokens
    check('cost with negative tokens fails', !CostMetadataSchema.safeParse({ inputTokens: -1, outputTokens: 0, estimatedCostUsd: 0 }).success);
    check('cost with float tokens fails', !CostMetadataSchema.safeParse({ inputTokens: 1.5, outputTokens: 0, estimatedCostUsd: 0 }).success);
    check('cost with zero values passes', CostMetadataSchema.safeParse({ inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }).success);

    // Transparency confidence levels
    check('confidence high passes', TransparencyMetadataSchema.safeParse({ ...payloads.result.transparency, confidenceLevel: 'high' }).success);
    check('confidence medium passes', TransparencyMetadataSchema.safeParse({ ...payloads.result.transparency, confidenceLevel: 'medium' }).success);
    check('confidence low passes', TransparencyMetadataSchema.safeParse({ ...payloads.result.transparency, confidenceLevel: 'low' }).success);
    check('confidence invalid fails', !TransparencyMetadataSchema.safeParse({ ...payloads.result.transparency, confidenceLevel: 'uncertain' }).success);

    // Safety evaluation outcomes in transparency
    for (const outcome of ['allow', 'challenge', 'deny', 'clarify']) {
      check(`transparency safety ${outcome} passes`,
        TransparencyMetadataSchema.safeParse({ ...payloads.result.transparency, safetyEvaluation: outcome }).success);
    }
  }
  console.log();

  // =========================================================================
  // Test 10: Error payload — error code format
  // =========================================================================
  console.log('--- Test 10: Error payload — error code format ---');
  {
    // Valid error codes from each category
    check('BASTION-1001 valid', ErrorPayloadSchema.safeParse({ ...payloads.error, code: 'BASTION-1001' }).success);
    check('BASTION-2006 valid', ErrorPayloadSchema.safeParse({ ...payloads.error, code: 'BASTION-2006' }).success);
    check('BASTION-7005 valid', ErrorPayloadSchema.safeParse({ ...payloads.error, code: 'BASTION-7005' }).success);

    // Invalid error code formats
    check('BASTION-0001 fails (category 0)', !ErrorPayloadSchema.safeParse({ ...payloads.error, code: 'BASTION-0001' }).success);
    check('BASTION-8001 passes (budget category)', ErrorPayloadSchema.safeParse({ ...payloads.error, code: 'BASTION-8001' }).success);
    check('BASTION-9001 fails (category 9)', !ErrorPayloadSchema.safeParse({ ...payloads.error, code: 'BASTION-9001' }).success);
    check('ERROR-1001 fails (wrong prefix)', !ErrorPayloadSchema.safeParse({ ...payloads.error, code: 'ERROR-1001' }).success);
    check('BASTION-100 fails (too short)', !ErrorPayloadSchema.safeParse({ ...payloads.error, code: 'BASTION-100' }).success);

    // All ERROR_CODES constants are valid
    let allCodesValid = true;
    for (const code of Object.values(ERROR_CODES)) {
      if (!ErrorPayloadSchema.safeParse({ ...payloads.error, code }).success) {
        allCodesValid = false;
        break;
      }
    }
    check('all ERROR_CODES constants pass validation', allCodesValid);
  }
  console.log();

  // =========================================================================
  // Test 11: Status payload constraints
  // =========================================================================
  console.log('--- Test 11: Status payload constraints ---');
  {
    check('completion 0% passes', StatusPayloadSchema.safeParse({ ...payloads.status, completionPercentage: 0 }).success);
    check('completion 100% passes', StatusPayloadSchema.safeParse({ ...payloads.status, completionPercentage: 100 }).success);
    check('completion -1% fails', !StatusPayloadSchema.safeParse({ ...payloads.status, completionPercentage: -1 }).success);
    check('completion 101% fails', !StatusPayloadSchema.safeParse({ ...payloads.status, completionPercentage: 101 }).success);
    check('completion 50.5% passes (float OK)', StatusPayloadSchema.safeParse({ ...payloads.status, completionPercentage: 50.5 }).success);
  }
  console.log();

  // =========================================================================
  // Test 12: File transfer schemas
  // =========================================================================
  console.log('--- Test 12: File transfer schemas ---');
  {
    // FileManifest
    check('file manifest valid', FileManifestPayloadSchema.safeParse(payloads.file_manifest).success);
    check('file manifest sizeBytes must be positive', !FileManifestPayloadSchema.safeParse({ ...payloads.file_manifest, sizeBytes: 0 }).success);
    check('file manifest hashAlgorithm must be sha256', !FileManifestPayloadSchema.safeParse({ ...payloads.file_manifest, hashAlgorithm: 'md5' }).success);

    // FileOffer
    check('file offer valid', FileOfferPayloadSchema.safeParse(payloads.file_offer).success);
    check('file offer taskId optional', FileOfferPayloadSchema.safeParse({
      transferId: uuid(), filename: 'x.txt', sizeBytes: 100, hash: 'abc', mimeType: 'text/plain', purpose: 'test',
    }).success);

    // FileRequest
    check('file request valid', FileRequestPayloadSchema.safeParse(payloads.file_request).success);

    // File transfer state enum
    const validStates = ['pending_manifest', 'quarantined', 'offered', 'accepted', 'rejected',
      'delivering', 'delivered', 'hash_mismatch', 'purged', 'timed_out'];
    check('all 10 file transfer states valid', validStates.every(s => FileTransferStateSchema.safeParse(s).success));

    // Direction enum
    check('human_to_ai direction valid', FileTransferDirectionSchema.safeParse('human_to_ai').success);
    check('ai_to_human direction valid', FileTransferDirectionSchema.safeParse('ai_to_human').success);
    check('invalid direction fails', !FileTransferDirectionSchema.safeParse('relay_to_human').success);

    // Chain of custody
    const custody = {
      transferId: uuid(), direction: 'human_to_ai', filename: 'x.txt',
      sizeBytes: 100, mimeType: 'text/plain',
      events: [{ event: 'submitted', timestamp: ts(), actor: 'human-1' }],
    };
    check('valid chain of custody passes', FileChainOfCustodySchema.safeParse(custody).success);

    // Quarantine entry
    const quarantine = {
      transferId: uuid(), direction: 'human_to_ai', filename: 'x.txt',
      sizeBytes: 100, mimeType: 'text/plain', hashAtReceipt: sha256('file'),
      hashAlgorithm: 'sha256', quarantinedAt: ts(), manifestMessageId: uuid(),
      state: 'quarantined', purgeAt: ts(),
    };
    check('valid quarantine entry passes', QuarantineEntrySchema.safeParse(quarantine).success);
  }
  console.log();

  // =========================================================================
  // Test 13: Heartbeat constraints
  // =========================================================================
  console.log('--- Test 13: Heartbeat constraints ---');
  {
    check('heartbeat valid', HeartbeatPayloadSchema.safeParse(payloads.heartbeat).success);

    // Metrics constraints
    check('cpuPercent 0 valid', HeartbeatMetricsSchema.safeParse({ ...payloads.heartbeat.metrics, cpuPercent: 0 }).success);
    check('cpuPercent 100 valid', HeartbeatMetricsSchema.safeParse({ ...payloads.heartbeat.metrics, cpuPercent: 100 }).success);
    check('cpuPercent 101 fails', !HeartbeatMetricsSchema.safeParse({ ...payloads.heartbeat.metrics, cpuPercent: 101 }).success);
    check('negative uptimeMs fails', !HeartbeatMetricsSchema.safeParse({ ...payloads.heartbeat.metrics, uptimeMs: -1 }).success);

    // Peer status must be valid session state
    check('heartbeat with invalid peerStatus fails', !HeartbeatPayloadSchema.safeParse({ ...payloads.heartbeat, peerStatus: 'online' }).success);
  }
  console.log();

  // =========================================================================
  // Test 14: Supplementary message edge cases
  // =========================================================================
  console.log('--- Test 14: Supplementary message edge cases ---');
  {
    // ConfigUpdate type enum
    check('config_update api_key_rotation valid', ConfigUpdatePayloadSchema.safeParse({ configType: 'api_key_rotation', encryptedPayload: 'x' }).success);
    check('config_update tool_registry valid', ConfigUpdatePayloadSchema.safeParse({ configType: 'tool_registry', encryptedPayload: 'x' }).success);
    check('config_update safety_config valid', ConfigUpdatePayloadSchema.safeParse({ configType: 'safety_config', encryptedPayload: 'x' }).success);
    check('config_update invalid type fails', !ConfigUpdatePayloadSchema.safeParse({ configType: 'database', encryptedPayload: 'x' }).success);

    // ProviderStatus optional fields
    const minProvider = { providerName: 'anthropic', status: 'unavailable' };
    check('provider_status without optionals passes', ProviderStatusPayloadSchema.safeParse(minProvider).success);
    const fullProvider = { ...minProvider, errorDetail: 'API down', retryAttempt: 3, nextRetryMs: 30000 };
    check('provider_status with all fields passes', ProviderStatusPayloadSchema.safeParse(fullProvider).success);

    // BudgetAlert constraints (new schema)
    check('budget alert valid', BudgetAlertPayloadSchema.safeParse(payloads.budget_alert).success);
    check('budget alert bad level fails', !BudgetAlertPayloadSchema.safeParse({ ...payloads.budget_alert, alertLevel: 'invalid' }).success);
    check('budget alert empty message fails', !BudgetAlertPayloadSchema.safeParse({ ...payloads.budget_alert, message: '' }).success);

    // BudgetStatus constraints
    check('budget status valid', BudgetStatusPayloadSchema.safeParse(payloads.budget_status).success);
    check('budget status negative session fails', !BudgetStatusPayloadSchema.safeParse({ ...payloads.budget_status, searchesThisSession: -1 }).success);
    check('budget status pct > 100 fails', !BudgetStatusPayloadSchema.safeParse({ ...payloads.budget_status, percentUsed: 101 }).success);
    check('budget status bad alertLevel fails', !BudgetStatusPayloadSchema.safeParse({ ...payloads.budget_status, alertLevel: 'invalid' }).success);

    // BudgetConfig constraints
    check('budget config valid', BudgetConfigPayloadSchema.safeParse(payloads.budget_config).success);
    check('budget config zero cap fails', !BudgetConfigPayloadSchema.safeParse({ ...payloads.budget_config, monthlyCapUsd: 0 }).success);
    check('budget config zero maxPerMonth fails', !BudgetConfigPayloadSchema.safeParse({ ...payloads.budget_config, maxPerMonth: 0 }).success);
    check('budget config alertAt 0 fails', !BudgetConfigPayloadSchema.safeParse({ ...payloads.budget_config, alertAtPercent: 0 }).success);
    check('budget config alertAt 100 fails', !BudgetConfigPayloadSchema.safeParse({ ...payloads.budget_config, alertAtPercent: 100 }).success);

    // Reconnect JWT is optional
    const minReconnect = { sessionId: uuid(), lastReceivedMessageId: uuid() };
    check('reconnect without jwt passes', ReconnectPayloadSchema.safeParse(minReconnect).success);
  }
  console.log();

  // =========================================================================
  // Test 15: Serialisation round-trip
  // =========================================================================
  console.log('--- Test 15: Serialisation round-trip ---');
  {
    const envelope = makeEnvelope('conversation', payloads.conversation);
    const serialised = serialise(envelope);

    check('serialise returns wire string', typeof serialised.wire === 'string');
    check('serialise returns integrity hash', serialised.integrity.startsWith('sha256:'));
    check('wire contains _integrity', serialised.wire.includes('_integrity'));

    // Deserialise back
    const deser = deserialise(serialised.wire);
    check('deserialise succeeds', deser.success);
    if (deser.success) {
      check('round-trip preserves id', deser.envelope.id === envelope.id);
      check('round-trip preserves type', deser.envelope.type === envelope.type);
      check('round-trip preserves payload content', deser.envelope.payload.content === envelope.payload.content);
      check('integrity matches', deser.integrity === serialised.integrity);
    }
  }
  console.log();

  // =========================================================================
  // Test 16: Serialisation integrity tamper detection
  // =========================================================================
  console.log('--- Test 16: Serialisation integrity tamper detection ---');
  {
    const envelope = makeEnvelope('conversation', { content: 'Original message' });
    const serialised = serialise(envelope);

    // Tamper with the wire data (change content)
    const tampered = serialised.wire.replace('Original message', 'Tampered message');
    const deser = deserialise(tampered);
    check('tampered wire fails deserialisation', !deser.success);
    if (!deser.success) {
      check('error mentions integrity', deser.errors.some(e => e.message.includes('Integrity') || e.message.includes('integrity')));
    }

    // Missing _integrity
    const parsed = JSON.parse(serialised.wire);
    delete parsed._integrity;
    const noIntegrity = deserialise(JSON.stringify(parsed));
    check('missing _integrity fails', !noIntegrity.success);

    // Invalid JSON
    const badJson = deserialise('not json at all');
    check('invalid JSON fails', !badJson.success);
    check('JSON error mentions parsing', badJson.errors.some(e => e.message.includes('JSON')));
  }
  console.log();

  // =========================================================================
  // Test 17: Canonical JSON determinism
  // =========================================================================
  console.log('--- Test 17: Canonical JSON determinism ---');
  {
    // Key ordering
    const obj1 = { b: 2, a: 1, c: 3 };
    const obj2 = { c: 3, a: 1, b: 2 };
    check('key order doesn\'t matter', canonicalise(obj1) === canonicalise(obj2));

    // Nested ordering
    const nested1 = { outer: { z: 1, a: 2 } };
    const nested2 = { outer: { a: 2, z: 1 } };
    check('nested key order doesn\'t matter', canonicalise(nested1) === canonicalise(nested2));

    // Null and undefined
    check('null canonicalises to null', canonicalise(null) === 'null');
    check('undefined canonicalises to null', canonicalise(undefined) === 'null');

    // Arrays preserve order
    check('array order preserved', canonicalise([3, 1, 2]) === '[3,1,2]');

    // No whitespace
    const canonical = canonicalise({ key: 'value' });
    check('no whitespace in canonical', !canonical.includes(' '));

    // Same envelope always produces same hash
    const env = makeEnvelope('conversation', { content: 'test' });
    const h1 = sha256(canonicalise(env));
    const h2 = sha256(canonicalise(env));
    check('same input → same hash', h1 === h2);
  }
  console.log();

  // =========================================================================
  // Test 18: Serialise every message type round-trip
  // =========================================================================
  console.log('--- Test 18: Serialise all 25 types round-trip ---');
  {
    let allPassed = true;
    for (const [key, type] of Object.entries(MESSAGE_TYPES)) {
      const payload = payloads[type];
      if (!payload) { allPassed = false; continue; }
      try {
        const env = makeEnvelope(type, payload);
        const ser = serialise(env);
        const deser = deserialise(ser.wire);
        if (!deser.success) {
          allPassed = false;
          console.log(`    FAIL round-trip: ${type}`, deser.errors);
        }
      } catch (err) {
        allPassed = false;
        console.log(`    FAIL round-trip: ${type}`, err.message);
      }
    }
    check('all 90 message types survive serialisation round-trip', allPassed);
  }
  console.log();

  // =========================================================================
  // Test 19: Cross-type validation — wrong payload for type
  // =========================================================================
  console.log('--- Test 19: Cross-type validation — wrong payload for type ---');
  {
    // Task envelope with conversation payload should fail
    const wrongPayload = makeEnvelope('task', payloads.conversation);
    const r = validateMessage(wrongPayload);
    check('task envelope with conversation payload fails', !r.valid);

    // Conversation envelope with task payload should fail (content required)
    const wrongPayload2 = makeEnvelope('conversation', payloads.task);
    const r2 = validateMessage(wrongPayload2);
    // This actually passes because ConversationPayload only requires 'content', and task payload
    // doesn't have 'content'. Let's verify:
    check('conversation envelope with task payload (no content) fails', !r2.valid);

    // Result envelope with denial payload
    const wrongPayload3 = makeEnvelope('result', payloads.denial);
    const r3 = validateMessage(wrongPayload3);
    check('result envelope with denial payload fails', !r3.valid);
  }
  console.log();

  // =========================================================================
  // Test 20: Constants consistency checks
  // =========================================================================
  console.log('--- Test 20: Constants consistency ---');
  {
    check('PROTOCOL_VERSION is semver', /^\d+\.\d+\.\d+$/.test(PROTOCOL_VERSION));
    check('MESSAGE_TYPES keys match values', Object.entries(MESSAGE_TYPES)
      .every(([key, value]) => key === value.toUpperCase()));

    // Every MESSAGE_TYPES value is in ALL_MESSAGE_TYPES
    check('all MESSAGE_TYPES in ALL_MESSAGE_TYPES',
      Object.values(MESSAGE_TYPES).every(t => ALL_MESSAGE_TYPES.includes(t)));

    // SAFETY constants exist
    check('SAFETY_LAYERS defined', SAFETY_LAYERS !== undefined);
    check('SAFETY_OUTCOMES defined', SAFETY_OUTCOMES !== undefined);

    // Error codes have correct format
    const allCodes = Object.values(ERROR_CODES);
    check('all error codes match BASTION-CXXX', allCodes.every(c => /^BASTION-[1-8]\d{3}$/.test(c)));
    check('error codes span 8 categories', new Set(allCodes.map(c => c[8])).size === 8);
  }
  console.log();

  // =========================================================================
  // Test 21: Boundary values and type coercion
  // =========================================================================
  console.log('--- Test 21: Boundary values and type coercion ---');
  {
    // String where number expected
    check('string completionPercentage fails', !StatusPayloadSchema.safeParse({ ...payloads.status, completionPercentage: '50' }).success);

    // Number where string expected
    check('number content fails for conversation', !ConversationPayloadSchema.safeParse({ content: 42 }).success);

    // Boolean where string expected
    check('boolean action fails for task', !TaskPayloadSchema.safeParse({ ...payloads.task, action: true }).success);

    // Extra fields are stripped (Zod passthrough vs strict)
    const withExtra = { ...payloads.conversation, extraField: 'bonus' };
    const r = ConversationPayloadSchema.safeParse(withExtra);
    check('extra fields do not cause failure', r.success);

    // Null where object expected
    check('null parameters fails for task', !TaskPayloadSchema.safeParse({ ...payloads.task, parameters: null }).success);

    // Array where object expected
    check('array parameters fails for task', !TaskPayloadSchema.safeParse({ ...payloads.task, parameters: [1, 2, 3] }).success);

    // Very large values
    const bigResult = { ...payloads.result, cost: { inputTokens: 999999999, outputTokens: 999999999, estimatedCostUsd: 99999.99 } };
    check('very large token counts pass', ResultPayloadSchema.safeParse(bigResult).success);
  }
  console.log();

  // =========================================================================
  // Test 22: Self-Update System validation
  // =========================================================================
  console.log('--- Test 22: Self-Update System validation ---');
  {
    // update_check
    check('update_check valid', UpdateCheckPayloadSchema.safeParse(payloads.update_check).success);
    check('update_check requires github source', !UpdateCheckPayloadSchema.safeParse({ ...payloads.update_check, source: 'gitlab' }).success);
    check('update_check requires repo', !UpdateCheckPayloadSchema.safeParse({ source: 'github', currentVersion: '0.1.0' }).success);

    // update_available
    check('update_available valid', UpdateAvailablePayloadSchema.safeParse(payloads.update_available).success);
    check('update_available optional estimatedBuildTime', UpdateAvailablePayloadSchema.safeParse({ ...payloads.update_available, estimatedBuildTime: undefined }).success);

    // update_execute command whitelist — CRITICAL security test
    check('update_execute valid with whitelist commands', UpdateExecutePayloadSchema.safeParse(payloads.update_execute).success);
    check('update_execute rejects unknown command type', !UpdateExecutePayloadSchema.safeParse({
      ...payloads.update_execute,
      commands: [{ type: 'shell_exec', command: 'rm -rf /' }],
    }).success);
    check('update_execute rejects eval command', !UpdateExecutePayloadSchema.safeParse({
      ...payloads.update_execute,
      commands: [{ type: 'eval', code: 'process.exit(1)' }],
    }).success);
    check('update_execute rejects arbitrary strings', !UpdateExecutePayloadSchema.safeParse({
      ...payloads.update_execute,
      commands: [{ type: 'sudo rm -rf /' }],
    }).success);
    check('update_execute accepts git_pull with repo', UpdateExecutePayloadSchema.safeParse({
      ...payloads.update_execute,
      commands: [{ type: 'git_pull', repo: 'https://github.com/Glorktelligence/Bastion.git' }],
    }).success);
    check('update_execute accepts pnpm_build with filter', UpdateExecutePayloadSchema.safeParse({
      ...payloads.update_execute,
      commands: [{ type: 'pnpm_build', filter: '@bastion/relay' }],
    }).success);
    check('update_execute targetComponent enum', !UpdateExecutePayloadSchema.safeParse({
      ...payloads.update_execute,
      targetComponent: 'database',
    }).success);

    // update_build_status
    check('update_build_status valid', UpdateBuildStatusPayloadSchema.safeParse(payloads.update_build_status).success);
    check('update_build_status all phases valid', ['pulling', 'installing', 'building', 'complete', 'failed'].every(
      phase => UpdateBuildStatusPayloadSchema.safeParse({ ...payloads.update_build_status, phase }).success
    ));
    check('update_build_status invalid phase fails', !UpdateBuildStatusPayloadSchema.safeParse({ ...payloads.update_build_status, phase: 'compiling' }).success);
    check('update_build_status with error', UpdateBuildStatusPayloadSchema.safeParse({ component: 'relay', phase: 'failed', error: 'tsc error' }).success);

    // update_restart
    check('update_restart valid', UpdateRestartPayloadSchema.safeParse(payloads.update_restart).success);
    check('update_restart requires positive timeout', !UpdateRestartPayloadSchema.safeParse({ ...payloads.update_restart, timeout: 0 }).success);

    // update_reconnected
    check('update_reconnected valid', UpdateReconnectedPayloadSchema.safeParse(payloads.update_reconnected).success);

    // update_complete
    check('update_complete valid', UpdateCompletePayloadSchema.safeParse(payloads.update_complete).success);
    check('update_complete with empty components', UpdateCompletePayloadSchema.safeParse({ ...payloads.update_complete, components: [] }).success);

    // update_failed
    check('update_failed valid', UpdateFailedPayloadSchema.safeParse(payloads.update_failed).success);
    check('update_failed all phases valid', ['check', 'prepare', 'build', 'restart', 'verify'].every(
      phase => UpdateFailedPayloadSchema.safeParse({ ...payloads.update_failed, phase }).success
    ));
    check('update_failed invalid phase', !UpdateFailedPayloadSchema.safeParse({ ...payloads.update_failed, phase: 'deploy' }).success);
    check('update_failed optional component', UpdateFailedPayloadSchema.safeParse({ phase: 'check', error: 'Network error', recoverable: true }).success);

    // update_prepare + update_prepare_ack
    check('update_prepare valid', UpdatePreparePayloadSchema.safeParse(payloads.update_prepare).success);
    check('update_prepare_ack valid', UpdatePrepareAckPayloadSchema.safeParse(payloads.update_prepare_ack).success);

    // Round-trip serialisation for update types
    const updateTypes = ['update_check', 'update_available', 'update_prepare', 'update_prepare_ack', 'update_execute', 'update_build_status', 'update_restart', 'update_reconnected', 'update_complete', 'update_failed'];
    let allUpdateRoundTrips = true;
    for (const type of updateTypes) {
      const env = makeEnvelope(type, payloads[type], makeSender('updater'));
      const ser = serialise(env);
      const des = deserialise(ser.wire);
      if (!des.success) {
        allUpdateRoundTrips = false;
        console.log(`  FAIL round-trip for ${type}: ${JSON.stringify(des.errors)}`);
      }
    }
    check('all 10 update types survive serialisation round-trip', allUpdateRoundTrips);
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
