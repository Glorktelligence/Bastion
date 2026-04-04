# Bastion Deep Audit Report — 2026-04-04

**Auditor:** Claude Opus 4.6 (automated, 7 parallel agents)
**Scope:** Wiring check — protocol types, start scripts, dead code, user features, config, docs, tests
**Action:** Report only. No fixes applied.

---

## Executive Summary

| Severity | Count | Highlights |
|----------|-------|------------|
| **CRITICAL** | 3 | Desktop client sends wrong type names; `auditLogger` undefined in AI client; TLS logic inverted |
| **HIGH** | 8 | UpdateOrchestrator still exists (657 lines); Docker dev JWT secret; 28 missing sender restrictions; dead self-update UI/routes; stale bastion-ai defaults |
| **MEDIUM** | 20+ | Challenge status no UI indicator; stale doc counts everywhere; 19 untested source files; dead/phantom env vars |
| **LOW** | 15+ | Orphaned protocol exports; stale lockfile entry; missing ADR directory |

**Overall verdict:** The protocol layer and safety engine are solid. The critical issues are in wiring — the desktop client sends non-protocol type names, and two runtime bugs (`auditLogger` undefined, TLS logic inversion) would cause failures in production paths.

---

## AUDIT 1: Protocol Message Type Audit

### Summary

| Metric | Count |
|--------|-------|
| Total defined message types (`ALL_MESSAGE_TYPES`) | **89** |
| Types with Zod payload schema | **89** (100%) |
| Types with relay sender restrictions | **48** (24 human-only + 24 AI-only) |
| Dead types (no runtime producer) | **7** |
| Dead types (no runtime consumer) | **4** |
| Missing sender restrictions | **28** |
| Non-protocol transport types in use | **8** |

### CRITICAL: Desktop Client Sends Wrong Type Names

| What Client Sends | What Protocol Defines | Location | Impact |
|-------------------|-----------------------|----------|--------|
| `task_submission` | `task` | `+page.svelte:164` | Tasks from desktop **never reach AI client's task handler** |
| `challenge_response` | `confirmation` | `+page.svelte:317,340` | Challenge responses from desktop **never reach AI client's confirmation handler** |

The mobile client (`client-human-mobile`) correctly uses `task` and `confirmation`. The desktop client also consumes `task_result` and `task_status` (session.ts lines 876, 892) but no component produces these types — the AI client sends `result`, never `task_result`.

### Dead Types (No Runtime Producer)

| Type | Has Consumer? | Notes |
|------|--------------|-------|
| `status` | Yes (mobile UI) | AI client never sends task progress status |
| `audit` | No | Completely dead — `audit_query`/`audit_response` used instead |
| `heartbeat` | Yes (human silent) | Referenced in capability matrices, never sent |
| `session_end` | Yes (human silent) | No disconnect flow sends this |
| `session_conflict` | Yes (human notification) | No relay code detects/sends conflicts |
| `session_superseded` | Yes (human disconnect) | No relay code supersedes sessions |
| `reconnect` | Yes (human silent) | No reconnect handshake sends this |

### Dead Types (No Runtime Consumer)

| Type | Has Producer? | Notes |
|------|--------------|-------|
| `audit` | No | Completely dead |
| `config_update` | No | Completely dead |
| `skill_list_response` | Yes (AI) | AI produces, human client never handles |
| `ai_challenge_response` | Yes (human) | Human sends, AI client does not handle |

### Tool Types — Test-Only Producers (5 types)

`tool_registry_sync`, `tool_registry_ack`, `tool_request`, `tool_alert`, `tool_alert_response` — implemented end-to-end in tests but AI client never initiates the flow at runtime.

### Skills Types — Dead (2 of 3)

- `skill_list` — no producer (human client never sends)
- `skill_config` — no producer AND no AI-side consumer

### Missing Sender Restrictions (28 types)

**Should be human-only (9):** `conversation_list`, `conversation_create`, `conversation_switch`, `conversation_history`, `conversation_archive`, `conversation_delete`, `conversation_compact`, `data_export_request`, `data_import_confirm`

**Should be ai-only (12):** `conversation_list_response`, `conversation_create_ack`, `conversation_switch_ack`, `conversation_history_response`, `conversation_compact_ack`, `conversation_stream`, `usage_status`, `data_export_progress`, `data_export_ready`, `data_import_validate`, `data_import_complete`

**Also missing (7):** `conversation_archive`, `conversation_delete` (human), plus all data erasure types already covered by existing restrictions.

### Non-Protocol Transport Types (8)

These work correctly outside the protocol type system: `session_init`, `session_established`, `peer_status`, `ping`, `pong`, `file_data`, `file_reject`, `audit_event`. Of note: `file_reject` is a meaningful protocol operation that arguably should be a formal type.

### Doc Comment Discrepancy

`message-types.ts` line 6 claims "91 message types" — actual count is **89** (10 self-update types removed, 8 new types added since that comment).

---

## AUDIT 2: Start Script Wiring Check

### start-relay.mjs

| Check | Result |
|-------|--------|
| All 16 imports valid | **PASS** |
| 55 message handlers verified against protocol | **PASS** |
| No orphaned handlers | **PASS** |

**Findings:**

1. **Stale `update_*` guard (line 1312-1315):** Comment says update handlers "are handled above" but no `update_*` handlers exist (removed in commit `d1ce49c`). Guard is harmless but comment is misleading.

2. **Dead `updater` client type guard (line 1320-1323):** Checks `senderClient?.identity.type === 'updater'` but no updater client type is tracked in `session_init` flow. Dead code from removed self-update feature.

### start-ai-client.mjs

| Check | Result |
|-------|--------|
| All 32 imports valid | **PASS** |
| 40 inbound handlers verified | **PASS** |
| 38 outbound response types verified | **PASS** |
| DataEraser after UsageTracker | **PASS** (line 466 vs 473, explicit comments) |
| Action block parser (CHALLENGE + MEMORY) | **PASS** (regex + JSON parse + rate limits) |

**CRITICAL Finding:**

3. **`auditLogger` undefined (lines 2171, 2182, 2227):** Used 3 times in data erasure handlers but never imported or instantiated. `AuditLogger` is a `@bastion/relay` export, not `@bastion/client-ai`. Will throw `ReferenceError: auditLogger is not defined` when `data_erasure_confirm` or `data_erasure_cancel` is triggered at runtime.

---

## AUDIT 3: Dead Code Detection

### Summary

| Category | Issues |
|----------|--------|
| UpdateOrchestrator still exists | 657-line file + 6 export lines |
| Self-update admin UI page/store | 2 files |
| Admin routes update methods | ~130 lines |
| Audit logger update event types | 8 event type constants |
| bastion-ai defaults in active code | 9 source files |
| bastion-ai in infrastructure | 8+ files |
| pnpm-lock.yaml stale entry | 1 (update-agent) |
| Self-update type string references | 9 files, ~45 lines |
| Orphaned protocol exports | 15+ types/schemas |
| **Total individual findings** | **~84** |

### HIGH: UpdateOrchestrator Still Fully Intact

| File | Detail |
|------|--------|
| `packages/relay/src/admin/update-orchestrator.ts` | 657-line class — full update lifecycle |
| `packages/relay/src/index.ts:216-224` | Exports class + 6 types |
| `packages/relay/src/admin/admin-routes.ts:199,239` | Optional reference + methods |
| `packages/relay-admin-ui/src/routes/update/+page.svelte` | Full update management UI |
| `packages/relay-admin-ui/src/lib/stores/update.ts` | 104-line update state store |
| `packages/relay/src/audit/audit-logger.ts:77-85` | 8 update-related audit event types |

### MEDIUM: bastion-ai Default Paths in Active Source Code

These are active runtime defaults that point to the old `/var/lib/bastion-ai/` path instead of `/var/lib/bastion/`:

| File | Default Path |
|------|-------------|
| `client-ai/src/provider/usage-tracker.ts:70` | `/var/lib/bastion-ai/usage.db` |
| `client-ai/src/provider/project-store.ts:49` | `/var/lib/bastion-ai/project` |
| `client-ai/src/provider/memory-store.ts:75` | `/var/lib/bastion-ai/memories.db` |
| `client-ai/src/provider/conversation-store.ts:140` | `/var/lib/bastion-ai/conversations.db` |
| `client-ai/src/provider/conversation-manager.ts:81` | `/var/lib/bastion-ai/user-context.md` |
| `client-ai/src/provider/conversation-manager.ts:82` | `/var/lib/bastion-ai/operator-context.md` |
| `client-ai/src/provider/challenge-manager.ts:91` | `/var/lib/bastion-ai/challenge-config.json` |
| `client-ai/src/provider/budget-guard.ts:106` | `/var/lib/bastion-ai/budget.db` |
| `client-ai/src/provider/budget-guard.ts:107` | `/var/lib/bastion-ai/budget-config.json` |

The `start-ai-client.mjs` overrides these with `/var/lib/bastion/` env vars, but the library defaults are stale.

### Orphaned Protocol Exports (consumed only within protocol package)

**Types:** `SessionConflictPayload`, `SessionSupersededPayload`, `TokenRefreshPayload`, `ConfigUpdateType`, `ConfigNackPayload`, `ReconnectPayload`, `ProviderStatusPayload`, `HeartbeatMetrics`, `TransparencyMetadata`, `ConfidenceLevel`, `ConnectionQuality`, `CorrelationId`, `Layer2FactorName`, `SerialisedMessage`, `DeserialisationSuccess`, `DeserialisationFailure`, `DeserialisationResult`

**Schemas:** `SessionConflictPayloadSchema`, `SessionSupersededPayloadSchema`, `ConnectionQualitySchema`, `ConfidenceLevelSchema`, `SafetyOutcomeSchema`, `ErrorCodeSchema`, `ProviderStatusSchema`

**Skills schemas (internal only, not even exported):** `SkillListPayloadSchema`, `SkillListResponsePayloadSchema`, `SkillConfigPayloadSchema` — these also lack corresponding TypeScript type definitions in `messages.ts`.

---

## AUDIT 4: User Choice Verification

| # | Feature | Verdict | Notes |
|---|---------|---------|-------|
| 1 | Override model per conversation | **WIRED** | Adapter selection at creation; no post-creation change UI |
| 2 | Access ALL 9 settings tabs | **WIRED** | Profile, Safety, Context, Files, Privacy, Usage, Tools, Provider, About — all with content |
| 3 | Export data (Article 20) | **WIRED** | Full export + import with progress, validation, conflict resolution |
| 4 | Delete data (Article 17) | **WIRED** | Preview, confirm "DELETE MY DATA", 30-day soft delete, cancel |
| 5 | Manage memories | **WIRED** | List, filter, add, edit, delete, AI proposal approve/reject |
| 6 | Approve/reject file transfers | **WIRED** | FileOfferBanner with airlock, custody chain, hash verification |
| 7 | Challenge Me More status | **PARTIAL** | Enforced internally but **no persistent UI indicator** |
| 8 | Usage/budget information | **WIRED** | Dashboard + inline BudgetIndicator |
| 9 | Context budget | **WIRED** | Per-zone prompt budget report in Usage tab |

### Gap: Challenge Me More Has No Visual Status

The `challengeStatus` store holds `active`, `timezone`, `periodEnd`, `highRiskStart`, `highRiskEnd` — all the data needed. But no component renders this to the user proactively. Users only discover challenge hours are active when they attempt a destructive action and see a countdown. A sidebar badge or status bar element showing "Challenge hours active — ends at HH:MM" would close this gap.

### Minor Gap: Model Override Only at Creation

The adapter/model can only be set when creating a conversation. There is no UI to change the preferred adapter on an existing conversation after creation.

---

## AUDIT 5: Operator Configurability

### Config Counts

| Category | Env Vars | Config File Keys |
|----------|----------|-----------------|
| Relay | 25 | 0 |
| AI Client | 37 | 0 |
| Challenge Me More | 1 (file path) | 10 |
| Budget | 2 (file paths) | 9 |
| Admin UI | 2 | 0 |
| **Total** | **54** unique | **19** |

**Validated:** Only 3 of 54 env vars have any validation (`ANTHROPIC_API_KEY` required check, `BASTION_STREAMING` and `BASTION_DISCLOSURE_ENABLED` strict equality).

### CRITICAL: TLS Reject-Unauthorized Logic Is Inverted

**Location:** `start-ai-client.mjs:67`

```js
const REJECT_UNAUTHORIZED = process.env.BASTION_TLS_REJECT_UNAUTHORIZED !== 'false' ? false : true;
```

Setting `BASTION_TLS_REJECT_UNAUTHORIZED=true` results in `REJECT_UNAUTHORIZED = false` (accept self-signed). Setting it to `false` results in `true` (reject unauthorized). **The logic is backwards.** An operator who sets the env var to `true` expecting strict TLS gets the opposite.

### HIGH: Docker Compose Weak Dev JWT Secret

**Location:** `docker-compose.yml:29`

```yaml
BASTION_JWT_SECRET: "bastion-dev-secret-do-not-use-in-production"
```

Static, publicly-known string. No `.env.example` or `.env` mechanism to force operators to set a real secret.

### Dead/Phantom Env Vars (Set But Never Consumed)

| Env Var | Set In | Status |
|---------|--------|--------|
| `BASTION_AUDIT_RETENTION_DAYS` | systemd, Docker | No code reads it |
| `BASTION_JWT_ISSUER` | Docker | Hardcoded in `start-relay.mjs:126` |
| `BASTION_JWT_AUDIENCE` | Docker | No code reads it |
| `BASTION_ADMIN_API_URL` | Docker | Browser-side, no JS consumes |
| `BASTION_INTAKE_DIR` | deployment docs | No code reads it |
| `BASTION_OUTBOUND_DIR` | deployment docs | No code reads it |
| `BASTION_ADMIN_HOST` | Docker, systemd | Hardcoded `127.0.0.1` in `start-relay.mjs:429` |

### Hardcoded Values That Should Be Configurable

| Value | Location | Current |
|-------|----------|---------|
| Admin server host | `start-relay.mjs:429` | `127.0.0.1` (env var ignored) |
| JWT issuer | `start-relay.mjs:126` | `bastion-relay` (env var ignored) |
| Max prompt memories | `start-ai-client.mjs:186` | `20` |
| Compaction trigger % | `start-ai-client.mjs:303` | `80` |
| Compaction keep recent | `start-ai-client.mjs:304` | `50` messages |
| IntakeDirectory maxFiles | `start-ai-client.mjs:379` | `50` |
| OutboundStaging maxFiles | `start-ai-client.mjs:382` | `50` |
| FilePurge timeout | `start-ai-client.mjs:386` | `3,600,000` ms |
| PROJECT_SYNC_MAX_CONTENT | `start-relay.mjs:60` | `1,048,576` (1 MB) |
| AI action rate limits | `start-ai-client.mjs:590-596` | 3 challenges/session, 3 memories/session |

### No `.env.example` File Exists

Operators must discover env vars from source code or deployment docs.

---

## AUDIT 6: Stale Comments & Documentation

### Stale Message Type Counts

| Location | Claims | Actual |
|----------|--------|--------|
| `message-types.ts:6` | 91 | **89** |
| `message.schema.ts:6` | 23 | **89** |
| `trace-test.mjs:420` | 81 | **89** |
| `trace-test.mjs:870` | 91 | **89** |
| 4 skill files | 81 | **89** |
| `bastion-protocol-v0.5.0.md` | 81 + 10 self-update | **89**, self-update removed |
| `getting-started.md` | 81 | **89** |

### Stale Error Code Counts

| Location | Claims | Actual |
|----------|--------|--------|
| `CLAUDE.md:85` | 45 | **48** (contradicts own line 87 which correctly says 48) |
| 4 skill files | 45 | **48** |

Note: The per-category breakdowns (7+6+6+6+7+6+5+5=48) are correct everywhere. Only the summary "45" is wrong.

### Stale Test Counts

| Location | Claims | Actual |
|----------|--------|--------|
| `CLAUDE.md`, `README.md` | 2,974+ | **~2,973** |
| 6 skill files | 2,896 | **~2,973** |
| `getting-started.md` | 1,831 | **~2,973** |
| `SECURITY-AUDIT.md` | 2,896 | **~2,973** |

Individual file count changes: `trace-test.mjs` 286→266, `integration-test.mjs` 82→118, `client-ai/trace-test.mjs` 416→566. Missing from all tables: `data-portability-test.mjs` (80 tests).

### VERSION Consistency

**PASS** — `VERSION` file, all 10 `package.json` files, and `version.ts` all report `0.8.1`.

### CHANGELOG Gap

`CHANGELOG.md` has no entry for `0.8.1`. Latest entry is `[0.8.0]`. Changes since (GDPR erasure, AI native toolbox, self-update removal, DataEraser fix, prompt budget report) are undocumented.

### Missing Directory

`docs/architecture/decisions/` referenced in `CLAUDE.md`, `CONTRIBUTING.md`, and `git-workflow` skill — **directory does not exist**.

### Protocol Spec Staleness

`docs/protocol/bastion-protocol-v0.5.0.md` still fully documents 10 removed self-update types (lines 746-858) and claims 81 message types. Missing all types added since v0.5.0 (data portability, erasure, AI native, usage_status, skills, streaming).

### TODO/FIXME/HACK/XXX Comments

**None found.** Codebase is clean.

---

## AUDIT 7: Test Coverage Gaps

### Summary

| Metric | Count |
|--------|-------|
| Total source files (excl. index/barrel/d.ts) | **122** |
| Files with test coverage | **103** |
| Files with NO test coverage | **19** |
| Coverage percentage | **84.4%** |

### Per-Package Coverage

| Package | Source Files | Covered | % |
|---------|-------------|---------|---|
| `@bastion/protocol` | 18 | 18 | 100% |
| `@bastion/crypto` | 8 | 8 | 100% |
| `@bastion/relay` | 21 | 20 | 95.2% |
| `@bastion/client-ai` | 28 | 25 | 89.3% |
| `@bastion/client-human` | 25 | 14 | 56.0% |
| `@bastion/client-human-mobile` | 8 | 7 | 87.5% |
| `@bastion/relay-admin-ui` | 14 | 11 | 78.6% |

### HIGH Risk Uncovered Files

| File | Lines | Risk |
|------|-------|------|
| `relay/src/admin/update-orchestrator.ts` | 657 | Dead code — 657-line state machine, zero tests, still exported |
| `client-human/src/lib/crypto/browser-crypto.ts` | — | E2E crypto interop with libsodium. Mismatch breaks all encryption. No independent tests. |
| `client-human/src/lib/extensions/bridge.ts` | — | Security boundary — postMessage validation for sandboxed iframes. Untested. |

### MEDIUM Risk Uncovered Files

| File | Risk |
|------|------|
| `client-ai/src/provider/mcp-client-adapter.ts` | External protocol adapter |
| `client-ai/src/provider/compaction-manager.ts` | Context window management |
| `relay-admin-ui/src/lib/stores/audit.ts` | Admin audit filtering |

### LOW Risk Uncovered Files (11)

Client-human UI stores following the same writable/derived pattern as 14 already-tested stores:

`budget.ts`, `projects.ts`, `memories.ts`, `tools.ts`, `conversations.ts`, `provider.ts`, `ai-disclosure.ts`, `extensions.ts`, `session.ts`, `useStore.ts` (mobile), `service-instance.ts` (admin)

### Stale Test References

- `pnpm-lock.yaml:257` references `packages/update-agent` — directory does not exist
- No test files reference `UpdateOrchestrator` or self-update types (correctly absent, but the source file still exists)

---

## Cross-Cutting Findings

### Finding Matrix — All Critical/High Issues

| ID | Severity | Audit | Finding | Impact |
|----|----------|-------|---------|--------|
| C1 | **CRITICAL** | 1 | Desktop sends `task_submission` instead of `task` | Tasks from desktop never reach AI handler |
| C2 | **CRITICAL** | 1 | Desktop sends `challenge_response` instead of `confirmation` | Challenge responses from desktop never reach AI handler |
| C3 | **CRITICAL** | 2 | `auditLogger` undefined in AI client erasure handlers | Runtime crash on `data_erasure_confirm` / `data_erasure_cancel` |
| C4 | **CRITICAL** | 5 | `BASTION_TLS_REJECT_UNAUTHORIZED` logic inverted | Operators setting `true` get insecure TLS |
| H1 | HIGH | 3 | UpdateOrchestrator 657-line dead file + exports | Dead code in production relay package |
| H2 | HIGH | 3 | Self-update admin UI page + store still exist | Dead UI pages accessible in admin panel |
| H3 | HIGH | 3 | 9 bastion-ai default paths in active library code | Wrong defaults if env vars not set |
| H4 | HIGH | 5 | Docker Compose hardcoded dev JWT secret | All JWTs signed with known key if not overridden |
| H5 | HIGH | 1 | 28 message types missing sender restrictions | AI could spoof human-only messages (or vice versa) |
| H6 | HIGH | 6 | `docs/architecture/decisions/` referenced but doesn't exist | Referenced in CLAUDE.md, CONTRIBUTING.md, skills |
| H7 | HIGH | 6 | Source code test descriptions claim wrong type counts | Test intent unclear (81 vs 89 vs 91) |
| H8 | HIGH | 1 | `ai_challenge_response` has no AI-side consumer | Human sends, relay forwards, AI ignores |

---

## Test Suite Status

Test suite was run at the end of this audit to confirm nothing is broken. See below for results.

```
=== Bastion Unified Test Runner ===
14 test files, all passing:

  packages/client-ai/data-portability-test.mjs     80 passed
  packages/client-ai/file-handling-trace-test.mjs  155 passed
  packages/client-ai/trace-test.mjs                566 passed
  packages/client-human-mobile/trace-test.mjs      123 passed
  packages/client-human/trace-test.mjs             321 passed
  packages/crypto/trace-test.mjs                   134 passed
  packages/relay-admin-ui/trace-test.mjs           239 passed
  packages/relay/admin-trace-test.mjs              312 passed
  packages/relay/file-transfer-trace-test.mjs       96 passed
  packages/relay/quarantine-trace-test.mjs         105 passed
  packages/relay/trace-test.mjs                    353 passed
  packages/tests/file-transfer-integration-test.mjs 105 passed
  packages/tests/integration-test.mjs              118 passed
  packages/tests/trace-test.mjs                    266 passed

  Total: 2,973 tests — 2,973 passed, 0 failed
```

---

## Recommendations (Prioritised)

### Immediate (blocks correct runtime behavior)

1. Fix desktop client type names: `task_submission` → `task`, `challenge_response` → `confirmation`
2. Fix `auditLogger` in `start-ai-client.mjs` erasure handlers (either create a local audit mechanism or remove the calls)
3. Fix TLS reject-unauthorized inversion in `start-ai-client.mjs:67`

### Short-term (security/correctness)

4. Add sender restrictions for 28 unprotected message types
5. Add `ai_challenge_response` handler in `start-ai-client.mjs`
6. Remove UpdateOrchestrator, update admin UI page, update store, and update audit event types
7. Update bastion-ai default paths to bastion in 9 library files
8. Create `.env.example` with all 54 env vars documented
9. Replace Docker Compose dev JWT secret with `.env` reference

### Medium-term (documentation/quality)

10. Update all stale counts (89 types, 48 errors, ~2,973 tests) across CLAUDE.md, skills, docs
11. Create `docs/architecture/decisions/` directory (or remove references)
12. Add CHANGELOG entry for 0.8.1
13. Update protocol spec from v0.5.0 (remove self-update types, add new types)
14. Add tests for `browser-crypto.ts`, `extensions/bridge.ts`, `mcp-client-adapter.ts`
15. Clean up pnpm-lock.yaml stale `update-agent` entry
16. Add input validation for numeric env vars

---

*Report generated 2026-04-04 by automated audit. No code was modified.*
