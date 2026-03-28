# How to Build a Bastion Adapter

This package is a **reference template** for community developers building AI provider adapters for Project Bastion.

## Quick Start

1. Copy this package to `packages/my-adapter/`
2. Rename `@bastion/adapter-template` to `@bastion/my-adapter` in `package.json`
3. Implement `executeTask()` with your provider's API
4. Set accurate pricing and capabilities
5. Register in `start-ai-client.mjs`

## The ProviderAdapter Interface

Every adapter must implement this interface (from `@bastion/protocol`):

```typescript
interface ProviderAdapter {
  readonly providerId: string;            // Unique ID (e.g., 'openai-gpt4')
  readonly providerName: string;          // Display name (e.g., 'OpenAI GPT-4')
  readonly supportedModels: string[];     // Models this adapter supports
  readonly activeModel: string;           // Currently selected model
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

This is the core method. Bastion sends a `TaskPayload`, you translate it to your provider's API format, make the call, and return an `AdapterResult`.

```typescript
async executeTask(task: TaskPayload, options?: AdapterOptions): Promise<AdapterResult> {
  // 1. Extract system prompt: task.parameters._systemPrompt
  // 2. Extract conversation history: task.parameters._conversationHistory
  // 3. Build your provider's request body
  // 4. Make the HTTP call
  // 5. Parse the response
  // 6. Calculate cost from token usage
  // 7. Return AdapterResult
}
```

The `_systemPrompt` and `_conversationHistory` are injected by Bastion's ConversationManager. Your adapter receives them as pre-built strings/arrays.

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
    inputPerMTok: 2.0,     // USD per million input tokens
    outputPerMTok: 10.0,   // USD per million output tokens
  };
}
```

Bastion uses this for budget tracking. Inaccurate pricing = inaccurate budget alerts.

### Step 6: Create Your Config

Copy `example-config.json` and fill in your provider's details. The config file is for documentation — actual API keys come from environment variables.

### Step 7: Environment Variables

**Never put API keys in config files.** Use environment variables:

```bash
# In your .env file
MY_PROVIDER_API_KEY=sk-your-key-here
```

Read it in your adapter:
```typescript
const apiKey = process.env.MY_PROVIDER_API_KEY;
```

### Step 8: Register in start-ai-client.mjs

```javascript
import { createMyAdapter } from './packages/my-adapter/dist/index.js';

const myAdapter = createMyAdapter({
  providerId: 'my-adapter',
  providerName: 'My Provider',
  model: 'my-model-v1',
  // ... config
});

adapterRegistry.registerAdapter(myAdapter, ['default', 'conversation', 'task']);
```

### Step 9: Test

```javascript
const connected = await myAdapter.testConnection();
console.log('Connection test:', connected ? 'PASS' : 'FAIL');
```

## AdapterResult Structure

```typescript
// Success
{ ok: true, response: {
    textContent: "The assistant's response text",
    stopReason: "end_turn",
    usage: { inputTokens: 500, outputTokens: 200 },
    cost: { inputTokens: 500, outputTokens: 200, estimatedCostUsd: 0.003 },
    model: "my-model-v1"
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
```

## Adapter Roles

When registering your adapter, declare what it's used for:

| Role | Meaning |
|---|---|
| `default` | Fallback for any operation |
| `conversation` | Used for chat messages |
| `task` | Used for task execution |
| `compaction` | Used for conversation summarisation (prefer cheap/fast) |
| `dream` | Used for background processing (future) |

A single adapter can have multiple roles. The AdapterRegistry routes operations to the correct adapter based on roles.

## Capabilities

Set these accurately — they affect what features are available:

```typescript
capabilities: {
  conversation: true,      // Can handle chat messages
  taskExecution: true,     // Can execute structured tasks
  fileTransfer: false,     // Can process file content
  streaming: false,        // Supports streaming responses (future)
  webSearch: false,        // Has built-in web search
  toolUse: false,          // Supports function/tool calling
  vision: false,           // Can process images
  maxContextTokens: 128000 // Maximum context window
}
```

## Security Notes

- API keys are **never** stored in config files or transmitted through the relay
- The adapter runs on the AI VM (isolated VLAN) — network access is controlled by firewall
- All API calls use HTTPS — the adapter handles TLS
- Bastion's safety engine evaluates tasks **before** they reach your adapter
- Your adapter should **never** bypass the safety engine
