import { randomUUID } from 'node:crypto';
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
  evaluateSafety,
  defaultSafetyConfig,
  createPatternHistory,
  generateSafetyResponse,
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
const toolRegistry = createToolRegistry();

const adapter = createAnthropicAdapter(keyManager, toolRegistry, {
  model: MODEL,
  maxTokens: MAX_TOKENS,
  // System prompt is assembled by ConversationManager (role context + user context).
  // The adapter's systemPrompt is used as fallback for executeTask calls.
  systemPrompt: ConversationManager.getRoleContext(),
});

console.log('[✓] Anthropic adapter initialised');

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
// Safety engine
// ---------------------------------------------------------------------------

const safetyConfig = defaultSafetyConfig();
const patternHistory = createPatternHistory();
console.log('[✓] Safety engine armed (3-layer evaluation)');

// ---------------------------------------------------------------------------
// Challenge Me More — temporal governance
// ---------------------------------------------------------------------------

const CHALLENGE_CONFIG_PATH = process.env.BASTION_CHALLENGE_CONFIG || '/var/lib/bastion-ai/challenge-config.json';
const challengeManager = new ChallengeManager(CHALLENGE_CONFIG_PATH);
console.log(`[✓] Challenge manager: ${challengeManager.enabled ? 'ENABLED' : 'disabled'} (tz: ${challengeManager.timezone}, active: ${challengeManager.isActive()})`);

// ---------------------------------------------------------------------------
// Tool registry + MCP adapters
// ---------------------------------------------------------------------------

const toolRegistry = new ToolRegistryManager();
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

  console.log('[★] Safety engine active — 3-layer evaluation armed');
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

  // Handle session_established — complete the auth handshake
  if (msg.type === 'session_established') {
    console.log(`[←] Session established (session: ${(msg.sessionId || '').slice(0, 8)})`);
    client.setToken(msg.jwt, msg.expiresAt);

    // Register as a governed provider
    const registerMsg = JSON.stringify({
      type: 'provider_register',
      payload: {
        providerId: PROVIDER_ID,
        providerName: PROVIDER_NAME,
        capabilities: {
          conversation: true,
          taskExecution: true,
          fileTransfer: false,
        },
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
    console.log(`[←] Challenge response: ${decision}`);
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
    const { proposalId, content, category, sourceMessageId } = p;
    console.log(`[←] Memory proposal: "${content.substring(0, 60)}..." (${category})`);

    // Store as pending — the AI confirms by saving and sending memory_decision back
    const memoryId = memoryStore.addMemory(content, category, sourceMessageId || 'unknown');
    console.log(`[✓] Memory saved: ${memoryId}`);

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

  // Handle memory_list — return all memories to human client
  if (msg.type === 'memory_list') {
    const category = msg.payload?.category;
    const memories = category ? memoryStore.getMemoriesByCategory(category) : memoryStore.getMemories();
    client.send(JSON.stringify({
      type: 'memory_list_response',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: IDENTITY,
      payload: {
        memories: memories.map(m => ({ id: m.id, content: m.content, category: m.category, createdAt: m.createdAt, updatedAt: m.updatedAt })),
        totalCount: memories.length,
      },
    }));
    console.log(`[→] Memory list: ${memories.length} memories`);
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

  // Handle file transfer messages — acknowledge but not yet implemented in runtime
  if (msg.type === 'file_manifest' || msg.type === 'file_offer' || msg.type === 'file_request') {
    console.log(`[←] File transfer message: ${msg.type} — file handling not yet wired in runtime`);
    // TODO: Wire to IntakeDirectory/OutboundStaging when file transfer is enabled
    return;
  }

  // Handle task messages — run through safety engine first
  if (msg.type === 'task') {
    const payload = msg.payload || msg;
    console.log(`[←] Task: ${payload.action} → ${payload.target} (priority: ${payload.priority})`);

    // Safety evaluation
    const safetyResult = evaluateSafety(payload, safetyConfig, patternHistory);
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
      const challengeMsg = JSON.stringify({
        type: 'challenge',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: IDENTITY,
        payload: safetyResponse.payload,
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

    console.log(`[←] ${senderName}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);

    // Add to conversation buffer
    conversationManager.addUserMessage(content);

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
    console.log('[~] Calling Anthropic API...');

    try {
      // Use the adapter's executeTask with conversation context
      const result = await adapter.executeTask({
        taskId: msg.id || randomUUID(),
        action: 'respond',
        target: content,
        priority: msg.type === 'task' ? ((msg.payload || msg).priority || 'normal') : 'normal',
        parameters: {
          _systemPrompt: conversationManager.getSystemPrompt(),
          _conversationHistory: conversationManager.getMessages(),
        },
        constraints: [],
      });

      if (result.ok) {
        const responseText = result.response.textContent;
        const cost = result.response.cost;

        // Add to conversation buffer
        conversationManager.addAssistantMessage(responseText);

        console.log(`[✓] API response (${result.response.usage.inputTokens}in/${result.response.usage.outputTokens}out, $${cost.estimatedCostUsd.toFixed(4)})`);
        console.log(`[→] Claude: ${responseText.substring(0, 100)}${responseText.length > 100 ? '...' : ''}`);

        // Send response back through the relay
        const responseMsg = JSON.stringify({
          type: 'conversation',
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          sender: IDENTITY,
          payload: { content: responseText },
        });

        const sent = client.send(responseMsg);
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
