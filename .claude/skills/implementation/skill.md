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
- [ ] Schema added to PAYLOAD_SCHEMAS mapping
- [ ] Added to MessagePayload discriminated union
- [ ] Constants in correct location
- [ ] Export from package index
- [ ] Validation tests for schema

### Relay Feature
- [ ] Message handler in `start-relay.mjs` (not just library code)
- [ ] Full validation with correct BASTION-XXXX codes
- [ ] Audit logging for all actions
- [ ] Content scanning if accepting user content
- [ ] Rate limiting consideration
- [ ] Integration with existing routing

### AI Client Feature
- [ ] Message handler in `start-ai-client.mjs` (not just library code)
- [ ] Safety engine integration (correct layer)
- [ ] ChallengeManager check (if governance feature)
- [ ] Budget Guard check (if cost-related)
- [ ] Tool registry check (if tool-related)
- [ ] Transparency metadata included
- [ ] Error reporting to relay

### Human Client Feature
- [ ] Handler in `session.ts` (populate store, not silent consumption)
- [ ] Svelte store following factory pattern (writable + methods)
- [ ] UI component with loading, error, and empty states
- [ ] Subscription in Settings page or relevant route
- [ ] Toast notification for confirmations/errors
- [ ] Offline behaviour handled

---

## Startup Script Wiring (CRITICAL)

**Library code that isn't wired in a startup script doesn't run.** This was a recurring pattern during initial development — all instances are now resolved, but new features must follow this rule:

| Library Package | Wired In | What Must Be Done |
|----------------|----------|-------------------|
| @bastion/relay | `start-relay.mjs` | Instantiate class, add message handler, wire to router |
| @bastion/client-ai | `start-ai-client.mjs` | Instantiate class, add message handler, wire to client events |
| @bastion/client-human | `session.ts` | Add handler in `handleRelayMessage()`, update store, remove from silent block |

If you implement a feature as a class in a library package, you MUST also wire it in the appropriate startup script. Verify by tracing the code path: does a message arriving on the WebSocket actually reach your handler?

---

## Code Quality

### Error Handling

```typescript
// ✅ Complete — uses Bastion error codes
if (!hashCheck.valid) {
  relay.send(connId, JSON.stringify({
    type: 'error',
    code: 'BASTION-5001',
    message: `Hash verification failed: expected ${expected}, got ${actual}`,
    timestamp: new Date().toISOString(),
  }));
  auditLogger.logEvent('file_hash_mismatch', sid, { transferId, stage: 'submission' });
  return;
}
```

### Complete Validation

```typescript
// ✅ Every input validated with Zod
const TaskPayloadSchema = z.object({
  taskId: TaskIdSchema,
  action: z.string().min(1).max(500),
  target: z.string().min(1).max(200),
  priority: z.enum(['low', 'normal', 'high', 'critical']),
});
```

### Audit Everything

```typescript
// ✅ Every significant action logged
auditLogger.logEvent('file_submitted', sid, {
  transferId, filename, direction, sizeBytes,
  sender_hash: declaredHash, stage: 'submitted', actor: identity.id,
});
```

---

## Naming Conventions

| Area | Convention | Example |
|------|-----------|---------|
| Packages | `@bastion/kebab-case` | `@bastion/client-human` |
| Files | `kebab-case.ts` | `message-router.ts` |
| Svelte components | `PascalCase.svelte` | `ChallengeBanner.svelte` |
| Svelte stores | `kebab-case.ts` | `projects.ts`, `budget.ts` |
| Types | `PascalCase` | `TaskPayload`, `SafetyEvaluation` |
| Constants | `SCREAMING_SNAKE_CASE` | `MESSAGE_TYPES`, `SAFETY_FLOORS` |
| Functions | `camelCase` | `validateMessage()`, `encryptPayload()` |
| Store factories | `createXxxStore()` | `createProjectsStore()` |
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

## Import Order (enforced by Biome)

1. Node.js built-ins (`node:crypto`, `node:fs`)
2. External packages (`zod`, `jose`)
3. `@bastion/*` workspace packages
4. Relative imports (`../store.js`, `./config/config-store.js`)

Biome auto-fixes import ordering with `pnpm lint --write`.

---

## Before Marking Complete

```
□ Feature works end-to-end
□ Wired in startup script (not just library code)
□ Error cases handled with correct BASTION codes
□ Audit events logged
□ Safety implications considered (5 immutable boundaries checked)
□ Tests written and passing
□ pnpm lint --write applied
□ pnpm lint clean (0 issues)
□ Full 13-file test suite passes (2,854+ tests)
□ No placeholder code or TODO comments
□ Follows existing patterns
□ Apache 2.0 header present
```
