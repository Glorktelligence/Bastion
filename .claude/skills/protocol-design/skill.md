# Protocol Design - Message Types & Schemas

**Read this before creating or modifying any message types.**

---

## Core Principle

Every message type is defined in `@bastion/protocol` FIRST. No other package defines message structures. Protocol is the single source of truth.

---

## Current State: 57 Message Types, 45 Error Codes

The protocol has grown significantly from the original 23 core types. Current categories:

| Category | Count | Direction |
|----------|-------|-----------|
| Core | 13 | Bidirectional |
| Supplementary | 10 | Various (session, config, status) |
| Audit | 2 | Human↔Relay |
| Provider/Context | 2 | Client→Relay, Human→AI |
| Memory | 6 | Human↔AI |
| Extensions | 2 | Client↔Relay |
| Project Context | 7 | Human↔AI |
| Tool Integration | 9 | AI↔Human |
| Challenge Me More | 3 | AI↔Human |
| Budget Guard | 2 | AI↔Human |
| E2E Key Exchange | 1 | Peer↔Peer |

---

## Message Envelope

Every message shares this envelope:

```typescript
interface MessageEnvelope<TPayload> {
  id: MessageId;           // UUID v4
  type: MessageType;       // One of 57 types
  timestamp: Timestamp;    // ISO 8601
  sender: SenderIdentity;  // { id, type: 'human'|'ai'|'relay', displayName }
  correlationId: CorrelationId;  // UUID v4 — links related messages
  version: string;         // Protocol version (e.g. "0.1.0")
  payload: TPayload;       // Type-specific, validated by Zod schema
}
```

For E2E encrypted messages, the envelope becomes:

```typescript
interface EncryptedEnvelope {
  // Same metadata fields (relay can read these)
  encryptedPayload: string;  // Base64-encoded ciphertext
  nonce: string;             // Base64-encoded nonce
}
```

---

## Schema Validation (Zod)

Every message type has a corresponding Zod schema in `packages/protocol/src/schemas/message.schema.ts`.

All 57 schemas are mapped in `PAYLOAD_SCHEMAS` for runtime lookup.

```typescript
import { z } from 'zod';

export const TaskPayloadSchema = z.object({
  taskId: TaskIdSchema,        // UUID v4
  action: z.string().min(1).max(500),
  target: z.string().min(1).max(200),
  parameters: z.record(z.unknown()).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']),
  constraints: z.array(z.string()).optional(),
});
```

### Validation Rules
- All inbound messages validated by relay before routing
- Messages failing validation are rejected with `BASTION-3001`
- Validation errors are logged as audit events
- **Never trust, always validate** — even messages from authenticated clients

---

## Adding a New Message Type

1. Add to `ALL_MESSAGE_TYPES` array in `packages/protocol/src/constants/message-types.ts`
2. Define payload interface in `packages/protocol/src/types/messages.ts`
3. Add Zod schema in `packages/protocol/src/schemas/message.schema.ts`
4. Add to `PAYLOAD_SCHEMAS` mapping
5. Add to `MessagePayload` discriminated union
6. Export from `packages/protocol/src/index.ts`
7. Add handler in `start-relay.mjs` (route, forward, or intercept)
8. Add handler in `start-ai-client.mjs` (if AI receives it)
9. Add handler in `packages/client-human/src/lib/session.ts` (if human receives it)
10. Add validation test

**Order matters.** Protocol first, then startup scripts, then client UI.

---

## Message Categories

### Human → AI (via Relay)
`task`, `conversation`, `confirmation`, `config_update`, `context_update`, `memory_proposal`, `memory_list`, `memory_update`, `memory_delete`, `project_sync`, `project_list`, `project_delete`, `project_config`, `tool_approved`, `tool_denied`, `tool_revoke`, `challenge_config`, `budget_config`

### AI → Human (via Relay)
`conversation`, `challenge`, `denial`, `status`, `result`, `provider_status`, `budget_alert`, `budget_status`, `challenge_status`, `challenge_config_ack`, `memory_decision`, `memory_list_response`, `project_sync_ack`, `project_list_response`, `project_config_ack`, `tool_registry_sync`, `tool_request`, `tool_result`, `tool_alert`

### Client → Relay (consumed by relay)
`session_init` (not in 57 — connection level), `provider_register`, `extension_query`, `audit_query`, `token_refresh`, `file_manifest` (intercepted), `file_request` (intercepted)

### Relay → Client (relay-generated)
`session_established`, `session_conflict`, `session_superseded`, `error`, `audit_response`, `extension_list_response`, `file_manifest` (metadata only), `file_offer` (metadata only), `file_data`

### Peer ↔ Peer (forwarded by relay)
`key_exchange`, `heartbeat`

---

## Protocol Extension System

Extensions add namespaced message types without modifying the core protocol.

### Extension Message Format
`namespace:type` — e.g., `weather:forecast`, `calendar:event`

### Rules
- Namespace must be lowercase, alphanumeric + hyphens
- Reserved namespaces: `bastion`, `core`, `system`, `admin`
- Extensions loaded from relay's `extensions/` directory (JSON files)
- Registry locked after startup — no mid-session registration
- Each extension declares: namespace, name, version, message types, safety level

### Safety Levels for Extension Messages
- `passthrough` — routed without special handling
- `task` — treated like a task (safety evaluation required)
- `admin` — requires admin authentication
- `blocked` — rejected outright

---

## Error Codes — 45 codes, 8 categories

| Range | Category | Count |
|-------|----------|-------|
| BASTION-1XXX | Connection | 7 |
| BASTION-2XXX | Authentication | 6 |
| BASTION-3XXX | Protocol | 6 |
| BASTION-4XXX | Safety | 6 |
| BASTION-5XXX | File Transfer | 7 |
| BASTION-6XXX | Provider | 6 |
| BASTION-7XXX | Configuration | 5 |
| BASTION-8XXX | Budget | 5 |

---

## Naming Conventions

- Message types: `snake_case` (e.g., `file_manifest`, `session_end`, `challenge_config_ack`)
- Type interfaces: `PascalCase` + `Payload` suffix (e.g., `TaskPayload`)
- Schema exports: `PascalCase` + `Schema` suffix (e.g., `TaskPayloadSchema`)
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `MESSAGE_TYPES`, `ALL_MESSAGE_TYPES`)

---

## Checklist: New Message Type

```
□ Added to ALL_MESSAGE_TYPES array
□ Payload interface defined with JSDoc
□ Zod schema created and added to PAYLOAD_SCHEMAS
□ Added to MessagePayload discriminated union
□ Exported from index.ts
□ Handler added to start-relay.mjs
□ Handler added to start-ai-client.mjs (if applicable)
□ Handler added to session.ts (if applicable)
□ Validation test written
□ Error cases documented
□ Added to protocol docs
```
