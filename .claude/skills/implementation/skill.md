# Implementation Standards

**Read this before writing any code.**

---

## Core Principle

Every piece of code is production-ready. Complete implementations only. Security is not optional.

---

## What "Complete" Means

### Protocol Package
- [ ] Type interface with JSDoc comments
- [ ] Zod schema for validation
- [ ] Constants in correct location
- [ ] Export from package index
- [ ] Unit tests for schemas

### Relay Feature
- [ ] Message handler with full validation
- [ ] Audit logging for all actions
- [ ] Error handling with correct BASTION-XXXX codes
- [ ] Rate limiting consideration
- [ ] Integration with existing routing

### AI Client Feature
- [ ] Safety engine integration (correct layer)
- [ ] Tool registry check
- [ ] Transparency metadata included
- [ ] Budget tracking updated
- [ ] Error reporting to relay

### Human Client Feature
- [ ] SvelteKit component with full UI
- [ ] Loading, error, and empty states
- [ ] WebSocket integration
- [ ] Offline behaviour handled
- [ ] Accessibility considered

---

## Code Quality

### Error Handling

```typescript
// ✅ Complete — uses Bastion error codes
async function routeMessage(envelope: MessageEnvelope): Promise<void> {
  const validation = MessageSchema.safeParse(envelope);
  
  if (!validation.success) {
    await auditLog.append({
      event: 'SCHEMA_VALIDATION_FAILED',
      detail: validation.error.message,
      level: 'warning',
    });
    throw new BastionError('BASTION-3001', 'Schema validation failed', {
      detail: validation.error.message,
      recoverable: false,
    });
  }
  
  // Route message...
}
```

### Complete Validation

```typescript
// ✅ Every input validated with Zod
const TaskPayloadSchema = z.object({
  action: z.string().min(1).max(500),
  target: z.string().min(1).max(200),
  priority: z.enum(['low', 'normal', 'high', 'critical']),
});
```

### Audit Everything

```typescript
// ✅ Every significant action logged
await auditLog.append({
  event: 'CHALLENGE_ISSUED',
  detail: `Layer 2: ${factors.join(', ')}`,
  level: 'warning',
  messageId: envelope.id,
  correlationId: envelope.correlationId,
});
```

---

## Naming Conventions

| Area | Convention | Example |
|------|-----------|---------|
| Packages | `@bastion/kebab-case` | `@bastion/client-human` |
| Files | `kebab-case.ts` | `message-router.ts` |
| Svelte components | `PascalCase.svelte` | `ChallengeBanner.svelte` |
| Types | `PascalCase` | `TaskMessage`, `SafetyEvaluation` |
| Constants | `SCREAMING_SNAKE_CASE` | `MESSAGE_TYPES`, `SAFETY_FLOORS` |
| Functions | `camelCase` | `validateMessage()`, `encryptPayload()` |
| Database tables | `snake_case` | `audit_entries` |
| Environment vars | `BASTION_SCREAMING_SNAKE` | `BASTION_RELAY_PORT` |

---

## File Headers

Every source file requires the Apache 2.0 header:

```typescript
// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms
```

---

## Import Order

1. Node.js built-ins
2. External packages
3. `@bastion/*` workspace packages
4. Relative imports

```typescript
import { createServer } from 'node:http';
import { z } from 'zod';
import { MessageEnvelope } from '@bastion/protocol';
import { encrypt } from '@bastion/crypto';
import { auditLog } from '../audit/audit-logger';
```

---

## Before Marking Complete

- [ ] Feature works end-to-end
- [ ] Error cases handled with correct BASTION codes
- [ ] Audit events logged
- [ ] Safety implications considered
- [ ] Tests written
- [ ] No placeholder code or TODO comments
- [ ] Follows existing patterns
- [ ] Apache 2.0 header present
