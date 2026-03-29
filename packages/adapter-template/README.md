# How to Build a Bastion Adapter

This package is a **reference template** for community developers building AI provider adapters for Project Bastion.

> **Adapters run ONLY on the AI VM.** The relay and human client need **zero changes** for a new adapter. Your adapter is a plugin for `start-ai-client.mjs` — the AI client startup script on the isolated VM. The relay routes encrypted messages without knowing which provider is behind them. The human client displays whatever provider metadata the relay forwards.

## Architecture — Where Your Adapter Fits

```
Human Client  ←→  Relay  ←→  AI Client (your adapter runs HERE)
                                │
                                ├── start-ai-client.mjs  ← you edit this to register your adapter
                                ├── AdapterRegistry       ← routes operations to adapters by role
                                ├── SafetyEngine           ← evaluates tasks BEFORE they reach your adapter
                                └── YourAdapter            ← translates Bastion → your provider's API
```

**Registration flow:**
1. You register your adapter in `start-ai-client.mjs` with the `AdapterRegistry`
2. On startup, the AI client sends `provider_register` to the relay with your adapter's metadata
3. The relay approves the provider and forwards `provider_status` to the human client
4. The human client displays your provider name, model, and capabilities in the UI
5. **You do not modify the relay or human client.** They work with any adapter automatically.

## Quick Start

1. Copy this package to `packages/my-adapter/`
2. Rename `@bastion/adapter-template` to `@bastion/my-adapter` in `package.json`
3. Implement `executeTask()` with your provider's API
4. Set accurate pricing and capabilities
5. Edit `start-ai-client.mjs` to import and register your adapter
6. Deploy to the AI VM

## What Your Adapter Does (and Doesn't Do)

Your adapter is a **translator**. It receives a fully assembled prompt and returns a response. Everything upstream is handled for you:

| Responsibility | Handled by | Your adapter's role |
|---|---|---|
| System prompt (role context, memories, user context, project files) | ConversationManager | **Receives** it in `task.parameters._systemPrompt` |
| Conversation history (trimmed to token budget) | ConversationManager | **Receives** it in `task.parameters._conversationHistory` |
| Safety evaluation (3-layer engine) | SafetyEngine | Runs **before** your adapter is called |
| Budget tracking | Budget Guard | Uses your `getModelPricing()` for cost calculation |
| Conversation state, message storage | ConversationManager + SQLite | Not your concern |
| Memory persistence | MemoryStore | Not your concern |

**The two "magic" parameters in `task.parameters`:**

| Parameter | Type | Description |
|---|---|---|
| `_systemPrompt` | `string` | The full assembled system prompt. Includes immutable role context, persistent memories, user context, and project files. Your adapter sends this as the system message. |
| `_conversationHistory` | `Array<{ role: string; content: string }>` | The conversation message buffer, already trimmed to token budget. Your adapter sends these as the messages array. If absent, format the task itself as a single user message. |

These are the **only** magic parameters. Per-call overrides (model, temperature, maxTokens, streaming) come via the `options` argument to `executeTask()`, not `task.parameters`.

## The ProviderAdapter Interface

Every adapter must implement this interface (from `@bastion/protocol`):

```typescript
interface ProviderAdapter {
  readonly providerId: string;              // Unique ID (e.g., 'openai-gpt4')
  readonly providerName: string;            // Display name (e.g., 'OpenAI GPT-4')
  readonly supportedModels: readonly string[]; // Models this adapter supports
  readonly activeModel: string;             // Currently selected model
  readonly capabilities: AdapterCapabilities;

  executeTask(task: TaskPayload, options?: AdapterOptions): Promise<AdapterResult>;
  testConnection(): Promise<boolean>;
  getModelPricing(model?: string): ModelPricing;
}
```

## Step-by-Step Guide

### Step 1: Copy the Template

```bash
cp -r packages/adapter-template packages/my-adapter
```

Update `package.json` with your adapter name and dependencies.

### Step 2: Implement executeTask()

This is the core method. The ConversationManager has already assembled the system prompt and conversation history (see "What Your Adapter Does" above). Your adapter extracts them, formats for your provider's API, and returns an `AdapterResult`.

```typescript
async executeTask(task: TaskPayload, options?: AdapterOptions): Promise<AdapterResult> {
  // 1. Extract system prompt: task.parameters._systemPrompt (pre-assembled by ConversationManager)
  // 2. Extract conversation history: task.parameters._conversationHistory (trimmed to token budget)
  // 3. Format both for your provider's API (system prompt handling varies by provider)
  // 4. Apply per-call overrides from options (model, temperature, maxTokens)
  // 5. Make the HTTP call to your provider
  // 6. Parse the response — extract text, token usage, stop reason
  // 7. Calculate cost from token usage and your pricing
  // 8. Return AdapterResult
}
```

**Your adapter does NOT build the system prompt or manage conversation state.** It receives these fully assembled and just translates them into your provider's request format. See `template-adapter.ts` for the exact extraction pattern.

### Step 3: Handle Tool Formatting

If your provider supports tools/function calling, convert Bastion's tool format to your provider's format in the request body. Different providers use different schemas:

- **OpenAI**: `tools: [{ type: 'function', function: { name, description, parameters } }]`
- **Anthropic**: `tools: [{ name, description, input_schema }]`
- **Others**: Check your provider's documentation

If your provider doesn't support tools, set `capabilities.toolUse = false`.

### Step 4: Map Errors to BASTION Codes

All errors must be returned as `AdapterResult` with a BASTION error code:

| HTTP Status | BASTION Code | Meaning | Retryable |
|---|---|---|---|
| 401, 403 | BASTION-6002 | Auth failed (bad API key) | No |
| 429 | BASTION-6003 | Rate limited | Yes |
| 402 | BASTION-6004 | Quota/billing exceeded | No |
| Timeout | BASTION-6005 | Request timed out | Yes |
| 5xx | BASTION-6001 | Server unavailable | Yes |
| Other | BASTION-6006 | Generic provider error | No |

Never throw exceptions from `executeTask()` — always return an `AdapterResult`.

### Step 5: Set Accurate Pricing

```typescript
getModelPricing(model?: string): ModelPricing {
  return {
    inputPerMTok: 2.0,       // USD per million input tokens
    outputPerMTok: 10.0,     // USD per million output tokens
    searchPerRequest: 0.01,  // USD per web search (optional — omit if not applicable)
  };
}
```

Bastion uses this for Budget Guard tracking. Inaccurate pricing = inaccurate budget alerts.

### Step 6: Create Your Config

Copy `example-config.json` and fill in your provider's details. The config file is for documentation — actual API keys come from environment variables.

### Step 7: Environment Variables

**Never put API keys in config files.** Use environment variables:

```bash
# In your .env file on the AI VM
MY_PROVIDER_API_KEY=sk-your-key-here
```

Read it in your adapter:
```typescript
const apiKey = process.env.MY_PROVIDER_API_KEY;
```

### Step 8: Register in start-ai-client.mjs

There is no plugin loading system. You **must edit `start-ai-client.mjs` directly** to import and register your adapter. This is by design — the AI VM startup is a controlled, auditable process.

Add your adapter alongside the existing Anthropic adapter:

```javascript
// At the top of start-ai-client.mjs — import your adapter factory
import { createMyAdapter } from './packages/my-adapter/dist/index.js';

// After the existing adapter creation — create your adapter instance
const myAdapter = createMyAdapter({
  providerId: 'my-provider',
  providerName: 'My Provider',
  model: 'my-model-v1',
  maxTokens: 4096,
  apiBaseUrl: 'https://api.my-provider.com/v1',
  apiKey: process.env.MY_PROVIDER_API_KEY,
  pricingInputPerMTok: 2.0,
  pricingOutputPerMTok: 10.0,
});

// Register with the AdapterRegistry — declare which roles this adapter serves
adapterRegistry.registerAdapter(myAdapter, ['default', 'conversation', 'task']);

// The registry is locked after all adapters are registered — no runtime additions
adapterRegistry.lock();
```

The `adapterRegistry.selectAdapter(operation, preferredAdapterId)` method routes operations to the correct adapter based on roles and per-conversation preferences.

### Step 9: Test

```javascript
const connected = await myAdapter.testConnection();
console.log('Connection test:', connected ? 'PASS' : 'FAIL');
```

## AdapterResult Structure

```typescript
// Success
{
  ok: true,
  response: {
    textContent: "The assistant's response text",
    stopReason: "end_turn",
    usage: { inputTokens: 500, outputTokens: 200 },
    cost: { inputTokens: 500, outputTokens: 200, estimatedCostUsd: 0.003 },
    model: "my-model-v1",
    toolCalls: [],          // Optional — tool invocations if toolUse is enabled
    rejectedToolCalls: [],  // Optional — tools the adapter refused to call
  }
}

// Failure
{ ok: false, errorCode: "BASTION-6002", message: "API key rejected", retryable: false }
```

## AdapterOptions (Per-Call Overrides)

```typescript
// Override model for a specific call
adapter.executeTask(task, { model: 'my-cheaper-model' });

// Override temperature
adapter.executeTask(task, { temperature: 0.3 });

// Override max tokens
adapter.executeTask(task, { maxTokens: 2048 });

// Enable streaming (if your adapter supports it)
adapter.executeTask(task, { streaming: true });
```

## Adapter Roles

When registering your adapter, declare what it's used for:

| Role | Meaning |
|---|---|
| `default` | Fallback for any operation |
| `conversation` | Used for chat messages |
| `task` | Used for task execution |
| `compaction` | Used for conversation summarisation (prefer cheap/fast models) |
| `dream` | Used for background processing (future) |

A single adapter can have multiple roles. The AdapterRegistry routes operations to the correct adapter based on roles. You can register multiple adapters with different roles — e.g., a powerful model for `conversation`/`task` and a cheap model for `compaction`.

## Capabilities

Set these accurately — they affect what features are available:

```typescript
capabilities: {
  conversation: true,      // Can handle chat messages
  taskExecution: true,     // Can execute structured tasks
  fileTransfer: false,     // Can process file content
  streaming: false,        // Supports streaming responses (set true if your provider supports SSE)
  webSearch: false,        // Has built-in web search
  toolUse: false,          // Supports function/tool calling
  vision: false,           // Can process images
  maxContextTokens: 128000 // Maximum context window
}
```

## Security Notes

- **Adapters run exclusively on the AI VM** — an isolated VLAN with firewall-controlled network access. They never run on the relay or human client.
- API keys are **never** stored in config files or transmitted through the relay. Keys stay on the AI VM and are read from environment variables.
- All API calls use HTTPS — the adapter handles TLS directly to the provider.
- Bastion's three-layer safety engine evaluates tasks **before** they reach your adapter. Your adapter should **never** bypass the safety engine.
- The relay and human client require **no modifications** for a new adapter. The relay forwards encrypted envelopes without knowing which provider is behind them.
