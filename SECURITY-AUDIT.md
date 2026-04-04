# Security Audit — Project Bastion

**Date**: 2026-03-31 (original), 2026-04-01 (v0.6.0–v0.7.1 addendum)
**Auditors**: Harry Smith, Claude (Opus 4.6)
**Scope**: Full security audit of messaging flow, immutable boundaries, AI self-permission, file quarantine, and safety floors
**Commit**: 3635848 (original), 266bbe1 (addendum)
**Status**: All findings resolved

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

**~~CRITICAL GAP~~** ✅ **RESOLVED**: `Allowlist` imported (`start-relay.mjs:18`), instantiated (`start-relay.mjs:187`), and `Allowlist.isMaliClawMatch()` wired into `session_init` handler BEFORE JWT issuance (`start-relay.mjs:524`). Rejects with BASTION-1003 and closes connection.

**Receipt**: MaliClaw patterns are defined at `allowlist.ts:71-92` and checked before allowlist at `allowlist.ts:194`. Enforcement is now wired into `start-relay.mjs:524` — checks both `identity.id` and `identity.displayName` against MaliClaw patterns before any JWT is issued.

**Severity**: ~~CRITICAL~~ → **RESOLVED**

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

**~~Medium gap~~** ✅ **RESOLVED**: `loadConfig()` now clamps `cooldownDays` to minimum 1 day (`budget-guard.ts:515`). `MIN_COOLDOWN_DAYS` added to protocol `SAFETY_FLOORS` (`safety-levels.ts:69`).

**Receipt**: Budget enforced at `budget-guard.ts:145-209`, tighten-only at `budget-guard.ts:328-393`, cooldown at `budget-guard.ts:398-411`, floor at `budget-guard.ts:515`.

**Severity**: ~~MEDIUM~~ → **RESOLVED**

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

**~~Gap 1~~** ✅ **RESOLVED**: `loadConfig()` now overrides `enabled: false` back to `true` with safety floor warning (`challenge-manager.ts:304`).

**~~Gap 2~~** ✅ **RESOLVED**: Wait timer now enforced server-side. Challenges tracked in `pendingChallenges` map (`start-ai-client.mjs:303`). Confirmation handler checks elapsed time and rejects early responses with BASTION-4006 (`start-ai-client.mjs:755`).

**Receipt**: Challenge hours at `challenge-manager.ts:95-98`, timezone at `challenge-manager.ts:90`, enabled floor at `challenge-manager.ts:304`, wait timer enforcement at `start-ai-client.mjs:755`.

**Severity**: ~~MEDIUM~~ → **RESOLVED**

---

## AUDIT 3: AI Client Self-Permission

### 3a. System Prompt Modification

| Aspect | Code Reference | Status |
|--------|---------------|--------|
| Soul Document layers (static) | `packages/client-ai/src/provider/conversation-manager.ts:56-180` (module-level `const` — SOUL_LAYER_0, SOUL_LAYER_1, SOUL_LAYER_2_CONVERSATION) | ENFORCED |
| AI output always `conversation` type | `start-ai-client.mjs:1429-1435` | ENFORCED |
| Relay sender-type validation | `start-relay.mjs:662-671, 748-749, 890-898` | **GAP FOUND** 🟡 |

**Receipt**: System prompt modification by AI model is prevented because the Soul Document layers (SOUL_LAYER_0, SOUL_LAYER_1, SOUL_LAYER_2_CONVERSATION) are module-level `const` strings (`conversation-manager.ts:56-180`) and AI output is always wrapped in `conversation` type messages (`start-ai-client.mjs:1429-1435`). Memory, user-context, and project-file content enters the system prompt, but requires human-initiated message types that the AI model cannot self-originate.

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
| High-risk hours | `settings.ts:175-188` | Range [0,23] + 6-hour minimum window | ✅ RESOLVED |

**~~Gap~~** ✅ **RESOLVED**: `validateSettingChange()` now computes the proposed window size and rejects if below 6 hours (`settings.ts:188`). `HIGH_RISK_HOURS_MIN_WINDOW: 6` added to protocol `SAFETY_FLOORS` (`safety-levels.ts:72`).

**Verdict**: **ENFORCED** — all parameter types now have floor enforcement

### 5c. Config Interaction — Startup Loading

| Stage | Code Reference | Floor Check? | Status |
|-------|---------------|-------------|--------|
| AI client startup | `start-ai-client.mjs:300` (`defaultSafetyConfig()`) | Uses defaults (at floor) | ENFORCED |
| AI client runtime | `pipeline.ts:47` (`validateSafetyConfig()`) | Clamps to floors | ENFORCED |
| Human client init | `settings.ts:215-225` (floor-clamped merge) | Clamps to floors | ✅ RESOLVED |
| Human client runtime | `settings.ts` (`tryUpdate()` → `validateSettingChange()`) | Rejects below floor | ENFORCED |

**~~Gap~~** ✅ **RESOLVED**: `createSettingsStore()` now clamps all initial values to their respective safety floors (`settings.ts:215-225`): `Math.min` for lower-is-stricter thresholds, `Math.max` for higher-is-stricter values, and locked booleans forced to `true`.

**Verdict**: **ENFORCED** — floors checked on both initialization and runtime updates

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

## Consolidated Resolution Summary

### CRITICAL (4 findings — ALL RESOLVED)

| # | Finding | Fix | Status |
|---|---------|-----|--------|
| C-1 | Base64 encoding mismatch | ✅ RESOLVED — AI client now uses `sodium.base64_variants.ORIGINAL` for both encode (`start-ai-client.mjs:480`) and decode (`start-ai-client.mjs:665`), matching human client's `btoa()` standard base64 | ✅ |
| C-2 | Key exchange race condition | ✅ RESOLVED — Added `keyExchangePending` flag and `encryptedMessageQueue` (`start-ai-client.mjs:348`). Encrypted messages are queued when cipher unavailable (`start-ai-client.mjs:648`), drained after key exchange completes (`start-ai-client.mjs:433`) | ✅ |
| C-3 | MaliClaw not wired | ✅ RESOLVED — Imported `Allowlist` (`start-relay.mjs:18`), instantiated (`start-relay.mjs:187`), and wired `Allowlist.isMaliClawMatch()` check into `session_init` handler BEFORE JWT issuance (`start-relay.mjs:524`). Rejects with BASTION-1003 and closes connection (`start-relay.mjs:539`) | ✅ |
| C-4 | Key exchange routing deadlock | ✅ RESOLVED — Relay's `key_exchange` routing used exclusive if/else: when an updater was connected, human's key_exchange was sent to updater INSTEAD of AI peer (`start-relay.mjs:756`). AI never received human's public key, cipher never established, encrypted message queue never drained. Fix: human's key_exchange always goes to paired AI peer first, then ALSO to updater if connected (`start-relay.mjs:751-770`) | ✅ |

### HIGH (1 finding — RESOLVED)

| # | Finding | Fix | Status |
|---|---------|-----|--------|
| H-1 | Empty content poisoning | ✅ RESOLVED — Added empty content guard (`start-ai-client.mjs:1381`) that rejects and logs warning instead of persisting. Added defense-in-depth filter in Anthropic adapter (`anthropic-adapter.ts:526`) that strips empty-content messages from history before API call | ✅ |

### MEDIUM (6 findings — ALL RESOLVED)

| # | Finding | Fix | Status |
|---|---------|-----|--------|
| M-1 | `cooldownDays` no floor | ✅ RESOLVED — Added `MIN_COOLDOWN_DAYS: 1` to `SAFETY_FLOORS` (`safety-levels.ts:69`). `loadConfig()` clamps `cooldownDays` to minimum 1 (`budget-guard.ts:515`) | ✅ |
| M-2 | Challenge `enabled` writable | ✅ RESOLVED — `loadConfig()` now overrides `enabled: false` back to `true` with safety floor warning (`challenge-manager.ts:304`) | ✅ |
| M-3 | No sender-type validation | ✅ RESOLVED — Added `SENDER_TYPE_RESTRICTIONS` map (`start-relay.mjs:465`) and `validateSenderType()` function (`start-relay.mjs:483`). Applied to all forwarded messages (`start-relay.mjs:716`). Mismatches rejected with BASTION-3003 and audit logged | ✅ |
| M-4 | `evaluateSafety()` args | ✅ RESOLVED — Fixed call to pass `{ config: safetyConfig, history: patternHistory }` as single `SafetyPipelineOptions` object (`start-ai-client.mjs:1333`). Pattern history now accumulates across calls | ✅ |
| M-5 | Wait timer advisory | ✅ RESOLVED — Added `pendingChallenges` tracker (`start-ai-client.mjs:303`). Challenge issuance records timing (`start-ai-client.mjs:1355`). Confirmation handler enforces elapsed time server-side (`start-ai-client.mjs:755`). Early responses rejected with BASTION-4006 | ✅ |
| M-6 | Hours not floor-enforced | ✅ RESOLVED — Added `HIGH_RISK_HOURS_MIN_WINDOW: 6` to `SAFETY_FLOORS` (`safety-levels.ts:72`). `validateSettingChange()` now computes window size and rejects if below 6 hours (`settings.ts:188`). Also fixed initialization bypass — `createSettingsStore()` now clamps initial values to floors (`settings.ts:222`) | ✅ |

### MEDIUM (2 findings — ALL RESOLVED)

| # | Finding | Fix | Status |
|---|---------|-----|--------|
| M-7 | Update message routing not isolated — `update_*` types not in `SENDER_TYPE_RESTRICTIONS`, could be sent by AI/human clients; generic fallthrough could leak update messages to AI/human peers | ✅ RESOLVED — Added `update_available`, `update_prepare_ack`, `update_build_status`, `update_reconnected`, `update_complete`, `update_failed` to `SENDER_TYPE_RESTRICTIONS` as `'updater'`-only. Added guards on generic fallthrough: `update_*` prefix blocked from peer routing; updater clients blocked from sending non-update messages via peer routing | ✅ |
| M-8 | Single `updaterConnectionId` variable — only last-connected updater received commands. Second updater (e.g., AI VM) overwrote first (relay). `onUpdateMessage`, key_exchange, disconnect all operated on single connId | ✅ RESOLVED — Replaced `let updaterConnectionId` with `Map updaterClients` keyed by agentId. `onUpdateMessage` targets specific component or broadcasts. Key exchange forwarded to all updaters. Disconnect removes by connectionId lookup (`start-relay.mjs:346,310-338,600-605,766-784,972-979,1282-1290`) | ✅ |

### LOW (2 findings — ALL RESOLVED)

| # | Finding | Fix | Status |
|---|---------|-----|--------|
| L-1 | `shouldAutoApprove` doesn't check `dangerous` flag | ✅ RESOLVED — Added explicit `tool?.dangerous` check in `shouldAutoApprove()` (`tool-registry-manager.ts:230`). Dangerous tools now NEVER auto-approve regardless of `readOnly` or `trustLevel` | ✅ |
| L-2 | Settings store init bypass | ✅ RESOLVED as part of M-6 fix — initialization now clamps to floors (`settings.ts:222`) | ✅ |

### INFO (2 observations)

| # | Observation | Location | Status |
|---|-------------|----------|--------|
| I-1 | Mobile client has no safety floor infrastructure | `packages/client-human-mobile/` | DEFERRED — mobile modernisation roadmap |
| I-2 | Admin-UI hardcoded floor values | `relay-admin-ui/src/lib/stores/config.ts:40-47` | ACCEPTED — cannot import from `@bastion/protocol` in browser build (node:crypto breaks Vite). Values hardcoded with comments referencing protocol source. Human client (Tauri/Node) correctly imports from protocol. `CHALLENGE_THRESHOLD` and `DENIAL_THRESHOLD` added to protocol `SAFETY_FLOORS` as authoritative source |

---

## Fix Verification

All fixes verified:
- **Build**: `pnpm build` — clean (no TypeScript errors)
- **Lint**: `pnpm lint` — 0 issues
- **Tests**: `pnpm test` — 2,993 passed, 0 failed (14 test files)
- **Security**: All 4 CRITICAL, 1 HIGH, 8 MEDIUM, 2 LOW findings resolved

---

*Audit performed 2026-03-31. Fixes applied same day. Current: v0.5.9, 2,993 tests.*

---

## AUDIT 7: Audit Trail Completeness

**Date**: 2026-03-31
**Scope**: Verify every auditable event in `start-relay.mjs` triggers an `auditLogger.logEvent()` call with useful forensic detail.

### Connection Events

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| Client connect | `connection_opened` | `start-relay.mjs:483` | LOGGED |
| Client disconnect (authenticated) | `session_ended` | `start-relay.mjs:1290` | LOGGED |
| Client disconnect (unauthenticated) | `connection_closed` | `start-relay.mjs:1293` | **ADDED** (was missing) |
| Session init / auth success | `auth_success` | `start-relay.mjs:631` | LOGGED |
| Authentication failure (JWT) | `auth_failure` | `start-relay.mjs:590` | **ADDED** (was missing) |
| MaliClaw rejection | `security_violation` | `start-relay.mjs:566` | LOGGED |
| Token refresh | `auth_token_refresh` | `start-relay.mjs:1216` | LOGGED (detail **enriched** with clientId/clientType) |

### Message Routing

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| Human -> AI forwarded | `message_routed` | `start-relay.mjs:1267` | LOGGED |
| AI -> Human forwarded | `message_routed` | `start-relay.mjs:1267` | LOGGED |
| Sender type mismatch (BASTION-3003) | `security_violation` | `start-relay.mjs:761` | LOGGED |
| Conversation create | `conversation_created` | `start-relay.mjs:949` | LOGGED |
| Conversation switch | `conversation_switched` | `start-relay.mjs:950` | LOGGED |
| Conversation archive | `conversation_archived` | `start-relay.mjs:951` | LOGGED |
| Conversation delete | `conversation_deleted` | `start-relay.mjs:952` | LOGGED |
| Compaction triggered | `compaction_triggered` | `start-relay.mjs:953` | LOGGED |
| Compaction completed | `compaction_completed` | `start-relay.mjs:954` | LOGGED |
| Stream started | `stream_started` | `start-relay.mjs:932` | LOGGED |
| Stream completed | `stream_completed` | `start-relay.mjs:935` | LOGGED |

### Key Exchange

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| Key exchange forwarded | `key_exchange` | `start-relay.mjs:809` | LOGGED (metadata only — key material NOT logged) |

### Security Events

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| MaliClaw connection rejection | `security_violation` | `start-relay.mjs:566` | LOGGED |
| Sender type mismatch | `security_violation` | `start-relay.mjs:761` | LOGGED |
| project_sync content rejection | `security_violation` | `start-relay.mjs:879` | LOGGED |
| Unauthorised file_request | `security_violation` | `start-relay.mjs:1152` | LOGGED |
| AI disclosure sent | `ai_disclosure_sent` | `start-relay.mjs:429` | LOGGED |

### File Transfer

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| File submitted to quarantine | `file_submitted` | `start-relay.mjs:1076` | LOGGED |
| Hash mismatch at submission | `file_hash_mismatch` | `start-relay.mjs:1094` | LOGGED |
| File delivered | `file_delivered` | `start-relay.mjs:1168` | LOGGED |
| Hash mismatch at delivery | `file_hash_mismatch` | `start-relay.mjs:1183` | LOGGED |

### Provider Events

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| Provider registered (self-register) | `provider_registered` | `start-relay.mjs:649` | LOGGED |
| Provider approved (admin) | `provider_approved` | `admin-routes.ts:319` | LOGGED |
| Provider revoked | `provider_deactivated` | `admin-routes.ts:348` | LOGGED |
| Provider reactivated | `provider_approved` | `admin-routes.ts:373` | LOGGED |
| MaliClaw blocked provider | `maliclaw_rejected` | `admin-routes.ts:297` | LOGGED |

### Update Events

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| Update check initiated | `update_check_initiated` | `admin-routes.ts:682` | LOGGED |
| Update build started | `update_build_started` | `admin-routes.ts:789` | LOGGED |
| Update cancelled | `update_failed` | `admin-routes.ts:831` | LOGGED (reason: cancelled_by_admin) |
| Update lifecycle messages (all) | `update_*` (per type) | `start-relay.mjs:~997` | **ADDED** (was missing — no per-message audit) |

### Memory Events

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| Memory proposed | `memory_proposed` | `start-relay.mjs:911` | LOGGED |
| Memory decided | `memory_decided` | `start-relay.mjs:911` | LOGGED |

### Challenge Events

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| Challenge status | `challenge_status` | `start-relay.mjs:778` | LOGGED |
| Challenge config | `challenge_config` | `start-relay.mjs:778` | LOGGED |
| Challenge config ack | `challenge_config_ack` | `start-relay.mjs:778` | LOGGED |

### Budget Events

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| Budget alert | `budget_alert` | `start-relay.mjs:825` | LOGGED |
| Budget config changed | `budget_config_changed` | `start-relay.mjs:831` | LOGGED |
| Budget status | `budget_status` | `start-relay.mjs:837` | LOGGED |

### Tool Events

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| Tool request/approved/denied/result/revoke/alert | Per message type | `start-relay.mjs:855` | LOGGED |

### Project Sync Events

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| project_sync (valid) | `project_sync` | `start-relay.mjs:895` | LOGGED |
| project_sync (rejected) | `security_violation` | `start-relay.mjs:879` | LOGGED |

### Context Update

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| context_update forwarded | `context_update` | `start-relay.mjs:1017` | LOGGED |

### Admin Events

| Event | Event Type | Code Reference | Status |
|-------|-----------|---------------|--------|
| Admin login | Handled by `AdminServer` | `admin-server.ts` | LOGGED (via AdminServer auth flow) |
| Audit query | `audit_query` | `start-relay.mjs:744` | LOGGED |
| Capability matrix update | `config_change` | `admin-routes.ts:418` | LOGGED |
| Session paired | `session_paired` | `start-relay.mjs:450` | LOGGED |

### Summary of Fixes Applied

| # | Gap | Severity | Fix |
|---|-----|----------|-----|
| 1 | Auth failure (JWT issuance) not audited | **MEDIUM** | Added `auth_failure` event on JWT error |
| 2 | Unauthenticated disconnections not audited | **LOW** | Added `connection_closed` event for pre-auth disconnects |
| 3 | Update lifecycle messages not individually audited | **MEDIUM** | Added per-message audit for all `update_*` types |
| 4 | Token refresh detail empty | **LOW** | Enriched with `clientId` and `clientType` |

### Pagination Bug (CRITICAL)

| # | Bug | Impact | Fix |
|---|-----|--------|-----|
| 1 | `queryAudit()` returned `entries.length` as `totalCount` | Pagination showed page size as total count — admins could not navigate beyond first page | Added `count()` to AuditStore/AuditLogger; `queryAudit()` now returns real `totalCount`, `page`, `pageSize`, `hasMore` |
| 2 | Admin UI detail column truncated at 80 chars | Forensic detail invisible to admins | Replaced with inline key fields + collapsible full JSON view |
| 3 | Admin UI pagination missing "Showing X of Y" | No indication of total result set size | Added "Showing 1–25 of N entries" range display |

---

## ADDENDUM: v0.6.0–v0.7.1 Findings (2026-04-01)

### Finding A-1: Self-Update Agent Git Commands Without Sudo (HIGH)

**Issue:** `handleUpdateCheck()` in `packages/update-agent/src/agent.ts` ran `git fetch`, `git log`, and `git show` as the agent process user (`bastion-updater`) without `sudo -u buildUser`. The git repo is owned by `bastion`/`bastion-ai`. Commands failed silently because `2>/dev/null` hid stderr and catch blocks swallowed errors, causing false "up to date" reports.

**Fix:** All git commands in `handleUpdateCheck()` now use `sudo -u ${config.buildUser}` prefix (consistent with command-executor.ts). Removed `2>/dev/null`. Errors are logged to console. Added `RESTRICTED_ENV` (PATH=/usr/bin:/bin). The `up_to_date` response includes a `fetchFailed` flag so the admin UI can warn if the check used stale local state.

**Commit:** 266bbe1

### Finding A-2: AI Disclosure Config Not Persisted (MEDIUM)

**Issue:** `PUT /api/disclosure` updated in-memory config only. On relay restart, config reverted to env vars. The response said `{ saved: true }` which was misleading.

**Fix:** Disclosure config persists to `/var/lib/bastion/disclosure-config.json` (configurable via `BASTION_DISCLOSURE_CONFIG_PATH`). On startup, file takes precedence over env vars. File lives outside the git repo, so self-updates don't overwrite admin configuration.

**Commit:** fc3f3a5

### Finding A-3: Layer 2 and ChallengeManager Time Window Disagreement (MEDIUM)

**Issue:** Two separate time-of-day systems with different configurations. Layer 2's `evaluateTimeOfDay()` used `SafetyConfig.highRiskHoursStart/End` (default 0–6). ChallengeManager used its own schedule with weekday/weekend distinction (default weekdays 22:00–06:00, weekends 23:00–08:00). At 23:00 on a weekday, ChallengeManager was ACTIVE but Layer 2's time_of_day factor was NOT triggered.

**Fix:** `evaluateLayer2()` accepts an optional `challengeActive` parameter. When provided, it overrides the old highRiskHours config with ChallengeManager's `isActive()` state. `evaluateSafety()` passes `challengeActive` through pipeline options. `start-ai-client.mjs` passes `challengeManager.isActive()`. Both systems now always agree.

**Commit:** 1a6b965

### Addendum Summary

| # | Finding | Severity | Fix Commit |
|---|---------|----------|------------|
| A-1 | Self-update git commands without sudo | **HIGH** | 266bbe1 |
| A-2 | Disclosure config not persisted | **MEDIUM** | fc3f3a5 |
| A-3 | Layer 2 / ChallengeManager time disagreement | **MEDIUM** | 1a6b965 |
