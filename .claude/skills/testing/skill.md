# Testing - Verification Patterns

**Read this when writing or running tests.**

---

## Testing Framework

Vitest for all packages. Run from monorepo root or individual packages.

```bash
# All tests
pnpm test

# Specific package
pnpm --filter @bastion/protocol test

# Watch mode
pnpm --filter @bastion/relay test -- --watch
```

---

## What Must Be Tested

### Protocol Package (Critical)
- Every Zod schema validates correct input
- Every Zod schema rejects invalid input
- Serialisation round-trips preserve data
- Envelope structure is correct
- Error codes are unique and correctly formatted

### Safety Engine (Critical)
- Layer 1 denies every blocked category
- Layer 2 challenges every trigger factor
- Layer 3 catches every ambiguity type
- Safety floors CANNOT be lowered (test this explicitly)
- Budget thresholds trigger correct actions
- Tool registry blocks self-modification

### Relay (Critical)
- Message routing delivers to correct recipient
- Schema validation rejects malformed messages
- JWT validation rejects expired/invalid tokens
- Allowlist rejects unapproved providers
- MaliClaw Clause rejects blocked identifiers
- Audit log is append-only
- File quarantine hashes match at every stage

### Clients
- WebSocket connection handles reconnection
- Challenge UI blocks until response
- Offline drafts are NOT auto-sent
- Budget indicators appear at correct thresholds

---

## Test Structure

```typescript
import { describe, it, expect } from 'vitest';
import { TaskPayloadSchema } from '@bastion/protocol';

describe('TaskPayloadSchema', () => {
  it('validates correct task payload', () => {
    const valid = {
      action: 'Check SSL certificates',
      target: 'naval-app-01',
      priority: 'normal',
    };
    expect(TaskPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects missing action', () => {
    const invalid = { target: 'naval-app-01', priority: 'normal' };
    expect(TaskPayloadSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects invalid priority', () => {
    const invalid = {
      action: 'Check SSL',
      target: 'naval-app-01',
      priority: 'ULTRA',
    };
    expect(TaskPayloadSchema.safeParse(invalid).success).toBe(false);
  });
});
```

---

## Safety Floor Tests (Mandatory Pattern)

```typescript
describe('Safety Floors', () => {
  it('prevents lowering time scrutiny below 1.2x', () => {
    const config = createSafetyConfig();
    
    // Attempt to lower below floor
    const result = config.setTimeScrutiny(1.0);
    
    // Must remain at floor
    expect(result.value).toBe(1.2);
    expect(result.error).toBe('BASTION-7002');
  });

  it('allows tightening above default', () => {
    const config = createSafetyConfig();
    const result = config.setTimeScrutiny(2.0);
    expect(result.value).toBe(2.0);
  });

  it('prevents disabling high-risk hours entirely', () => {
    const config = createSafetyConfig();
    const result = config.setHighRiskHours(null);
    expect(result.error).toBe('BASTION-7002');
  });
});
```

---

## MaliClaw Clause Tests (Mandatory)

```typescript
describe('MaliClaw Clause', () => {
  it.each([
    'openclaw-client-v2',
    'ClawdBot',
    'MOLTBOT',
    'clawrouter-lite',
  ])('rejects %s', (clientId) => {
    expect(checkMaliClawClause(clientId)).toBe(false);
  });

  it('accepts legitimate clients', () => {
    expect(checkMaliClawClause('anthropic-claude-opus')).toBe(true);
    expect(checkMaliClawClause('bastion-human-client')).toBe(true);
  });

  it('cannot be disabled via configuration', () => {
    // This test verifies the clause is hardcoded
    // There should be no config option to disable it
    expect(typeof checkMaliClawClause).toBe('function');
    // No config parameter accepted
    expect(checkMaliClawClause.length).toBe(1); // Only clientId param
  });
});
```

---

## Integration Tests

Located in `tests/integration/`. Test full flows:

1. **Full message round-trip**: Human sends task → relay routes → AI receives
2. **Challenge cycle**: Task → challenge → confirmation → execution
3. **File transfer**: Upload → quarantine → manifest → request → deliver → verify hash
4. **Connection rejection**: Unapproved client → TLS rejection → audit log entry

---

## Before Marking "Tested"

```
□ Unit tests pass
□ Safety floor tests included
□ MaliClaw tests included
□ Error codes tested
□ Audit events verified
□ Edge cases covered
□ No skipped tests
```
