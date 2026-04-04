# Bastion Extension System Audit — 2026-04-04

**Auditor:** Claude Opus 4.6 (automated, 3 parallel agents)
**Scope:** Byte-level readiness audit for Naval-Chronicle integration
**Action:** Report only. No fixes applied.

---

## Executive Summary

The Bastion extension system has a **well-designed relay-side foundation** (ExtensionRegistry with namespace validation, safety levels, adapter hints, audit config, UI manifests, dependency tracking) but **zero AI-client-side awareness**. Extension messages transit the relay correctly via generic forwarding and are E2E encrypted, but the AI client silently drops them at the "Unhandled message type" fallback. The extension metadata (safety, adapterHint, audit config) defined in JSON manifests is loaded and validated by the relay but **never consumed by any runtime code**.

| Area | PASS | PARTIAL | FAIL | MISSING |
|------|------|---------|------|---------|
| Registration & Loading | 7 | 1 | 0 | 0 |
| Message Routing | 4 | 2 | 2 | 2 |
| Adapter Hint Routing | 3 | 1 | 1 | 1 |
| Extension UI | 8 | 2 | 0 | 0 |
| Core Feature Integration | 1 | 4 | 0 | 3 |
| AI Client Support | 0 | 1 | 1 | 4 |
| **Totals** | **23** | **11** | **4** | **10** |

---

## PART 1: Extension Registration & Loading

### 1.1 Manifest Discovery

**Verdict: PASS**

- **File**: `packages/relay/src/extensions/extension-registry.ts:158-209`
- **File**: `start-relay.mjs:170-183`
- Extensions loaded from `BASTION_EXTENSIONS_DIR` env var (default `./extensions`)
- Scans `.json` files at top-level and one directory deep
- Deterministic, configurable discovery

### 1.2 Validation

**Verdict: PARTIAL**

Checks performed (`extension-registry.ts:215-408`):
- `namespace`: required, string, regex `/^[a-z0-9-]+$/`
- `name`, `version`: required strings
- `messageTypes`: required array, each with `name`, `safety`, `audit`
- Duplicate namespace detection
- Hard caps: 25 extensions max, 250 total message types
- UI validation: path traversal blocked, messageTypes ownership checked

**Gap**: The `safety` field is validated as a string but NOT checked against the valid enum (`'passthrough' | 'task' | 'admin' | 'blocked'`). An extension could declare `safety: "anything"`.

### 1.3 Routing Table Separation

**Verdict: PASS**

Extensions stored in a separate `Map<string, ExtensionDefinition>` within `ExtensionRegistry`. NOT merged with core protocol types. Clean separation.

### 1.4 Post-Startup Lock

**Verdict: PASS**

- `lock()` called exactly once at startup (`start-relay.mjs:179`)
- Subsequent `register()` calls return error: `'Extension Violation Detected — Registry is locked after startup'`
- Lock is set even if dependency validation fails

### 1.5 Example File Skipping

**Verdict: PASS**

- Files with `"_example": true` in JSON content are skipped (`extension-registry.ts:192-195`)
- Both example files in repo have this flag set

### 1.6 Collision Detection

**Verdict: PASS**

- `namespace:type` format inherently prevents collisions with core types (core types never contain `:`)
- `resolveMessageType()` only resolves types containing `:`

### 1.7 Namespace Validation

**Verdict: PASS**

- Pattern: `/^[a-z0-9-]+$/` (lowercase alphanumeric + hyphens)
- 12 reserved namespaces: `bastion`, `admin`, `system`, `internal`, `core`, `protocol`, `relay`, `auth`, `safety`, `audit`, `debug`, `test`

### 1.8 ExtensionDefinition Interface

**Verdict: PASS**

```typescript
interface ExtensionDefinition {
  namespace: string; name: string; version: string;
  description: string; author: string;
  messageTypes: ExtensionMessageType[];
  dependencies?: string[];
  ui?: ExtensionUI;  // pages → components with placement, audit, sandboxing
}

interface ExtensionMessageType {
  name: string; description: string;
  fields: Record<string, unknown>;
  safety: ExtensionSafetyLevel;
  adapterHint?: string;  // 'cheapest' | 'fastest' | 'smartest' | 'default' | adapter ID
  audit: { logEvent: boolean; logContent: boolean };
}
```

---

## PART 2: Message Routing for Extension Types

### Trace: `game:turn_submit` from Human → Relay → AI

| Step | What Happens | File:Line | Verdict |
|------|-------------|-----------|---------|
| 1. Human sends | Bridge validates type is not core, is in allowedTypes | `bridge.ts:271-286` | **PASS** |
| 2. Relay receives | No explicit `:` recognition; falls through all `if` checks | `start-relay.mjs:645-1388` | **PARTIAL** |
| 3. Relay validates type | `resolveMessageType()` exists but is NEVER called during routing | `start-relay.mjs` (absent) | **FAIL** |
| 4. Sender restrictions | `SENDER_TYPE_RESTRICTIONS` only has core types; extension types pass unconditionally | `start-relay.mjs:606-643` | **MISSING** |
| 5. Relay forwards | Generic peer-forward at end of handler chain works correctly | `start-relay.mjs:1357-1387` | **PASS** |
| 6. AI client handler | No generic handler for `namespace:type` messages | `start-ai-client.mjs:2280` | **FAIL** |
| 7. No-handler behaviour | `console.log('[←] Unhandled message type: game:turn_submit')` — silent drop, no error feedback | `start-ai-client.mjs:2280` | **PARTIAL** |
| 8. Response path | No response possible — AI drops the message | — | **MISSING** |
| 9. E2E encryption | Extension types NOT in `PLAINTEXT_TYPES` — correctly encrypted | `start-ai-client.mjs:766-771` | **PASS** |
| 10. Plaintext exceptions | 14-15 control types; extension types excluded | Both start scripts | **PASS** |

### Critical Finding

**Extension messages are dead-on-arrival at the AI client.** The human client can send `game:turn_submit`, it gets encrypted, forwarded by the relay, decrypted by the AI client, and then silently logged as "Unhandled message type" with no processing, no error response, and no audit entry.

---

## PART 3: Adapter Hint Routing

| Check | Result | Detail |
|-------|--------|--------|
| 3.1 Manifest supports `adapterHint` | **PASS** | Per-message-type field on `ExtensionMessageType`, validated at registration |
| 3.2 Hint consumed at runtime | **MISSING** | `resolveHint()` exists in AdapterRegistry but is never called anywhere |
| 3.3 Adapter selection methods exist | **PASS** | `getCheapest()`, `getCheapestByRole()`, `getMostCapableByRole()`, `resolveHint()`, `selectAdapter()`, `getByRole()`, `getDefault()` — 9 methods total |
| 3.4 Extension message adapter routing | **FAIL** | Extension messages fall to "Unhandled message type" — no adapter call |
| 3.5 Per-type different hints | **PASS** (schema) | `adapterHint` is per-message-type, not per-extension. But never consumed at runtime |
| 3.6 Fallback on missing adapter | **PARTIAL** | `resolveHint()` has correct fallback logic but is never exercised |

### Naval-Chronicle Impact

Naval-Chronicle needs multi-adapter routing per turn (Haiku for faction AI, Sonnet for GM, Opus for chronicler). The `AdapterRegistry` has all the methods needed (`getCheapestByRole('game')`, `getMostCapableByRole('research')`), and the `AdapterRole` type includes `'game'`. The Haiku adapter is already registered with the `'game'` role. But the `OperationType` enum lacks `'game'`, and `resolveHint()` is never called from the message handler.

---

## PART 4: Extension UI

| Check | Result | Detail |
|-------|--------|--------|
| 4.1 UI fields in ExtensionDefinition | **PASS** | Full hierarchy: `ExtensionUI → ExtensionUIPage → ExtensionUIComponent` with placement, audit, size |
| 4.2 Extension UI route exists | **PASS** | `/extensions/[namespace]` SvelteKit dynamic route renders `main` and `full-page` components |
| 4.3 Extension discovery | **PASS** | `extension_query` → `extension_list_response` over WebSocket; stored in Svelte store |
| 4.4 Admin API for extensions | **PASS** | `GET /api/extensions` (summary), `GET /api/extensions/:ns` (full definition) |
| 4.5 HTML delivery | **PASS** | Inline in WebSocket `extension_list_response`; relay reads via `readUIFile()` with path traversal check |
| 4.6 Iframe CSP | **PARTIAL** | `sandbox="allow-scripts"` + regex content scanning (13 patterns), but no explicit CSP header/meta injected |
| 4.7 Bridge message types | **PASS** | Outbound: `send`, `getTheme`, `getConversationId`, `isChallengeHoursActive`, `requestConfirmation`. Inbound: `bastion-forward`, `bastion-reply` |
| 4.8 Iframe reads AI state | **PARTIAL** | Limited: conversationId, challenge status, forwarded extension messages. No access to memory, budget, conversation history |
| 4.9 Iframe sends protocol messages | **PASS** | Validated against `allowedTypes`; core types blocked; 5 violations = component disabled |
| 4.10 Rendering location | **PASS** | Separate route with sidebar nav; `sidebar` and `settings-tab` placements defined but not rendered |
| 4.11 Multiple components | **PASS** | Multiple within same extension (vertical stack); one extension route active at a time |

### Naval-Chronicle Impact

The UI system is the **most complete** part of the extension architecture. Naval-Chronicle could render its game board in a sandboxed iframe with its own `/extensions/game` route. The bridge supports sending game messages (`game:turn_submit`) and receiving forwarded responses. The main gap is that the AI client won't process those messages.

---

## PART 5: Extension + Core Feature Integration

| Integration Point | Verdict | Detail |
|-------------------|---------|--------|
| 5.1 BudgetGuard tracking | **PARTIAL** | UsageTracker records all API calls, but extension messages can't trigger API calls (unhandled) |
| 5.2 Audit trail logging | **PARTIAL** | Messages logged via generic `message_routed` event, but extension-specific `audit.logEvent`/`audit.logContent` config is never consulted |
| 5.3 Challenge Me More | **MISSING** | Safety pipeline only runs for `msg.type === 'task'`. Extension `safety` field defined but never enforced |
| 5.4 E2E encryption | **PASS** | Extension types correctly NOT in plaintext exceptions — encrypted by default |
| 5.5 Compaction | **PARTIAL** | Compaction is type-agnostic (would work if messages stored), but no extension-aware summarisation |
| 5.6 Memory proposals | **PARTIAL** | `[BASTION:MEMORY]` parser is type-agnostic, but unreachable for extensions (no API call triggered) |
| 5.7 Conversation storage | **MISSING** | Extension messages not persisted in ConversationStore. Schema could accept them if wired |
| 5.8 File airlock | **MISSING** | Architecture has no type restrictions (could work), but no extension code to invoke it |

---

## PART 6: AI Client Extension Support

| Check | Verdict | Detail |
|-------|---------|--------|
| 6.1 Generic extension handler | **MISSING** | No dispatch for `namespace:type` messages. Monolithic if-else chain |
| 6.2 `game:turn_submit` code path | **FAIL** | Passes through all 40+ handler blocks → `console.log('[←] Unhandled message type: game:turn_submit')` |
| 6.3 Plugin/module system | **MISSING** | No plugin loader, no hook mechanism, no dynamic handler registration |
| 6.4 Extension state directory | **MISSING** | No configurable `/var/lib/bastion/extensions/` path. No extension data management |
| 6.5 External repo integration | **Option (a) only** | Direct import into `start-ai-client.mjs` is the only viable path. MCP tools impractical (per-call approval). No IPC. |
| 6.6 Adapter hint passthrough | **PARTIAL** | `resolveHint()` and `adapterHint` exist in schema. `AdapterRole` includes `'game'`. But never wired to message handling |

---

## PART 7: Naval-Chronicle Gap Analysis

### What WORKS Today

| Capability | Status | Notes |
|-----------|--------|-------|
| Extension manifest registration | **WORKS** | JSON manifest → validated → locked at startup |
| Namespace validation & collision prevention | **WORKS** | `game:*` types structurally distinct from core |
| E2E encryption of game messages | **WORKS** | Extension types encrypted by default |
| Extension UI rendering (iframe) | **WORKS** | `/extensions/game` route, sandboxed, bridge communication |
| Bridge: iframe sends game messages | **WORKS** | `window.bastion.send('game:turn_submit', payload)` validated & encrypted |
| Extension discovery by human client | **WORKS** | `extension_query` → `extension_list_response` |
| Relay forwards game messages to AI | **WORKS** | Generic peer-forward path handles any type |
| Adapter registry with game role | **WORKS** | `AdapterRole: 'game'`, Haiku registered with game role |
| `resolveHint()` method | **WORKS** | Correctly maps 'cheapest'→Haiku, 'smartest'→Opus, 'default'→Sonnet |
| Audit logging of transit | **WORKS** | `message_routed` event captures all forwarded messages |

### What PARTIALLY Works (needs enhancement)

| Capability | Gap | Effort |
|-----------|-----|--------|
| Relay type validation | `resolveMessageType()` exists but not called during routing. Wire it. | **Small** |
| Sender restrictions for extensions | Manifests declare safety levels but relay doesn't consult them. Add lookup. | **Small** |
| Extension audit config | `audit.logEvent`/`logContent` fields defined but never read at runtime. | **Small** |
| Safety level enforcement | Extension `safety: 'task'` should trigger safety pipeline. Wire `resolveMessageType()` → safety check. | **Medium** |
| Iframe CSP hardening | Add explicit `<meta http-equiv="Content-Security-Policy">` to srcdoc. | **Small** |
| Bridge state access | Iframe can't read game state from AI. Add `getExtensionState(namespace)` bridge method. | **Medium** |
| Sidebar/settings-tab placement | Declared in schema but rendering only supports `main`/`full-page`. | **Small** |

### What's COMPLETELY MISSING (needs building)

| Capability | Description | Effort | Blocker? |
|-----------|-------------|--------|----------|
| **AI client extension message dispatch** | Generic handler for `namespace:type` messages with dispatch to registered extension handlers | **Large** | **YES** |
| **Extension handler registration API** | Mechanism for external code to register handlers for extension message types | **Large** | **YES** |
| **Multi-adapter routing per turn** | Route different game message types to different adapters based on `adapterHint` | **Medium** | **YES** |
| **Game state persistence** | SQLite or file-based storage at `/var/lib/bastion/extensions/game/` | **Medium** | **YES** |
| **Game session ↔ conversation mapping** | Store game turns as conversation messages with `type: 'game'` | **Medium** | No |
| **Extension-aware compaction** | Custom summarisation for game sessions (don't blindly summarise faction state) | **Medium** | No |
| **`OperationType: 'game'`** | Add to enum so `selectAdapter('game')` works with role-based routing | **Small** | **YES** |
| **Safety level validation** | Validate `safety` field against enum during registration | **Small** | No |
| **Extension state bridge** | `getExtensionState(namespace)` → request AI client state via bridge | **Medium** | No |
| **File airlock for game export** | Wire extension handler to produce `file_manifest` for state export | **Small** | No |

### Blocker Summary

**4 blockers** prevent Naval-Chronicle from functioning:

1. **AI client extension message dispatch** — Without this, game messages are silently dropped. This is the #1 blocker. Requires adding a generic `namespace:type` handler that looks up the extension, resolves the adapter hint, and dispatches to registered handler functions.

2. **Extension handler registration API** — Naval-Chronicle's game engine code needs a way to register handlers (`game:turn_submit` → `handleTurnSubmit()`). This could be a simple `Map<string, Handler>` with a `registerExtensionHandler(type, fn)` API.

3. **Multi-adapter routing per turn** — The `resolveHint()` method and `adapterHint` field exist but are unwired. Need to: read hint from `extensionRegistry.resolveMessageType()`, call `adapterRegistry.resolveHint()`, use the result for the API call.

4. **`OperationType: 'game'`** — The adapter selection system needs a `'game'` operation type so that `selectAdapter('game')` correctly routes to adapters with the `'game'` role (Haiku).

### Effort Estimate

| Category | Items | Estimated Effort |
|----------|-------|-----------------|
| Blockers (must-have) | 4 | 2-3 days |
| Enhancements (should-have) | 7 | 2-3 days |
| Nice-to-haves | 4 | 1-2 days |
| **Total for Naval-Chronicle readiness** | **15** | **5-8 days** |

---

## Architecture Diagram: Current vs Required

```
CURRENT STATE:
  Human [game UI iframe] → bridge.send('game:turn_submit')
    → session.sendSecure() → encrypted → relay
    → generic peer-forward → AI client
    → "Unhandled message type: game:turn_submit" ← DEAD END

REQUIRED STATE:
  Human [game UI iframe] → bridge.send('game:turn_submit')
    → session.sendSecure() → encrypted → relay
    → extensionRegistry.resolveMessageType() → validate safety level
    → forward to AI client → encrypted
    → extension dispatch → resolveHint('cheapest') → Haiku adapter
    → API call → response → [BASTION:MEMORY] parsed
    → game:turn_result → encrypted → relay → forward → human
    → bridge.forward('game:turn_result') → iframe receives
```

---

## Test Suite Status

Test suite run to confirm current state is stable. See below.

```
=== Bastion Unified Test Runner ===
14 test files, all passing:

  packages/client-ai/data-portability-test.mjs      80 passed
  packages/client-ai/file-handling-trace-test.mjs   155 passed
  packages/client-ai/trace-test.mjs                 566 passed
  packages/client-human-mobile/trace-test.mjs       123 passed
  packages/client-human/trace-test.mjs              321 passed
  packages/crypto/trace-test.mjs                    134 passed
  packages/relay-admin-ui/trace-test.mjs            239 passed
  packages/relay/admin-trace-test.mjs               312 passed
  packages/relay/file-transfer-trace-test.mjs        96 passed
  packages/relay/quarantine-trace-test.mjs          105 passed
  packages/relay/trace-test.mjs                     353 passed
  packages/tests/file-transfer-integration-test.mjs  105 passed
  packages/tests/integration-test.mjs               118 passed
  packages/tests/trace-test.mjs                     257 passed

  Total: 2,964 tests — 2,964 passed, 0 failed
```

---

*Report generated 2026-04-04 by automated audit. No code was modified.*
