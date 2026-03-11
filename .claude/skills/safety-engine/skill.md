# Safety Engine - Three-Layer Evaluation

**Read this before implementing or modifying any safety-related code.**

---

## Core Principle

Every task is guilty until proven safe. Default: deny.

---

## The Three Layers

### Layer 1: Absolute Boundaries
**Result**: Immediate `denial` message. Non-negotiable. No override. No configuration.

Always deny:
- Destructive operations without explicit scope (`rm -rf`, `dd`, `mkfs`, unqualified deletes)
- Operations targeting systems outside AI VM permitted scope
- Privilege escalation (sudo config, user creation, chmod on restricted paths)
- Data exfiltration to external endpoints not explicitly whitelisted
- Safety floor modification attempts
- AI self-modification of tool registry

```typescript
// Layer 1 check returns: { allowed: false, reason: string } or { allowed: true }
// If denied: send denial message, log audit event, STOP.
```

### Layer 2: Contextual Evaluation
**Result**: `challenge` message. Blocks execution until human confirms.

Check these factors:
- **Reversibility**: Irreversible → always challenge
- **Scope vs intent**: "tidy a folder" affecting entire filesystem → challenge
- **Pattern deviation**: Unusual target, time, or operation type → challenge
- **Time-of-day**: High-risk hours (00:00–06:00) → elevated scrutiny (1.5x weight, floor 1.2x)
- **Resource impact**: High CPU/memory/disk consumption → challenge with assessment
- **Cascading effects**: Deleting a dependency, modifying shared config → challenge

```typescript
// Layer 2 returns: { challenge: true, factors: string[], risk: RiskLevel }
// If challenged: send challenge message, BLOCK execution, wait for confirmation
```

### Layer 3: Completeness & Clarity
**Result**: Switch to `conversation` mode. No block, but pause for clarification.

Check:
- Missing required parameters
- Ambiguous target references
- Conflicting constraints
- Insufficient context
- Logical inconsistencies

```typescript
// Layer 3 returns: { needsClarification: true, questions: string[] }
// If unclear: send conversation message asking for clarification, pause task
```

---

## Safety Floors

**CRITICAL**: Floors are immutable minimums. Code that allows lowering below the floor is a BUG.

| Parameter | Default | Floor (Minimum) |
|-----------|---------|-----------------|
| High-risk hours | 00:00–06:00 | Cannot be disabled |
| Time scrutiny weight | 1.5× | 1.2× minimum |
| Irreversible action | Always challenge | Locked |
| Pattern deviation sensitivity | Medium | Low (not Off) |
| File transfer quarantine | Enabled | Locked |
| Budget thresholds | 50/75/90/100% | Cannot be disabled |

### Implementation Pattern

```typescript
function applySetting(param: string, value: number, floor: number): number {
  if (value < floor) {
    // Log BASTION-7002 error
    // Return floor value, not requested value
    return floor;
  }
  return value;
}
```

**Never** use a conditional that could bypass the floor check.

---

## Budget as Safety

API costs are a safety concern (Harry is on a fixed income).

| Threshold | Action |
|-----------|--------|
| 50% | Informational status message |
| 75% | Persistent budget indicator in client |
| 90% | Automatic challenge on all new tasks |
| 100% | Automatic denial of new tasks |

Budget adjustment is admin-only. The human client CANNOT raise the budget. This prevents 3am hyperfocus spending.

---

## Tool Registry

The AI can only invoke tools explicitly listed in its registry. The registry is:
- A config file on the AI VM
- Loaded at startup
- Immutable by the AI itself (`registry-guard.ts` enforces this)
- Modifiable only by direct SSH or admin config message

Each tool entry defines: permitted hosts, blocked commands, challenge requirements, max execution time.

---

## Testing Safety Code

**Every safety change requires corresponding tests.** No exceptions.

Test categories:
- Layer 1: Verify denial for each category
- Layer 2: Verify challenge triggers for each factor
- Layer 3: Verify clarification requests
- Floors: Verify floors cannot be breached
- Budget: Verify threshold actions
- Registry: Verify self-modification is blocked

---

## Checklist: Safety Changes

```
□ Layer identified (1, 2, or 3)
□ Implementation follows layer's pattern
□ Floor constraints respected
□ Tests written for new behaviour
□ Tests verify floor cannot be lowered
□ Audit events logged
□ Error codes used correctly (BASTION-4XXX)
□ Documented in safety-engine.md
```
