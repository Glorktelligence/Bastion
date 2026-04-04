# Testing - Verification Patterns

**Read this when writing or running tests.**

---

## Testing Framework

Tests use the `node:test` built-in module with a custom trace-test.mjs pattern. NOT Vitest.

```bash
# All tests (from monorepo root)
pnpm test

# Specific test file
node packages/relay/trace-test.mjs

# Build before testing (tests run against compiled output)
pnpm build && pnpm test
```

---

## Test Suite — 14 Files, 2,993 Tests

| # | File | Tests | Package | Scope |
|---|------|-------|---------|-------|
| 1 | packages/tests/trace-test.mjs | 266 | @bastion/protocol | Schema validation for all 85 message types |
| 2 | packages/tests/integration-test.mjs | 82 | Cross-package | Full message round-trip (human→relay→AI→relay→human) |
| 3 | packages/tests/file-transfer-integration-test.mjs | 105 | Cross-package | File transfer pipeline with quarantine + hash verification |
| 4 | packages/crypto/trace-test.mjs | 134 | @bastion/crypto | E2E encryption, key exchange, hashing, audit chain |
| 5 | packages/relay/trace-test.mjs | 353 | @bastion/relay | WebSocket server, routing, JWT, heartbeat, rate limiting |
| 6 | packages/relay/admin-trace-test.mjs | 312 | @bastion/relay | Admin API, auth, provider CRUD, live status |
| 7 | packages/relay/quarantine-trace-test.mjs | 105 | @bastion/relay | File quarantine, hash verifier, purge scheduler |
| 8 | packages/relay/file-transfer-trace-test.mjs | 96 | @bastion/relay | FileTransferRouter workflow (manifest/offer/request) |
| 9 | packages/client-ai/trace-test.mjs | 416 | @bastion/client-ai | Safety engine (3 layers), provider adapter, budget guard, challenge manager |
| 10 | packages/client-ai/file-handling-trace-test.mjs | 155 | @bastion/client-ai | IntakeDirectory, OutboundStaging, FilePurgeManager |
| 11 | packages/client-human/trace-test.mjs | 321 | @bastion/client-human | Connection, stores, services, crypto |
| 12 | packages/client-human-mobile/trace-test.mjs | 123 | @bastion/client-human-mobile | Mobile stores, connection, components |
| 13 | packages/relay-admin-ui/trace-test.mjs | 239 | @bastion/relay-admin-ui | Admin UI stores, data service, API client |

**All 14 files must pass before committing.** Expected: 2,993+ tests, 0 failures.

---

## What Must Be Tested

### Protocol Package (Critical)
- Every Zod schema validates correct input
- Every Zod schema rejects invalid input
- Serialisation round-trips preserve data
- Integrity hashes detect tampering
- All 48 error codes have valid BASTION-CXXX format
- All 85 message types have schemas

### Safety Engine (Critical)
- Layer 1 denies every blocked category
- Layer 2 challenges every trigger factor
- Layer 3 catches every ambiguity type
- Safety floors CANNOT be lowered (test this explicitly)
- Budget thresholds trigger correct actions and cooldowns
- Tool registry blocks self-modification
- Challenge Me More blocks budget changes during active periods

### Relay (Critical)
- Message routing delivers to correct recipient
- Schema validation rejects malformed messages
- JWT validation rejects expired/invalid tokens
- Allowlist rejects unapproved providers
- MaliClaw Clause rejects all 13 blocked identifiers + /claw/i regex
- Audit log is append-only with hash chain integrity
- File quarantine hashes match at every stage (3-stage custody chain)
- Content scanning blocks all 13 dangerous patterns in project_sync
- Admin API endpoints require authentication

### Clients
- WebSocket connection handles reconnection with exponential backoff
- Challenge UI blocks until response
- Budget indicators appear at correct thresholds
- E2E key exchange produces interoperable ciphers (browser ↔ Node.js)
- Stores follow writable + factory pattern correctly

---

## Test Structure (trace-test.mjs pattern)

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// --- Test Group ---
console.log('--- Test: Schema validation ---');
check('valid task accepted', validateMessage(validTask).valid);
check('invalid task rejected', !validateMessage(invalidTask).valid);

// --- Summary ---
console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

---

## Safety Floor Tests (Mandatory Pattern)

```javascript
check('prevents lowering challenge threshold below floor',
  settings.tryUpdate('challengeThreshold', 0.3).ok === false
);

check('allows tightening challenge threshold',
  settings.tryUpdate('challengeThreshold', 0.8).ok === true
);

check('irreversibleAlwaysChallenge is locked',
  settings.tryUpdate('irreversibleAlwaysChallenge', false).ok === false
);
```

---

## MaliClaw Clause Tests (Mandatory)

```javascript
// Must reject all 13 identifiers + any string containing 'claw'
for (const id of ['openclaw', 'ClawdBot', 'MOLTBOT', 'hiclaw', 'my-claw-bot']) {
  check(`rejects ${id}`, !allowlist.isAllowed(id));
}

// Must accept legitimate clients
check('accepts anthropic-claude', allowlist.isAllowed('anthropic-claude'));
```

---

## Budget Guard Tests

```javascript
check('budget exhausted blocks tasks', budgetGuard.checkBudget().blocked === true);
check('cooldown prevents loosening', budgetGuard.checkCooldown().allowed === false);
check('tightening takes immediate effect', budgetGuard.updateLimits({maxPerMonth: 100}).accepted === true);
check('challenge hours block budget changes', challengeManager.checkAction('budget_change').blocked === true);
```

---

## Content Scanning Tests

```javascript
// Must reject all dangerous patterns in project_sync content
check('rejects script tags', validateProjectSync({path: 'a.md', content: '<script>alert(1)</script>'}) !== null);
check('rejects __proto__ pollution', validateProjectSync({path: 'a.json', content: '{"__proto__": {}}'}) !== null);
check('accepts clean markdown', validateProjectSync({path: 'a.md', content: '# Hello'}) === null);
```

---

## Before Marking "Tested"

```
□ All 14 test files pass (2,993+ tests, 0 failures)
□ Safety floor tests included
□ MaliClaw tests included (all 13 identifiers + regex)
□ Error codes tested (BASTION-CXXX format)
□ Audit events verified
□ Edge cases covered
□ No skipped tests
□ pnpm lint clean
```
