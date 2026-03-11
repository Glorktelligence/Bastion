# Protocol Design - Message Types & Schemas

**Read this before creating or modifying any message types.**

---

## Core Principle

Every message type is defined in `@bastion/protocol` FIRST. No other package defines message structures. Protocol is the single source of truth.

---

## Message Envelope

Every message shares this envelope:

```typescript
interface MessageEnvelope {
  id: string;              // UUID v4
  type: MessageType;       // Enum value
  timestamp: string;       // ISO 8601
  sender: string;          // Authenticated identity
  correlationId?: string;  // Links related messages in a thread
  protocolVersion: string; // e.g. "0.1.0"
  payload: unknown;        // Type-specific, validated by Zod schema
}
```

---

## Schema Validation (Zod)

Every message type has a corresponding Zod schema in `packages/protocol/src/schemas/`.

```typescript
// Example: Task message schema
import { z } from 'zod';

export const TaskPayloadSchema = z.object({
  action: z.string().min(1).max(500),
  target: z.string().min(1).max(200),
  parameters: z.record(z.unknown()).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']),
  constraints: z.array(z.string()).optional(),
});

export type TaskPayload = z.infer<typeof TaskPayloadSchema>;
```

### Validation Rules
- All inbound messages validated by relay before routing
- Messages failing validation are rejected with `BASTION-3001`
- Validation errors are logged as audit events
- **Never trust, always validate** — even messages from authenticated clients

---

## Adding a New Message Type

1. Add to `MessageType` enum in `packages/protocol/src/constants/message-types.ts`
2. Define payload interface in `packages/protocol/src/types/`
3. Create Zod schema in `packages/protocol/src/schemas/`
4. Add validation test in `tests/protocol/`
5. Update relay routing in `packages/relay/src/routing/message-router.ts`
6. Update relevant clients

**Order matters.** Protocol first, then relay, then clients.

---

## Message Categories

### Human → AI (via Relay)
`task`, `conversation`, `confirmation`

### AI → Human (via Relay)
`challenge`, `denial`, `status`, `result`, `conversation`, `file-offer`, `provider_status`, `budget_alert`

### Either → Relay
`session_end`, `reconnect`, `token_refresh`, `heartbeat`

### Relay → Either
`session_conflict`, `session_superseded`, `error`, `audit`

### Admin → AI (via Relay)
`config_update`

### AI → Admin (via Relay)
`config_ack`, `config_nack`

---

## Challenge Message Structure

Challenges are critical — they block execution. Structure:

```typescript
interface ChallengePayload {
  reason: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  layer: 1 | 2 | 3;
  triggeredFactors: string[];
  originalTaskId: string;
  suggestedAlternative: string;
}
```

The human responds with a `confirmation` referencing the challenge ID:

```typescript
interface ConfirmationPayload {
  decision: 'approve' | 'modify' | 'cancel';
  challengeId: string;
  modification?: string;  // If decision is 'modify'
}
```

---

## Error Message Structure

```typescript
interface ErrorPayload {
  code: string;        // BASTION-XXXX format
  name: string;        // Human-readable error name
  message: string;     // Description
  detail?: string;     // Additional context
  recoverable: boolean;
  suggestedAction?: string;
}
```

---

## Naming Conventions

- Message types: `snake_case` (e.g., `file_manifest`, `session_end`)
- Type interfaces: `PascalCase` + `Payload` suffix (e.g., `TaskPayload`)
- Schema exports: `PascalCase` + `Schema` suffix (e.g., `TaskPayloadSchema`)
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `MESSAGE_TYPES`)

---

## Checklist: New Message Type

```
□ Added to MessageType enum
□ Payload interface defined with JSDoc
□ Zod schema created
□ Validation test written
□ Relay routing updated
□ Relevant client(s) updated
□ Error cases documented
□ Added to protocol docs
```
