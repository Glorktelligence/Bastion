# Security Audit — Project Bastion

**Date**: 2026-03-31
**Auditors**: Harry Smith, Claude (Opus 4.6)
**Scope**: Full security audit of messaging flow, immutable boundaries, AI self-permission, file quarantine, and safety floors
**Commit**: 3635848 (main)
**Status**: Audit only — no fixes applied

---

## Severity Key

| Level | Meaning |
|-------|---------|
| **CRITICAL** | Active security bypass or data loss in production path |
| **HIGH** | Boundary enforcement missing or bypassable |
| **MEDIUM** | Defense-in-depth gap, exploitable under specific conditions |
| **LOW** | Minor inconsistency, unlikely to be exploitable |
| **INFO** | Observation, no security impact |

---

## AUDIT 1: Message Flow End-to-End (CRITICAL — Messaging Is Broken)

### Claim
A message sent through Bastion returns HTTP 400 from Anthropic: `messages.0: user messages must have non-empty content`.

### Findings

#### Stage 1: Human Client — Content Is Present ✅
- **`packages/client-human/src/routes/+page.svelte:112-118`** — Constructs envelope with `payload: { content: text }`. Content is correctly nested.
- **Verdict**: CORRECT

#### Stage 2: sendSecure() — Content Is Encrypted ✅
- **`packages/client-human/src/lib/session.ts:341`** — Encrypts `JSON.stringify(envelope.payload ?? {})`, which serializes `{ content: "user's text" }`.
- **`packages/client-human/src/lib/crypto/browser-crypto.ts:23`** — Uses `btoa(String.fromCharCode(...bytes))` for base64 encoding (standard base64 with `+`, `/`, `=`).
- Wire format: `{ id, type, timestamp, sender, encryptedPayload: "<base64>", nonce: "<base64>" }` — no `payload` field.
- **Verdict**: CORRECT

#### Stage 3: Relay — Transparent Forwarding ✅
- **`start-relay.mjs:1121`** — Default forwarder sends raw WebSocket data unmodified. No decryption.
- **Verdict**: CORRECT

#### Stage 4: AI Client — Decryption (BUG #1 — Base64 Incompatibility) 🔴
- **`start-ai-client.mjs:636-637`** — `sodium.from_base64(msg.nonce)` and `sodium.from_base64(msg.encryptedPayload)` use libsodium's default variant `URLSAFE_NO_PADDING` (variant 7).
- **`packages/client-human/src/lib/crypto/browser-crypto.ts:23`** — Human client uses `btoa()` which produces STANDARD base64 (`+`, `/`, `=` padding).
- **Impact**: When ciphertext bytes produce `+`, `/`, or `=` in standard base64 (~75% of messages), `sodium.from_base64()` throws "incomplete input". The catch block at line 646 silently drops the message.
- **Severity**: **CRITICAL** — Intermittent message loss. Some messages decrypt successfully (when random bytes avoid those characters), others fail silently.
- **Code Reference**: `start-ai-client.mjs:636-637` (decoder) vs `browser-crypto.ts:23` (encoder)
- **Verdict**: **GAP FOUND**

#### Stage 5: AI Client — Missing E2E Cipher (BUG #2 — Race Condition) 🔴
- **`start-ai-client.mjs:633`** — `if (msg.encryptedPayload && e2eCipher)` — if `e2eCipher` is null (key exchange incomplete), condition is false.
- The encrypted message passes through without decryption. `msg.payload` remains `undefined`.
- **Race condition**: `handleKeyExchange()` is `async` (line 391) with `await ensureSodium()`. A `key_exchange` and `conversation` message arriving in the same TCP segment will fire both handlers before the first `await` resolves.
- **Severity**: **CRITICAL** — Messages during key exchange window are silently processed with empty content.
- **Code Reference**: `start-ai-client.mjs:633` (guard), line 391 (async key exchange)
- **Verdict**: **GAP FOUND**

#### Stage 6: Content Extraction — Empty String Fallback (BUG #3) 🔴
- **`start-ai-client.mjs:1320`**:
  ```js
  const content = msg.type === 'task'
    ? `Task: ${(msg.payload || msg).action} on ${(msg.payload || msg).target}`
    : (msg.payload?.content || msg.content || '');
  ```
- When `msg.payload` is `undefined` (from BUG #1 or #2): `msg.payload?.content` → `undefined`, `msg.content` → `undefined` (no top-level content field), `|| ''` → empty string.
- **`start-ai-client.mjs:1328`** — `conversationManager.addUserMessage('')` stores `{ role: 'user', content: '' }`.
- **Severity**: **CRITICAL** — This is where content goes from present to empty.
- **Code Reference**: `start-ai-client.mjs:1320` (extraction), line 1328 (storage)
- **Verdict**: **GAP FOUND**

#### Stage 7: Poisoned History Amplification (BUG #4) 🟡
- Once an empty-content message enters the conversation buffer, it persists in SQLite (`persistMessage` at line 1329).
- All subsequent API calls include this empty message in `_conversationHistory`, causing ALL future calls to fail with HTTP 400.
- **`packages/client-ai/src/provider/anthropic-adapter.ts:518-531`** — Maps history directly: `[...history.map((m) => ({ role: m.role, content: m.content }))]`.
- **Severity**: **HIGH** — One failed message permanently poisons the conversation until cleared.
- **Code Reference**: `start-ai-client.mjs:1329` (persist), `anthropic-adapter.ts:518-531` (assembly)
- **Verdict**: **GAP FOUND**

### Root Cause Summary

| Bug | Location | Severity | Description |
|-----|----------|----------|-------------|
| #1 Base64 mismatch | `start-ai-client.mjs:636-637` | CRITICAL | Standard vs URL-safe base64 incompatibility |
| #2 Race condition | `start-ai-client.mjs:633` | CRITICAL | Async key exchange allows undecrypted messages through |
| #3 Empty fallback | `start-ai-client.mjs:1320` | CRITICAL | No guard against undefined payload → empty string |
| #4 History poison | `start-ai-client.mjs:1329` | HIGH | Empty content persisted, poisons all future API calls |

---

## AUDIT 2: Immutable Boundaries — Code Receipts

### 2a. MaliClaw Clause

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| 13 blocked identifiers | `packages/relay/src/auth/allowlist.ts:71-89` (`MALICLAW_PATTERNS`, `Object.freeze()`) | ENFORCED |
| `/claw/i` catch-all regex | `packages/relay/src/auth/allowlist.ts:92` (`CLAW_CATCHALL`) | ENFORCED |
| Check logic | `packages/relay/src/auth/allowlist.ts:107-118` (`getMaliClawMatchDetail()`) | ENFORCED |
| Checked BEFORE allowlist | `packages/relay/src/auth/allowlist.ts:194` (MaliClaw) → line 198 (allowlist) | ENFORCED |
| Cannot add MaliClaw to allowlist | `packages/relay/src/auth/allowlist.ts:163-166` (`addEntry()` returns false) | ENFORCED |
| Admin API enforcement | `packages/relay/src/admin/admin-routes.ts:292-306` | ENFORCED |
| Admin UI enforcement | `packages/relay-admin-ui/src/lib/stores/blocklist.ts:121,126,134` | ENFORCED |
| **Runtime connection enforcement** | `start-relay.mjs:474` (session_init handler) | **GAP FOUND** 🔴 |

**CRITICAL GAP**: `start-relay.mjs` does NOT import or instantiate the `Allowlist` class. The `session_init` handler at line 474 accepts any `identity.id` without calling `allowlist.check()`. Line 184 prints `[✓] MaliClaw Clause active` but this is cosmetic — the check is never performed on incoming connections.

**Receipt**: MaliClaw patterns are defined at `allowlist.ts:71-92` and checked before allowlist at `allowlist.ts:194`. The library code is correct and `Object.freeze()`'d. **However, `start-relay.mjs` never calls `allowlist.check()` on `session_init` (line 474), so MaliClaw enforcement is NOT active at runtime.** A MaliClaw-matching client can connect and authenticate.

**Severity**: **CRITICAL** — The flagship security boundary is library code only, not wired into production.

### 2b. Safety Floors

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| Protocol floor constants | `packages/protocol/src/constants/safety-levels.ts:33-67` (`as const`) | ENFORCED |
| Client-human floor values | `packages/client-human/src/lib/stores/settings.ts:59-70` (`Readonly<SafetySettings>`) | ENFORCED |
| Client-AI config validation | `packages/client-ai/src/safety/config.ts:67-133` (`validateSafetyConfig()`) | ENFORCED |
| Tighten-only (thresholds) | `settings.ts:105-114` (rejects values above floor) | ENFORCED |
| Tighten-only (weights) | `settings.ts:118-126` (rejects values below floor) | ENFORCED |
| Locked booleans | `settings.ts:152-156` (`value !== true` → reject) | ENFORCED |
| Locked in Layer 2 | `packages/client-ai/src/safety/layer2.ts:291-294` | ENFORCED |
| No env var override | N/A (no env vars for safety settings) | ENFORCED |
| No admin API endpoint | No `PUT /api/config` or `PUT /api/safety` exists | ENFORCED |

**Receipt**: Safety floors are defined at `packages/protocol/src/constants/safety-levels.ts:33-67` (`as const`), enforced in AI client at `config.ts:67-133` (clamp-on-validate), and in human client at `settings.ts:100-185` (reject-on-update). Tighten-only at `settings.ts:105-184`. `irreversibleAlwaysChallenge` and `fileQuarantineEnabled` locked true at `settings.ts:152-156`. No bypass path found for runtime updates.

**Severity**: None for runtime updates. See AUDIT 5 for initialization gaps.

### 2c. Dangerous Tool Blindness

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| Dangerous flag on tools | `packages/client-ai/src/provider/tool-registry-manager.ts:33` (`dangerous: boolean`) | ENFORCED |
| Stripped from conversation mode | `tool-registry-manager.ts:150` (`if (mode === 'conversation' && tool.dangerous) continue`) | ENFORCED |
| Auto-approval blocked | `tool-registry-manager.ts:229` (`if (!trust.readOnly) return false`) | ENFORCED |
| `shouldAutoApprove` gap | `tool-registry-manager.ts:224-231` | **LOW GAP** |

**Minor gap**: `shouldAutoApprove()` checks `trust.readOnly` but not `tool.dangerous` directly. A hypothetical `dangerous: true, readOnly: true` tool could auto-approve at `trustLevel >= 4`. Mitigated: this combination is architecturally unlikely, and dangerous tools are stripped from conversation mode regardless.

**Receipt**: Dangerous tools stripped from conversation mode at `tool-registry-manager.ts:150` (hardcoded `continue`). Auto-approval blocked for non-readOnly tools at `tool-registry-manager.ts:229`.

**Severity**: **LOW**

### 2d. Budget Guard

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| Budget hard stop | `packages/client-ai/src/provider/budget-guard.ts:145-209` (`checkBudget()`) | ENFORCED |
| Runtime wiring | `start-ai-client.mjs:1347` (`budgetGuard.checkBudget()`) | ENFORCED |
| Tighten-only (current month) | `budget-guard.ts:328-359` (higher values → `pendingChanges`) | ENFORCED |
| Loosening deferred to next month | `budget-guard.ts:362-372` (only `immediateChanges` applied) | ENFORCED |
| 7-day cooldown check | `budget-guard.ts:398-411` (`checkCooldown()`) | ENFORCED |
| Cooldown wiring | `start-ai-client.mjs:765-773` | ENFORCED |
| Challenge hours block | `start-ai-client.mjs:754` (`challengeManager.checkAction('budget_change')`) | ENFORCED |
| `cooldownDays` floor | `budget-guard.ts:513-514` (loaded from config) | **GAP FOUND** 🟡 |

**Medium gap**: `cooldownDays` is loaded from the JSON config file at `budget-guard.ts:513-514` with no minimum floor validation. Setting `"cooldownDays": 0` in the config file effectively disables the 7-day cooldown.

**Receipt**: Budget enforced at `budget-guard.ts:145-209`, tighten-only at `budget-guard.ts:328-393`, cooldown at `budget-guard.ts:398-411`. Runtime wiring at `start-ai-client.mjs:1347` (checkBudget) and `start-ai-client.mjs:765` (checkCooldown). Gap: `cooldownDays` has no minimum floor — can be set to 0 via config file.

**Severity**: **MEDIUM**

### 2e. Challenge Me More

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| Active check | `packages/client-ai/src/provider/challenge-manager.ts:95-98` (`isActive()`) | ENFORCED |
| Schedule check | `challenge-manager.ts:230-246` (`isWithinSchedule()` with `Intl.DateTimeFormat`) | ENFORCED |
| Action blocking | `challenge-manager.ts:123-163` (`checkAction()`, `BLOCKED_ACTIONS`) | ENFORCED |
| Server-side timezone | `challenge-manager.ts:90` (`Intl.DateTimeFormat().resolvedOptions().timeZone`) | ENFORCED |
| Timezone config protection | `challenge-manager.ts:301` (uses system timezone, ignores config file) | ENFORCED |
| Schedule changes during active | `challenge-manager.ts:195-200` (blocked) | ENFORCED |
| 7-day schedule cooldown | `challenge-manager.ts:180-192` | ENFORCED |
| `enabled` flag protection | `challenge-manager.ts:297-304` (`loadConfig()`) | **GAP FOUND** 🟡 |
| Wait timer enforcement | `challenge-manager.ts:136-141` | **GAP FOUND** 🟡 |

**Gap 1**: `enabled` can be set to `false` via config file on disk (`loadConfig()` at line 301 merges `parsed` which can contain `enabled: false`), bypassing all challenge enforcement.

**Gap 2**: `CONFIRM_ACTIONS` wait timer is advisory — the AI client sends the requirement but does not enforce the countdown server-side. The human client UI is trusted to honor it.

**Receipt**: Challenge hours at `challenge-manager.ts:95-98`, timezone at `challenge-manager.ts:90` (system, cannot be overridden via config at line 301), schedule blocking at `challenge-manager.ts:195-200`, cooldown at `challenge-manager.ts:180-192`. Gaps: (1) `enabled` can be `false` in config file; (2) wait timer is advisory-only.

**Severity**: **MEDIUM**

---

## AUDIT 3: AI Client Self-Permission

### 3a. System Prompt Modification

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| ROLE_CONTEXT (static) | `packages/client-ai/src/provider/conversation-manager.ts:56-70` (module-level `const`) | ENFORCED |
| AI output always `conversation` type | `start-ai-client.mjs:1429-1435` | ENFORCED |
| Relay sender-type validation | `start-relay.mjs:662-671, 748-749, 890-898` | **GAP FOUND** 🟡 |

**Receipt**: System prompt modification by AI model is prevented because ROLE_CONTEXT is a module-level `const` (`conversation-manager.ts:56-70`) and AI output is always wrapped in `conversation` type messages (`start-ai-client.mjs:1429-1435`). Memory, user-context, and project-file content enters the system prompt, but requires human-initiated message types that the AI model cannot self-originate.

**Defense-in-depth gap**: The relay does NOT validate sender type on `context_update`, `project_sync`, or `memory_proposal` forwarding. If the AI client process were compromised at the Node.js level (not just model output), it could send these message types through the relay.

**Severity**: **MEDIUM** (requires process-level compromise)

### 3b. Tool Registry Self-Modification

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| No `tool_registry_sync` handler | `start-ai-client.mjs` (absent from all `msg.type` checks) | ENFORCED |
| AdapterRegistry locked after startup | `start-ai-client.mjs:118`, `adapter-registry.ts:57-59` | ENFORCED |
| AI output type constraint | `start-ai-client.mjs:1429-1435` | ENFORCED |

**Receipt**: Tool self-registration is prevented because (1) no message handler exists for `tool_registry_sync` on the AI client, (2) AdapterRegistry is locked after startup (`adapter-registry.ts:57-59`), and (3) AI output is always `conversation` type.

**Severity**: None

### 3c. Safety Threshold Modification

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| No `safety_config` message handler | `start-ai-client.mjs` (absent) | ENFORCED |
| `safetyConfig` initialized as `const` | `start-ai-client.mjs:300` | ENFORCED |
| `SAFETY_FLOORS` are `as const` | `packages/protocol/src/constants/safety-levels.ts:33-67` | ENFORCED |
| `CHALLENGE_THRESHOLD` is `const` | `packages/client-ai/src/safety/layer2.ts:20` | ENFORCED |
| Floor clamping on any config | `packages/client-ai/src/safety/config.ts:67-133` | ENFORCED |

**Receipt**: Safety threshold modification is prevented because no message handler exists for safety config changes, `safetyConfig` is `const` at startup, `SAFETY_FLOORS` are `as const` in protocol, and `validateSafetyConfig()` clamps any proposed config to floor values.

**Severity**: None

### 3d. Budget Guard Modification

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| AI output type constraint | `start-ai-client.mjs:1429-1435` | ENFORCED |
| Tighten-only enforcement | `budget-guard.ts:321-393` | ENFORCED |
| Challenge hours blocking | `start-ai-client.mjs:754-762` | ENFORCED |
| Relay sender-type validation for `budget_config` | `start-relay.mjs:699` | **GAP FOUND** 🟡 |

**Receipt**: Budget modification by AI model is prevented because AI responses are always `conversation` type (`start-ai-client.mjs:1429-1435`). Tighten-only enforcement at `budget-guard.ts:321-393` constrains damage even if a raw `budget_config` were sent. Gap: relay does not validate sender type on `budget_config` forwarding.

**Severity**: **MEDIUM** (requires process-level compromise, constrained by tighten-only)

### 3e. Cross-Cutting: evaluateSafety() Signature Mismatch 🟡

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| Function signature | `packages/client-ai/src/safety/pipeline.ts:43` (2 params: `task`, `options?`) | — |
| Call site | `start-ai-client.mjs:1284` (3 args: `payload`, `safetyConfig`, `patternHistory`) | **GAP FOUND** |

**Impact**: `safetyConfig` (2nd arg) is received as `options` parameter. Since it's a `SafetyConfig` not `SafetyPipelineOptions`, `options?.config` is undefined → falls through to `defaultSafetyConfig()`. The `patternHistory` (3rd arg) is silently discarded. Result: pattern deviation detection never accumulates history across calls.

**Severity**: **MEDIUM** — safety evaluation works (Layer 1 denials, floor enforcement intact) but Layer 2 contextual analysis is weakened (no accumulated pattern history).

---

## AUDIT 4: File Quarantine Chain

### 4a. Stage 1 — Submission Hash

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| Hash computation | `packages/relay/src/quarantine/hash-verifier.ts:84` (`sha256(data)`) | ENFORCED |
| Hash comparison | `hash-verifier.ts:86` (`actualHash === declaredHash`) | ENFORCED |
| Invocation | `packages/relay/src/quarantine/file-transfer-router.ts:173-178` (`verifyAtSubmission()`) | ENFORCED |
| Mismatch → BASTION-5001 | `start-relay.mjs:964-976` | ENFORCED |
| Mismatch → audit event | `hash-verifier.ts:198-206` (`logMismatch()`) | ENFORCED |
| File NOT quarantined on mismatch | `file-transfer-router.ts:180` (returns early before `quarantine.submit()`) | ENFORCED |

**Verdict**: **ENFORCED**

### 4b. Stage 2 — Quarantine Storage

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| In-memory storage | `packages/relay/src/quarantine/file-quarantine.ts:101` (`Map<FileTransferId, StoredFile>`) | ENFORCED |
| Hash stored alongside | `file-quarantine.ts:156` (`hashAtReceipt`) | ENFORCED |
| State-gated release | `file-quarantine.ts:252` (only `'accepted'` state can release) | ENFORCED |
| Private `files` Map | `file-quarantine.ts:101` (`private`) | ENFORCED |
| `verifyInQuarantine()` auto-invocation | N/A | **GAP FOUND** 🟡 |

**Gap**: `verifyInQuarantine()` exists at `hash-verifier.ts:109-132` but is NOT automatically called in the normal transfer pipeline. `FileTransferRouter` only calls Stage 1 and Stage 3. Stage 2 appears to be an on-demand verification tool.

**Mitigating factor**: Data is in-memory in a single process. Tampering at rest would require a compromised relay process, at which point all guarantees are void.

**Verdict**: **PARTIALLY ENFORCED** — method exists but not wired into automatic pipeline

### 4c. Stage 3 — Delivery Hash

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| Hash re-computation | `hash-verifier.ts:150` (`sha256(data)`) | ENFORCED |
| Hash comparison | `hash-verifier.ts:152` (`actualHash === entry.hashAtReceipt`) | ENFORCED |
| Invocation | `file-transfer-router.ts:278` (`verifyAtDelivery()`) | ENFORCED |
| Mismatch → BASTION-5001 | `start-relay.mjs:1054-1063` | ENFORCED |
| Different code path from Stage 1 | `verifyAtSubmission()` (line 78-98) vs `verifyAtDelivery()` (line 144-175) | ENFORCED |
| Client-side verification (Stage 3b) | `start-ai-client.mjs:1210-1218` (independent `createHash('sha256')`) | ENFORCED |
| Crypto-layer verification (Stage 4) | `packages/crypto/src/e2e/file-decrypt.ts:148-153` (plaintext hash) | ENFORCED |

**Verdict**: **ENFORCED** — defense in depth with 4 independent verification points

### 4d. Purge

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| Deleted on release | `file-quarantine.ts:268` (`this.files.delete(transferId)`) | ENFORCED |
| PurgeScheduler interval | `packages/relay/src/quarantine/purge-scheduler.ts:85-93` (60s default, `unref()`'d) | ENFORCED |
| Quarantine timeout | `file-quarantine.ts:40` (1hr default) | ENFORCED |
| Configurable via env var | `start-relay.mjs:139` (`BASTION_QUARANTINE_TIMEOUT_MS`) | INFO |
| Max entries cap | `file-quarantine.ts:109` (max 100, configurable) | ENFORCED |
| Client-side purge | `packages/client-ai/src/files/purge.ts:73-92` (task lifecycle cleanup) | ENFORCED |

**Verdict**: **ENFORCED** — files cannot accumulate indefinitely

### Receipt
3-stage hash at `hash-verifier.ts:84` (Stage 1), `hash-verifier.ts:115` (Stage 2 — not auto-invoked), `hash-verifier.ts:150` (Stage 3). Client-side at `start-ai-client.mjs:1210` (Stage 3b). Crypto-layer at `file-decrypt.ts:148-153` (Stage 4). Mismatch handling at `start-relay.mjs:964-976` (Stage 1), `start-relay.mjs:1054-1063` (Stage 3), `start-ai-client.mjs:1211-1218` (client). Purge at `purge-scheduler.ts:85` (auto), `file-quarantine.ts:268` (on release), `file-quarantine.ts:109` (max cap).

---

## AUDIT 5: Safety Floors Deep Dive

### 5a. Floor Values — Compile-Time Constants

| Package | Code Reference | Type | Status |
|---------|---------------|------|--------|
| Protocol | `packages/protocol/src/constants/safety-levels.ts:33-67` | `as const` | ENFORCED |
| Client-AI | `packages/client-ai/src/safety/config.ts:14` (imports from protocol) | Import | ENFORCED |
| Client-Human | `packages/client-human/src/lib/stores/settings.ts:59-70` | `Readonly<SafetySettings>` | ENFORCED |
| Client-Human-Mobile | N/A | N/A | **GAP FOUND** 🟡 |
| Relay-Admin-UI | `packages/relay-admin-ui/src/lib/stores/config.ts:39-45` | Hardcoded literals | INFO |

**Gap**: Mobile client has no safety floor infrastructure. No `SAFETY_FLOOR_VALUES`, no settings store, no `validateSettingChange()`.

**Verdict**: **PARTIALLY ENFORCED** — all desktop/server packages have compile-time constants, mobile has none

### 5b. Tighten-Only Enforcement

| Parameter Type | Code Reference | Comparison | Status |
|----------------|---------------|------------|--------|
| Thresholds (lower=stricter) | `settings.ts:105-114` | `if (num > floor)` reject | ENFORCED |
| Weights (higher=stricter) | `settings.ts:118-126` | `if (num < floor)` reject | ENFORCED |
| Duration (higher=stricter) | `settings.ts:129-137` | `if (num < floor)` reject | ENFORCED |
| Locked booleans | `settings.ts:152-156` | `if (value !== true)` reject | ENFORCED |
| Sensitivity enum | `settings.ts:161-169` | Ordinal: `if (order[val] < order[floor])` reject | ENFORCED |
| High-risk hours | `settings.ts:173-180` | Range [0,23] only | **GAP FOUND** 🟡 |

**Gap**: High-risk hours are only range-validated (0-23), not floor-enforced. A user can shrink the protected window from 6 hours (00:00-06:00) to 1 hour (e.g., 05:00-06:00) without rejection.

**Verdict**: **PARTIALLY ENFORCED** — all types handled correctly except high-risk hours

### 5c. Config Interaction — Startup Loading

| Stage | Code Reference | Floor Check? | Status |
|-------|---------------|-------------|--------|
| AI client startup | `start-ai-client.mjs:300` (`defaultSafetyConfig()`) | Uses defaults (at floor) | ENFORCED |
| AI client runtime | `pipeline.ts:47` (`validateSafetyConfig()`) | Clamps to floors | ENFORCED |
| Human client init | `settings.ts:201` (`{ ...DEFAULT_SETTINGS, ...initial }`) | **NO floor check** | **GAP FOUND** 🟡 |
| Human client runtime | `settings.ts` (`tryUpdate()` → `validateSettingChange()`) | Rejects below floor | ENFORCED |

**Gap**: `createSettingsStore(initial?)` merges `initial` via spread without calling `validateSettingChange()`. If a caller passes below-floor values in `initial`, they would be accepted silently. Currently no caller does this, but the API permits it.

**Verdict**: **GAP FOUND** — floors are enforced on runtime updates but not on initialization

### 5d. Admin API

No `PUT /api/config` or `PUT /api/safety` endpoint exists in `packages/relay/src/admin/admin-routes.ts:848-993`. The relay has no concept of mutable safety configuration — safety is enforced client-side only.

**Verdict**: **ENFORCED** — attack surface does not exist

### 5e. Cross-Package Consistency

| Parameter | Protocol | Client-Human | Client-AI | Admin-UI |
|-----------|----------|-------------|-----------|----------|
| challengeThreshold | **not defined** | 0.6 | not defined | 0.6 (display) |
| denialThreshold | **not defined** | 0.9 | not defined | 0.9 (display) |
| timeOfDayWeight | 1.2 | 1.2 | uses protocol | — |
| irreversibleAlwaysChallenge | true | true | uses protocol | — |
| fileQuarantineEnabled | true | true | uses protocol | — |
| patternDeviationSensitivity | 'low' | 'low' | uses protocol | — |
| gracePeriodMs | 120000 | 120000 | — | — |
| auditRetentionDays | 90 | 90 | — | — |

**Observations**:
1. `challengeThreshold` (0.6) and `denialThreshold` (0.9) exist ONLY in client-human, not in protocol.
2. Relay-admin-ui duplicates values as hardcoded literals instead of importing from protocol.
3. Mobile client has no floor values at all.

**Verdict**: **PARTIALLY ENFORCED** — values consistent where defined, but not all floors are in the authoritative protocol package

---

## Consolidated Gap Summary

### CRITICAL (3 findings — all in message flow)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| C-1 | Base64 encoding mismatch (standard vs URL-safe) | `browser-crypto.ts:23` ↔ `start-ai-client.mjs:636-637` | ~75% of messages fail to decrypt silently |
| C-2 | Async key exchange race condition | `start-ai-client.mjs:633, 391` | Messages during key exchange window processed with empty content |
| C-3 | MaliClaw not wired into session_init | `start-relay.mjs:474` (missing `allowlist.check()`) | Flagship security boundary inactive at runtime |

### HIGH (1 finding)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| H-1 | Empty content poisons conversation history permanently | `start-ai-client.mjs:1320, 1329` | One failed message breaks all future API calls |

### MEDIUM (6 findings)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| M-1 | `cooldownDays` has no minimum floor | `budget-guard.ts:513-514` | Config file can set cooldown to 0 |
| M-2 | Challenge `enabled` flag writable via config file | `challenge-manager.ts:297-304` | Can disable all challenge enforcement |
| M-3 | Relay does not validate sender type on sensitive messages | `start-relay.mjs:662-671, 699, 748-749, 890-898` | Compromised AI client could send human-only message types |
| M-4 | `evaluateSafety()` signature mismatch (3 args vs 2 params) | `start-ai-client.mjs:1284` ↔ `pipeline.ts:43` | Pattern history never accumulates |
| M-5 | Challenge wait timer is advisory only | `challenge-manager.ts:136-141` | Human client trusted to honor countdown |
| M-6 | High-risk hours not floor-enforced | `settings.ts:173-180` | Protected window can be shrunk |

### LOW (2 findings)

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| L-1 | `shouldAutoApprove` doesn't check `dangerous` flag | `tool-registry-manager.ts:224-231` | Theoretical bypass for `dangerous+readOnly` tools |
| L-2 | Settings store init doesn't validate against floors | `settings.ts:201` | API permits below-floor initial values |

### INFO (2 observations)

| # | Observation | Location |
|---|-------------|----------|
| I-1 | Mobile client has no safety floor infrastructure | `packages/client-human-mobile/` |
| I-2 | Admin-UI duplicates floor values as literals instead of importing from protocol | `relay-admin-ui/src/lib/stores/config.ts:39-45` |

---

## Recommendations (Do NOT implement during audit)

1. **C-1**: Fix base64 encoding — either use `sodium.from_base64(data, sodium.base64_variants.ORIGINAL)` on the AI client side, or switch browser-crypto to URL-safe base64.
2. **C-2**: Queue encrypted messages until key exchange completes, or make key exchange synchronous.
3. **C-3**: Import and instantiate `Allowlist` in `start-relay.mjs`, call `allowlist.check()` in the `session_init` handler before authentication.
4. **H-1**: Add a guard in content extraction: if decrypted payload content is empty/undefined, do NOT store in conversation history. Log a warning instead.
5. **M-1**: Add a minimum floor for `cooldownDays` (e.g., 7) in `BudgetGuard.loadConfig()`.
6. **M-2**: Remove `enabled` from the loadable config fields, or add a floor that prevents disabling.
7. **M-3**: Add sender-type validation in the relay for directional message types.
8. **M-4**: Fix the `evaluateSafety()` call to pass `{ config: safetyConfig, history: patternHistory }` as a single options object.

---

*This audit documents findings only. No code was modified. All 2,879 tests pass at audit time.*
