import { randomUUID } from 'node:crypto';
import { ensureSodium } from './packages/crypto/dist/index.js';
import { createHash } from 'node:crypto';
import {
  BastionAiClient,
  createApiKeyManager,
  createToolRegistry,
  createAnthropicAdapter,
  ConversationManager,
  MemoryStore,
  ProjectStore,
  ToolRegistryManager,
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
} from './packages/client-ai/dist/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RELAY_URL = process.env.BASTION_RELAY_URL || 'wss://10.0.30.10:9443';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const AI_CLIENT_ID = process.env.BASTION_AI_CLIENT_ID || 'ai-client-001';
const AI_DISPLAY_NAME = process.env.BASTION_AI_DISPLAY_NAME || 'Claude (Bastion)';
const PROVIDER_ID = process.env.BASTION_PROVIDER_ID || 'anthropic-bastion';
const PROVIDER_NAME = process.env.BASTION_PROVIDER_NAME || 'Anthropic (Bastion Official)';
const MODEL = process.env.BASTION_MODEL || 'claude-sonnet-4-20250514';
const MAX_TOKENS = parseInt(process.env.BASTION_MAX_TOKENS || '4096', 10);
const TEMPERATURE = parseFloat(process.env.BASTION_TEMPERATURE || '1.0');
const API_ENDPOINT = process.env.BASTION_API_ENDPOINT || 'https://api.anthropic.com';
const API_VERSION = process.env.BASTION_API_VERSION || '2023-06-01';
const API_TIMEOUT = parseInt(process.env.BASTION_TIMEOUT || '120000', 10);
const PRICING_INPUT = parseFloat(process.env.BASTION_PRICING_INPUT || '3');
const PRICING_OUTPUT = parseFloat(process.env.BASTION_PRICING_OUTPUT || '15');
const STREAMING_ENABLED = process.env.BASTION_STREAMING !== 'false';
const COMPACTION_MODEL = process.env.BASTION_COMPACTION_MODEL || MODEL;
const COMPACTION_PRICING_INPUT = parseFloat(process.env.BASTION_COMPACTION_PRICING_INPUT || String(PRICING_INPUT));
const COMPACTION_PRICING_OUTPUT = parseFloat(process.env.BASTION_COMPACTION_PRICING_OUTPUT || String(PRICING_OUTPUT));
const REJECT_UNAUTHORIZED = process.env.BASTION_TLS_REJECT_UNAUTHORIZED !== 'false' ? false : true;
// Note: defaults to false (accept self-signed) — set BASTION_TLS_REJECT_UNAUTHORIZED=true for strict

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
console.log(`Model: ${MODEL}`);
console.log('');

// ---------------------------------------------------------------------------
// Anthropic adapter setup
// ---------------------------------------------------------------------------

const keyManager = createApiKeyManager(API_KEY);
const adapterToolRegistry = createToolRegistry();

const adapter = createAnthropicAdapter(keyManager, adapterToolRegistry, {
  providerId: PROVIDER_ID,
  providerName: PROVIDER_NAME,
  model: MODEL,
  maxTokens: MAX_TOKENS,
  temperature: TEMPERATURE,
  apiBaseUrl: API_ENDPOINT,
  apiVersion: API_VERSION,
  requestTimeoutMs: API_TIMEOUT,
  pricingInputPerMTok: PRICING_INPUT,
  pricingOutputPerMTok: PRICING_OUTPUT,
  supportedModels: [MODEL],
  systemPrompt: ConversationManager.getRoleContext(),
});

// Compaction adapter — uses cheaper model if configured
const usesSeparateCompaction = COMPACTION_MODEL !== MODEL;
const compactionAdapter = usesSeparateCompaction
  ? createAnthropicAdapter(keyManager, adapterToolRegistry, {
      providerId: `${PROVIDER_ID}-compaction`,
      providerName: `${PROVIDER_NAME} (Compaction)`,
      model: COMPACTION_MODEL,
      maxTokens: MAX_TOKENS,
      temperature: 0.3,
      apiBaseUrl: API_ENDPOINT,
      apiVersion: API_VERSION,
      requestTimeoutMs: API_TIMEOUT,
      pricingInputPerMTok: COMPACTION_PRICING_INPUT,
      pricingOutputPerMTok: COMPACTION_PRICING_OUTPUT,
      supportedModels: [COMPACTION_MODEL],
      systemPrompt: ConversationManager.getCoreContext() + '\n\nYou are summarising a conversation. Produce concise, structured notes.',
    })
  : adapter;

// Adapter registry — routes operations to the appropriate adapter
const adapterRegistry = new AdapterRegistry();
adapterRegistry.registerAdapter(adapter, ['default', 'conversation', 'task']);
if (usesSeparateCompaction) {
  adapterRegistry.registerAdapter(compactionAdapter, ['compaction']);
}
adapterRegistry.lock();

const registeredAdapters = adapterRegistry.list();
console.log(`[✓] Adapter registry: ${registeredAdapters.length} adapter${registeredAdapters.length !== 1 ? 's' : ''} registered`);
for (const ra of registeredAdapters) {
  console.log(`    → ${ra.adapter.providerId} [${ra.adapter.activeModel}] (${ra.roles.join(', ')})`);
}
console.log('[✓] Adapter registry locked');

// ---------------------------------------------------------------------------
// Memory store — persistent Layer 2 memory
// ---------------------------------------------------------------------------

const MEMORIES_DB = process.env.BASTION_MEMORIES_DB || '/var/lib/bastion-ai/memories.db';
const memoryStore = new MemoryStore({ path: MEMORIES_DB, maxPromptMemories: 20 });
console.log(`[✓] Memory store initialised (${memoryStore.count} memories, db: ${MEMORIES_DB})`);

// Pending memory proposals (proposalId → {content, category, source})
const pendingProposals = new Map();

// ---------------------------------------------------------------------------
// Project store — Layer 3 project context
// ---------------------------------------------------------------------------

const PROJECT_DIR = process.env.BASTION_PROJECT_DIR || '/var/lib/bastion-ai/project';
const projectStore = new ProjectStore({ rootDir: PROJECT_DIR });
console.log(`[✓] Project store initialised (${projectStore.fileCount} files, dir: ${PROJECT_DIR})`);

// ---------------------------------------------------------------------------
// Conversation manager — session context + user context + memories + project
// ---------------------------------------------------------------------------

const conversationManager = new ConversationManager({
  tokenBudget: parseInt(process.env.BASTION_TOKEN_BUDGET || '100000', 10),
  userContextPath: process.env.BASTION_USER_CONTEXT_PATH || '/var/lib/bastion-ai/user-context.md',
  memoryStore,
  projectStore,
});
console.log(`[✓] Conversation manager initialised (budget: ${conversationManager.estimateTokenCount() || 0} base tokens)`);
if (conversationManager.getUserContext()) {
  console.log(`[✓] User context loaded (${conversationManager.getUserContext().length} chars)`);
}

// ---------------------------------------------------------------------------
// Conversation store — multi-conversation persistence (SQLite)
// ---------------------------------------------------------------------------

const CONVERSATIONS_DB = process.env.BASTION_CONVERSATIONS_DB || '/var/lib/bastion-ai/conversations.db';
const conversationStore = new ConversationStore({ path: CONVERSATIONS_DB });

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

const compactionManager = new CompactionManager(conversationStore, {
  conversationBudget: parseInt(process.env.BASTION_CONVERSATION_BUDGET || '80000', 10),
  triggerPercent: 80,
  keepRecent: 50,
});
console.log('[✓] Compaction manager initialised (budget: 80k tokens, trigger: 80%)');

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
      return { ok: true, text: result.response.textContent };
    }
    return { ok: false, text: '', error: result.message };
  } catch (err) {
    return { ok: false, text: '', error: err.message };
  }
}

/** Persist a message to the active conversation + auto-compact check. */
function persistMessage(role, type, content) {
  if (activeConversationId) {
    conversationStore.addMessage(activeConversationId, role, type, content);

    // Auto-compact check (non-blocking)
    const check = compactionManager.shouldCompact(activeConversationId);
    if (check.needed) {
      compactionManager.compact(activeConversationId, summariseForCompaction).then(result => {
        if (result.success && result.messagesCovered > 0) {
          console.log(`[✓] Auto-compacted: ${result.messagesCovered} messages, ~${result.tokensSaved} tokens saved`);
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
        console.error(`[!] Auto-compaction failed: ${err.message}`);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// File handling — intake directory, outbound staging, purge manager
// ---------------------------------------------------------------------------

const intakeDirectory = new IntakeDirectory({ maxFiles: 50 });
console.log('[✓] Intake directory initialised (read-only, max: 50 files)');

const outboundStaging = new OutboundStaging({ maxFiles: 50 });
console.log('[✓] Outbound staging initialised (write-only, max: 50 files)');

const filePurgeManager = new FilePurgeManager(intakeDirectory, outboundStaging, {
  defaultTimeoutMs: 3_600_000, // 1 hour
  checkIntervalMs: 30_000,     // 30 seconds
  onPurge: (result) => {
    console.log(`[~] File purge: task ${result.taskId.slice(0, 8)} — ${result.totalPurged} files (${result.reason})`);
  },
});
filePurgeManager.start();
console.log('[✓] File purge manager started (timeout: 1h, check: 30s)');

/** Pending file acceptances — transferId → metadata from file_manifest. */
const pendingFileAcceptances = new Map();

/** Track which tasks have been registered with purge manager. */
const registeredPurgeTasks = new Set();

// ---------------------------------------------------------------------------
// Safety engine
// ---------------------------------------------------------------------------

const safetyConfig = defaultSafetyConfig();
const patternHistory = createPatternHistory();
/** Pending challenges — correlationId → { issuedAt, waitSeconds } for wait timer enforcement. */
const pendingChallenges = new Map();
console.log('[✓] Safety engine armed (3-layer evaluation)');

// ---------------------------------------------------------------------------
// Challenge Me More — temporal governance
// ---------------------------------------------------------------------------

const CHALLENGE_CONFIG_PATH = process.env.BASTION_CHALLENGE_CONFIG || '/var/lib/bastion-ai/challenge-config.json';
const challengeManager = new ChallengeManager(CHALLENGE_CONFIG_PATH);
console.log(`[✓] Challenge manager: ${challengeManager.enabled ? 'ENABLED' : 'disabled'} (tz: ${challengeManager.timezone}, active: ${challengeManager.isActive()})`);

// ---------------------------------------------------------------------------
// Budget Guard — immutable enforcement (same tier as MaliClaw)
// ---------------------------------------------------------------------------

const BUDGET_DB = process.env.BASTION_BUDGET_DB || '/var/lib/bastion-ai/budget.db';
const BUDGET_CONFIG_PATH = process.env.BASTION_BUDGET_CONFIG || '/var/lib/bastion-ai/budget-config.json';
const budgetGuard = new BudgetGuard({
  dbPath: BUDGET_DB,
  configPath: BUDGET_CONFIG_PATH,
  timezone: challengeManager.timezone,
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

/** Messages that must stay plaintext — relay or pre-key-exchange control messages. */
const PLAINTEXT_TYPES = new Set([
  'session_init', 'session_established', 'key_exchange', 'token_refresh',
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

const toolRegistry = new ToolRegistryManager();
// Sync tool trust scope to the active conversation
toolRegistry.setActiveConversation(activeConversationId);
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

  // Connect to MCP providers
  await connectMcpProviders();

  // Send challenge status to human
  const challengeStatus = challengeManager.getStatus();
  client.send(JSON.stringify({
    type: 'challenge_status',
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sender: IDENTITY,
    payload: challengeStatus,
  }));
  if (challengeStatus.active) console.log(`[🛡️] Challenge hours ACTIVE until ${challengeStatus.periodEnd}`);

  // Send budget status to human
  budgetGuard.resetSession();
  sendBudgetStatus();

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
        model: adapter.activeModel,
        capabilities: adapter.capabilities,
        adapters: adapterRegistry.list().map(ra => ({
          id: ra.adapter.providerId,
          name: ra.adapter.providerName,
          model: ra.adapter.activeModel,
          roles: ra.roles,
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

    // Server-side wait timer enforcement
    if (correlationId && pendingChallenges.has(correlationId)) {
      const challenge = pendingChallenges.get(correlationId);
      const elapsedMs = Date.now() - challenge.issuedAt;
      const requiredMs = challenge.waitSeconds * 1000;
      if (elapsedMs < requiredMs && decision !== 'cancel') {
        const remainingSec = Math.ceil((requiredMs - elapsedMs) / 1000);
        console.log(`[!] Challenge response TOO EARLY: ${elapsedMs}ms elapsed, ${requiredMs}ms required — REJECTED`);
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
    client.send(JSON.stringify({
      type: 'config_ack', id: randomUUID(), timestamp: new Date().toISOString(), sender: IDENTITY,
      payload: { configType: 'budget_config', accepted: result.accepted, reason: result.reason, pendingNextMonth: result.pendingNextMonth },
    }));

    // Send updated budget status
    sendBudgetStatus();
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
    return;
  }

  // Handle tool_revoke — human revoked session trust
  if (msg.type === 'tool_revoke') {
    const p = msg.payload || msg;
    toolRegistry.revokeTrust(p.toolId);
    console.log(`[✗] Tool trust revoked: ${p.toolId} — ${p.reason}`);
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

  // Handle context_update — update user context file
  if (msg.type === 'context_update') {
    const content = msg.payload?.content ?? msg.content ?? '';
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

    // Safety evaluation
    const safetyResult = evaluateSafety(payload, { config: safetyConfig, history: patternHistory });
    const safetyResponse = generateSafetyResponse(payload, safetyResult);

    if (safetyResponse.type === 'denial') {
      console.log(`[✗] DENIED by Layer ${safetyResult.decidingLayer}: ${safetyResponse.payload.reason}`);
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
    // For task messages, fall through to API call below
  }

  // Handle conversation messages — call Anthropic API
  if (msg.type === 'conversation' || msg.type === 'task') {
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
          _systemPrompt: conversationManager.getSystemPrompt(activeConversationId),
          _conversationHistory: conversationManager.getMessages(),
        },
        constraints: [],
      }, STREAMING_ENABLED ? { streaming: true, onChunk } : undefined);

      if (result.ok) {
        const responseText = result.response.textContent;
        const cost = result.response.cost;

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

        // Add to conversation buffer and persist
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
