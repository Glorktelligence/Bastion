---
name: safety-engine
description: Three-layer safety evaluation engine — immutable boundaries, contextual challenges, completeness checks. Read before implementing or modifying any safety-related code.
user-invocable: false
---

# Safety Engine - Three-Layer Evaluation

**Read this before implementing or modifying any safety-related code.**

---

## Core Principle

Every task is guilty until proven safe. Default: deny.

---

## Five Immutable Boundaries

These operate at the same enforcement tier. None can be configured, weakened, or bypassed.

| Boundary | Enforcement | Cannot Be... |
|----------|------------|--------------|
| **MaliClaw Clause** | 13 identifiers + `/claw/i` regex, checked before allowlist | Removed, configured, or bypassed |
| **Safety Floors** | Floor values for all safety parameters | Lowered below factory defaults |
| **Budget Guard** | SQLite-persisted budget limits, tighten-only mid-month | Raised mid-month, loosened within 7-day cooldown |
| **Challenge Me More** | Temporal governance with server-side timezone | Loosened during active periods or within cooldown |
| **Dangerous Tool Blindness** | Destructive tools always per-call approval | Changed to session-scope, auto-approved, or parameter-visible before approval |

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
- **Reversibility**: Irreversible → always challenge (locked true, cannot be disabled)
- **Scope vs intent**: "tidy a folder" affecting entire filesystem → challenge
- **Pattern deviation**: Unusual target, time, or operation type → challenge
- **Time-of-day**: High-risk hours (00:00–06:00) → elevated scrutiny (1.5× weight, floor 1.2×)
- **Resource impact**: High CPU/memory/disk consumption → challenge with assessment
- **Cascading effects**: Deleting a dependency, modifying shared config → challenge

**Challenge Me More integration**: When temporal governance is active, Layer 2 thresholds are automatically tightened. Budget changes and schedule modifications are blocked entirely during active challenge periods.

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

| Parameter | Default | Floor (Minimum) | Locked? |
|-----------|---------|-----------------|---------|
| Challenge threshold | 0.6 | 0.6 | No (can tighten) |
| Denial threshold | 0.9 | 0.9 | No (can tighten) |
| Time scrutiny weight | 1.5× | 1.2× | No (can tighten) |
| Irreversible action | Always challenge | true | **Yes** |
| Pattern deviation sensitivity | Medium | Low (not Off) | No (can tighten) |
| File quarantine | Enabled | true | **Yes** |
| Grace period | 300s (5 min) | 120s (2 min) | No (can tighten) |
| Audit retention | 365 days | 90 days | No (can tighten) |
| High-risk hours | 00:00–06:00 | Cannot be disabled | — |

### Implementation Pattern

```typescript
function validateSettingChange(key, value, floor): SettingUpdateResult {
  if (value < floor) {
    return { ok: false, reason: 'Below safety floor' };
  }
  return { ok: true };
}
```

**Never** use a conditional that could bypass the floor check.

---

## Budget Guard (Immutable Enforcement)

Budget Guard operates at the same tier as MaliClaw — it cannot be weakened easily.

| Feature | Behaviour |
|---------|-----------|
| Tighten limits | Immediate effect |
| Loosen limits | Requires 7-day cooldown + takes effect next month |
| During challenge hours | Budget config changes BLOCKED entirely |
| Exhausted budget | AI denies new tasks (BASTION-8001) |
| Session/daily/monthly limits | All tracked independently in SQLite |

### Integration with ChallengeManager
- `challengeManager.checkAction('budget_change')` — blocked during active challenge periods
- `budgetGuard.checkCooldown()` — enforces 7-day cooldown on loosening
- `challengeManager.recordAction('budget_change')` — logs for cooldown tracking

### Budget Thresholds → Safety Actions
| Threshold | Action |
|-----------|--------|
| 50% | `budget_alert` (warning level) |
| 80% | `budget_alert` (urgent level) |
| 100% | `budget_alert` (exhausted) + automatic denial of new tasks |

---

## Challenge Me More (Temporal Governance)

Server-side timezone enforcement. AI VM clock is authoritative.

| Feature | Behaviour |
|---------|-----------|
| Active period | Budget/schedule changes BLOCKED, safety thresholds tightened |
| Cooldown (loosening) | 7-day cooldown on loosening any restriction |
| Tightening | Immediate effect, no cooldown |
| Status broadcast | `challenge_status` sent to human on connect and on change |
| Config updates | `challenge_config` (Human→AI) → `challenge_config_ack` (AI→Human) |

---

## Tool Registry

The AI can only invoke tools explicitly listed in its registry. The registry is:
- Managed by `ToolRegistryManager` on the AI VM
- Tools discovered from MCP providers via `McpClientAdapter`
- Trust levels: read-only (auto-approvable at session scope), write (per-call), destructive (per-call, parameter-blind)
- Session trust revocable at any time via `tool_revoke`
- Self-modification blocked

---

## Testing Safety Code

**Every safety change requires corresponding tests.** No exceptions.

Test categories:
- Layer 1: Verify denial for each category
- Layer 2: Verify challenge triggers for each factor
- Layer 3: Verify clarification requests
- Floors: Verify floors cannot be breached
- Budget: Verify threshold actions and cooldowns
- Challenge Me More: Verify temporal blocking
- Registry: Verify self-modification is blocked
- Immutable boundaries: Verify all 5 cannot be weakened

---

## Checklist: Safety Changes

```
□ Layer identified (1, 2, or 3)
□ Implementation follows layer's pattern
□ Floor constraints respected
□ Five immutable boundaries not violated
□ ChallengeManager integration checked (if governance feature)
□ Budget Guard integration checked (if cost-related)
□ Tests written for new behaviour
□ Tests verify floor cannot be lowered
□ Audit events logged
□ Error codes used correctly (BASTION-4XXX for safety, BASTION-8XXX for budget)
□ Documented in safety-engine.md
```
