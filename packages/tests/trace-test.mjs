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
  ConfigAckPayloadSchema,
  ConfigNackPayloadSchema,
  TokenRefreshPayloadSchema,
  ProviderStatusPayloadSchema,
  BudgetAlertPayloadSchema,
  BudgetStatusPayloadSchema,
  BudgetConfigPayloadSchema,
  // Schemas — file transfer
  FileTransferStateSchema,
  FileTransferDirectionSchema,
  CustodyEventSchema,
  FileChainOfCustodySchema,
  QuarantineEntrySchema,

  // Schemas — payload lookup
  PAYLOAD_SCHEMAS,

  // Schemas — extension manifest
  ExtensionSafetyLevelSchema,
  ExtensionMessageTypeSchema,
  ExtensionUIComponentSchema,
  ExtensionUIPageSchema,
  ExtensionUISchema,
  ExtensionManifestSchema,
  SkillListResponsePayloadSchema,

  // Schemas — extension state bridge (M14)
  ExtensionStateUpdatePayloadSchema,
  ExtensionStateRequestPayloadSchema,
  ExtensionStateResponsePayloadSchema,

  // Constants
  RESERVED_NAMESPACES,

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
    session_restored: { sessionId, queuedMessageCount: 3 },
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
    context_request: {},
    context_response: {
      content: 'Harry is the operator. Loves infrastructure.',
      source: 'file',
      charCount: 42,
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
        conversationRenderers: {
          'game-turn': { html: '<div>Turn</div>', style: 'compact' },
        },
      }],
      totalCount: 1,
    },
    extension_state_update: {
      namespace: 'chronicle',
      state: { turn: 3, phase: 'action' },
    },
    extension_state_request: {
      namespace: 'chronicle',
    },
    extension_state_response: {
      namespace: 'chronicle',
      state: { turn: 3, phase: 'action' },
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
    tool_alert: { alertType: 'new_tool_detected', severity: 'warning', toolName: 'new_tool', providerId: 'obsidian', fullId: 'obsidian:new_tool', source: 'mcp', detectedAt: '2026-03-26T10:00:00.000Z', description: 'A newly discovered tool', message: 'Tool "new_tool" detected but not in registry' },
    tool_alert_response: { toolId: 'obsidian:new_tool', decision: 'accept' },
    tool_register: { providerId: 'obsidian', tool: { name: 'new_tool', description: 'A new tool', category: 'read', readOnly: true, dangerous: false, modes: ['conversation'] }, action: 'approve' },
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
    skill_list_response: { skills: [{ id: 'test', name: 'Test', description: 'A test skill', version: '1.0.0', author: 'test', triggers: ['test'], modes: ['conversation'], estimatedTokens: 100 }], totalCount: 1, totalEstimatedTokens: 100 },
    skill_scan_result: { skillId: 'test-skill', passed: true, checks: [{ name: 'file_type', passed: true, detail: 'Markdown file' }, { name: 'size_limit', passed: true, detail: '512 bytes (max: 1048576)' }], hash: 'sha256:abc123', fileSize: 512, action: 'pending_review' },
    ai_disclosure: { text: 'You are interacting with an AI system.', style: 'info', position: 'banner', dismissible: true, link: 'https://example.com/ai-policy', linkText: 'Learn more', jurisdiction: 'EU AI Act Article 50' },
    data_export_request: { format: 'bdp' },
    data_export_progress: { percentage: 50, phase: 'Exporting conversations' },
    data_export_ready: { transferId: 'abc-123', filename: 'export.bdp', sizeBytes: 1024, hash: 'deadbeef', contentCounts: { conversations: 5, memories: 10, projectFiles: 3, skills: 2 } },
    data_import_validate: { valid: true, format: 'bdp', version: '0.7.3', exportedAt: '2026-04-02T00:00:00Z', contents: { conversations: 5, memories: 10, projectFiles: 3, skills: 2, hasConfig: true }, conflicts: [], errors: [] },
    data_import_confirm: { importConversations: true, importMemories: true, importProjectFiles: true, importSkills: false, importConfig: false, conflictResolutions: [] },
    data_import_complete: { imported: { conversations: 5, memories: 8, projectFiles: 3, skills: 0, configSections: 0 }, skipped: { conversations: 0, memories: 2, projectFiles: 0, skills: 2 }, errors: [] },
    usage_status: { today: { calls: 10, inputTokens: 5000, outputTokens: 3000, costUsd: 0.05 }, thisMonth: { calls: 200, inputTokens: 100000, outputTokens: 70000, costUsd: 1.20 }, byAdapter: { 'claude-sonnet-4': { calls: 180, costUsd: 1.00 } }, budget: { monthlyCapUsd: 10, remaining: 8.80, percentUsed: 12, alertLevel: 'none' } },
    data_erasure_request: {},
    data_erasure_preview: { conversations: 5, messages: 100, memories: 10, projectFiles: 3, skills: 0, usageRecords: 50, softDeleteDays: 30, hardDeleteAt: '2026-05-03T00:00:00Z', auditNote: 'Audit metadata preserved.' },
    data_erasure_confirm: { confirmed: true },
    data_erasure_complete: { erasureId: 'abc-123', softDeleted: { conversations: 5, messages: 100, memories: 10, projectFiles: 3, usageRecords: 50 }, hardDeleteScheduledAt: '2026-05-03T00:00:00Z', receipt: 'BASTION-ERASURE-abc-123' },
    data_erasure_cancel: { erasureId: 'abc-123' },
    ai_challenge: { challengeId: 'c-1', reason: 'late night deletion', severity: 'critical', suggestedAction: 'sleep on it', waitSeconds: 30, context: { challengeHoursActive: true, requestedAction: 'delete data' } },
    ai_challenge_response: { challengeId: 'c-1', decision: 'accept' },
    ai_memory_proposal: { proposalId: 'p-1', content: 'User prefers TypeScript', category: 'preference', reason: 'stated', sourceMessageId: 'm-1', conversationId: 'conv-1' },
    ai_memory_proposal_batch: { batchId: 'batch-1', source: 'dream_cycle', conversationId: 'conv-1', proposals: [{ proposalId: 'p-1', content: 'User prefers TypeScript', category: 'preference', reason: 'stated', isUpdate: false, existingMemoryContent: null }] },
    memory_batch_decision: { batchId: 'batch-1', decisions: [{ proposalId: 'p-1', decision: 'approved', editedContent: null }] },
    dream_cycle_request: { conversationId: 'conv-1', scope: 'conversation' },
    dream_cycle_complete: { conversationId: 'conv-1', candidateCount: 3, tokensUsed: { input: 10000, output: 500 }, estimatedCost: 0.12, durationMs: 3200 },
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
    check('all 88 message types accepted in envelope', allTypesValid);
    check('ALL_MESSAGE_TYPES has 97 entries', ALL_MESSAGE_TYPES.length === 97);
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
    check('MESSAGE_TYPES has 97 entries', typeKeys.length === 97);
    check('PAYLOAD_SCHEMAS has 97 entries', Object.keys(PAYLOAD_SCHEMAS).length === 97);

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
      'config_ack', 'config_nack', 'token_refresh', 'provider_status', 'budget_alert']) {
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
    check('all 88 message types survive serialisation round-trip', allPassed);
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
  // Test: H18 — Extension manifest types importable from @bastion/protocol
  // =========================================================================
  console.log('--- H18: Extension manifest types & Zod schemas ---');
  {
    // ExtensionSafetyLevelSchema validates correct levels
    check('H18: safety level "passthrough" valid', ExtensionSafetyLevelSchema.safeParse('passthrough').success);
    check('H18: safety level "task" valid', ExtensionSafetyLevelSchema.safeParse('task').success);
    check('H18: safety level "admin" valid', ExtensionSafetyLevelSchema.safeParse('admin').success);
    check('H18: safety level "blocked" valid', ExtensionSafetyLevelSchema.safeParse('blocked').success);
    check('H18: safety level "invalid" rejected', !ExtensionSafetyLevelSchema.safeParse('invalid').success);

    // ExtensionMessageTypeSchema
    const validMsgType = {
      name: 'chess-move',
      description: 'A chess move',
      fields: { from: { type: 'string', required: true, description: 'Source square' } },
      safety: 'passthrough',
      audit: { logEvent: 'chess_move', logContent: false },
    };
    check('H18: valid message type passes', ExtensionMessageTypeSchema.safeParse(validMsgType).success);

    const invalidMsgType = { ...validMsgType, safety: 'invalid' };
    check('H18: invalid safety rejects message type', !ExtensionMessageTypeSchema.safeParse(invalidMsgType).success);

    const missingAudit = { name: 'test', description: '', fields: {}, safety: 'task' };
    check('H18: missing audit rejects message type', !ExtensionMessageTypeSchema.safeParse(missingAudit).success);

    // ExtensionUIComponentSchema
    const validComp = {
      id: 'board',
      name: 'Game Board',
      file: 'ui/board.html',
      description: 'The game board',
      function: 'display',
      messageTypes: ['games:chess-move'],
      size: { minHeight: '200px', maxHeight: '600px' },
      placement: 'main',
      dangerous: false,
      audit: { logRender: true, logInteractions: false, logEvent: 'board_render' },
    };
    check('H18: valid UI component passes', ExtensionUIComponentSchema.safeParse(validComp).success);

    const invalidPlacement = { ...validComp, placement: 'invalid' };
    check('H18: invalid placement rejects component', !ExtensionUIComponentSchema.safeParse(invalidPlacement).success);

    // ExtensionManifestSchema — full manifest validation
    const validManifest = {
      namespace: 'chess',
      name: 'Chess Extension',
      version: '1.0.0',
      description: 'A chess game extension',
      author: 'Test',
      messageTypes: [validMsgType],
      ui: {
        pages: [{
          id: 'game',
          name: 'Game',
          icon: '♟',
          components: [validComp],
        }],
      },
    };
    check('H18: valid manifest passes', ExtensionManifestSchema.safeParse(validManifest).success);

    // Invalid namespace format
    const badNs = { ...validManifest, namespace: 'INVALID_NS' };
    check('H18: invalid namespace format rejected', !ExtensionManifestSchema.safeParse(badNs).success);

    // Missing required fields
    const missingName = { namespace: 'test', version: '1.0.0', messageTypes: [] };
    check('H18: missing name rejected', !ExtensionManifestSchema.safeParse(missingName).success);

    // RESERVED_NAMESPACES constant is importable and contains expected values
    check('H18: RESERVED_NAMESPACES is a Set', RESERVED_NAMESPACES instanceof Set);
    check('H18: "bastion" is reserved', RESERVED_NAMESPACES.has('bastion'));
    check('H18: "admin" is reserved', RESERVED_NAMESPACES.has('admin'));
    check('H18: "protocol" is reserved', RESERVED_NAMESPACES.has('protocol'));
    check('H18: "chess" is not reserved', !RESERVED_NAMESPACES.has('chess'));

    // Manifest with conversationRenderers
    const withRenderers = {
      ...validManifest,
      conversationRenderers: {
        'chess-move': { html: '<div>move</div>', style: 'compact' },
      },
    };
    check('H18: manifest with conversationRenderers passes', ExtensionManifestSchema.safeParse(withRenderers).success);

    // Invalid renderer style
    const badRenderer = {
      ...validManifest,
      conversationRenderers: {
        'chess-move': { html: '<div></div>', style: 'invalid' },
      },
    };
    check('H18: invalid renderer style rejected', !ExtensionManifestSchema.safeParse(badRenderer).success);

    // Optional fields
    const minimal = {
      namespace: 'mini',
      name: 'Mini',
      version: '0.1.0',
      messageTypes: [],
    };
    check('H18: minimal manifest (no description/author) passes', ExtensionManifestSchema.safeParse(minimal).success);
    const parsed = ExtensionManifestSchema.parse(minimal);
    check('H18: default description is empty string', parsed.description === '');
    check('H18: default author is "unknown"', parsed.author === 'unknown');

    // M11: Extension type name format validation
    const validNameType = { ...validMsgType, name: 'chess-move' };
    check('M11: valid type name "chess-move" passes', ExtensionMessageTypeSchema.safeParse(validNameType).success);

    const validNameType2 = { ...validMsgType, name: 'session_create' };
    check('M11: valid type name "session_create" passes', ExtensionMessageTypeSchema.safeParse(validNameType2).success);

    const uppercaseName = { ...validMsgType, name: 'Chess-Move' };
    check('M11: uppercase type name rejected', !ExtensionMessageTypeSchema.safeParse(uppercaseName).success);

    const spaceName = { ...validMsgType, name: 'chess move' };
    check('M11: space in type name rejected', !ExtensionMessageTypeSchema.safeParse(spaceName).success);

    const digitStartName = { ...validMsgType, name: '1chess' };
    check('M11: digit-start type name rejected', !ExtensionMessageTypeSchema.safeParse(digitStartName).success);

    // M12: Direction field in extension message types
    const withDirection = { ...validMsgType, direction: 'human_to_ai' };
    check('M12: direction "human_to_ai" passes', ExtensionMessageTypeSchema.safeParse(withDirection).success);

    const withBidi = { ...validMsgType, direction: 'bidirectional' };
    check('M12: direction "bidirectional" passes', ExtensionMessageTypeSchema.safeParse(withBidi).success);

    const badDirection = { ...validMsgType, direction: 'invalid' };
    check('M12: invalid direction rejected', !ExtensionMessageTypeSchema.safeParse(badDirection).success);

    const noDirection = ExtensionMessageTypeSchema.parse(validMsgType);
    check('M12: default direction is "bidirectional"', noDirection.direction === 'bidirectional');

    // M10: SkillListResponsePayload schema exported
    const skillListPayload = {
      skills: [{
        id: 'sk-1',
        name: 'Test Skill',
        description: 'A test skill',
        version: '1.0.0',
        author: 'test',
        triggers: ['test'],
        modes: ['conversation'],
        estimatedTokens: 100,
      }],
      totalCount: 1,
      totalEstimatedTokens: 100,
    };
    check('M10: SkillListResponsePayloadSchema validates', SkillListResponsePayloadSchema.safeParse(skillListPayload).success);

    // M14: Extension State Bridge schemas
    console.log('--- M14: Extension State Bridge schemas ---');

    // extension_state_update
    const stateUpdateValid = { namespace: 'chronicle', state: { turn: 3, phase: 'action' } };
    check('M14: extension_state_update valid', ExtensionStateUpdatePayloadSchema.safeParse(stateUpdateValid).success);
    check('M14: extension_state_update empty namespace rejected', !ExtensionStateUpdatePayloadSchema.safeParse({ namespace: '', state: {} }).success);
    check('M14: extension_state_update missing namespace rejected', !ExtensionStateUpdatePayloadSchema.safeParse({ state: {} }).success);
    check('M14: extension_state_update missing state rejected', !ExtensionStateUpdatePayloadSchema.safeParse({ namespace: 'chronicle' }).success);
    check('M14: extension_state_update empty state valid', ExtensionStateUpdatePayloadSchema.safeParse({ namespace: 'game', state: {} }).success);

    // extension_state_request
    const stateReqValid = { namespace: 'chronicle' };
    check('M14: extension_state_request valid', ExtensionStateRequestPayloadSchema.safeParse(stateReqValid).success);
    check('M14: extension_state_request empty namespace rejected', !ExtensionStateRequestPayloadSchema.safeParse({ namespace: '' }).success);
    check('M14: extension_state_request missing namespace rejected', !ExtensionStateRequestPayloadSchema.safeParse({}).success);

    // extension_state_response
    const stateRespValid = { namespace: 'chronicle', state: { turn: 3 } };
    check('M14: extension_state_response with state valid', ExtensionStateResponsePayloadSchema.safeParse(stateRespValid).success);
    const stateRespNull = { namespace: 'chronicle', state: null };
    check('M14: extension_state_response with null state valid', ExtensionStateResponsePayloadSchema.safeParse(stateRespNull).success);
    check('M14: extension_state_response empty namespace rejected', !ExtensionStateResponsePayloadSchema.safeParse({ namespace: '', state: null }).success);
    check('M14: extension_state_response missing state rejected', !ExtensionStateResponsePayloadSchema.safeParse({ namespace: 'chronicle' }).success);

    // PAYLOAD_SCHEMAS lookup
    check('M14: PAYLOAD_SCHEMAS has extension_state_update', PAYLOAD_SCHEMAS['extension_state_update'] != null);
    check('M14: PAYLOAD_SCHEMAS has extension_state_request', PAYLOAD_SCHEMAS['extension_state_request'] != null);
    check('M14: PAYLOAD_SCHEMAS has extension_state_response', PAYLOAD_SCHEMAS['extension_state_response'] != null);

    // MESSAGE_TYPES constants
    check('M14: MESSAGE_TYPES.EXTENSION_STATE_UPDATE exists', MESSAGE_TYPES.EXTENSION_STATE_UPDATE === 'extension_state_update');
    check('M14: MESSAGE_TYPES.EXTENSION_STATE_REQUEST exists', MESSAGE_TYPES.EXTENSION_STATE_REQUEST === 'extension_state_request');
    check('M14: MESSAGE_TYPES.EXTENSION_STATE_RESPONSE exists', MESSAGE_TYPES.EXTENSION_STATE_RESPONSE === 'extension_state_response');
    check('M14: ALL_MESSAGE_TYPES includes extension_state_update', ALL_MESSAGE_TYPES.includes('extension_state_update'));
    check('M14: ALL_MESSAGE_TYPES includes extension_state_request', ALL_MESSAGE_TYPES.includes('extension_state_request'));
    check('M14: ALL_MESSAGE_TYPES includes extension_state_response', ALL_MESSAGE_TYPES.includes('extension_state_response'));
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
