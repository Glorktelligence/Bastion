import { randomUUID } from 'node:crypto';
import {
  BastionAiClient,
  createApiKeyManager,
  createToolRegistry,
  createAnthropicAdapter,
  ConversationManager,
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

if (!API_KEY) {
  console.error('[!] ANTHROPIC_API_KEY not set. Run with: node --env-file=.env start-ai-client.mjs');
  process.exit(1);
}

const IDENTITY = {
  type: 'ai',
  id: 'ai-client-001',
  displayName: 'Claude (Bastion)',
};

console.log('=== Project Bastion — AI Client ===');
console.log(`Relay: ${RELAY_URL}`);
console.log(`Model: claude-sonnet-4-20250514`);
console.log('');

// ---------------------------------------------------------------------------
// Anthropic adapter setup
// ---------------------------------------------------------------------------

const keyManager = createApiKeyManager(API_KEY);
const toolRegistry = createToolRegistry();

const adapter = createAnthropicAdapter(keyManager, toolRegistry, {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  systemPrompt:
    'You are Claude, a helpful AI assistant communicating through the Bastion secure messaging protocol. ' +
    'You are chatting with Harry. Respond naturally, helpfully, and concisely. ' +
    'The user message is conveyed in the Target field below — respond to its content directly.',
});

console.log('[✓] Anthropic adapter initialised');

// ---------------------------------------------------------------------------
// Conversation manager — session context + user context
// ---------------------------------------------------------------------------

const conversationManager = new ConversationManager({
  tokenBudget: parseInt(process.env.BASTION_TOKEN_BUDGET || '100000', 10),
  userContextPath: process.env.BASTION_USER_CONTEXT_PATH || '/var/lib/bastion-ai/user-context.md',
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
// Client setup
// ---------------------------------------------------------------------------

const client = new BastionAiClient({
  relayUrl: RELAY_URL,
  identity: IDENTITY,
  providerId: 'anthropic-prod',
  rejectUnauthorized: false, // self-signed cert on relay
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
    providerId: 'anthropic-prod',
    timestamp: new Date().toISOString(),
  });

  console.log('[→] Sending session_init...');
  client.send(sessionInit);
});

client.on('authenticated', (jwt, expiresAt) => {
  console.log(`[✓] Authenticated — JWT expires at ${expiresAt}`);
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
        providerId: 'anthropic-bastion',
        providerName: 'Anthropic (Bastion Official)',
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
