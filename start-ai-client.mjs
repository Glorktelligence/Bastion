import { randomUUID } from 'node:crypto';
import { ensureSodium } from './packages/crypto/dist/index.js';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import {
  BastionAiClient,
  createApiKeyManager,
  createToolRegistry,
  createAnthropicAdapter,
  ConversationManager,
  MemoryStore,
  ProjectStore,
  ToolRegistryManager,
  ToolUpstreamMonitor,
  McpClientAdapter,
  validateParameters,
  ChallengeManager,
  BudgetGuard,
  evaluateSafety,
  defaultSafetyConfig,
  createPatternHistory,
  generateSafetyResponse,
  IntakeDirectory,
  OutboundStaging,
  FilePurgeManager,
  ConversationStore,
  CompactionManager,
  AdapterRegistry,
  SkillStore,
  SkillsManager,
  DataExporter,
  DataEraser,
  ImportRegistry,
  BastionImportAdapter,
  ImportExecutor,
  UsageTracker,
  ExtensionDispatcher,
  loadExtensionHandlers,
  DreamCycleManager,
  DateTimeManager,
  RecallHandler,
  BastionBash,
  AiClientAuditLogger,
} from './packages/client-ai/dist/index.js';

// ---------------------------------------------------------------------------
// BastionGuardian Phase 1 — Foreign harness detection (MUST run before anything else)
// ---------------------------------------------------------------------------

const FOREIGN_HARNESS_VARS = [
  'CLAUDE_CODE_ENTRY_POINT',
  'CLAUDE_CODE_VERSION',
  'CLAUDE_CODE_PROJECT_DIR',
  'OPENCLAW_HOME',
  'OPENHARNESS_HOME',
  'OH_HOME',
  'OPENHARNESS_API_FORMAT',
  'CURSOR_TRACE_ID',
  'CURSOR_SESSION_ID',
  'AGENT_HARNESS_MODE',
  'CLINE_DIR',
];

for (const envVar of FOREIGN_HARNESS_VARS) {
  if (process.env[envVar]) {
    console.error('[✗] BASTION-9002: Foreign harness environment detected: ' + envVar);
    console.error('[✗] Bastion is a sovereign system — it does not run inside another harness.');
    console.error('[✗] Remove the foreign harness or run Bastion independently.');
    process.exit(99);
  }
}
console.log('[✓] Environment clean — no foreign harness detected');

// ---------------------------------------------------------------------------
// BastionGuardian Phase 1 — Identity announcement
// ---------------------------------------------------------------------------

function getBastionVersionStartup() {
  try {
    return readFileSync('VERSION', 'utf-8').trim();
  } catch {
    return 'unknown';
  }
}

const BASTION_VERSION_ID = getBastionVersionStartup();
console.log(`[✓] Bastion Identity: Bastion/${BASTION_VERSION_ID} (+https://bastion.glorktelligence.co.uk)`);

// ---------------------------------------------------------------------------
// Env var parsing helpers — validates range, warns on invalid values
// ---------------------------------------------------------------------------

/**
 * Parse an integer env var with validation.
 * Returns defaultValue if unset or invalid.
 */
function parseIntEnv(name, defaultValue, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < min || parsed > max) {
    console.warn(`[!] ${name}=${raw} invalid (range: ${min}–${max}), using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function parseFloatEnv(name, defaultValue, min = 0, max = Infinity) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < min || parsed > max) {
    console.warn(`[!] ${name}=${raw} invalid (range: ${min}–${max}), using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Configuration
//
// PERSISTENCE AUDIT — what survives an AI client restart:
//   PERSISTS (on AI VM, /var/lib/bastion/):
//     ✅ Challenge config        → challenge-config.json
//     ✅ Budget database          → budget.db (SQLite)
//     ✅ Budget config            → budget-config.json
//     ✅ Memory store             → memories.db (SQLite)
//     ✅ Conversations            → conversations.db (SQLite)
//     ✅ User context             → user-context.md
//     ✅ Project files            → project/ directory
//   RECONSTRUCTED ON STARTUP (no persistence needed):
//     ✓ E2E keys (new key exchange on each connection)
//     ✓ Tool registry (re-synced from MCP servers on connect)
//     ✓ Provider registration (re-registers with relay on connect)
//     ✓ Conversation buffer (reloaded from conversations.db)
// ---------------------------------------------------------------------------

const RELAY_URL = process.env.BASTION_RELAY_URL || 'wss://10.0.30.10:9443';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const AI_CLIENT_ID = process.env.BASTION_AI_CLIENT_ID || 'ai-client-001';
const AI_DISPLAY_NAME = process.env.BASTION_AI_DISPLAY_NAME || 'Claude (Bastion)';
const PROVIDER_ID = process.env.BASTION_PROVIDER_ID || 'anthropic-bastion';
const PROVIDER_NAME = process.env.BASTION_PROVIDER_NAME || 'Anthropic (Bastion Official)';
const MAX_TOKENS = parseIntEnv('BASTION_MAX_TOKENS', 4096, 256, 32768);
const TEMPERATURE = parseFloatEnv('BASTION_TEMPERATURE', 1.0, 0, 2.0);
const API_ENDPOINT = process.env.BASTION_API_ENDPOINT || 'https://api.anthropic.com';
const API_VERSION = process.env.BASTION_API_VERSION || '2023-06-01';
const API_TIMEOUT = parseIntEnv('BASTION_TIMEOUT', 120000, 5000, 600000);
const STREAMING_ENABLED = process.env.BASTION_STREAMING !== 'false';
const REJECT_UNAUTHORIZED = process.env.BASTION_TLS_REJECT_UNAUTHORIZED !== 'false';
// Note: defaults to true (strict TLS) — set BASTION_TLS_REJECT_UNAUTHORIZED=false for self-signed certs

// Extension system — data directory for extension-namespaced state
const EXTENSIONS_DATA = process.env.BASTION_EXTENSIONS_DATA || '/var/lib/bastion/extensions';
try { mkdirSync(EXTENSIONS_DATA, { recursive: true }); } catch {}
const EXTENSION_HANDLERS_DIR = process.env.BASTION_EXTENSION_HANDLERS_DIR || '/var/lib/bastion/extension-handlers';

// Three Bastion Official Adapters — Sonnet, Haiku, Opus
// All share ANTHROPIC_API_KEY. Each targets a different model with role-specific config.
// Sonnet 4.6 — 1M context, default conversation adapter
const SONNET_MODEL = process.env.BASTION_SONNET_MODEL || 'claude-sonnet-4-6';
const SONNET_PRICING_INPUT = parseFloatEnv('BASTION_SONNET_PRICING_INPUT', 3, 0, 1000);
const SONNET_PRICING_OUTPUT = parseFloatEnv('BASTION_SONNET_PRICING_OUTPUT', 15, 0, 1000);
const SONNET_MAX_CONTEXT = parseIntEnv('BASTION_SONNET_MAX_CONTEXT', 1000000, 1000, 10000000);

// Haiku 4.5 — 200k context, cost-efficient compaction
const HAIKU_MODEL = process.env.BASTION_HAIKU_MODEL || 'claude-haiku-4-5-20251001';
const HAIKU_PRICING_INPUT = parseFloatEnv('BASTION_HAIKU_PRICING_INPUT', 1, 0, 1000);
const HAIKU_PRICING_OUTPUT = parseFloatEnv('BASTION_HAIKU_PRICING_OUTPUT', 5, 0, 1000);
const HAIKU_MAX_CONTEXT = parseIntEnv('BASTION_HAIKU_MAX_CONTEXT', 200000, 1000, 10000000);

// Opus 4.6 — 1M context, maximum capability; pricing: $5/$25 per MTok
const OPUS_MODEL = process.env.BASTION_OPUS_MODEL || 'claude-opus-4-6';
const OPUS_PRICING_INPUT = parseFloatEnv('BASTION_OPUS_PRICING_INPUT', 5, 0, 1000);
const OPUS_PRICING_OUTPUT = parseFloatEnv('BASTION_OPUS_PRICING_OUTPUT', 25, 0, 1000);
const OPUS_MAX_TOKENS = parseIntEnv('BASTION_OPUS_MAX_TOKENS', 8192, 256, 32768);
const OPUS_MAX_CONTEXT = parseIntEnv('BASTION_OPUS_MAX_CONTEXT', 1000000, 1000, 10000000);

if (!API_KEY) {
  console.error('[!] ANTHROPIC_API_KEY not set. Run with: node --env-file=.env start-ai-client.mjs');
  process.exit(1);
}

const IDENTITY = {
  type: 'ai',
  id: AI_CLIENT_ID,
  displayName: AI_DISPLAY_NAME,
};

console.log('=== Project Bastion — AI Client ===');
console.log(`Relay: ${RELAY_URL}`);
console.log(`Identity: ${AI_DISPLAY_NAME} (${AI_CLIENT_ID})`);
console.log(`Provider: ${PROVIDER_NAME} (${PROVIDER_ID})`);
console.log(`Models: Sonnet=${SONNET_MODEL}, Haiku=${HAIKU_MODEL}, Opus=${OPUS_MODEL}`);
console.log('');

// ---------------------------------------------------------------------------
// Three Bastion Official Adapters — Sonnet, Haiku, Opus
// ---------------------------------------------------------------------------

const keyManager = createApiKeyManager(API_KEY);
const adapterToolRegistry = createToolRegistry();

// Sonnet — default conversation and task adapter (balanced capability + cost)
const sonnetAdapter = createAnthropicAdapter(keyManager, adapterToolRegistry, {
  providerId: 'anthropic-sonnet',
  providerName: 'Anthropic Sonnet (Bastion Official)',
  model: SONNET_MODEL,
  maxTokens: MAX_TOKENS,
  maxContextTokens: SONNET_MAX_CONTEXT,
  temperature: TEMPERATURE,
  apiBaseUrl: API_ENDPOINT,
  apiVersion: API_VERSION,
  requestTimeoutMs: API_TIMEOUT,
  pricingInputPerMTok: SONNET_PRICING_INPUT,
  pricingOutputPerMTok: SONNET_PRICING_OUTPUT,
  supportedModels: [SONNET_MODEL],
  systemPrompt: ConversationManager.getRoleContext(),
});

// Haiku — cost-efficient compaction and game adapter (4x cheaper than Sonnet)
const haikuAdapter = createAnthropicAdapter(keyManager, adapterToolRegistry, {
  providerId: 'anthropic-haiku',
  providerName: 'Anthropic Haiku (Bastion Official)',
  model: HAIKU_MODEL,
  maxTokens: MAX_TOKENS,
  maxContextTokens: HAIKU_MAX_CONTEXT,
  temperature: 0.3,
  apiBaseUrl: API_ENDPOINT,
  apiVersion: API_VERSION,
  requestTimeoutMs: API_TIMEOUT,
  pricingInputPerMTok: HAIKU_PRICING_INPUT,
  pricingOutputPerMTok: HAIKU_PRICING_OUTPUT,
  supportedModels: [HAIKU_MODEL],
  systemPrompt: ConversationManager.getCoreContext() + '\n\nYou are summarising a conversation. Produce concise, structured notes.',
});

// Opus — maximum capability for research and dream cycle
const opusAdapter = createAnthropicAdapter(keyManager, adapterToolRegistry, {
  providerId: 'anthropic-opus',
  providerName: 'Anthropic Opus (Bastion Official)',
  model: OPUS_MODEL,
  maxTokens: OPUS_MAX_TOKENS,
  maxContextTokens: OPUS_MAX_CONTEXT,
  temperature: TEMPERATURE,
  apiBaseUrl: API_ENDPOINT,
  apiVersion: API_VERSION,
  requestTimeoutMs: API_TIMEOUT * 2, // Double timeout for deep research
  pricingInputPerMTok: OPUS_PRICING_INPUT,
  pricingOutputPerMTok: OPUS_PRICING_OUTPUT,
  supportedModels: [OPUS_MODEL],
  systemPrompt: ConversationManager.getRoleContext(),
});

// Adapter registry — routes operations to the appropriate adapter
const adapterRegistry = new AdapterRegistry();
adapterRegistry.registerAdapter(sonnetAdapter, ['default', 'conversation', 'task', 'game'], { pricingInputPerMTok: SONNET_PRICING_INPUT, maxContextTokens: SONNET_MAX_CONTEXT });
adapterRegistry.registerAdapter(haikuAdapter, ['compaction', 'game'], { pricingInputPerMTok: HAIKU_PRICING_INPUT, maxContextTokens: HAIKU_MAX_CONTEXT });
adapterRegistry.registerAdapter(opusAdapter, ['research', 'dream'], { pricingInputPerMTok: OPUS_PRICING_INPUT, maxContextTokens: OPUS_MAX_CONTEXT });
adapterRegistry.lock();

const registeredAdapters = adapterRegistry.list();
console.log(`[✓] Adapter registry: ${registeredAdapters.length} adapters registered`);
for (const ra of registeredAdapters) {
  console.log(`    → ${ra.adapter.providerId} [${ra.adapter.activeModel}] (${ra.roles.join(', ')})`);
}
console.log('[✓] Adapter registry locked');

// ---------------------------------------------------------------------------
// Extension dispatcher — routes namespace:type messages to handlers
// ---------------------------------------------------------------------------

const extensionDispatcher = new ExtensionDispatcher();
// Handler registration deferred — loadExtensionHandlers() runs after all services initialised

// ---------------------------------------------------------------------------
// Memory store — persistent Layer 2 memory
// ---------------------------------------------------------------------------

const MEMORIES_DB = process.env.BASTION_MEMORIES_DB || '/var/lib/bastion/memories.db';
const MAX_PROMPT_MEMORIES = parseIntEnv('BASTION_MAX_PROMPT_MEMORIES', 20, 1, 100);
const memoryStore = new MemoryStore({ path: MEMORIES_DB, maxPromptMemories: MAX_PROMPT_MEMORIES });
console.log(`[✓] Memory store initialised (${memoryStore.count} memories, max prompt: ${MAX_PROMPT_MEMORIES}, db: ${MEMORIES_DB})`);

// Pending AI memory proposals — keyed by proposalId, awaiting human decision
const pendingMemoryProposals = new Map();

// Pending memory proposal batches — keyed by batchId, awaiting human batch decision
const pendingBatches = new Map();

// Pending memory proposals (proposalId → {content, category, source})
const pendingProposals = new Map();

// ---------------------------------------------------------------------------
// Project store — Layer 3 project context
// ---------------------------------------------------------------------------

const PROJECT_DIR = process.env.BASTION_PROJECT_DIR || '/var/lib/bastion/project';
const projectStore = new ProjectStore({ rootDir: PROJECT_DIR, purgeManager: null });
console.log(`[✓] Project store initialised (${projectStore.fileCount} files, dir: ${PROJECT_DIR})`);

// ---------------------------------------------------------------------------
// Skill store — Layer 5 skills system
// ---------------------------------------------------------------------------

const SKILLS_DIR = process.env.BASTION_SKILLS_DIR || './skills';
const skillStore = new SkillStore({ skillsDir: SKILLS_DIR });
const skillLoadResult = skillStore.loadFromDirectory();
if (skillLoadResult.loaded.length > 0) {
  console.log(`[✓] Skills loaded: ${skillLoadResult.loaded.join(', ')}`);
}
if (skillLoadResult.errors.length > 0) {
  for (const err of skillLoadResult.errors) console.error(`[!] Skill error: ${err}`);
}
skillStore.lock();
console.log(`[✓] Skill registry locked (${skillStore.skillCount} skills, ${skillStore.triggerCount} triggers)`);

// ---------------------------------------------------------------------------
// DateTimeManager — sole DateTime authority (created early — no dependencies)
// ---------------------------------------------------------------------------

const dateTimeManager = new DateTimeManager({ timezone: process.env.BASTION_TIMEZONE });
console.log(`[✓] DateTimeManager initialised (${dateTimeManager.now().timezone}, source: ${dateTimeManager.now().source})`);

const AUDIT_DB = process.env.BASTION_AUDIT_DB || '/var/lib/bastion/ai-audit.db';
const auditLogger = new AiClientAuditLogger({ path: AUDIT_DB, dateTimeManager });
auditLogger.lockEventTypes();
console.log(`[✓] AI audit logger initialised (db: ${AUDIT_DB}, ${auditLogger.entryCount} entries, ${auditLogger.registeredTypeCount} event types)`);

// Skills Manager — sole authority for skill registry edits post-startup
const QUARANTINE_DIR = process.env.BASTION_SKILLS_QUARANTINE || './skills-quarantine';
const skillsManager = new SkillsManager({
  quarantineDir: QUARANTINE_DIR,
  skillStore,
  dateTimeManager,
  onViolation: (count, detail) => {
    console.error(`[!] Skill violation #${count}: ${detail}`);
    auditLogger.logViolation('skills-manager', 'skill_violation', { count, detail });
  },
  onShutdown: (reason) => {
    console.error(`[!!!] Shutdown triggered by skill violation: ${reason}`);
    auditLogger.logViolation('skills-manager', 'skill_violation', { reason, action: 'shutdown' });
    process.exit(1);
  },
});
skillsManager.initializeKnownHashes(SKILLS_DIR);
console.log(`[✓] Skills manager initialised (quarantine: ${QUARANTINE_DIR})`);

// ---------------------------------------------------------------------------
// Challenge Me More — temporal governance (must be created before ConversationManager)
// ---------------------------------------------------------------------------

const CHALLENGE_CONFIG_PATH = process.env.BASTION_CHALLENGE_CONFIG || '/var/lib/bastion/challenge-config.json';
const challengeManager = new ChallengeManager({ configPath: CHALLENGE_CONFIG_PATH, dateTimeManager });
console.log(`[✓] Challenge manager: ${challengeManager.enabled ? 'ENABLED' : 'disabled'} (tz: ${challengeManager.timezone}, active: ${challengeManager.isActive()})`);

// ---------------------------------------------------------------------------
// Conversation manager — session context + user context + memories + project
// ---------------------------------------------------------------------------

// Compartmentalized prompt budgets — deployer env vars set ceilings
const SYSTEM_BUDGET = 5000; // hardcoded, not configurable
const OPERATOR_BUDGET = parseIntEnv('BASTION_OPERATOR_CONTEXT_BUDGET', 2000, 500, 50000);
const USER_BUDGET = parseIntEnv('BASTION_USER_CONTEXT_BUDGET', 20000, 1000, 100000);
const TOKEN_BUDGET = parseIntEnv('BASTION_TOKEN_BUDGET', SONNET_MAX_CONTEXT, 10000, 10000000);

const conversationManager = new ConversationManager({
  tokenBudget: TOKEN_BUDGET,
  userContextPath: process.env.BASTION_USER_CONTEXT_PATH || '/var/lib/bastion/user-context.md',
  operatorContextPath: process.env.BASTION_OPERATOR_CONTEXT_PATH || '/var/lib/bastion/operator-context.md',
  systemBudget: SYSTEM_BUDGET,
  operatorBudget: OPERATOR_BUDGET,
  userBudget: USER_BUDGET,
  maxContextTokens: SONNET_MAX_CONTEXT,
  maxOutputTokens: MAX_TOKENS,
  memoryStore,
  projectStore,
  challengeManager,
  skillStore,
  dateTimeManager,
});

// Log prompt budget report
const budgetReport = conversationManager.getPromptBudgetReport();
const zonesSummary = budgetReport.zones.map(z => `${z.tokenCount.toLocaleString()}/${z.budget.toLocaleString()} ${z.name}`).join(' + ');
console.log(`[✓] System prompt: ${zonesSummary} = ${budgetReport.totalTokens.toLocaleString()} total`);
if (conversationManager.getUserContext()) {
  console.log(`[✓] User context loaded (${conversationManager.getUserContext().length} chars)`);
}

// ---------------------------------------------------------------------------
// Conversation store — multi-conversation persistence (SQLite)
// ---------------------------------------------------------------------------

const CONVERSATIONS_DB = process.env.BASTION_CONVERSATIONS_DB || '/var/lib/bastion/conversations.db';
const conversationStore = new ConversationStore({ path: CONVERSATIONS_DB, dateTimeManager });

// Migration: if no conversations exist, create default + migrate buffer
if (conversationStore.conversationCount === 0) {
  const existingMessages = conversationManager.getMessages();
  if (existingMessages.length > 0) {
    const convId = conversationStore.migrateFromBuffer(existingMessages);
    console.log(`[✓] Migrated ${existingMessages.length} messages to Default conversation (${convId.slice(0, 8)})`);
  } else {
    const defaultConv = conversationStore.createConversation('Default', 'normal');
    conversationStore.setActiveConversation(defaultConv.id);
    console.log(`[✓] Created Default conversation (${defaultConv.id.slice(0, 8)})`);
  }
} else {
  console.log(`[✓] Conversation store loaded (${conversationStore.conversationCount} conversations, db: ${CONVERSATIONS_DB})`);
}

// Ensure an active conversation is set
let activeConversationId = conversationStore.getActiveConversationId();
if (!activeConversationId) {
  const convs = conversationStore.listConversations();
  if (convs.length > 0) {
    activeConversationId = convs[0].id;
    conversationStore.setActiveConversation(activeConversationId);
  }
}
if (activeConversationId) {
  // Load recent messages into conversation buffer for API calls
  const recent = conversationStore.getRecentMessages(activeConversationId, 50);
  for (const msg of recent) {
    if (msg.role === 'user') conversationManager.addUserMessage(msg.content);
    else conversationManager.addAssistantMessage(msg.content);
  }
  console.log(`[✓] Active conversation: ${activeConversationId.slice(0, 8)} (${recent.length} messages loaded)`);
}

// ---------------------------------------------------------------------------
// Compaction manager — context optimisation via conversation summarisation
// ---------------------------------------------------------------------------

const CONVERSATION_BUDGET = parseIntEnv('BASTION_CONVERSATION_BUDGET', 80000, 10000, 500000);
const COMPACTION_TRIGGER_PERCENT = parseIntEnv('BASTION_COMPACTION_TRIGGER_PERCENT', 80, 50, 99);
const COMPACTION_KEEP_RECENT = parseIntEnv('BASTION_COMPACTION_KEEP_RECENT', 50, 5, 200);
const compactionManager = new CompactionManager(conversationStore, {
  conversationBudget: CONVERSATION_BUDGET,
  triggerPercent: COMPACTION_TRIGGER_PERCENT,
  keepRecent: COMPACTION_KEEP_RECENT,
});
console.log(`[✓] Compaction manager initialised (budget: ${CONVERSATION_BUDGET}, trigger: ${COMPACTION_TRIGGER_PERCENT}%, keep: ${COMPACTION_KEEP_RECENT})`);

// Load compaction summary for the active conversation (so AI retains pre-compaction context on startup)
if (activeConversationId) {
  const startupCompaction = compactionManager.getCompactionSummary(activeConversationId);
  if (startupCompaction) {
    conversationManager.setCompactionSummary(startupCompaction.summary);
    console.log(`[✓] Compaction summary loaded (${startupCompaction.messagesCovered} messages covered, ${startupCompaction.tokensSaved} tokens saved)`);
  }
}

// ---------------------------------------------------------------------------
// Recall handler — AI-initiated conversation history search
// ---------------------------------------------------------------------------

const recallHandler = new RecallHandler(conversationStore, dateTimeManager);
console.log('[✓] Recall handler initialised');

// ---------------------------------------------------------------------------
// Dream Cycle Manager — Layer 6 memory extraction via Opus
// ---------------------------------------------------------------------------

const DREAM_CONFIG_PATH = process.env.BASTION_DREAM_CONFIG || '/var/lib/bastion/dream-config.json';
const DREAM_MAX_TRANSCRIPT_TOKENS = parseIntEnv('BASTION_DREAM_MAX_TOKENS', 50000, 5000, 200000);
const dreamCycleManager = new DreamCycleManager({
  enabled: true,
  maxTranscriptTokens: DREAM_MAX_TRANSCRIPT_TOKENS,
  configPath: DREAM_CONFIG_PATH,
  dateTimeManager,
});
console.log(`[✓] Dream cycle manager initialised (max tokens: ${DREAM_MAX_TRANSCRIPT_TOKENS})`);

/** Summarise function — calls Anthropic API for compaction. */
async function summariseForCompaction(prompt) {
  try {
    const { adapter: compAdapter, reason } = adapterRegistry.selectAdapter('compaction');
    console.log(`[~] Compaction using ${compAdapter.activeModel} (${reason})`);
    const result = await compAdapter.executeTask({
      taskId: randomUUID(),
      action: 'summarise',
      target: 'conversation-compaction',
      priority: 'normal',
      parameters: {
        _systemPrompt: ConversationManager.getCoreContext() + '\n\nYou are summarising a conversation. Produce concise, structured notes.',
        _conversationHistory: [{ role: 'user', content: prompt }],
      },
      constraints: [],
    });
    if (result.ok) {
      usageTracker.record({
        timestamp: new Date().toISOString(),
        adapterId: compAdapter.activeModel || 'unknown',
        adapterRole: 'compaction',
        purpose: 'compaction',
        conversationId: activeConversationId || null,
        inputTokens: result.response.usage?.inputTokens ?? 0,
        outputTokens: result.response.usage?.outputTokens ?? 0,
        costUsd: result.response.cost?.estimatedCostUsd ?? 0,
      });
      sendUsageStatusDebounced();
      return { ok: true, text: result.response.textContent };
    }
    return { ok: false, text: '', error: result.message };
  } catch (err) {
    return { ok: false, text: '', error: err.message };
  }
}

/** Re-entry guard — prevents compaction from triggering while already in progress. */
let compactionInProgress = false;

/** Persist a message to the active conversation + auto-compact check. */
function persistMessage(role, type, content) {
  if (activeConversationId) {
    conversationStore.addMessage(activeConversationId, role, type, content);

    // Auto-compact check (non-blocking, with re-entry guard)
    if (!compactionInProgress) {
      const check = compactionManager.shouldCompact(activeConversationId);
      if (check.needed) {
        compactionInProgress = true;
        compactionManager.compact(activeConversationId, summariseForCompaction).then(result => {
          compactionInProgress = false;
          if (result.success && result.messagesCovered > 0) {
            console.log(`[✓] Auto-compacted: ${result.messagesCovered} messages, ~${result.tokensSaved} tokens saved`);
            // Inject compaction summary into conversation context so AI retains pre-compaction knowledge
            conversationManager.setCompactionSummary(result.summary || null);
            // Notify human client
            if (client) {
              client.send(JSON.stringify({
                type: 'conversation_compact_ack', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
                payload: {
                  conversationId: activeConversationId,
                  summaryPreview: (result.summary || '').slice(0, 200),
                  messagesCovered: result.messagesCovered,
                  tokensSaved: result.tokensSaved,
                },
              }));
            }
          }
        }).catch(err => {
          compactionInProgress = false;
          console.error(`[!] Auto-compaction failed: ${err.message}`);
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// File handling — intake directory, outbound staging, purge manager
// ---------------------------------------------------------------------------

const INTAKE_DIR = process.env.BASTION_INTAKE_DIR || '/var/lib/bastion/intake';
const INTAKE_MAX_FILES = parseIntEnv('BASTION_INTAKE_MAX_FILES', 50, 10, 500);
const intakeDirectory = new IntakeDirectory({ rootDir: INTAKE_DIR, maxFiles: INTAKE_MAX_FILES });
console.log(`[✓] Intake directory initialised (read-only, max: ${INTAKE_MAX_FILES} files, dir: ${INTAKE_DIR})`);

const OUTBOUND_DIR = process.env.BASTION_OUTBOUND_DIR || '/var/lib/bastion/outbound';
const OUTBOUND_MAX_FILES = parseIntEnv('BASTION_OUTBOUND_MAX_FILES', 50, 10, 500);
const outboundStaging = new OutboundStaging({ rootDir: OUTBOUND_DIR, maxFiles: OUTBOUND_MAX_FILES });
console.log(`[✓] Outbound staging initialised (write-only, max: ${OUTBOUND_MAX_FILES} files, dir: ${OUTBOUND_DIR})`);

const FILE_PURGE_TIMEOUT_MS = parseIntEnv('BASTION_FILE_PURGE_TIMEOUT_MS', 3600000, 60000, 86400000);
const filePurgeManager = new FilePurgeManager(intakeDirectory, outboundStaging, {
  defaultTimeoutMs: FILE_PURGE_TIMEOUT_MS,
  checkIntervalMs: 30_000,     // 30 seconds
  dateTimeManager,
  onPurge: (result) => {
    console.log(`[~] File purge: task ${result.taskId.slice(0, 8)} — ${result.totalPurged} files (${result.reason})`);
  },
});
filePurgeManager.start();
console.log(`[✓] File purge manager started (timeout: ${FILE_PURGE_TIMEOUT_MS}ms, check: 30s)`);

// Wire PurgeManager as sole delete authority into stores created earlier
projectStore.setPurgeManager(filePurgeManager);

// ---------------------------------------------------------------------------
// Bastion Bash — Governed AI Execution Environment
// ---------------------------------------------------------------------------

const BASH_WORKSPACE = process.env.BASTION_BASH_WORKSPACE || '/var/lib/bastion/workspace';
const BASH_INTAKE = process.env.BASTION_BASH_INTAKE || INTAKE_DIR;
const BASH_OUTBOUND = process.env.BASTION_BASH_OUTBOUND || OUTBOUND_DIR;
const BASH_TRASH = process.env.BASTION_BASH_TRASH || '/var/lib/bastion/trash';
const BASH_SCRATCH = process.env.BASTION_BASH_SCRATCH || '/var/lib/bastion/scratch';

// Create governed directories
for (const dir of [BASH_WORKSPACE, BASH_TRASH, BASH_SCRATCH]) {
  mkdirSync(dir, { recursive: true });
}

const bastionBash = new BastionBash(
  {
    workspacePath: BASH_WORKSPACE,
    intakePath: BASH_INTAKE,
    outboundPath: BASH_OUTBOUND,
    trashPath: BASH_TRASH,
    scratchPath: BASH_SCRATCH,
    maxOutputChars: 8000,
    maxCommandLength: 1000,
  },
  filePurgeManager,
  null, // audit logger — logged inline in action handler
  dateTimeManager,
);
console.log('[✓] Bastion Bash initialised (governed execution environment)');
console.log(`    workspace: ${BASH_WORKSPACE}`);
console.log(`    trash: ${BASH_TRASH} (PurgeManager territory)`);

/** Pending file acceptances — transferId → metadata from file_manifest. */
const pendingFileAcceptances = new Map();

/** Track which tasks have been registered with purge manager. */
const registeredPurgeTasks = new Set();

// ---------------------------------------------------------------------------
// Data Portability (GDPR Article 20)
// ---------------------------------------------------------------------------

const dataExporter = new DataExporter({
  conversationStore,
  memoryStore,
  projectStore,
  skillStore,
  challengeManager,
});
console.log('[✓] Data exporter initialised (GDPR Article 20)');

// DataEraser initialised after UsageTracker (below) — requires usageTracker reference

const importRegistry = new ImportRegistry();
importRegistry.register(new BastionImportAdapter());
console.log('[✓] Import registry initialised (1 adapter: bastion)');

/** Pending import data — held between validate and confirm steps. */
let pendingImportData = null;
let pendingImportAdapter = null;

// ---------------------------------------------------------------------------
// Safety engine
// ---------------------------------------------------------------------------

const safetyConfig = defaultSafetyConfig();
const patternHistory = createPatternHistory(dateTimeManager);
/** Pending challenges — correlationId → { issuedAt, waitSeconds } for wait timer enforcement. */
const pendingChallenges = new Map();
/** Pending AI-initiated challenges — challengeId → { issuedAt, reason, severity } for response tracking. */
const pendingAiChallenges = new Map();
console.log('[✓] Safety engine armed (3-layer evaluation)');

// ---------------------------------------------------------------------------
// Budget Guard — immutable enforcement (same tier as MaliClaw)
// ---------------------------------------------------------------------------

const BUDGET_DB = process.env.BASTION_BUDGET_DB || '/var/lib/bastion/budget.db';
const BUDGET_CONFIG_PATH = process.env.BASTION_BUDGET_CONFIG || '/var/lib/bastion/budget-config.json';
const budgetGuard = new BudgetGuard({
  dbPath: BUDGET_DB,
  configPath: BUDGET_CONFIG_PATH,
  timezone: challengeManager.timezone,
  dateTimeManager,
});
const budgetStatus = budgetGuard.getStatus();
console.log(`[✓] Budget Guard armed (${budgetStatus.searchesThisMonth}/${budgetGuard.getLimits().maxPerMonth} searches, $${budgetStatus.costThisMonth}/$${budgetStatus.monthlyCapUsd} cost, alert: ${budgetStatus.alertLevel})`);

/** Send budget_status to human client. */
function sendBudgetStatus() {
  if (!client) return;
  const status = budgetGuard.getStatus();
  client.send(JSON.stringify({
    type: 'budget_status',
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sender: IDENTITY,
    payload: status,
  }));
}

// ---------------------------------------------------------------------------
// Usage Tracker — all API token usage with SQLite persistence
// ---------------------------------------------------------------------------

const USAGE_DB = process.env.BASTION_USAGE_DB || '/var/lib/bastion/usage.db';
const usageTracker = new UsageTracker({ path: USAGE_DB, dateTimeManager });
console.log(`[✓] Usage tracker initialised (db: ${USAGE_DB}, ${usageTracker.totalRecords} records)`);

// ---------------------------------------------------------------------------
// Data Eraser — GDPR Article 17 (must be after UsageTracker)
// ---------------------------------------------------------------------------

const dataEraser = new DataEraser({
  conversationStore,
  memoryStore,
  projectStore,
  usageTracker,
  challengeConfigPath: CHALLENGE_CONFIG_PATH,
  userContextPath: process.env.BASTION_USER_CONTEXT_PATH || '/var/lib/bastion/user-context.md',
  purgeManager: filePurgeManager,
  dateTimeManager,
});

// Check for expired soft deletes on startup (30-day window passed)
if (dataEraser.checkExpiredErasures()) {
  console.log('[!] Expired erasure found — running hard delete...');
  dataEraser.hardDelete();
  console.log('[✓] Hard delete complete — all soft-deleted data permanently removed');
  auditLogger.logEvent('data_erasure', 'system', 'data-eraser', { action: 'hard_delete' });
} else {
  const activeErasure = dataEraser.getActiveErasure();
  if (activeErasure) {
    console.log(`[!] Active erasure: ${activeErasure.erasureId} (hard delete at ${activeErasure.hardDeleteAt})`);
  }
}
console.log('[✓] Data eraser initialised (GDPR Article 17)');

// ---------------------------------------------------------------------------
// Extension handler loading — all services now available for context
// ---------------------------------------------------------------------------

// ToolRegistryManager — must be created before extension context
const toolRegistry = new ToolRegistryManager({ dateTimeManager });
toolRegistry.setActiveConversation(activeConversationId);

const extensionContext = {
  conversationStore,
  conversationManager,
  memoryStore,
  adapterRegistry,
  usageTracker,
  budgetGuard,
  filePurgeManager,
  dateTimeManager,
  recallHandler,
  bastionBash,
  extensionsDataDir: EXTENSIONS_DATA,
  projectStore,
  skillStore,
  challengeManager,
  toolRegistry,
  pushState: (namespace, state) => {
    if (!client) return;
    sendSecure({
      type: 'extension_state_update',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: IDENTITY,
      payload: { namespace, state },
    });
  },
};

const handlerCount = await loadExtensionHandlers(extensionDispatcher, extensionContext, EXTENSION_HANDLERS_DIR);
extensionDispatcher.lock();
console.log(`[✓] Extension dispatcher: ${handlerCount} extensions loaded, ${extensionDispatcher.size} handlers registered, locked`);

/** Debounce timer for usage_status — max once per 30 seconds. */
let usageStatusTimer = null;

function sendUsageStatus() {
  if (!client) return;
  const today = usageTracker.getUsageToday();
  const thisMonth = usageTracker.getUsageThisMonth();
  const byAdapter = {};
  for (const a of usageTracker.getUsageByAdapter()) {
    byAdapter[a.adapterId] = { calls: a.calls, costUsd: a.costUsd };
  }
  const limits = budgetGuard.getLimits();
  const bStatus = budgetGuard.getStatus();
  client.send(JSON.stringify({
    type: 'usage_status',
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sender: IDENTITY,
    payload: {
      today: { calls: today.calls, inputTokens: today.inputTokens, outputTokens: today.outputTokens, costUsd: today.costUsd },
      thisMonth: { calls: thisMonth.calls, inputTokens: thisMonth.inputTokens, outputTokens: thisMonth.outputTokens, costUsd: thisMonth.costUsd },
      byAdapter,
      budget: {
        monthlyCapUsd: limits.monthlyCapUsd,
        remaining: limits.monthlyCapUsd - bStatus.costThisMonth - thisMonth.costUsd,
        percentUsed: limits.monthlyCapUsd > 0 ? ((bStatus.costThisMonth + thisMonth.costUsd) / limits.monthlyCapUsd) * 100 : 0,
        alertLevel: bStatus.alertLevel,
      },
      promptBudget: (() => {
        const report = conversationManager.getPromptBudgetReport();
        return {
          zones: report.zones.map((z) => ({
            name: z.name,
            budget: z.budget,
            tokenCount: z.tokenCount,
            truncated: z.truncated,
            components: z.components,
          })),
          totalTokens: report.totalTokens,
          maxContextTokens: report.maxContextTokens,
          available: report.available,
          utilizationPercent: report.utilizationPercent,
        };
      })(),
    },
  }));
}

function sendUsageStatusDebounced() {
  if (usageStatusTimer) return;
  usageStatusTimer = setTimeout(() => {
    usageStatusTimer = null;
    sendUsageStatus();
  }, 30_000);
}

// ---------------------------------------------------------------------------
// AI Action Block Parser — extract structured actions from AI response
// ---------------------------------------------------------------------------

const ACTION_BLOCK_RE = /\[BASTION:(CHALLENGE|MEMORY|RECALL|EXEC)\]([\s\S]*?)\[\/BASTION:\1\]/g;

/**
 * Parse [BASTION:ACTION]{...}[/BASTION:ACTION] blocks from response text.
 * Returns cleaned text (blocks removed) and extracted actions.
 */
function parseActionBlocks(text) {
  const actions = [];
  let cleanText = text;

  let match;
  while ((match = ACTION_BLOCK_RE.exec(text)) !== null) {
    const actionType = match[1];
    const rawContent = match[2].trim();

    if (actionType === 'EXEC') {
      // EXEC blocks contain raw command strings, not JSON
      actions.push({ type: 'EXEC', data: rawContent });
    } else {
      try {
        const data = JSON.parse(rawContent);
        actions.push({ type: actionType, data });
      } catch {
        console.log(`[!] Failed to parse BASTION:${actionType} block — invalid JSON`);
      }
    }
  }

  // Strip all action blocks from displayed text
  cleanText = cleanText.replace(ACTION_BLOCK_RE, '').trim();
  // Clean up excessive whitespace left by block removal
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n');

  return { cleanText, actions };
}

/**
 * Rate limiter for AI-initiated actions.
 * - ai_challenge: max 1 per response (enforced by for-loop), max 3 per session
 * - ai_memory_proposal: max 1 per response, max 1 per 5 messages, max 3 per session
 */
const aiActionLimits = {
  challengeCount: 0,
  memoryCount: 0,
  recallCount: 0,
  execCount: 0,
  execCountThisResponse: 0,
  messagesSinceLastMemory: 5,  // Start at gap value — first proposal in session is allowed
  messagesSinceLastRecall: 5,  // Same — first recall in session is allowed
  maxChallengesPerSession: 3,
  maxMemoriesPerSession: 3,
  maxRecallsPerSession: 3,
  maxExecsPerResponse: 5,
  maxExecsPerSession: 20,
  memoryMinMessageGap: 5,
  recallMinMessageGap: 5,

  canChallenge() {
    return this.challengeCount < this.maxChallengesPerSession;
  },
  recordChallenge() {
    this.challengeCount++;
  },
  canMemory() {
    return (
      this.memoryCount < this.maxMemoriesPerSession &&
      this.messagesSinceLastMemory >= this.memoryMinMessageGap
    );
  },
  recordMemory() {
    this.memoryCount++;
    this.messagesSinceLastMemory = 0;
  },
  canRecall() {
    return (
      this.recallCount < this.maxRecallsPerSession &&
      this.messagesSinceLastRecall >= this.recallMinMessageGap
    );
  },
  recordRecall() {
    this.recallCount++;
    this.messagesSinceLastRecall = 0;
  },
  canExec() {
    return (
      this.execCount < this.maxExecsPerSession &&
      this.execCountThisResponse < this.maxExecsPerResponse
    );
  },
  recordExec() {
    this.execCount++;
    this.execCountThisResponse++;
  },
  resetResponseExecCount() {
    this.execCountThisResponse = 0;
  },
  recordMessage() {
    this.messagesSinceLastMemory++;
    this.messagesSinceLastRecall++;
  },

  // Batch rate limiting (dream cycle / recall analysis)
  batchCount: 0,
  maxBatchesPerSession: 3,
  lastBatchTime: 0,
  batchCooldownMs: 5 * 60 * 1000, // 5 minutes
  canBatch() {
    return this.batchCount < this.maxBatchesPerSession &&
      (Date.now() - this.lastBatchTime) >= this.batchCooldownMs;
  },
  recordBatch() {
    this.batchCount++;
    this.lastBatchTime = Date.now();
  },
};

// ---------------------------------------------------------------------------
// E2E Encryption — X25519 key exchange + KDF ratchet
// ---------------------------------------------------------------------------

let ownKeyPair = null;
let e2eCipher = null; // { nextSendKey(), nextReceiveKey(), destroy() }
let keyExchangePending = false; // true while key exchange is in progress
const encryptedMessageQueue = []; // queued messages awaiting key exchange completion

// KDF constants — must match human client's browser-crypto.ts
const KDF_CHAIN_STEP = new Uint8Array([0x01]);
const KDF_MESSAGE_KEY = new Uint8Array([0x02]);
const DIRECTIONAL_SEND = new TextEncoder().encode('bastion-e2e-send');
const DIRECTIONAL_RECV = new TextEncoder().encode('bastion-e2e-recv');

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

/** SHA-512 (matches tweetnacl's nacl.hash) truncated to 32 bytes. */
function sha512_32(data) {
  return new Uint8Array(createHash('sha512').update(data).digest().buffer, 0, 32);
}

/** Generate X25519 keypair using libsodium's crypto_box_keypair. */
async function initKeyPair() {
  const sodium = await ensureSodium();
  ownKeyPair = sodium.crypto_box_keypair();
  console.log('[✓] X25519 keypair generated (crypto_box)');
}

/** Send key_exchange message to peer. */
function sendKeyExchange() {
  if (!client || !ownKeyPair) return;
  const pubKeyB64 = Buffer.from(ownKeyPair.publicKey).toString('base64');
  client.send(JSON.stringify({
    type: 'key_exchange',
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sender: IDENTITY,
    payload: { publicKey: pubKeyB64 },
  }));
  console.log('[→] Key exchange: public key sent to peer');
}

/**
 * Handle incoming key_exchange from peer — derive session keys.
 * Uses crypto_box_beforenm (= tweetnacl nacl.box.before) for shared secret,
 * then SHA-512-truncated-to-32 for directional keys and KDF ratchet.
 */
async function handleKeyExchange(peerPublicKeyB64) {
  if (!ownKeyPair) return;
  const sodium = await ensureSodium();
  const peerPublicKey = new Uint8Array(Buffer.from(peerPublicKeyB64, 'base64'));

  // Shared secret: HSalsa20(X25519(mySecret, theirPublic)) — interoperable with nacl.box.before
  const sharedSecret = sodium.crypto_box_beforenm(peerPublicKey, ownKeyPair.privateKey);

  // Directional keys — AI is 'responder', swaps send/receive vs initiator
  const keyA = sha512_32(concatBytes(DIRECTIONAL_SEND, sharedSecret, peerPublicKey, ownKeyPair.publicKey));
  const keyB = sha512_32(concatBytes(DIRECTIONAL_RECV, sharedSecret, peerPublicKey, ownKeyPair.publicKey));

  // Responder: sendKey = keyB, receiveKey = keyA (swapped from initiator)
  let sendChainKey = keyB;
  let sendCounter = 0;
  let receiveChainKey = keyA;
  let receiveCounter = 0;

  e2eCipher = {
    nextSendKey() {
      const messageKey = sha512_32(concatBytes(sendChainKey, KDF_MESSAGE_KEY));
      const nextChain = sha512_32(concatBytes(sendChainKey, KDF_CHAIN_STEP));
      sendChainKey.fill(0);
      sendChainKey = nextChain;
      return { key: messageKey, counter: sendCounter++ };
    },
    nextReceiveKey() {
      const messageKey = sha512_32(concatBytes(receiveChainKey, KDF_MESSAGE_KEY));
      const nextChain = sha512_32(concatBytes(receiveChainKey, KDF_CHAIN_STEP));
      receiveChainKey.fill(0);
      receiveChainKey = nextChain;
      return { key: messageKey, counter: receiveCounter++ };
    },
    destroy() {
      sendChainKey.fill(0);
      receiveChainKey.fill(0);
    },
  };
  keyExchangePending = false;
  console.log('[✓] E2E session established — interoperable ratchet active');

  // Drain the encrypted message queue now that cipher is available
  if (encryptedMessageQueue.length > 0) {
    console.log(`[~] Draining ${encryptedMessageQueue.length} queued encrypted message(s)`);
    const queued = encryptedMessageQueue.splice(0, encryptedMessageQueue.length);
    for (const queuedData of queued) {
      // Re-emit through the message handler (now with cipher available)
      client.ws?.emit('message', queuedData);
    }
  }
}

/**
 * Messages that must stay plaintext — relay or pre-key-exchange control messages.
 * NOTE: token_refresh and audit_response are NOT in this set — they carry sensitive data
 * (JWTs, audit history) and must be encrypted when sent through the E2E channel.
 */
const PLAINTEXT_TYPES = new Set([
  'session_init', 'session_established', 'key_exchange',
  'provider_register', 'ping', 'pong', 'peer_status', 'error',
  'config_ack', 'config_nack',
  'file_manifest', 'file_offer', 'file_request', 'file_data',
]);

/**
 * Send a message, encrypting the payload if session cipher is available.
 * Uses XSalsa20-Poly1305 (crypto_secretbox_easy) — interoperable with tweetnacl.secretbox.
 */
async function sendSecure(envelope) {
  if (!client) return false;

  if (!e2eCipher || PLAINTEXT_TYPES.has(envelope.type)) {
    return client.send(JSON.stringify(envelope));
  }

  try {
    const sodium = await ensureSodium();
    const payloadStr = JSON.stringify(envelope.payload || {});
    const payloadBytes = new TextEncoder().encode(payloadStr);
    const { key } = e2eCipher.nextSendKey();
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(payloadBytes, nonce, key);
    key.fill(0);

    const encrypted = {
      id: envelope.id,
      type: envelope.type,
      timestamp: envelope.timestamp,
      sender: envelope.sender,
      encryptedPayload: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
      nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
    };
    return client.send(JSON.stringify(encrypted));
  } catch (err) {
    console.error(`[!] Encryption failed: ${err.message} — sending plaintext`);
    return client.send(JSON.stringify(envelope));
  }
}

// ---------------------------------------------------------------------------
// Tool registry + MCP adapters
// ---------------------------------------------------------------------------

// toolRegistry — moved earlier, before extension context (was at line ~1020)
const mcpAdapters = new Map(); // providerId → McpClientAdapter
const pendingToolRequests = new Map(); // requestId → { toolId, params, resolve, reject }

/** Connect to configured MCP providers from env vars. */
async function connectMcpProviders() {
  // Scan env vars for MCP provider configs: BASTION_MCP_<NAME>_URL + BASTION_MCP_<NAME>_API_KEY
  const providerEnvs = new Map();
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^BASTION_MCP_([A-Z_]+)_URL$/);
    if (match && value) {
      const name = match[1].toLowerCase().replace(/_/g, '-');
      providerEnvs.set(name, { url: value, keyEnv: `BASTION_MCP_${match[1]}_API_KEY` });
    }
  }

  for (const [name, config] of providerEnvs) {
    try {
      const adapter = new McpClientAdapter({
        providerId: name,
        endpoint: config.url,
        apiKeyEnvVar: config.keyEnv,
        WebSocketImpl: (await import('ws')).default,
      });
      await adapter.connect();
      mcpAdapters.set(name, adapter);

      // Discover tools
      const tools = await adapter.listTools();
      console.log(`[✓] MCP ${name}: ${tools.length} tools discovered`);
      for (const t of tools) {
        console.log(`    - ${name}:${t.name}: ${t.description}`);
      }
    } catch (err) {
      console.error(`[!] MCP ${name}: connection failed — ${err.message}`);
    }
  }

  if (mcpAdapters.size > 0) {
    console.log(`[✓] ${mcpAdapters.size} MCP providers connected`);
  }
}

// ---------------------------------------------------------------------------
// Tool upstream monitor
// ---------------------------------------------------------------------------

const toolUpstreamMonitor = new ToolUpstreamMonitor(
  toolRegistry,
  mcpAdapters,
  // On MCP violation (severe — 2hr timer)
  (change) => {
    console.log(`[!] TOOL VIOLATION: ${change.source} tool "${change.fullId}" not in registry`);
    auditLogger.logTool('violation', { toolName: change.toolName, source: change.source, fullId: change.fullId });
    // Send alert to relay → human client
    if (client?.connected) {
      sendSecure({
        type: 'tool_alert',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        payload: {
          alertType: 'new_tool_detected',
          severity: change.source === 'mcp' ? 'warning' : 'info',
          toolName: change.toolName,
          providerId: change.providerId,
          fullId: change.fullId,
          source: change.source,
          detectedAt: change.detectedAt,
          description: change.details || 'Unknown tool',
          message: change.source === 'mcp'
            ? `User-configured tool "${change.toolName}" detected but not in Bastion registry. Register or reject within 2 hours.`
            : `Authorised Provider added tool "${change.toolName}" — see Relay Admin for registration.`,
        },
      });
    }
    // Audit is handled at the relay when it receives the tool_alert message
  },
  // On Provider notice (informational — removed tools, etc.)
  (change) => {
    console.log(`[i] Provider tool notice: "${change.fullId}" (${change.type})`);
    auditLogger.logEvent('tool_upstream_detected', 'system', 'tool-upstream-monitor', { fullId: change.fullId, type: change.type });
  },
  dateTimeManager,
);

// ---------------------------------------------------------------------------
// Client setup
// ---------------------------------------------------------------------------

// Generate X25519 keypair before connecting
await initKeyPair();

const client = new BastionAiClient({
  relayUrl: RELAY_URL,
  identity: IDENTITY,
  providerId: PROVIDER_ID,
  rejectUnauthorized: REJECT_UNAUTHORIZED,
});

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

client.on('connected', () => {
  console.log('[✓] WebSocket connected to relay');

  // Send session_init to start the handshake
  const sessionInit = JSON.stringify({
    type: 'session_init',
    identity: IDENTITY,
    providerId: PROVIDER_ID,
    timestamp: new Date().toISOString(),
  });

  console.log('[→] Sending session_init...');
  client.send(sessionInit);
});

client.on('authenticated', async (jwt, expiresAt) => {
  console.log(`[✓] Authenticated — JWT expires at ${expiresAt}`);
  auditLogger.logEvent('auth_success', 'ai', 'connection', {});

  // Connect to MCP providers
  await connectMcpProviders();

  // NOTE: Tool registry is NOT locked here — it locks after tool_registry_sync
  // is received from the relay (which populates the registry with authorised tools).
  // Locking before sync would result in an empty, useless registry.

  // Initialize upstream monitor (will start periodic checks after registry is locked)
  toolUpstreamMonitor.initializeFromRegistry();
  console.log('[✓] Tool upstream monitor initialised (awaiting tool_registry_sync to lock registry)');

  // Fallback: if no tool_registry_sync arrives within 30s, lock with whatever we have
  setTimeout(() => {
    if (!toolRegistry.isLocked) {
      toolRegistry.lock();
      toolUpstreamMonitor.startPeriodicChecks();
      console.log(`[!] Tool registry lock timeout — locked with ${toolRegistry.toolCount} tools (no sync received)`);
    }
  }, 30_000);

  // Send challenge status to human
  const challengeStatus = challengeManager.getStatus();
  client.send(JSON.stringify({
    type: 'challenge_status',
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sender: IDENTITY,
    payload: challengeStatus,
  }));
  if (challengeStatus.active) {
    console.log(`[🛡️] Challenge hours ACTIVE until ${challengeStatus.periodEnd}`);
    auditLogger.logEvent('challenge_issued', 'system', 'challenge-manager', { active: true });
  }

  // Send budget + usage status to human
  budgetGuard.resetSession();
  sendBudgetStatus();
  sendUsageStatus();

  // Start periodic skill directory watch
  const SKILL_WATCH_INTERVAL = parseIntEnv('BASTION_SKILL_WATCH_INTERVAL', 60, 10, 3600) * 1000;
  setInterval(() => {
    try {
      const newSkills = skillsManager.checkForNewSkills(SKILLS_DIR);
      for (const skillId of newSkills) {
        const pending = skillsManager.getPendingSkills().find(p => p.skillId === skillId);
        if (pending) {
          sendSecure({
            type: 'skill_scan_result',
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            sender: IDENTITY,
            payload: {
              skillId,
              passed: pending.scanResult.passed,
              checks: pending.scanResult.checks,
              hash: pending.scanResult.hash,
              fileSize: pending.scanResult.fileSize,
              action: 'pending_review',
            },
          });
        }
      }
    } catch (err) {
      console.error(`[!] Skill watch error: ${err.message}`);
    }
  }, SKILL_WATCH_INTERVAL);
  console.log(`[✓] Skill directory watch active (interval: ${SKILL_WATCH_INTERVAL / 1000}s)`);

  console.log('[★] Safety engine active — 3-layer evaluation armed');
  console.log('[★] Budget Guard active — immutable enforcement armed');
  console.log('[★] Awaiting messages...');
});

client.on('tokenRefreshNeeded', () => {
  console.log('[~] Token refresh needed — requesting new JWT...');
  const jwt = client.jwt;
  if (jwt) {
    client.send(JSON.stringify({
      type: 'token_refresh',
      jwt,
      timestamp: new Date().toISOString(),
    }));
  }
});

client.on('disconnected', (code, reason) => {
  console.log(`[-] Disconnected from relay (${code}: ${reason})`);
  auditLogger.logEvent('connection_closed', 'ai', 'connection', { code, reason });
});

client.on('error', (err) => {
  console.error(`[!] Error: ${err.message}`);
});

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

let processing = false;

client.on('message', async (data) => {
  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    console.log(`[←] Non-JSON message: ${data.substring(0, 80)}`);
    return;
  }

  // Decode relay-generated messages — relay wraps payload as base64 JSON in encryptedPayload
  // These are NOT E2E encrypted, just base64 transport encoding from the relay
  if (msg.encryptedPayload && msg.sender?.type === 'relay') {
    try {
      const payloadStr = Buffer.from(msg.encryptedPayload, 'base64').toString('utf-8');
      msg = { ...msg, payload: JSON.parse(payloadStr) };
      delete msg.encryptedPayload;
      delete msg.nonce;
    } catch (err) {
      console.error(`[!] Failed to decode relay message: ${err.message}`);
      return;
    }
  }

  // Queue encrypted messages if key exchange is still in progress
  if (msg.encryptedPayload && !e2eCipher) {
    if (keyExchangePending) {
      console.log(`[~] Queuing encrypted message (key exchange pending) — type: ${msg.type}`);
      encryptedMessageQueue.push(data);
      return;
    }
    // No key exchange in progress and no cipher — reject
    console.error(`[!] Encrypted message received but no E2E cipher available — dropping (type: ${msg.type})`);
    return;
  }

  // Decrypt if this is an encrypted envelope (has encryptedPayload field)
  if (msg.encryptedPayload && e2eCipher) {
    try {
      const sodium = await ensureSodium();
      // Use ORIGINAL base64 variant (standard with +, /, = padding) to match
      // the human client's btoa() encoding in browser-crypto.ts
      const nonce = sodium.from_base64(msg.nonce, sodium.base64_variants.ORIGINAL);
      const ciphertext = sodium.from_base64(msg.encryptedPayload, sodium.base64_variants.ORIGINAL);
      const { key } = e2eCipher.nextReceiveKey();
      const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
      key.fill(0);
      const payloadStr = new TextDecoder().decode(plaintext);
      sodium.memzero(plaintext);
      msg = { ...msg, payload: JSON.parse(payloadStr) };
      delete msg.encryptedPayload;
      delete msg.nonce;
    } catch (err) {
      console.error(`[!] Decryption failed: ${err.message}`);
      return;
    }
  }

  // Handle session_established — complete the auth handshake
  if (msg.type === 'session_established') {
    console.log(`[←] Session established (session: ${(msg.sessionId || '').slice(0, 8)})`);
    client.setToken(msg.jwt, msg.expiresAt);

    // Register as a governed provider with adapter list and capabilities
    const registerMsg = JSON.stringify({
      type: 'provider_register',
      payload: {
        providerId: PROVIDER_ID,
        providerName: PROVIDER_NAME,
        model: sonnetAdapter.activeModel,
        capabilities: { conversation: true, taskExecution: true, fileTransfer: true, streaming: STREAMING_ENABLED },
        adapters: adapterRegistry.list().map(ra => ({
          id: ra.adapter.providerId,
          name: ra.adapter.providerName,
          model: ra.adapter.activeModel,
          roles: ra.roles,
          maxContextTokens: ra.maxContextTokens,
          pricingInputPerMTok: ra.pricingInputPerMTok,
          pricingOutputPerMTok: ra.adapter.getModelPricing?.()?.outputPerMTok,
        })),
      },
      timestamp: new Date().toISOString(),
    });
    client.send(registerMsg);
    console.log('[→] Sent provider_register');
    return;
  }

  // Handle config_ack/config_nack (provider registration response)
  if (msg.type === 'config_ack') {
    console.log(`[✓] Config acknowledged: ${msg.configType}`);
    return;
  }
  if (msg.type === 'config_nack') {
    console.log(`[!] Config rejected: ${msg.configType} — ${msg.reason}`);
    return;
  }

  // Handle peer status notifications
  if (msg.type === 'peer_status') {
    console.log(`[~] Peer status: ${msg.status}`);
    if (msg.status === 'active') {
      // Peer is connected — initiate E2E key exchange
      keyExchangePending = true;
      sendKeyExchange();
    }
    return;
  }

  // Handle key_exchange — derive session keys for E2E
  if (msg.type === 'key_exchange') {
    const pubKey = msg.payload?.publicKey;
    if (pubKey) {
      await handleKeyExchange(pubKey);
    }
    return;
  }

  // Handle error messages from relay
  if (msg.type === 'error') {
    console.error(`[!] Relay error: ${msg.message}`);
    return;
  }

  // Handle confirmation — human approved/modified/cancelled a challenged task
  if (msg.type === 'confirmation') {
    const decision = msg.payload?.decision || msg.decision;
    const correlationId = msg.correlationId || msg.payload?.correlationId;
    console.log(`[←] Challenge response: ${decision}`);
    auditLogger.logChallenge(decision === 'approve' ? 'accepted' : decision === 'cancel' ? 'rejected' : 'accepted', { decision, correlationId });

    // Server-side wait timer enforcement
    if (correlationId && pendingChallenges.has(correlationId)) {
      const challenge = pendingChallenges.get(correlationId);
      const elapsedMs = Date.now() - challenge.issuedAt;
      const requiredMs = challenge.waitSeconds * 1000;
      if (elapsedMs < requiredMs && decision !== 'cancel') {
        const remainingSec = Math.ceil((requiredMs - elapsedMs) / 1000);
        console.log(`[!] Challenge response TOO EARLY: ${elapsedMs}ms elapsed, ${requiredMs}ms required — REJECTED`);
        auditLogger.logViolation('challenge-manager', 'challenge_rejected', { reason: 'timing_violation', elapsedMs, requiredMs });
        client.send(JSON.stringify({
          type: 'error', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
          payload: { code: 'BASTION-4006', message: `Challenge wait timer not met — ${remainingSec}s remaining` },
        }));
        return;
      }
      pendingChallenges.delete(correlationId);
    }

    if (decision === 'cancel') {
      console.log('[~] Task cancelled by human');
    } else if (decision === 'approve' || decision === 'modify') {
      console.log(`[✓] Task ${decision}d by human — would proceed with execution`);
    }
    return;
  }

  // AI-initiated challenge response (human responds to AI's proactive safety challenge)
  if (msg.type === 'ai_challenge_response') {
    const decision = msg.payload?.decision;
    const challengeId = msg.payload?.challengeId;
    console.log(`[←] AI challenge response: decision=${decision}, challengeId=${challengeId}`);

    // Look up the pending AI challenge
    const pending = challengeId ? pendingAiChallenges.get(challengeId) : null;
    if (challengeId && !pending) {
      console.log(`[!] AI challenge response for unknown challengeId: ${challengeId}`);
    }

    if (decision === 'accept') {
      console.log('[✓] Human accepted AI safety recommendation');
      auditLogger.logChallenge('accepted', { challengeId });
      if (pending) {
        console.log(`[✓] AI challenge ${challengeId} resolved: accepted (${pending.severity}, ${Date.now() - pending.issuedAt}ms)`);
      }
    } else if (decision === 'override') {
      // Significant: user overrode AI safety recommendation — inform AI in next prompt
      console.log('[!] Human OVERRODE AI safety recommendation — proceeding with user choice');
      auditLogger.logChallenge('overridden', { challengeId });
      if (pending) {
        console.log(`[!] AI challenge ${challengeId} resolved: OVERRIDDEN (${pending.severity}, ${Date.now() - pending.issuedAt}ms)`);
        // Inform AI of override in conversation context for transparency
        conversationManager.addUserMessage(
          `[System: Human overrode AI safety challenge (${pending.severity}): "${pending.reason}". Proceeding with user's choice.]`
        );
      }
    } else if (decision === 'cancel') {
      console.log('[~] Human cancelled action after AI challenge');
      if (pending) {
        console.log(`[~] AI challenge ${challengeId} resolved: cancelled (${pending.severity}, ${Date.now() - pending.issuedAt}ms)`);
      }
    }

    // Clean up the pending challenge
    if (challengeId) pendingAiChallenges.delete(challengeId);
    return;
  }

  // Handle challenge_config — update challenge schedule
  if (msg.type === 'challenge_config') {
    const p = msg.payload || msg;
    const result = challengeManager.updateConfig(p.schedule, p.cooldowns);
    client.send(JSON.stringify({
      type: 'challenge_config_ack',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: IDENTITY,
      payload: { accepted: result.accepted, reason: result.reason, cooldownExpires: result.cooldownExpires },
    }));
    console.log(`[${result.accepted ? '✓' : '!'}] Challenge config ${result.accepted ? 'updated' : 'rejected'}: ${result.reason}`);
    auditLogger.logEvent('challenge_issued', 'operator', 'challenge-manager', { accepted: result.accepted, reason: result.reason });
    // Send updated status
    client.send(JSON.stringify({
      type: 'challenge_status',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: IDENTITY,
      payload: challengeManager.getStatus(),
    }));
    return;
  }

  // Handle budget_config — update budget limits (immutable enforcement)
  if (msg.type === 'budget_config') {
    const p = msg.payload || msg;

    // Check challenge hours FIRST — budget changes blocked during challenge hours
    const challengeCheck = challengeManager.checkAction('budget_change');
    if ('blocked' in challengeCheck && challengeCheck.blocked) {
      console.log(`[!] Budget config BLOCKED: ${challengeCheck.reason}`);
      auditLogger.logEvent('budget_blocked', 'system', 'budget-guard', { reason: 'challenge_hours_active' });
      client.send(JSON.stringify({
        type: 'error', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
        payload: { code: 'BASTION-8005', message: challengeCheck.reason },
      }));
      return;
    }

    // Check cooldown
    const cooldownCheck = budgetGuard.checkCooldown();
    if (!cooldownCheck.allowed) {
      console.log(`[!] Budget config COOLDOWN: ${cooldownCheck.reason}`);
      auditLogger.logEvent('budget_cooldown', 'system', 'budget-guard', { reason: 'cooldown_active' });
      client.send(JSON.stringify({
        type: 'error', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
        payload: { code: 'BASTION-8004', message: cooldownCheck.reason, availableAt: cooldownCheck.availableAt },
      }));
      return;
    }

    // Apply limits (tighten-only mid-month enforced by BudgetGuard)
    const result = budgetGuard.updateLimits({
      monthlyCapUsd: p.monthlyCapUsd,
      maxPerMonth: p.maxPerMonth,
      maxPerDay: p.maxPerDay,
      maxPerSession: p.maxPerSession,
      maxPerCall: p.maxPerCall,
      alertAtPercent: p.alertAtPercent,
    });
    challengeManager.recordAction('budget_change');

    console.log(`[${result.accepted ? '✓' : '!'}] Budget config: ${result.reason}${result.pendingNextMonth ? ' (pending next month)' : ''}`);
    auditLogger.logEvent('budget_config_applied', 'operator', 'budget-guard', {});
    client.send(JSON.stringify({
      type: 'config_ack', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
      payload: { configType: 'budget_config', accepted: result.accepted, reason: result.reason, pendingNextMonth: result.pendingNextMonth },
    }));

    // Send updated budget status
    sendBudgetStatus();
    return;
  }

  // Handle tool_registry_sync — relay sends authorised tool registry on connect
  if (msg.type === 'tool_registry_sync') {
    const p = msg.payload || msg;
    if (!toolRegistry.isLocked && p && p.providers) {
      toolRegistry.loadFromSync(p);
      toolRegistry.lock();
      toolUpstreamMonitor.startPeriodicChecks();
      console.log(`[✓] Tool registry locked (${toolRegistry.toolCount} tools, ${toolRegistry.providerCount} providers)`);
    } else if (toolRegistry.isLocked) {
      console.log(`[~] tool_registry_sync received but registry already locked — ignoring`);
    }
    return;
  }

  // Handle tool_approved — human approved a tool call
  if (msg.type === 'tool_approved') {
    const p = msg.payload || msg;
    const pending = pendingToolRequests.get(p.requestId);
    if (!pending) {
      console.log(`[!] Tool approval for unknown request: ${p.requestId}`);
      return;
    }
    pendingToolRequests.delete(p.requestId);

    // Grant session trust
    toolRegistry.grantTrust(p.toolId, p.trustLevel, p.scope);
    console.log(`[✓] Tool approved: ${p.toolId} (trust: ${p.trustLevel}, scope: ${p.scope}, reason: ${p.reason})`);
    auditLogger.logTool('approved', { toolId: p.toolId, requestId: p.requestId });

    // Validate parameters
    const paramCheck = validateParameters(pending.params);
    if (!paramCheck.valid) {
      console.log(`[!] Parameter validation failed: ${paramCheck.reason}`);
      client.send(JSON.stringify({ type: 'tool_result', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY, payload: { requestId: p.requestId, toolId: p.toolId, result: null, durationMs: 0, success: false, error: `Parameter validation: ${paramCheck.reason}` } }));
      return;
    }

    // Execute MCP call
    const [providerId, toolName] = p.toolId.split(':');
    const adapter = mcpAdapters.get(providerId);
    if (!adapter || !adapter.connected) {
      console.log(`[!] MCP provider not connected: ${providerId}`);
      client.send(JSON.stringify({ type: 'tool_result', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY, payload: { requestId: p.requestId, toolId: p.toolId, result: null, durationMs: 0, success: false, error: `MCP provider ${providerId} not connected` } }));
      return;
    }

    const startTime = Date.now();
    try {
      const result = await adapter.callTool(toolName, pending.params);
      const duration = Date.now() - startTime;
      console.log(`[✓] Tool executed: ${p.toolId} (${duration}ms)`);
      client.send(JSON.stringify({ type: 'tool_result', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY, payload: { requestId: p.requestId, toolId: p.toolId, result, durationMs: duration, success: true } }));
    } catch (err) {
      const duration = Date.now() - startTime;
      console.error(`[!] Tool execution failed: ${p.toolId} — ${err.message}`);
      client.send(JSON.stringify({ type: 'tool_result', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY, payload: { requestId: p.requestId, toolId: p.toolId, result: null, durationMs: duration, success: false, error: err.message } }));
    }
    return;
  }

  // Handle tool_denied — human denied a tool call
  if (msg.type === 'tool_denied') {
    const p = msg.payload || msg;
    pendingToolRequests.delete(p.requestId);
    console.log(`[✗] Tool denied: ${p.toolId} — ${p.reason}`);
    auditLogger.logTool('denied', { toolId: p.toolId, requestId: p.requestId });
    return;
  }

  // Handle tool_revoke — human revoked session trust
  if (msg.type === 'tool_revoke') {
    const p = msg.payload || msg;
    toolRegistry.revokeTrust(p.toolId);
    console.log(`[✗] Tool trust revoked: ${p.toolId} — ${p.reason}`);
    auditLogger.logTool('revoked', { toolId: p.toolId });
    return;
  }

  // Handle tool_register — admin-approved tool addition via hot reload
  if (msg.type === 'tool_register') {
    const p = msg.payload || msg;
    const { providerId, tool, action } = p;

    if (action === 'approve' && tool) {
      const fullId = `${providerId}:${tool.name}`;
      const registeredTool = {
        providerId,
        providerName: providerId,
        name: tool.name,
        fullId,
        description: tool.description,
        category: tool.category,
        readOnly: tool.readOnly,
        dangerous: tool.dangerous,
        modes: [...(tool.modes || [])],
      };
      const registered = toolRegistry.addTool(providerId, registeredTool, 'admin_approved');
      if (registered) {
        toolUpstreamMonitor.acknowledgeChange(fullId);
        toolUpstreamMonitor.registerKnownTool(providerId, tool.name);
        console.log(`[✓] Tool registered via hot reload: ${fullId}`);
      } else {
        console.log(`[!] Tool hot reload failed (already exists or not locked): ${fullId}`);
      }
    } else if (action === 'reject') {
      const fullId = `${providerId}:${tool?.name || 'unknown'}`;
      toolUpstreamMonitor.acknowledgeChange(fullId);
      console.log(`[✗] Tool rejected: ${fullId}`);
    }
    return;
  }

  // Handle memory_proposal — human wants to save a memory (via "Remember" button)
  if (msg.type === 'memory_proposal') {
    const p = msg.payload || msg;
    const { proposalId, content, category, sourceMessageId, conversationId } = p;
    const scope = conversationId ? `conv:${String(conversationId).slice(0, 8)}` : 'global';
    console.log(`[←] Memory proposal: "${content.substring(0, 60)}..." (${category}, ${scope})`);

    // Store with conversation scope (null = global)
    const memoryId = memoryStore.addMemory(content, category, sourceMessageId || 'unknown', conversationId || null);
    console.log(`[✓] Memory saved: ${memoryId} (${scope})`);

    // Send approval confirmation back to human
    client.send(JSON.stringify({
      type: 'memory_decision',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: IDENTITY,
      payload: {
        proposalId,
        decision: 'approve',
        memoryId,
      },
    }));
    console.log(`[→] Memory decision: approved (${memoryStore.count} total memories)`);
    return;
  }

  // Handle memory_decision — human approves/rejects an AI-proposed memory
  if (msg.type === 'memory_decision') {
    const p = msg.payload || msg;
    const { proposalId, decision } = p;
    const pending = pendingMemoryProposals.get(proposalId);

    if (!pending) {
      console.log(`[←] Memory decision for unknown proposal: ${proposalId} (expired or already handled)`);
      return;
    }

    pendingMemoryProposals.delete(proposalId);

    if (decision === 'approve') {
      const memoryId = memoryStore.addMemory(pending.content, pending.category, pending.sourceMessageId, pending.conversationId);
      console.log(`[✓] Memory approved: "${pending.content.substring(0, 60)}..." → ${memoryId} (${memoryStore.count} total)`);
    } else {
      console.log(`[✗] Memory rejected: "${pending.content.substring(0, 60)}..."`);
    }
    return;
  }

  // Handle memory_batch_decision — human approves/rejects a batch of memory proposals
  if (msg.type === 'memory_batch_decision') {
    const p = msg.payload || {};
    const { batchId, decisions } = p;
    if (!batchId || !Array.isArray(decisions)) return;

    const batch = pendingBatches.get(batchId);
    let approved = 0, rejected = 0, edited = 0;

    for (const d of decisions) {
      if (d.decision === 'approved' || d.decision === 'edited') {
        const original = batch?.proposals?.find(pr => pr.proposalId === d.proposalId);
        const content = d.editedContent || original?.content || d.proposalId;
        const category = original?.category || 'fact';
        const scope = batch?.conversationId ? `conv:${String(batch.conversationId).slice(0, 8)}` : 'global';
        memoryStore.addMemory(content, category, `batch:${batchId.slice(0, 8)}`, batch?.conversationId || undefined);
        if (d.decision === 'edited') edited++;
        else approved++;
      } else {
        rejected++;
      }
    }

    pendingBatches.delete(batchId);
    console.log(`[✓] Batch ${batchId.slice(0, 8)}: ${approved} approved, ${edited} edited, ${rejected} rejected (${memoryStore.count} total)`);
    auditLogger.logMemory('batch_resolved', { batchId, approved, edited, rejected, total: decisions.length });

    // Refresh memory list for human client
    sendSecure({
      type: 'memory_list_response',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: IDENTITY,
      payload: {
        memories: memoryStore.getMemories().map(m => ({ id: m.id, content: m.content, category: m.category, createdAt: m.createdAt, updatedAt: m.updatedAt, conversationId: m.conversationId })),
        totalCount: memoryStore.count,
        filter: 'all',
      },
    });
    return;
  }

  // Handle memory_list — return memories with optional conversationId/category filter
  if (msg.type === 'memory_list') {
    const p = msg.payload || {};
    const category = p.category;
    const convIdFilter = p.conversationId;
    let memories;
    if (category) {
      memories = memoryStore.getMemoriesByCategory(category);
    } else if (convIdFilter !== undefined) {
      // convIdFilter can be null (global only) or a string (specific conversation)
      memories = memoryStore.getMemories(undefined, convIdFilter);
    } else {
      memories = memoryStore.getMemories();
    }
    client.send(JSON.stringify({
      type: 'memory_list_response',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: IDENTITY,
      payload: {
        memories: memories.map(m => ({ id: m.id, content: m.content, category: m.category, createdAt: m.createdAt, updatedAt: m.updatedAt, conversationId: m.conversationId })),
        totalCount: memories.length,
      },
    }));
    console.log(`[→] Memory list: ${memories.length} memories (filter: ${convIdFilter !== undefined ? (convIdFilter ?? 'global') : 'all'})`);
    return;
  }

  // Handle memory_update — edit an existing memory
  if (msg.type === 'memory_update') {
    const { memoryId, content } = msg.payload || msg;
    if (memoryId && content) {
      const ok = memoryStore.updateMemory(memoryId, content);
      console.log(`[${ok ? '✓' : '!'}] Memory ${ok ? 'updated' : 'not found'}: ${memoryId.slice(0, 8)}`);
    }
    return;
  }

  // Handle memory_delete — remove a memory
  if (msg.type === 'memory_delete') {
    const { memoryId } = msg.payload || msg;
    if (memoryId) {
      const ok = memoryStore.deleteMemory(memoryId);
      console.log(`[${ok ? '✓' : '!'}] Memory ${ok ? 'deleted' : 'not found'}: ${memoryId.slice(0, 8)}`);
    }
    return;
  }

  // Handle project_sync — save a project file
  if (msg.type === 'project_sync') {
    const p = msg.payload || msg;
    const result = projectStore.saveFile(p.path, p.content, p.mimeType);
    if (result.ok) {
      console.log(`[✓] Project file saved: ${p.path} (${result.size} bytes)`);
      client.send(JSON.stringify({ type: 'project_sync_ack', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY, payload: { path: p.path, size: result.size, timestamp: new Date().toISOString() } }));
    } else {
      console.log(`[!] Project file rejected: ${p.path} — ${result.error}`);
      client.send(JSON.stringify({ type: 'error', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY, payload: { code: 'PROJECT_SAVE_FAILED', message: result.error } }));
    }
    return;
  }

  // Handle project_list — return all project files
  if (msg.type === 'project_list') {
    const files = projectStore.listFiles(msg.payload?.directory);
    client.send(JSON.stringify({ type: 'project_list_response', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY, payload: { files, totalSize: projectStore.getTotalSize(), totalCount: files.length } }));
    console.log(`[→] Project list: ${files.length} files`);
    return;
  }

  // Handle project_delete — remove a project file
  if (msg.type === 'project_delete') {
    const ok = projectStore.deleteFile(msg.payload?.path || msg.path);
    console.log(`[${ok ? '✓' : '!'}] Project file ${ok ? 'deleted' : 'not found'}: ${msg.payload?.path}`);
    return;
  }

  // Handle project_config — set loading rules
  if (msg.type === 'project_config') {
    const p = msg.payload || msg;
    projectStore.setConfig(p.alwaysLoaded || [], p.available || []);
    console.log(`[✓] Project config: ${(p.alwaysLoaded || []).length} always loaded, ${(p.available || []).length} available`);
    client.send(JSON.stringify({ type: 'project_config_ack', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY, payload: { ...projectStore.getConfig(), timestamp: new Date().toISOString() } }));
    return;
  }

  // Handle context_request — return current user context
  if (msg.type === 'context_request') {
    const content = conversationManager.getUserContext() || '';
    sendSecure({
      type: 'context_response',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: IDENTITY,
      payload: {
        content,
        source: 'file',
        charCount: content.length,
      },
    });
    console.log(`[→] User context sent (${content.length} chars)`);
    return;
  }

  // Handle context_update — update user context or preferred adapter
  if (msg.type === 'context_update') {
    const payload = msg.payload || {};

    // Mid-conversation adapter switch
    if (payload.preferredAdapter && payload.conversationId) {
      const convId = payload.conversationId;
      conversationStore.updatePreferredAdapter(convId, payload.preferredAdapter);
      const adapterName = adapterRegistry.get(payload.preferredAdapter)?.activeModel ?? payload.preferredAdapter;
      console.log(`[✓] Conversation ${convId.slice(0, 8)} adapter switched to ${adapterName}`);
      return;
    }

    // User context content update
    const content = payload.content ?? msg.content ?? '';
    conversationManager.updateUserContext(content);
    console.log(`[✓] User context updated (${content.length} chars)`);
    return;
  }

  // ----- conversation_list: return all conversations -----
  if (msg.type === 'conversation_list') {
    const p = msg.payload || msg;
    const convs = conversationStore.listConversations(Boolean(p.includeArchived));
    client.send(JSON.stringify({
      type: 'conversation_list_response', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
      payload: {
        conversations: convs.map(c => ({ id: c.id, name: c.name, type: c.type, updatedAt: c.updatedAt, messageCount: c.messageCount, lastMessagePreview: c.lastMessagePreview, archived: c.archived, preferredAdapter: c.preferredAdapter })),
        totalCount: convs.length,
      },
    }));
    console.log(`[→] Conversation list: ${convs.length} conversations`);
    return;
  }

  // ----- conversation_create: create new conversation -----
  if (msg.type === 'conversation_create') {
    const p = msg.payload || msg;
    const conv = conversationStore.createConversation(p.name, p.type, p.preferredAdapter);
    // Switch to the new conversation (fresh trust scope)
    activeConversationId = conv.id;
    conversationStore.setActiveConversation(conv.id);
    toolRegistry.setActiveConversation(conv.id);
    conversationManager.clear();
    const adapterName = conv.preferredAdapter ? adapterRegistry.get(conv.preferredAdapter)?.activeModel ?? conv.preferredAdapter : 'default';
    client.send(JSON.stringify({
      type: 'conversation_create_ack', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
      payload: { conversationId: conv.id, name: conv.name, type: conv.type, createdAt: conv.createdAt, preferredAdapter: conv.preferredAdapter },
    }));
    console.log(`[✓] Conversation created: "${conv.name}" (${conv.id.slice(0, 8)}, adapter: ${adapterName})`);
    return;
  }

  // ----- conversation_switch: switch active conversation -----
  if (msg.type === 'conversation_switch') {
    const p = msg.payload || msg;
    const targetId = p.conversationId;
    const conv = conversationStore.getConversation(targetId);
    if (!conv) {
      client.send(JSON.stringify({ type: 'error', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY, payload: { code: 'BASTION-3001', message: `Conversation not found: ${targetId}` } }));
      return;
    }
    // Switch: update active conversation, sync trust scope, clear buffer
    activeConversationId = targetId;
    conversationStore.setActiveConversation(targetId);
    toolRegistry.setActiveConversation(targetId);
    conversationManager.clear();
    const recent = conversationStore.getRecentMessages(targetId, 50);
    for (const m of recent) {
      if (m.role === 'user') conversationManager.addUserMessage(m.content);
      else conversationManager.addAssistantMessage(m.content);
    }
    // Load compaction summary for the switched-to conversation
    const latestCompaction = compactionManager.getCompactionSummary(targetId);
    conversationManager.setCompactionSummary(latestCompaction?.summary ?? null);
    // Get scoped memories (all memories — future: per-conversation filtering)
    const memories = memoryStore.getMemories().slice(0, 20).map(m => ({ id: m.id, content: m.content, category: m.category }));
    client.send(JSON.stringify({
      type: 'conversation_switch_ack', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
      payload: {
        conversationId: targetId, name: conv.name,
        recentMessages: recent.map(m => ({ id: m.id, conversationId: m.conversationId, role: m.role, type: m.type, content: m.content, timestamp: m.timestamp, hash: m.hash, previousHash: m.previousHash, pinned: m.pinned })),
        memories,
        preferredAdapter: conv.preferredAdapter,
      },
    }));
    const adapterName = conv.preferredAdapter ? adapterRegistry.get(conv.preferredAdapter)?.activeModel ?? conv.preferredAdapter : 'default';
    console.log(`[✓] Switched to conversation: "${conv.name}" (${targetId.slice(0, 8)}, ${recent.length} messages, adapter: ${adapterName})`);
    return;
  }

  // ----- conversation_history: paginated message retrieval -----
  if (msg.type === 'conversation_history') {
    const p = msg.payload || msg;
    const convId = p.conversationId;
    const limit = p.limit || 50;
    const offset = p.offset || 0;
    const messages = conversationStore.getMessages(convId, limit, offset);
    const total = conversationStore.getMessageCount(convId);
    client.send(JSON.stringify({
      type: 'conversation_history_response', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
      payload: {
        conversationId: convId,
        messages: messages.map(m => ({ id: m.id, conversationId: m.conversationId, role: m.role, type: m.type, content: m.content, timestamp: m.timestamp, hash: m.hash, previousHash: m.previousHash, pinned: m.pinned })),
        hasMore: offset + limit < total,
        totalCount: total,
      },
    }));
    console.log(`[→] Conversation history: ${messages.length} messages (offset ${offset}, total ${total})`);
    return;
  }

  // ----- conversation_archive: mark conversation as archived -----
  if (msg.type === 'conversation_archive') {
    const p = msg.payload || msg;
    const ok = conversationStore.archiveConversation(p.conversationId);
    if (ok) {
      console.log(`[✓] Conversation archived: ${p.conversationId.slice(0, 8)}`);
      // If archived the active conversation, switch to another
      if (activeConversationId === p.conversationId) {
        const remaining = conversationStore.listConversations();
        if (remaining.length > 0) {
          activeConversationId = remaining[0].id;
          conversationStore.setActiveConversation(activeConversationId);
          conversationManager.clear();
        }
      }
    }
    // Send updated list as ack
    const convs = conversationStore.listConversations(true);
    client.send(JSON.stringify({
      type: 'conversation_list_response', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
      payload: { conversations: convs.map(c => ({ id: c.id, name: c.name, type: c.type, updatedAt: c.updatedAt, messageCount: c.messageCount, lastMessagePreview: c.lastMessagePreview, archived: c.archived, preferredAdapter: c.preferredAdapter })), totalCount: convs.length },
    }));
    return;
  }

  // ----- conversation_delete: delete conversation + all messages -----
  if (msg.type === 'conversation_delete') {
    const p = msg.payload || msg;
    // Challenge hours check for destructive action
    const challengeCheck = challengeManager.checkAction('conversation_delete');
    if ('blocked' in challengeCheck && challengeCheck.blocked) {
      client.send(JSON.stringify({ type: 'error', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY, payload: { code: 'BASTION-4006', message: challengeCheck.reason } }));
      return;
    }
    const ok = conversationStore.deleteConversation(p.conversationId);
    if (ok) {
      console.log(`[✓] Conversation deleted: ${p.conversationId.slice(0, 8)}`);
      if (activeConversationId === p.conversationId) {
        const remaining = conversationStore.listConversations();
        if (remaining.length > 0) {
          activeConversationId = remaining[0].id;
          conversationStore.setActiveConversation(activeConversationId);
        } else {
          const def = conversationStore.createConversation('Default', 'normal');
          activeConversationId = def.id;
          conversationStore.setActiveConversation(def.id);
        }
        conversationManager.clear();
      }
    }
    const convs = conversationStore.listConversations(true);
    client.send(JSON.stringify({
      type: 'conversation_list_response', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
      payload: { conversations: convs.map(c => ({ id: c.id, name: c.name, type: c.type, updatedAt: c.updatedAt, messageCount: c.messageCount, lastMessagePreview: c.lastMessagePreview, archived: c.archived, preferredAdapter: c.preferredAdapter })), totalCount: convs.length },
    }));
    return;
  }

  // ----- conversation_compact: manual compaction trigger -----
  if (msg.type === 'conversation_compact') {
    const p = msg.payload || msg;
    const convId = p.conversationId;
    console.log(`[←] Manual compaction requested for ${(convId || '').slice(0, 8)}`);

    compactionManager.compact(convId, summariseForCompaction).then(result => {
      if (result.success) {
        console.log(`[✓] Compacted: ${result.messagesCovered} messages, ~${result.tokensSaved} tokens saved`);
        client.send(JSON.stringify({
          type: 'conversation_compact_ack', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
          payload: {
            conversationId: convId,
            summaryPreview: (result.summary || '').slice(0, 200),
            messagesCovered: result.messagesCovered || 0,
            tokensSaved: result.tokensSaved || 0,
          },
        }));
      } else {
        client.send(JSON.stringify({
          type: 'error', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
          payload: { code: 'BASTION-3001', message: `Compaction failed: ${result.error}` },
        }));
      }
    }).catch(err => {
      console.error(`[!] Compaction failed: ${err.message}`);
    });
    return;
  }

  // ----- file_manifest: relay notifies AI of incoming file from human -----
  if (msg.type === 'file_manifest') {
    const p = msg.payload || msg;
    console.log(`[←] File manifest: ${p.filename} (${p.sizeBytes} bytes, hash: ${(p.hash || '').slice(0, 12)}...)`);

    // Auto-accept project-related files (human→AI with projectContext)
    const isProjectFile = p.projectContext && p.projectContext.trim().length > 0;

    if (isProjectFile) {
      // Track acceptance metadata for when file_data arrives
      pendingFileAcceptances.set(p.transferId, {
        filename: p.filename,
        sizeBytes: p.sizeBytes,
        hash: p.hash,
        mimeType: p.mimeType,
        purpose: p.purpose,
        projectContext: p.projectContext,
        taskId: p.taskId || 'file-transfer',
      });

      // Send file_request to relay — triggers file delivery
      client.send(JSON.stringify({
        type: 'file_request',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        payload: {
          transferId: p.transferId,
          manifestMessageId: msg.id || randomUUID(),
        },
      }));
      console.log(`[→] Auto-accepted project file: ${p.filename} — file_request sent`);
    } else {
      console.log(`[~] File offer received but not auto-accepted (no projectContext): ${p.filename}`);
      // Future: apply safety evaluation or send challenge to human for approval
    }
    return;
  }

  // ----- file_data: relay delivers file bytes after AI accepted via file_request -----
  if (msg.type === 'file_data') {
    const transferId = msg.transferId;
    const fileDataB64 = msg.fileData;
    const filename = msg.filename;
    const declaredHash = msg.hash;

    if (!fileDataB64 || !transferId) {
      console.error('[!] file_data missing required fields (transferId or fileData)');
      return;
    }

    const fileData = new Uint8Array(Buffer.from(fileDataB64, 'base64'));

    // 3-stage custody chain — stage 3: verify hash at recipient
    const actualHash = createHash('sha256').update(fileData).digest('hex');
    if (actualHash !== declaredHash) {
      console.error(`[!] BASTION-5001: Hash mismatch at receipt — expected ${declaredHash.slice(0, 12)}, got ${actualHash.slice(0, 12)}`);
      console.error(`[!] Transfer ${transferId.slice(0, 8)} ABORTED — custody chain broken`);
      auditLogger.logViolation('file-transfer', 'purge_violation', { reason: 'hash_mismatch' });
      client.send(JSON.stringify({
        type: 'error', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
        payload: { code: 'BASTION-5001', message: `Hash verification failed at delivery: expected ${declaredHash}, got ${actualHash}` },
      }));
      return;
    }

    // Look up pending acceptance metadata
    const acceptance = pendingFileAcceptances.get(transferId);
    const taskId = acceptance?.taskId || 'file-transfer';
    const mimeType = acceptance?.mimeType || 'application/octet-stream';
    pendingFileAcceptances.delete(transferId);

    // Register task with purge manager if not already tracked
    if (!registeredPurgeTasks.has(taskId)) {
      try {
        filePurgeManager.registerTask(taskId);
        registeredPurgeTasks.add(taskId);
      } catch { /* already tracked */ }
    }

    // Store in intake directory (read-only from this point)
    const result = intakeDirectory.receive(transferId, taskId, filename, fileData, mimeType, actualHash);

    if (result.status === 'received') {
      console.log(`[✓] File received and verified: ${filename} (${fileData.length} bytes, SHA-256: ${actualHash.slice(0, 12)}...)`);
      console.log(`[✓] Custody chain complete: [submitted] → [quarantined] → [delivered] — all hashes match`);

      // --- Data import: if purpose is 'import', validate and send preview ---
      if (acceptance?.purpose === 'import' || filename.endsWith('.bdp')) {
        console.log('[~] Import file detected — running validation');
        const importBuffer = Buffer.from(fileData);
        const adapter = importRegistry.detectAdapter(importBuffer);
        if (!adapter) {
          client.send(JSON.stringify({
            type: 'data_import_validate',
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            sender: IDENTITY,
            payload: {
              valid: false, format: 'unknown', version: 'unknown', exportedAt: 'unknown',
              contents: { conversations: 0, memories: 0, projectFiles: 0, skills: 0, hasConfig: false },
              conflicts: [], errors: ['No import adapter found for this file format'],
            },
          }));
          return;
        }

        (async () => {
          try {
            const validation = await adapter.validate(importBuffer, {
              conversationStore, memoryStore, projectStore, skillStore,
            });

            if (validation.valid) {
              pendingImportData = await adapter.extract(importBuffer);
              pendingImportAdapter = adapter;
            }

            client.send(JSON.stringify({
              type: 'data_import_validate',
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              sender: IDENTITY,
              payload: validation,
            }));

            console.log(`[✓] Import validation: ${validation.valid ? 'VALID' : 'INVALID'} (${validation.contents.conversations}c ${validation.contents.memories}m ${validation.contents.projectFiles}p ${validation.contents.skills}s)`);
          } catch (err) {
            console.error(`[!] Import validation failed: ${err.message}`);
            client.send(JSON.stringify({
              type: 'data_import_validate',
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              sender: IDENTITY,
              payload: {
                valid: false, format: 'unknown', version: 'unknown', exportedAt: 'unknown',
                contents: { conversations: 0, memories: 0, projectFiles: 0, skills: 0, hasConfig: false },
                conflicts: [], errors: [`Validation error: ${err.message}`],
              },
            }));
          }
        })();
        return;
      }

      // Auto-save project files to ProjectStore
      const projectExts = ['.md', '.json', '.yaml', '.yml', '.txt'];
      const ext = filename.lastIndexOf('.') >= 0 ? filename.slice(filename.lastIndexOf('.')) : '';
      if (projectExts.includes(ext.toLowerCase())) {
        try {
          const content = new TextDecoder().decode(fileData);
          const saveResult = projectStore.saveFile(filename, content, mimeType);
          if (saveResult.ok) {
            console.log(`[✓] Project file auto-saved: ${filename} (${saveResult.size} bytes)`);
          } else {
            console.log(`[!] Project file save failed: ${filename} — ${saveResult.error}`);
          }
        } catch {
          // Binary content with text extension — skip project save
        }
      }
    } else if (result.status === 'duplicate') {
      console.log(`[~] Duplicate file delivery ignored: ${transferId.slice(0, 8)}`);
    } else if (result.status === 'full') {
      console.log(`[!] Intake directory full (${result.maxFiles} files) — cannot receive ${filename}`);
    }
    return;
  }

  // ----- file_offer: AI should not receive this (it's for human clients) -----
  if (msg.type === 'file_offer') {
    console.log(`[~] Unexpected file_offer received — this message type is for human clients`);
    return;
  }

  // ----- file_request: response to AI-initiated file offer (future outbound) -----
  if (msg.type === 'file_request') {
    console.log(`[←] file_request received: ${(msg.payload?.transferId || '').slice(0, 8)} — relay handles delivery`);
    return;
  }

  // Handle task messages — run through safety engine first
  if (msg.type === 'task') {
    const payload = msg.payload || msg;
    console.log(`[←] Task: ${payload.action} → ${payload.target} (priority: ${payload.priority})`);

    // Safety evaluation — challengeActive unifies Layer 2 time_of_day with ChallengeManager
    const safetyResult = evaluateSafety(payload, { config: safetyConfig, history: patternHistory, challengeActive: challengeManager.isActive(), dateTimeManager });
    const safetyResponse = generateSafetyResponse(payload, safetyResult);

    if (safetyResponse.type === 'denial') {
      console.log(`[✗] DENIED by Layer ${safetyResult.decidingLayer}: ${safetyResponse.payload.reason}`);
      auditLogger.logSafety('denied', safetyResult.decidingLayer, { reason: safetyResponse.payload.reason, action: payload.action });
      const denialMsg = JSON.stringify({
        type: 'denial',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        payload: safetyResponse.payload,
      });
      client.send(denialMsg);
      return;
    }

    if (safetyResponse.type === 'challenge') {
      console.log(`[?] CHALLENGE by Layer ${safetyResult.decidingLayer}: ${safetyResponse.payload.reason}`);
      auditLogger.logSafety('challenged', safetyResult.decidingLayer, { reason: safetyResponse.payload.reason });
      const challengeId = randomUUID();
      // Determine wait time: use challenge hours wait if active, otherwise 5s minimum
      const challengeAction = challengeManager.checkAction('dangerous_tool_approval');
      const waitSeconds = ('confirm' in challengeAction && challengeAction.waitSeconds) ? challengeAction.waitSeconds : 5;
      pendingChallenges.set(msg.correlationId || msg.id, { issuedAt: Date.now(), waitSeconds });
      const challengeMsg = JSON.stringify({
        type: 'challenge',
        id: challengeId,
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        correlationId: msg.correlationId || msg.id,
        payload: { ...safetyResponse.payload, waitSeconds },
      });
      client.send(challengeMsg);
      // Wait for confirmation — don't execute yet
      return;
    }

    console.log(`[✓] Safety: ALLOW (score: ${safetyResult.layer2?.score?.toFixed(2) ?? 'n/a'})`);
    auditLogger.logSafety('allowed', safetyResult.decidingLayer, { action: payload.action });
    // For task messages, fall through to API call below
  }

  // Handle conversation messages — call Anthropic API
  if (msg.type === 'conversation' || msg.type === 'task') {
    aiActionLimits.recordMessage();
    const content = msg.type === 'task'
      ? `Task: ${(msg.payload || msg).action} on ${(msg.payload || msg).target}`
      : (msg.payload?.content || msg.content || '');
    const senderName = msg.sender?.displayName || 'Unknown';

    // Guard: reject empty content — do NOT persist to conversation history
    if (!content || content.trim().length === 0) {
      console.warn(`[!] Empty content from ${senderName} — NOT persisting (would poison conversation history)`);
      return;
    }

    console.log(`[←] ${senderName}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);

    // Add to conversation buffer and persist
    conversationManager.addUserMessage(content);
    persistMessage('user', msg.type, content);

    if (processing) {
      console.log('[~] Already processing a message — queueing not implemented, sending busy notice');
      const busyMsg = JSON.stringify({
        type: 'conversation',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        payload: { content: 'I\'m still processing your previous message. Please wait a moment.' },
      });
      client.send(busyMsg);
      return;
    }

    processing = true;

    // Budget check — if budget exhausted, notify human but still allow non-search conversation
    const budgetCheck = budgetGuard.checkBudget();
    if ('blocked' in budgetCheck && budgetCheck.blocked) {
      console.log(`[!] Budget: ${budgetCheck.reason}`);
      // Still allow the API call but without web_search tool
    }

    const operation = msg.type === 'task' ? 'task' : 'conversation';
    const activeConv = activeConversationId ? conversationStore.getConversation(activeConversationId) : null;
    const { adapter: selectedAdapter, reason: adapterReason } = adapterRegistry.selectAdapter(operation, activeConv?.preferredAdapter);
    console.log(`[~] Calling ${selectedAdapter.activeModel} (${adapterReason})...`);

    try {
      // Streaming: send chunks to human client in real-time
      let streamChunkIndex = 0;
      const onChunk = STREAMING_ENABLED ? (chunk, index) => {
        sendSecure({
          type: 'conversation_stream',
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          sender: IDENTITY,
          payload: { conversationId: activeConversationId || '', chunk, index, final: false },
        });
        streamChunkIndex = index;
      } : undefined;

      // Use the registry-selected adapter with conversation context
      const result = await selectedAdapter.executeTask({
        taskId: msg.id || randomUUID(),
        action: 'respond',
        target: content,
        priority: msg.type === 'task' ? ((msg.payload || msg).priority || 'normal') : 'normal',
        parameters: {
          _systemPrompt: conversationManager.getSystemPrompt(activeConversationId, content),
          _conversationHistory: conversationManager.getMessages(),
        },
        constraints: [],
      }, STREAMING_ENABLED ? { streaming: true, onChunk } : undefined);

      if (result.ok) {
        const rawResponseText = result.response.textContent;
        const cost = result.response.cost;

        // Parse and strip AI action blocks before display/storage
        const { cleanText: responseText, actions } = parseActionBlocks(rawResponseText);

        // Process extracted actions — send protocol messages BEFORE response
        // Separate memory actions for smart routing (single→toast, multi→batch)
        const memoryActions = actions.filter(a => a.type === 'MEMORY');
        const otherActions = actions.filter(a => a.type !== 'MEMORY');

        // --- Memory action routing ---
        if (memoryActions.length === 1 && aiActionLimits.canMemory()) {
          // Single memory → existing inline toast flow
          aiActionLimits.recordMemory();
          const payload = memoryActions[0].data;
          const proposalId = randomUUID();
          sendSecure({
            type: 'ai_memory_proposal',
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            sender: IDENTITY,
            payload: {
              proposalId,
              content: String(payload.content || ''),
              category: ['fact', 'preference', 'workflow', 'project'].includes(payload.category) ? payload.category : 'fact',
              reason: String(payload.reason || ''),
              sourceMessageId: msg.id || '',
              conversationId: activeConversationId || '',
            },
          });
          pendingMemoryProposals.set(proposalId, {
            content: String(payload.content || ''),
            category: ['fact', 'preference', 'workflow', 'project'].includes(payload.category) ? payload.category : 'fact',
            conversationId: activeConversationId || null,
            sourceMessageId: msg.id || '',
          });
          console.log(`[→] AI memory proposal: "${String(payload.content || '').substring(0, 60)}"`);
          auditLogger.logMemory('proposed', { proposalId, category: payload.category });
        } else if (memoryActions.length === 1 && !aiActionLimits.canMemory()) {
          // Single memory but rate limited
          console.log(`[!] AI memory proposal rate-limited (${aiActionLimits.memoryCount}/${aiActionLimits.maxMemoriesPerSession} used, ${aiActionLimits.messagesSinceLastMemory}/${aiActionLimits.memoryMinMessageGap} gap)`);
          auditLogger.logMemory('rate_limited', { messagesSince: aiActionLimits.messagesSinceLastMemory, count: aiActionLimits.memoryCount });
        } else if (memoryActions.length > 1 && aiActionLimits.canBatch()) {
          // Multiple memories → batch flow
          aiActionLimits.recordBatch();
          const batchId = randomUUID();
          const proposals = memoryActions.map(a => ({
            proposalId: randomUUID(),
            content: String(a.data.content || ''),
            category: ['fact', 'preference', 'workflow', 'project'].includes(a.data.category) ? a.data.category : 'fact',
            reason: String(a.data.reason || ''),
            isUpdate: false,
            existingMemoryContent: null,
          }));
          sendSecure({
            type: 'ai_memory_proposal_batch',
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            sender: IDENTITY,
            payload: {
              batchId,
              source: 'inline_response',
              conversationId: activeConversationId || null,
              proposals,
            },
          });
          pendingBatches.set(batchId, {
            source: 'inline_response',
            conversationId: activeConversationId || null,
            proposals,
            sentAt: new Date().toISOString(),
          });
          console.log(`[→] Memory batch (inline): ${proposals.length} proposals (batch ${batchId.slice(0, 8)})`);
          auditLogger.logMemory('batch_proposed', { batchId, source: 'inline_response', count: proposals.length });
        } else if (memoryActions.length > 1 && !aiActionLimits.canBatch()) {
          // Multiple memories but batch rate limited
          console.log(`[!] Memory batch rate-limited (${aiActionLimits.batchCount}/${aiActionLimits.maxBatchesPerSession} batches, cooldown: ${Math.round((aiActionLimits.batchCooldownMs - (Date.now() - aiActionLimits.lastBatchTime)) / 1000)}s remaining)`);
          auditLogger.logMemory('batch_rate_limited', { count: memoryActions.length, batchCount: aiActionLimits.batchCount });
        }

        // --- Non-memory action processing (CHALLENGE, RECALL, EXEC) ---
        for (const action of otherActions) {
          if (action.type === 'CHALLENGE' && aiActionLimits.canChallenge()) {
            aiActionLimits.recordChallenge();
            const payload = action.data;
            const aiChallengeId = randomUUID();
            pendingAiChallenges.set(aiChallengeId, {
              issuedAt: Date.now(),
              reason: String(payload.reason || ''),
              severity: ['info', 'warning', 'critical'].includes(payload.severity) ? payload.severity : 'warning',
            });
            sendSecure({
              type: 'ai_challenge',
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              sender: IDENTITY,
              payload: {
                challengeId: aiChallengeId,
                reason: String(payload.reason || ''),
                severity: ['info', 'warning', 'critical'].includes(payload.severity) ? payload.severity : 'warning',
                suggestedAction: String(payload.suggestedAction || ''),
                waitSeconds: typeof payload.waitSeconds === 'number' ? payload.waitSeconds : 10,
                context: {
                  challengeHoursActive: challengeManager.isActive(),
                  requestedAction: String(payload.requestedAction || ''),
                },
              },
            });
            console.log(`[→] AI challenge issued: ${payload.severity} — ${String(payload.reason || '').substring(0, 60)}`);
            auditLogger.logChallenge('issued', { severity: payload.severity, reason: String(payload.reason || '') });
          } else if (action.type === 'RECALL' && aiActionLimits.canRecall()) {
            aiActionLimits.recordRecall();
            const payload = action.data;
            const query = String(payload.query || '');
            const scope = payload.scope || 'conversation';
            const limit = typeof payload.limit === 'number' ? payload.limit : 5;

            console.log(`[→] AI recall request: "${query.substring(0, 60)}" (scope: ${scope}, limit: ${limit})`);

            const result = recallHandler.recall(
              scope === 'conversation' ? activeConversationId : null,
              { query, scope, limit },
            );

            if (result.matches.length > 0) {
              const formatted = recallHandler.formatForPrompt(result);
              conversationManager.setRecallResults(formatted);
              console.log(`[✓] Recall: ${result.matches.length} matches for "${query.substring(0, 40)}" (${result.queryTimeMs}ms)`);
            } else {
              conversationManager.setRecallResults(`--- Recalled Context ---\nNo matches found for: "${query}"\n--- End Recalled Context ---`);
              console.log(`[✗] Recall: no matches for "${query.substring(0, 40)}"`);
            }

            // Audit trail via usage tracker
            usageTracker.record({
              timestamp: new Date().toISOString(),
              adapterId: 'system', adapterRole: 'recall', purpose: `recall:${query.substring(0, 50)}`,
              conversationId: activeConversationId || null,
              inputTokens: 0, outputTokens: 0, costUsd: 0,
            });
          } else if (action.type === 'EXEC' && aiActionLimits.canExec()) {
            aiActionLimits.recordExec();
            // EXEC block data is a raw command string (not JSON)
            const commandStr = typeof action.data === 'string'
              ? action.data
              : (typeof action.data === 'object' && action.data.command)
                ? String(action.data.command)
                : String(action.data);

            console.log(`[→] AI exec request: "${commandStr.substring(0, 80)}"`);

            const execResult = await bastionBash.execute(commandStr);

            // Audit trail
            const auditType = execResult.tier === 3 ? 'BASH_INVISIBLE' : execResult.tier === 2 ? 'BASH_BLOCKED' : 'BASH_COMMAND';
            usageTracker.record({
              timestamp: new Date().toISOString(),
              adapterId: 'system', adapterRole: 'bash', purpose: `${auditType}:${commandStr.substring(0, 50)}`,
              conversationId: activeConversationId || null,
              inputTokens: 0, outputTokens: 0, costUsd: 0,
            });

            // Inject result into conversation context for next prompt
            const formatted = bastionBash.formatForPrompt(execResult);
            conversationManager.setExecResults(formatted);

            console.log(`[${execResult.success ? '✓' : '✗'}] Bash tier ${execResult.tier}: "${commandStr.substring(0, 60)}" (${execResult.executionTimeMs}ms)`);
          } else if (action.type === 'EXEC' && !aiActionLimits.canExec()) {
            // M3: Rate-limited exec — audit event + feedback to AI
            const limitedCmd = typeof action.data === 'string'
              ? action.data.substring(0, 50)
              : String(action.data?.command ?? action.data).substring(0, 50);
            console.log(`[!] Exec rate limited: "${limitedCmd}" (session: ${aiActionLimits.execCount}/${aiActionLimits.maxExecsPerSession}, response: ${aiActionLimits.execCountThisResponse}/${aiActionLimits.maxExecsPerResponse})`);
            usageTracker.record({
              timestamp: new Date().toISOString(),
              adapterId: 'system', adapterRole: 'bash', purpose: `BASH_RATE_LIMITED:${limitedCmd}`,
              conversationId: activeConversationId || null,
              inputTokens: 0, outputTokens: 0, costUsd: 0,
            });
            auditLogger.logCommand(limitedCmd, 0, false, { reason: 'rate_limited', sessionCount: aiActionLimits.execCount, responseCount: aiActionLimits.execCountThisResponse });
            conversationManager.setExecResults('Command rate limited — max 5/response or 20/session reached.');
          }
        }

        // Reset per-response exec counter
        aiActionLimits.resetResponseExecCount();

        // Send final stream chunk marker if streaming was active
        if (STREAMING_ENABLED && streamChunkIndex > 0) {
          sendSecure({
            type: 'conversation_stream',
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            sender: IDENTITY,
            payload: { conversationId: activeConversationId || '', chunk: '', index: streamChunkIndex + 1, final: true },
          });
        }

        // Add to conversation buffer and persist (clean text, no action blocks)
        conversationManager.addAssistantMessage(responseText);
        persistMessage('assistant', 'conversation', responseText);

        const streamLabel = STREAMING_ENABLED && streamChunkIndex > 0 ? ` (${streamChunkIndex + 1} chunks streamed)` : '';
        console.log(`[✓] API response (${result.response.usage.inputTokens}in/${result.response.usage.outputTokens}out, $${cost.estimatedCostUsd.toFixed(4)})${streamLabel}`);
        console.log(`[→] Claude: ${responseText.substring(0, 100)}${responseText.length > 100 ? '...' : ''}`);

        // Record web search usage if any (from server_tool_use in response)
        const searchCount = result.response.usage.serverToolUse?.webSearchRequests ?? 0;
        if (searchCount > 0) {
          const budgetResult = budgetGuard.recordUsage(searchCount);
          console.log(`[💰] Budget: ${searchCount} search(es), alert: ${budgetResult.alertLevel}`);
          if (budgetResult.thresholdCrossed) {
            const status = budgetGuard.getStatus();
            client.send(JSON.stringify({
              type: 'budget_alert', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
              payload: {
                alertLevel: budgetResult.thresholdCrossed,
                message: `Budget threshold crossed: ${budgetResult.thresholdCrossed}`,
                budgetRemaining: status.budgetRemaining,
                searchesRemaining: Math.max(0, budgetGuard.getLimits().maxPerMonth - status.searchesThisMonth),
              },
            }));
          }
          sendBudgetStatus();
        }

        // Record usage to UsageTracker
        usageTracker.record({
          timestamp: new Date().toISOString(),
          adapterId: selectedAdapter.activeModel || 'unknown',
          adapterRole: adapterReason || 'conversation',
          purpose: msg.type === 'task' ? 'task' : 'conversation',
          conversationId: activeConversationId || null,
          inputTokens: result.response.usage.inputTokens,
          outputTokens: result.response.usage.outputTokens,
          costUsd: cost.estimatedCostUsd,
        });
        sendUsageStatusDebounced();

        // Send final complete response (for persistence + non-streaming clients)
        const responseEnvelope = {
          type: 'conversation',
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          sender: IDENTITY,
          payload: { content: responseText },
        };

        const sent = await sendSecure(responseEnvelope);
        if (!sent) {
          console.error('[!] Failed to send response — not connected');
        }
      } else {
        console.error(`[!] API call failed: ${result.errorCode} — ${result.message}`);

        // Send error notification to human
        const errorMsg = JSON.stringify({
          type: 'conversation',
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          sender: IDENTITY,
          payload: { content: `I encountered an error: ${result.message}. ${result.retryable ? 'Please try again.' : ''}` },
        });
        client.send(errorMsg);
      }
    } catch (err) {
      console.error(`[!] Unexpected error calling API: ${err.message}`);
    } finally {
      processing = false;
    }

    return;
  }

  // -----------------------------------------------------------------------
  // Data Portability (GDPR Article 20)
  // -----------------------------------------------------------------------

  if (msg.type === 'data_export_request') {
    console.log('[←] Data export request received');

    (async () => {
      try {
        const exportBuffer = await dataExporter.exportAll((progress) => {
          client.send(JSON.stringify({
            type: 'data_export_progress',
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            sender: IDENTITY,
            payload: { percentage: progress.percentage, phase: progress.phase },
          }));
        });

        // Stage the export file for delivery via file airlock
        const filename = `bastion-export-${new Date().toISOString().replace(/[:.]/g, '-')}.bdp`;
        const hash = createHash('sha256').update(exportBuffer).digest('hex');
        const stageResult = outboundStaging.stage(
          'data-export-' + randomUUID(),
          filename,
          new Uint8Array(exportBuffer),
          'application/zip',
          'data_export',
        );

        if (stageResult.status !== 'staged') {
          client.send(JSON.stringify({
            type: 'error',
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            sender: IDENTITY,
            payload: { code: 'BASTION-5002', message: 'Outbound staging full — cannot stage export' },
          }));
          return;
        }

        const counts = dataExporter.getContentCounts();
        const transferId = stageResult.metadata.transferId;

        // Submit file through relay's file airlock (file_manifest with fileData).
        // The relay intercepts file_manifest, quarantines the bytes, verifies
        // the hash, and generates a file_offer to the human client.
        const fileDataB64 = Buffer.from(exportBuffer).toString('base64');
        client.send(JSON.stringify({
          type: 'file_manifest',
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          sender: IDENTITY,
          payload: {
            transferId,
            filename,
            sizeBytes: exportBuffer.length,
            hash,
            hashAlgorithm: 'sha256',
            mimeType: 'application/zip',
            purpose: 'export',
            projectContext: 'data export',
            fileData: fileDataB64,
          },
        }));

        // Send ready notification
        client.send(JSON.stringify({
          type: 'data_export_ready',
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          sender: IDENTITY,
          payload: {
            transferId,
            filename,
            sizeBytes: exportBuffer.length,
            hash,
            contentCounts: counts,
          },
        }));

        console.log(`[✓] Data export ready: ${filename} (${exportBuffer.length} bytes, submitted via file_manifest)`);
        auditLogger.logEvent('data_export', 'human', 'data-exporter', {});
      } catch (err) {
        console.error(`[!] Data export failed: ${err.message}`);
        client.send(JSON.stringify({
          type: 'error',
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          sender: IDENTITY,
          payload: { code: 'BASTION-5003', message: `Export failed: ${err.message}` },
        }));
      }
    })();

    return;
  }

  if (msg.type === 'data_import_confirm') {
    const p = msg.payload || msg;
    console.log('[←] Data import confirmation received');

    if (!pendingImportData) {
      client.send(JSON.stringify({
        type: 'error',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        payload: { code: 'BASTION-3001', message: 'No pending import data — upload a .bdp file first' },
      }));
      return;
    }

    try {
      const executor = new ImportExecutor({
        conversationStore,
        memoryStore,
        projectStore,
        skillStore,
      });

      const result = executor.execute(pendingImportData, {
        importConversations: Boolean(p.importConversations),
        importMemories: Boolean(p.importMemories),
        importProjectFiles: Boolean(p.importProjectFiles),
        importSkills: Boolean(p.importSkills),
        importConfig: Boolean(p.importConfig),
        conflictResolutions: p.conflictResolutions || [],
      });

      client.send(JSON.stringify({
        type: 'data_import_complete',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        payload: result,
      }));

      console.log(`[✓] Data import complete: ${result.imported.conversations}c ${result.imported.memories}m ${result.imported.projectFiles}p ${result.imported.skills}s (${result.errors.length} errors)`);
      auditLogger.logEvent('data_import', 'human', 'import-executor', {});
    } catch (err) {
      console.error(`[!] Data import failed: ${err.message}`);
      client.send(JSON.stringify({
        type: 'error',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        payload: { code: 'BASTION-5004', message: `Import failed: ${err.message}` },
      }));
    } finally {
      pendingImportData = null;
      pendingImportAdapter = null;
    }

    return;
  }

  // -----------------------------------------------------------------------
  // Data Erasure (GDPR Article 17 — Right to Erasure)
  // -----------------------------------------------------------------------

  if (msg.type === 'data_erasure_request') {
    console.log('[←] Data erasure request received');

    // Check challenge hours — erasure blocked during vulnerable periods
    const challengeCheck = challengeManager.checkAction('data_erasure');
    if ('blocked' in challengeCheck && challengeCheck.blocked) {
      console.log(`[!] Data erasure BLOCKED: ${challengeCheck.reason}`);
      client.send(JSON.stringify({
        type: 'error',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        payload: { code: 'BASTION-4006', message: `Erasure blocked: ${challengeCheck.reason}` },
      }));
      return;
    }

    // Check for existing active erasure
    const existing = dataEraser.getActiveErasure();
    if (existing) {
      client.send(JSON.stringify({
        type: 'error',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        payload: { code: 'BASTION-7005', message: `Erasure already active: ${existing.erasureId} (hard delete at ${existing.hardDeleteAt})` },
      }));
      return;
    }

    const preview = dataEraser.preview();
    const hardDeleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    client.send(JSON.stringify({
      type: 'data_erasure_preview',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: IDENTITY,
      payload: {
        conversations: preview.conversations,
        messages: preview.messages,
        memories: preview.memories,
        projectFiles: preview.projectFiles,
        skills: preview.skills,
        usageRecords: preview.usageRecords,
        softDeleteDays: 30,
        hardDeleteAt,
        auditNote: 'Audit trail metadata preserved (content redacted). Chain integrity maintained.',
      },
    }));

    console.log(`[✓] Erasure preview sent: ${preview.conversations}c ${preview.messages}m ${preview.memories}mem ${preview.projectFiles}p ${preview.usageRecords}u`);
    return;
  }

  if (msg.type === 'data_erasure_confirm') {
    console.log('[←] Data erasure confirmation received');

    // Challenge hours check again (in case time passed between preview and confirm)
    const challengeCheck = challengeManager.checkAction('data_erasure');
    if ('blocked' in challengeCheck && challengeCheck.blocked) {
      client.send(JSON.stringify({
        type: 'error',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        payload: { code: 'BASTION-4006', message: `Erasure blocked: ${challengeCheck.reason}` },
      }));
      return;
    }

    const result = dataEraser.softDelete();

    // Audit: the relay's tamper-evident hash chain captures the data_erasure_complete
    // message as it transits — that IS the audit entry. No local duplicate needed.

    const receipt = `BASTION-ERASURE-${result.erasureId}-${new Date().toISOString()}`;
    client.send(JSON.stringify({
      type: 'data_erasure_complete',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: IDENTITY,
      payload: {
        erasureId: result.erasureId,
        softDeleted: result.softDeleted,
        hardDeleteScheduledAt: result.hardDeleteScheduledAt,
        receipt,
      },
    }));

    console.log(`[✓] Soft delete complete: erasureId=${result.erasureId}, hard delete at ${result.hardDeleteScheduledAt}`);
    auditLogger.logEvent('data_erasure', 'human', 'data-eraser', { action: 'soft_delete' });
    return;
  }

  if (msg.type === 'data_erasure_cancel') {
    console.log('[←] Data erasure cancellation received');

    const active = dataEraser.getActiveErasure();
    if (!active) {
      client.send(JSON.stringify({
        type: 'error',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        payload: { code: 'BASTION-7005', message: 'No active erasure to cancel' },
      }));
      return;
    }

    dataEraser.cancelErasure();

    // Audit: relay chain captures the result message transit — no local duplicate needed.

    client.send(JSON.stringify({
      type: 'result',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: IDENTITY,
      payload: { taskId: msg.payload?.erasureId || active.erasureId, result: 'Erasure cancelled — all data restored', success: true },
    }));

    console.log(`[✓] Erasure cancelled: ${active.erasureId} — data restored`);
    return;
  }

  // ---------------------------------------------------------------------------
  // Dream Cycle — Layer 6 memory extraction
  // ---------------------------------------------------------------------------
  if (msg.type === 'dream_cycle_request') {
    const p = msg.payload || msg;
    const convId = p.conversationId || activeConversationId;
    console.log(`[←] Dream cycle requested for ${(convId || '').slice(0, 8)} (scope: ${p.scope || 'conversation'})`);

    if (!convId) {
      client.send(JSON.stringify({
        type: 'error', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
        payload: { code: 'BASTION-3001', message: 'No active conversation for dream cycle' },
      }));
      return;
    }

    // Select dream adapter (Opus)
    let dreamAdapter;
    try {
      const selection = adapterRegistry.selectAdapter('dream');
      dreamAdapter = selection.adapter;
      console.log(`[~] Dream cycle using ${dreamAdapter.activeModel} (${selection.reason})`);
    } catch (err) {
      client.send(JSON.stringify({
        type: 'error', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
        payload: { code: 'BASTION-6001', message: `No dream adapter available: ${err.message}` },
      }));
      return;
    }

    // Get transcript from ConversationStore
    const recentMessages = conversationStore.getRecentMessages(convId, 200);
    const transcript = recentMessages
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n');

    if (transcript.length === 0) {
      client.send(JSON.stringify({
        type: 'error', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
        payload: { code: 'BASTION-3001', message: 'No messages in conversation for dream cycle' },
      }));
      return;
    }

    // Get existing memories for dedup
    const existingMemories = memoryStore.getMemories(100, convId).map(m => m.content);
    const globalMemories = memoryStore.getMemories(100, null).map(m => m.content);
    const allExisting = [...new Set([...existingMemories, ...globalMemories])];

    // Run dream cycle (async)
    dreamCycleManager.runDreamCycle(convId, transcript, allExisting, dreamAdapter).then(result => {
      console.log(`[✓] Dream cycle complete: ${result.candidateCount} candidates, $${result.cost.toFixed(4)}, ${result.durationMs}ms`);

      // Track usage
      usageTracker.record({
        timestamp: new Date().toISOString(),
        adapterId: dreamAdapter.activeModel || 'unknown',
        adapterRole: 'dream',
        purpose: 'dream',
        conversationId: convId,
        inputTokens: result.tokensUsed.input,
        outputTokens: result.tokensUsed.output,
        costUsd: result.cost,
      });

      // Track cost in BudgetGuard
      budgetGuard.recordUsage(0, result.cost);
      sendUsageStatusDebounced();

      // Send all dream candidates as a single batch
      if (result.candidates.length > 0 && aiActionLimits.canBatch()) {
        aiActionLimits.recordBatch();
        const batchId = randomUUID();
        const proposals = result.candidates.map(c => ({
          proposalId: c.proposalId || randomUUID(),
          content: String(c.content || ''),
          category: ['fact', 'preference', 'workflow', 'project'].includes(c.category) ? c.category : 'fact',
          reason: String(c.reason || ''),
          isUpdate: Boolean(c.isUpdate),
          existingMemoryContent: c.existingMemoryContent ? String(c.existingMemoryContent) : null,
        }));
        sendSecure({
          type: 'ai_memory_proposal_batch',
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          sender: IDENTITY,
          payload: {
            batchId,
            source: 'dream_cycle',
            conversationId: convId || null,
            proposals,
          },
        });
        pendingBatches.set(batchId, {
          source: 'dream_cycle',
          conversationId: convId,
          proposals,
          sentAt: new Date().toISOString(),
        });
        console.log(`[→] Memory batch sent: ${proposals.length} proposals (batch ${batchId.slice(0, 8)})`);
      } else if (result.candidates.length > 0) {
        console.log(`[!] Batch rate-limited: ${result.candidates.length} dream proposals dropped (batch ${aiActionLimits.batchCount}/${aiActionLimits.maxBatchesPerSession})`);
        auditLogger.logMemory('batch_rate_limited', { count: result.candidates.length, batchCount: aiActionLimits.batchCount });
      }

      // Send dream_cycle_complete summary
      client.send(JSON.stringify({
        type: 'dream_cycle_complete',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        payload: {
          conversationId: convId,
          candidateCount: result.candidateCount,
          tokensUsed: result.tokensUsed,
          estimatedCost: result.cost,
          durationMs: result.durationMs,
        },
      }));
    }).catch(err => {
      console.error(`[!] Dream cycle failed: ${err.message}`);
      client.send(JSON.stringify({
        type: 'error', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
        payload: { code: 'BASTION-6001', message: `Dream cycle failed: ${err.message}` },
      }));
    });
    return;
  }

  // ---------------------------------------------------------------------------
  // Extension state request — human client queries extension state (M14)
  // ---------------------------------------------------------------------------
  if (msg.type === 'extension_state_request') {
    const namespace = msg.payload?.namespace;
    const state = extensionDispatcher.getState(namespace);
    sendSecure({
      type: 'extension_state_response',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: IDENTITY,
      payload: { namespace, state },
    });
    return;
  }

  // ---------------------------------------------------------------------------
  // Extension message dispatch — handles namespace:type messages
  // ---------------------------------------------------------------------------
  if (msg.type && typeof msg.type === 'string' && msg.type.includes(':')) {
    const handler = extensionDispatcher.getHandler(msg.type);
    if (handler) {
      // Resolve adapter hint from extension type metadata
      // Adapter hint from extension metadata (extensionRegistry lives on relay, not AI client)
      const adapterHint = 'default';
      const hintResult = adapterRegistry.resolveHint(adapterHint, 'game');

      const namespace = msg.type.split(':')[0];
      const extDataDir = `${EXTENSIONS_DATA}/${namespace}`;
      try { mkdirSync(extDataDir, { recursive: true }); } catch {}

      console.log(`[←] Extension: ${msg.type} (adapter: ${adapterHint}, namespace: ${namespace})`);

      try {
        await handler({
          message: msg,
          adapterId: hintResult?.providerId ?? null,
          adapterHint,
          adapterRegistry,
          conversationManager,
          conversationStore,
          memoryStore,
          usageTracker,
          budgetGuard,
          dateTimeManager,
          filePurgeManager,
          recallHandler,
          bastionBash,
          projectStore,
          skillStore,
          challengeManager,
          toolRegistry,
          send: (responseType, payload) => {
            sendSecure({
              type: responseType,
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              sender: IDENTITY,
              payload,
            });
          },
          pushState: (state) => {
            sendSecure({
              type: 'extension_state_update',
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              sender: IDENTITY,
              payload: { namespace, state },
            });
          },
          dataDir: extDataDir,
        });
        console.log(`[✓] Extension: ${msg.type} handled successfully`);
        auditLogger.logExtension(namespace, msg.type, true, {});
      } catch (err) {
        console.error(`[!] Extension handler error for ${msg.type}: ${err.message}`);
        auditLogger.logExtension(namespace, msg.type, false, { error: err.message });
        sendSecure({
          type: 'error',
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          sender: IDENTITY,
          payload: { code: 'BASTION-3006', message: `Extension handler failed: ${err.message}` },
        });
      }

      // Persist extension message in conversation store
      if (activeConversationId) {
        const content = JSON.stringify(msg.payload || {});
        conversationStore.addMessage(activeConversationId, 'user', msg.type, content);
      }
    } else {
      console.log(`[←] Extension message: ${msg.type} (no handler registered — forwarding silently)`);
    }
    return;
  }

  // Unhandled message types
  console.log(`[←] Unhandled message type: ${msg.type}`);
});

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

console.log('[...] Connecting to relay...');

try {
  await client.connect();
  console.log('[✓] Connection established');
} catch (err) {
  console.error(`[!] Connection failed: ${err.message}`);
  process.exit(1);
}
