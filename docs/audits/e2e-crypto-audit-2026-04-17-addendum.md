# E2E Crypto Audit Addendum — Race Condition Trigger Identification

**Date:** 2026-04-17
**Author:** Claude (Opus 4.7, 1M context)
**Parent:** `docs/audits/e2e-crypto-audit-2026-04-17.md`
**Mode:** Read-only. No code changes.

---

## New evidence from Harry

> MAC errors reproduce in chat-only sessions with no file transfer active.

This rules out **§11(a)** (the `buildRelayEnvelope` file-control bypass) as the page-load trigger. The "1 on page load, ~23 per stream" pattern persists without any `file_manifest`/`file_offer`/`file_request`/`file_data` traffic. The primary desync must therefore originate in a path that is live in a pure chat session.

This addendum re-traces every encrypted send from the AI and every incoming-encrypted acceptance on the human, and locates the specific race.

---

## Summary

> **The trigger is the AI side's stale `e2eCipher`.** `e2eCipher` is a module-level singleton in `start-ai-client.mjs:942`. It is **never set back to null** on peer disconnect, peer reconnect, or new key_exchange. When the human reloads the page (or the WebSocket flaps), the AI receives a new `peer_status=active`, sends its new `key_exchange`, and sits in a window waiting for the human's new `key_exchange` to arrive — **with its old cipher still live**. Any encrypted send during that window (extension `pushState`, tool upstream alert, skill-watch scan result, or any re-emission triggered by the queue-drain) encrypts with **old keys and advances the old send counter**, then the cipher is replaced on `handleKeyExchange`. That one stale-key message arrives at the human *after* the human has created its new cipher, which starts at counter 0; the MAC check with new keys fails, the human's receive counter advances by one on the failure path (§4.1), and the chain is permanently off by one — exactly the "1 error on page load, then N per stream" pattern.

The human does not have the symmetric risk on page load because page load clears `globalThis`, so `sessionCipher` starts null. The human DOES have it on *unexpected disconnect* (audit §7.1 already notes the cipher is not destroyed on non-explicit disconnect).

---

## 1 — Every encrypted-send path on the AI (`start-ai-client.mjs`)

Here is the complete list of `sendSecure(...)` call sites and whether each can fire between "AI has cipher" and "human has cipher". `sendSecure` encrypts iff `e2eCipher` is non-null *and* the type is not in `PLAINTEXT_TYPES` (line 1063).

| # | Line | Type | Trigger | Fires during post-auth, pre-peer-cipher window? |
|---|------|------|---------|--------------------------------------------------|
| S1 | 747  | `extension_state_update` | Extension handler calls `pushState` from extensionContext | **YES** — extensions fire on any relay-routed message, including hydration queries forwarded through the AI while the key exchange is in flight |
| S2 | 1151 | `tool_alert` | `ToolUpstreamMonitor` detects a new MCP/Provider tool | Possible — monitor runs periodically; initial scan happens at `authenticated`; likely quiet during first second, not guaranteed |
| S3 | 1265 | `skill_scan_result` | `setInterval` → skills-dir poll | Unlikely on first connect (interval ≥ 10s and starts at `authenticated`) |
| S4 | 1780 | `memory_list_response` | Inside `memory_batch_decision` resolution | No — requires human message |
| S5 | 1883 | `context_response` | Inside `context_request` handler | **YES if queued and drained** — see §3 below |
| S6 | 2379 | `conversation_stream` | Claude stream chunk callback | No — requires conversation message which requires cipher on both sides |
| S7 | 2420 | `conversation_stream` (final) | End of stream | No |
| S8 | 2458 | `conversation` | Final assembled reply | No |
| S9 | 2495 | `result` | Task completion | No |
| S10 | 2593 | `conversation_stream` (final marker) | End of stream | No |
| S11 | 2652 | `response` | Tool response | No |
| S12 | 3046 | `ai_memory_proposal_batch` | Action-block parsing | No |
| S13 | 3100 | `dream_cycle_complete` | Dream cycle finish | No |
| S14 | 3147 / 3156 | `ai_memory_proposal` | Action-block parsing | No |
| S15 | 3171 | `ai_challenge` | Action-block parsing | No |

**S1, S2, S5** are the realistic candidates during the post-`peer_status=active` / pre-`human_KE` window on a stale-cipher reconnect.

S1 is the most likely: the extension dispatcher can fire on *any* relay-routed message (including hydration queries that arrive at the AI between peer_status and the human's key_exchange). In the stale-cipher case, `pushState → sendSecure('extension_state_update')` encrypts with the OLD cipher, sends one message, and advances the OLD send counter by one.

---

## 2 — Is there a gate that prevents this?

There are two obvious gates that *could* exist and don't:

### 2a — AI outgoing gate

**Absent.** `sendSecure` at `start-ai-client.mjs:1060-1089` only checks `!e2eCipher || PLAINTEXT_TYPES.has(type)`. A stale `e2eCipher` object is still truthy, so this gate is happy to encrypt with yesterday's keys. There is no `keyExchangePending` guard on the send side (the queue only applies to the receive side, `1343-1352`).

### 2b — Human outgoing gate

**Absent (and less risky today).** `session.ts:620` uses the same `!sessionCipher` form. On page load `sessionCipher` is null, so early sends fall through to plaintext — safe. On *explicit* disconnect, `session.ts:484-487` destroys the cipher — safe. On *unexpected* disconnect, the cipher is preserved (audit §7.1), so the human has the same stale-cipher bug as the AI in principle; but it doesn't fire on page load because globalThis is fresh.

### 2c — Human incoming gate

**Absent.** The AI has `encryptedMessageQueue` + `keyExchangePending` to queue encrypted messages that arrive before its cipher is live (`start-ai-client.mjs:1343-1348`). The human has no equivalent. `tryDecrypt` at `session.ts:688-689` does `if (!msg.encryptedPayload || !sessionCipher) return msg;` — silent early return, no queue, no log. Any encrypted message from the AI that arrives before the human has created its cipher is dropped without advancing the receive counter. That is the mechanism by which the stale-cipher send becomes an off-by-one for the new chain.

---

## 3 — The stale-cipher path, step-by-step

Conditions: AI process has been running continuously. Human reloads the page (or the browser's WebSocket drops and reconnects). AI's `e2eCipher` is still holding the previous session's ratchet.

1. Relay notifies AI `peer_status=disconnected` (`start-relay.mjs:2012-2016`). AI does nothing special — `e2eCipher` stays live.
2. Human page loads. `globalThis` fresh. `sessionCipher = null`. `ownKeyPair = generateKeyPair()` (new keys).
3. Human sends `session_init`. Relay replies `session_established`, then `tryPairClients()` sends `peer_status=active` to both (`start-relay.mjs:842-843`).
4. AI's `peer_status=active` handler (`start-ai-client.mjs:1419-1423`) sets `keyExchangePending=true` and sends its `key_exchange` in plaintext. **`e2eCipher` is still the old one.**
5. Human's `peer_status=active` handler (`session.ts:896-905`) sends its `key_exchange` in plaintext.
6. Both sides' KEs are in flight. For the window between steps 4 and the AI's call to `handleKeyExchange`:
   - AI's send path will encrypt with OLD keys any non-plaintext-typed message passed to `sendSecure`.
   - Hydration queries from the human (`extension_query`, `memory_list`, `project_list`, `context_request`, `conversation_list`, `guardian_status_request`) arrive at the AI as plaintext and are dispatched. Responses to `context_request` (`sendSecure` at 1883) and to extension relay-routed messages (`pushState` at 747) go through `sendSecure`. They encrypt with the OLD cipher.
7. Meanwhile the AI_KE reaches the human. The human's `handlePeerKeyExchange` creates a NEW `sessionCipher` starting at counter 0.
8. One or more of the AI's stale-key messages reaches the human AFTER step 7 (wire order: AI_KE before the stale-key message, because AI_KE went out at step 4, before the encrypted send in step 6). The human's new cipher tries `nextReceiveKey` on counter 0 → MAC fails → ratchet advances to 1 anyway (§4.1).
9. AI eventually receives human's new KE and runs `handleKeyExchange`, creating a fresh `e2eCipher` with `sendCounter=0`. From this point AI encrypts with NEW keys starting at counter 0.
10. First genuine new-cipher message from AI: sent with NEW key index 0. Human tries NEW key index 1. MAC fails. And so on forever. One page-load error, then N errors per stream, matching Harry's signature exactly.

The count of "page-load errors" equals the number of stale-key messages the AI emits during the step-6 window. For a chat-only session with extensions loaded, `extension_state_update` from any extension responding to incoming traffic is the most likely single source, producing precisely **one** pre-stream error.

---

## 4 — Human-side encrypted sends during the same window

For completeness: does the HUMAN send anything encrypted that could race the AI's KE?

| # | Source | Type | Fires pre-cipher-ready? |
|---|--------|------|--------------------------|
| H1 | `session.ts:625` (sendSecure used by task form) | `task` / `conversation` | No — requires user input |
| H2 | `session.ts:650` (sendDreamCycleRequest) | `dream_cycle_request` | No — user-initiated |
| H3 | `session.ts:661` (sendMemoryDecision) | `memory_decision` | No — user-initiated |
| H4 | `session.ts:675` (sendMemoryBatchDecision) | `memory_batch_decision` | No — user-initiated |
| H5 | `ExtensionUIHost.svelte:25, 43` | extension messages | Possible if an extension iframe posts on mount |
| H6 | `sendHydrationQueries()` (`session.ts:771-842`) | `extension_query`, `memory_list`, `project_list`, `context_request`, `conversation_list`, `guardian_status_request` | **Yes — but uses `client.send` directly (plaintext)**; NOT through `sendSecure`, so no counter advance |

H6 is noteworthy: the hydration queries are sent as plaintext envelopes with a `payload` field and no `encryptedPayload`. They do not advance either side's counter and are not the source of the desync. But they are *not* in the human's `PLAINTEXT_TYPES` set either; they work today because the AI's handler reads `msg.payload` directly. This is an orthogonal latent issue (the same-named types in `PLAINTEXT_TYPES`/routing drift) that is covered in parent audit §5.2.

H5 is the only realistic human-side outgoing encrypted send during the window, and it requires a mounted extension that calls `session.sendSecure` synchronously on component init. Harry can confirm this by checking whether the desync still reproduces with no extensions loaded. If yes, that rules out H5 entirely and leaves only the AI-side stale-cipher race.

---

## 5 — Recommended minimal fix (Track A, with correct scope)

The parent audit's Track A focused on §4.1 (receive-ratchet-before-MAC) and §4.2 (plaintext-types gate) and §8.1 (relay `buildRelayEnvelope`). Those fixes are still necessary — they prevent any single MAC failure from amplifying into N failures — but they do not *prevent the initial desync* when the cause is a stale cipher. For that, add one of the following, ordered by surgical minimality:

### Fix A (minimal, recommended): reset `e2eCipher` before key exchange

In `start-ai-client.mjs`, in the `peer_status` handler at `1419-1423`, zero and null `e2eCipher` before calling `sendKeyExchange()`:

```js
if (msg.status === 'active') {
  if (e2eCipher) { try { e2eCipher.destroy(); } catch {} e2eCipher = null; }
  keyExchangePending = true;
  sendKeyExchange();
}
```

Rationale: the instant the relay says we have a new peer, the previous cipher is by definition invalid. Any outgoing `sendSecure` between now and `handleKeyExchange` completion will correctly fall through to plaintext (since `!e2eCipher`), and any incoming encrypted message will be queued (since `keyExchangePending` is true and `!e2eCipher`). This closes the window entirely. It also addresses parent audit §3.1 on the AI side — the old cipher's chain keys are zeroized instead of leaked to GC.

Apply the same pattern symmetrically in `session.ts` peer_status handler (`:896-905`): destroy `sessionCipher` before calling `sendKeyExchange()`. This covers the unexpected-disconnect case (§7.1) for free.

### Fix B (defense in depth): human-side incoming queue

Mirror the AI's `encryptedMessageQueue` / `keyExchangePending` pattern on the human side. When `sessionCipher` is null and an envelope arrives with `encryptedPayload`, queue it until `handlePeerKeyExchange` fires, then drain. This is the symmetric counterpart to the existing AI-side queue and closes the silent-drop branch in `tryDecrypt`.

### Fix C (broader, already-recommended): advance-after-verify

Parent audit §4.1 fix. Necessary in addition to A and B: even with a perfect key exchange, any future single-message failure (duplicate, replay, bit error, relay tamper attempt) will still cascade without this fix.

### Fix D (optional): gate outgoing encrypted on "peer cipher ready"

Add an explicit ACK to the key exchange: peer sends a plaintext `key_exchange_ack` once their cipher is initialized, and both sides refuse to encrypt until they have both sent and received the KE-ACK. This is the only fully race-free design, but it changes the protocol and should be a separate ADR. Not required for the reported symptoms.

---

## 6 — How to confirm before landing the fix

Single-line instrumentation, still read-only:

1. At `start-ai-client.mjs:1060` (top of `sendSecure`), log `(envelope.type, !!e2eCipher, keyExchangePending, encryptedMessageQueue.length)`.
2. At `start-ai-client.mjs:1421` (peer_status active), log `e2eCipher was ${e2eCipher ? 'STALE' : 'null'}`.
3. Reload the browser once, and compare: the "STALE" line should appear, and the next non-PLAINTEXT_TYPES `sendSecure` call site should log a live `e2eCipher` handle between peer_status and handleKeyExchange.

If step 2 logs "null" on fresh startup but "STALE" on every subsequent human reconnect, the hypothesis is confirmed and Fix A is the correct scope.

---

## 7 — Bottom line

- **Track A as currently scoped is necessary but not sufficient.** Fixing `tryDecrypt`'s advance-then-verify will prevent *amplification*, but a single stale-cipher message will still cause the initial off-by-one.
- **Add Fix A (reset `e2eCipher` on peer_status=active) to Track A.** Three lines in `start-ai-client.mjs` plus the symmetric three lines in `session.ts`. Zero protocol change. Addresses the primary trigger.
- **Track A should also destroy the cipher on `disconnected`, not only on explicit `disconnect()`**, to close the human-side unexpected-disconnect variant — same pattern as Fix A but on the disconnect event (parent audit §7.1).
- **File-control messages (§11a) are still a latent trigger in the original audit's sense** — the fix for §8.1 is independent and still recommended, but it is not the page-load cause.
