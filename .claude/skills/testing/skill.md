---
name: testing
description: Testing patterns, verification rules, and the trace-test.mjs framework. Use when writing tests, debugging test failures, or verifying changes. Enforces console output suppression for expected-failure tests.
allowed-tools: Bash(pnpm test *) Bash(pnpm build *) Bash(pnpm lint *) Bash(node packages/*/trace-test.mjs) Bash(node packages/tests/*) Bash(git diff *) Bash(git status *)
effort: high
---

# Testing — Verification Patterns

## Testing Framework

Tests use `node:test` with the custom trace-test.mjs pattern. **NOT Vitest.**

```bash
# All tests (from monorepo root)
pnpm test

# Specific test file
node packages/relay/trace-test.mjs

# Build before testing (tests run against compiled output)
pnpm build && pnpm test
```

## Current Test Suite

**14 test files, 3,651+ tests.** This count grows — always verify the actual number.

```!
cd G:\Glorktelligence\Projects\Bastion && pnpm test 2>&1 | tail -5
```

## CRITICAL: Console Output Suppression for Expected Failures

**Tests that deliberately trigger violations, errors, or warnings MUST suppress console output.**

`node --test` treats ANY stderr output as a test failure indicator. Tests that trigger expected
console.warn/console.error (e.g., security violation escalation, quarantine failures, extension
loader errors) will FAIL on CI even though the behaviour is correct.

### The Pattern (MANDATORY for all expected-failure tests)

```javascript
// BEFORE triggering expected violations/errors:
const originalWarn = console.warn;
const originalError = console.error;
console.warn = () => {};   // Suppress expected warnings
console.error = () => {};  // Suppress expected errors

// Trigger the expected failure
skillsManager.reportViolation('test', 'unauthorized');
skillsManager.reportViolation('test', 'unauthorized');
skillsManager.reportViolation('test', 'unauthorized');

// IMMEDIATELY AFTER — restore console
console.warn = originalWarn;
console.error = originalError;

// Now assert on the results
check('violation count is 3', manager.violationCount === 3);
```

### Known Patterns That REQUIRE Suppression

| Component | Method | Output | Why |
|-----------|--------|--------|-----|
| SkillsManager | reportViolation() | `[!] SKILL REGISTRY VIOLATION` to stderr | Escalation warnings |
| PurgeManager | reportViolation() | `[!] PURGE VIOLATION` to stderr | Deletion violation warnings |
| ExtensionHandlerLoader | loadExtensionHandlers() | `Extension handler error` to stderr | Expected load failures |
| BastionBash | execute() | Various stderr from commands | Command execution errors |
| Safety Engine | evaluate() | Challenge/denial messages | Safety evaluation output |
| AuditLogger | logEvent() (degraded) | `[!] Audit chain degraded` to stderr | Storage failure fallback |

### Rule: If Your Test Triggers console.warn or console.error Deliberately

1. **Wrap the triggering code** in console suppression
2. **Restore immediately** after the trigger (before assertions)
3. **Never leave console suppressed** across test boundaries
4. **Comment why**: `// Suppress expected violation output (stderr breaks node --test)`

### Platform-Specific Test Guards

```javascript
// Symlink tests — only work on Linux
if (process.platform === 'linux') {
  // ... symlink traversal tests
}

// Tests requiring specific Node.js features
const nodeVersion = parseInt(process.versions.node);
if (nodeVersion >= 22) {
  // ... node:sqlite tests
}
```

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
