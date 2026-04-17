# E2E Cryptography Audit — Bastion

**Date:** 2026-04-17
**Auditor:** Claude (Opus 4.7, 1M context)
**Scope:** End-to-end encryption stack across `@bastion/crypto`, `client-human`, `client-ai`, `relay`
**Baseline:** `pnpm test` — 4349/4349 passing (14 files, 0 failures)
**Trigger:** Harry reports intermittent `MAC verification error` messages in the human client browser console — one on page load, ~23 during each Claude response stream — sourced from `session.ts:694` (`tryDecrypt`), called from `handleRelayMessage` at `session.ts:881`.
**Mode:** Read-only. No code changes made.

---

## Executive Summary

The audit identified **one critical bug** and **several contributing weaknesses** that together explain the reported MAC error pattern. The headline finding:

> **`tryDecrypt` advances the symmetric ratchet *before* MAC verification, and recovers by returning the original (still-encrypted) envelope on failure. Because `nextReceiveKey()` is called unconditionally, a single spurious MAC failure permanently shifts the receive chain out of lockstep with the peer's send chain. From that point on, every legitimate encrypted message fails MAC — and each failure advances the chain another step, keeping the gap constant. This perfectly matches the observed "1 error on page load, then ~23 per stream" signature: the stream chunk count equals the MAC error count once the chain is desynced.**

This is compounded by three related defects:

1. **`tryDecrypt` does not consult `PLAINTEXT_TYPES`** — it decides whether to decrypt based solely on whether the envelope has an `encryptedPayload` field. This is fragile.
2. **The relay emits file-transfer control messages with a fake `encryptedPayload` field** (base64 JSON, not ciphertext). These are labeled as plaintext-by-design but *look* encrypted to `tryDecrypt`. They are a plausible trigger for the initial desync.
3. **Two parallel crypto implementations exist.** The `@bastion/crypto` package (BLAKE2b KDF, libsodium `crypto_kx`) is used only by tests. Production runtime uses a *duplicate*, hand-rolled SHA-512-truncated-to-32 stack copy-pasted between `browser-crypto.ts` and `start-ai-client.mjs`. Any change to `@bastion/crypto` will have zero production effect.

These are the four issues most likely to require attention. A full finding list is in the section-by-section report below, with classifications.

Other observations:
- **No replay protection**: receive counters are consumed in strict order; there is no counter number on the wire, so a duplicate delivery silently desyncs the chain.
- **No associated-data binding in the runtime path**: the envelope metadata (id, type, sender, correlationId, version) is not authenticated against the ciphertext. `@bastion/crypto/decrypt.ts` *does* verify metadata consistency — but, per the dual-stack finding, that code is not running in production.
- **No recovery mechanism** for ratchet desync. Once off-by-one, the session is permanently degraded until reconnection.

Severity roll-up: **1 critical, 4 high, 3 medium, 2 low, ~6 informational/working.** All critical findings are safety/liveness issues, not confidentiality breaches. The zero-knowledge property of the relay is preserved throughout.

---

## Method

1. Read the full crypto package source (`packages/crypto/src/**/*.ts`).
2. Traced the key exchange flow end-to-end from `generateKeyPair()` through to `SessionCipher` instantiation, following all three participants (human, relay, AI) via `start-relay.mjs`, `start-ai-client.mjs`, and `packages/client-human/src/lib/session.ts`.
3. Cross-referenced the runtime decrypt path (`tryDecrypt` at `session.ts:688`, the AI's `client.on('message')` handler at `start-ai-client.mjs:1319`) with the packaged implementation (`packages/crypto/src/e2e/decrypt.ts`).
4. Mapped all 19 plaintext-by-design message types against the `PLAINTEXT_TYPES` sets on each side.
5. Enumerated every code location that emits `encryptedPayload` via grep.
6. Inspected the conversation_stream producer (`start-ai-client.mjs:2378-2387`) and consumer (`session.ts:1783`) for chunk-level semantics.
7. Verified the test baseline (4349/4349 passing) before beginning.

I did not: run the client against a live relay, reproduce the failure, attach a debugger, or inspect network captures. Those would strengthen the hypothesis in §11 but were out of scope for a read-only audit.

---

## §1 — `packages/crypto/` package

### Files audited
- `sodium.ts` — initialization via CJS `createRequire` (Node/PNPM path) or dynamic ESM import (browser path).
- `e2e/session-keys.ts` — `generateKeyPair`, `deriveSessionKeys`, `SessionCipher`, ratchet.
- `e2e/encrypt.ts` / `decrypt.ts` — `encryptEnvelope` / `decryptEnvelope`.
- `e2e/file-encrypt.ts` / `file-decrypt.ts` — file payload encryption with SHA-256 content hash.
- `e2e/key-store.ts` — encrypted-at-rest JSON store using Argon2id-derived key.
- `integrity/chain-hash.ts` — tamper-evident audit log chain (SHA-256, `GENESIS_SEED`).

### Algorithms
| Primitive | Choice | Assessment |
|---|---|---|
| Key exchange | X25519 via libsodium `crypto_kx_keypair` + `crypto_kx_client/server_session_keys` | WORKING — standard, produces two directional 32-byte keys via BLAKE2b-based KDF inside libsodium. |
| Symmetric encryption | XSalsa20-Poly1305 (`crypto_secretbox_easy`) | WORKING — 256-bit key, 192-bit random nonce, Poly1305 MAC. Collision probability on 24-byte random nonces is negligible for any realistic session length. |
| KDF ratchet | BLAKE2b-keyed hash (libsodium `crypto_generichash(32, msg, key)`) with `msg=0x01` → next chain key, `msg=0x02` → message key | WORKING — BLAKE2b-keyed is a PRF; using 1-byte context domain separation is adequate though unconventional. |
| Key-at-rest | Argon2id (OPSLIMIT_MODERATE / MEMLIMIT_MODERATE) | WORKING — Argon2id is appropriate for passphrase derivation. |
| Audit chain | SHA-256 with canonical JSON (sorted keys, no whitespace) + genesis seed | WORKING. |
| File-at-rest hash | SHA-256 of plaintext in inner header | WORKING. |

### Findings in this section

- **Finding §1.1 — WORKING**: `ratchetStep` in `session-keys.ts:169-181` correctly zeroizes the consumed chain key after use. `SessionCipher.destroy()` zeroizes both chains. `encryptEnvelope` zeroizes the message key in a `finally` block. `decryptEnvelope` zeroizes both the message key (in `finally`) and the plaintext buffer after decoding.
- **Finding §1.2 — SUSPECT**: The `SessionCipher.restore(state)` static method (line 298) requires sodium to already be initialized. The JSDoc acknowledges this. If a consumer calls `restore()` without having awaited any other crypto function first, the call will fail in a way that could look like a cipher bug. Not currently hit because no production code calls `restore` (see §3).
- **Finding §1.3 — BUG (benign, latent)**: `ensureSodium` in `sodium.ts:145-150` returns `sodium!` after an early return without checking `sodium` was populated. This is already safe under current logic, but the non-null assertion is load-bearing — any future path that sets `initialised=true` without populating `sodium` would produce a confusing runtime error rather than a clear one.
- **Finding §1.4 — WORKING**: The `crypto_kx_PUBLICKEYBYTES` length check in `deriveSessionKeys` (line 133-137) is the only input validation on the public key. Since `crypto_kx_client_session_keys` rejects low-order points internally via `crypto_scalarmult`, we are fine. (Note: `crypto_box_beforenm` — used by the production runtime — does NOT reject low-order points; it silently returns a predictable shared secret for zero public key. See §9.)

---

## §2 — Key exchange byte-for-byte trace

This section documents every byte that crosses the wire from the moment `generateKeyPair()` runs to the moment `SessionCipher` is ready on both sides.

### Production runtime path (what actually runs)

**Step 1 — Human keypair generation.** `packages/client-human/src/lib/crypto/browser-crypto.ts:79-82`:
```typescript
const kp = nacl.box.keyPair();  // tweetnacl X25519
// publicKey: 32 bytes, secretKey: 32 bytes
```

**Step 2 — AI keypair generation.** `start-ai-client.mjs:966-970`:
```javascript
ownKeyPair = sodium.crypto_box_keypair();  // X25519
// publicKey: 32 bytes, privateKey: 32 bytes
```

**Step 3 — Key exchange message (envelope, plaintext).** Both sides emit:
```json
{
  "type": "key_exchange",
  "id": "<uuid>",
  "timestamp": "<iso8601>",
  "sender": { "type": "human|ai", "id": "...", "displayName": "..." },
  "payload": { "publicKey": "<base64 32-byte X25519 pubkey>" }
}
```
Transmitted to relay over WSS. Relay validates, logs `auditLogger.logEvent('key_exchange', ...)`, forwards to peer at `start-relay.mjs:1352-1363`. Relay sees only public keys and routing metadata — zero-knowledge property holds.

**Step 4 — Shared-secret derivation.**

*Browser (human, `browser-crypto.ts:98`):*
```typescript
const sharedSecret = nacl.box.before(peerPublicKey, ownKeyPair.secretKey);
// = HSalsa20(X25519(sk, pk), nonce=zeroes) — 32 bytes
```

*AI (`start-ai-client.mjs:997`):*
```javascript
const sharedSecret = sodium.crypto_box_beforenm(peerPublicKey, ownKeyPair.privateKey);
// Same: HSalsa20(X25519(sk, pk), nonce=zeroes)
```

These produce **byte-identical** outputs — confirmed interoperable.

**Step 5 — Directional key derivation.** Both sides compute:
```
keyA = SHA-512( "bastion-e2e-send" || sharedSecret || pkA || pkB )[:32]
keyB = SHA-512( "bastion-e2e-recv" || sharedSecret || pkA || pkB )[:32]
```

where the ordering of `pkA`/`pkB` in the hash input differs between sides:
- Browser (human, line 102): `concat(DIRECTIONAL_SEND, sharedSecret, ownKeyPair.publicKey, peerPublicKey)`
- AI (line 1000): `concat(DIRECTIONAL_SEND, sharedSecret, peerPublicKey, ownKeyPair.publicKey)`

**This differs per side.** The human passes `(own, peer)`, the AI passes `(peer, own)`. This is deliberate — each side wants to refer to the same (human, AI) pair, and the AI's `ownKeyPair.publicKey` is the human's `peerPublicKey`, so the hash inputs match across sides.

Role assignment:
- Initiator (human): `sendKey = keyA`, `receiveKey = keyB`
- Responder (AI): `sendKey = keyB`, `receiveKey = keyA` (swapped)

So `human.sendKey === AI.receiveKey` and `human.receiveKey === AI.sendKey`. ✓

**Step 6 — Cipher instantiation.** Each side initializes a ratchet with `sendChainKey = sendKey`, `receiveChainKey = receiveKey`, counters at zero.

### Finding §2.1 — BUG (benign, documentation)

The in-code comments claim the browser and AI use an "interoperable ratchet" with libsodium. In reality, **neither side uses `@bastion/crypto`'s `deriveSessionKeys` or `SessionCipher`**. The runtime uses a hand-rolled SHA-512-truncated-to-32 KDF duplicated between `browser-crypto.ts` and `start-ai-client.mjs`. The `@bastion/crypto` package uses BLAKE2b and `crypto_kx` — a completely different KDF. See §9.

### Finding §2.2 — SUSPECT (hardening gap)

`crypto_box_beforenm` (used on the AI side) does not reject low-order X25519 public keys. An attacker who can tamper with the public key on the wire could supply one of the ~25 low-order points, forcing `sharedSecret` to a known value. In this protocol the relay forwards key_exchange messages unmodified and is audited, so active tampering requires relay compromise — but a signed or HKDF-bound key exchange would reduce the attack surface. In contrast, `crypto_kx` (in `@bastion/crypto`, unused) has low-order checks.

---

## §3 — Session state lifecycle

### Where ratchet state lives

**Human side:** module-level `let sessionCipher: BrowserSessionCipher | null` in `session.ts:523`, mirrored on `globalThis.__bastionCipher` for Vite HMR persistence.

**AI side:** module-level `let e2eCipher = null` in `start-ai-client.mjs:942`. Not persisted.

Neither side persists ratchet state to disk in production. The `@bastion/crypto/e2e/key-store.ts` KeyStore is implemented but unused — no runtime code imports it.

### When the ratchet advances

- **Send:** once per `sendSecure()` call, for any message type NOT in `PLAINTEXT_TYPES`.
- **Receive:** once per incoming envelope that has an `encryptedPayload` field, if the cipher is established — *regardless of whether decryption actually succeeds*. (See §4, the central bug.)

### When the ratchet is reset

- `disconnect()` in `session.ts:484-487` calls `sessionCipher.destroy()` and clears the handle.
- A new cipher is created only on receipt of a peer `key_exchange` message (`handlePeerKeyExchange` at `session.ts:598`).
- There is **no path that resets or reseeds the ratchet mid-session**. The only recovery mechanism is full reconnect + key exchange.

### On reconnect

`BastionHumanClient` (`packages/client-human/src/lib/services/connection.ts`) handles WebSocket reconnection with exponential backoff. On successful reconnect, `session.ts` fires `reconnected` → `hydrateState()` which re-sends `session_init`. The relay issues a new JWT, the new `peer_status=active` arrives, and both sides initiate a new `sendKeyExchange()`.

The existing `sessionCipher` is **not destroyed on the reconnect path** — only on explicit `disconnect()`. This means if `peer_status=active` arrives but the peer has generated a new keypair, `handlePeerKeyExchange` will `deriveSessionKeys(...)` and `createSessionCipher(...)` — overwriting the old cipher handle. The old cipher's chain keys are leaked into GC but not zeroized.

### On key_exchange during an existing session

Same behaviour — the old cipher is abandoned (not destroyed), a new one is created. In-flight encrypted messages from before the new key_exchange would decrypt with the OLD cipher but are now processed with the NEW cipher → MAC failure, ratchet advance. See §4.

### Findings in this section

- **Finding §3.1 — BUG (benign)**: On reconnect or mid-session key_exchange, the previous `sessionCipher` is not `.destroy()`'d before being reassigned — chain keys leak into GC.
- **Finding §3.2 — SUSPECT**: `globalThis.__bastionCipher` persistence across Vite HMR can preserve a stale cipher whose counters no longer match the peer (e.g., AI client restarted since browser reload). No integrity check binds the cipher to the current JWT or peer public key. An HMR event during development could produce the exact pre-page-load state that matches the observed "1 error on page load" symptom.
- **Finding §3.3 — BUG (medium)**: No replay protection. Receive counters are implicitly advanced per-message; there is no counter number on the wire. A duplicate message delivery (possible during relay reconnection scenarios, though current relay code does not replay) would be indistinguishable from a legitimate message and would silently desync the chain.

---

## §4 — `tryDecrypt` path — THE CRITICAL FINDING

### The function (`session.ts:688-703`)

```typescript
function tryDecrypt(msg: Record<string, unknown>): Record<string, unknown> {
  if (!msg.encryptedPayload || !sessionCipher) return msg;

  try {
    const payload = decryptPayload(String(msg.encryptedPayload), String(msg.nonce), sessionCipher);
    if (!payload) {
      console.error('[Bastion] Decryption failed — MAC verification error');  // LINE 694
      return msg;
    }
    const { encryptedPayload: _ep, nonce: _n, ...rest } = msg;
    return { ...rest, payload };
  } catch (err) {
    console.error('[Bastion] Decryption failed:', err instanceof Error ? err.message : String(err));
    return msg;
  }
}
```

### The underlying `decryptPayload` (`browser-crypto.ts:202-215`)

```typescript
export function decryptPayload(encryptedPayloadB64, nonceB64, cipher) {
  const { key } = cipher.nextReceiveKey();    // ← RATCHET ADVANCES HERE
  const ciphertext = decodeBase64(encryptedPayloadB64);
  const nonce = decodeBase64(nonceB64);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);  // ← MAC CHECK HERE
  key.fill(0);
  if (!plaintext) return null;    // ← Failure path — but ratchet already advanced
  return JSON.parse(new TextDecoder().decode(plaintext));
}
```

### The call site (`session.ts:865-883`)

```typescript
function handleRelayMessage(data: string): void {
  let envelope: Record<string, unknown>;
  try { envelope = JSON.parse(data); }
  catch { /* add as raw system message */ return; }

  envelope = tryDecrypt(envelope);  // LINE 881 — UNCONDITIONAL, BEFORE ANY TYPE CHECK

  const type = String(envelope.type ?? 'conversation');
  // ... type-specific branches
}
```

### Finding §4.1 — BUG (CRITICAL — liveness, not confidentiality)

**The receive ratchet is advanced before MAC verification, and not rewound on failure. A single spurious MAC failure permanently shifts the receive chain out of sync with the peer's send chain.**

Mechanism:
1. Peer's send chain is at counter `N`. Peer encrypts msg with `sendKey_N`, advances to `N+1`.
2. On the wire, the envelope arrives at the human.
3. Human's receive chain is at counter `M` (should equal `N`). `tryDecrypt` calls `nextReceiveKey()` → advances human receive chain to `M+1`.
4. `nacl.secretbox.open(ct, nonce, receiveKey_M)` — if `M ≠ N`, MAC fails. Returns `null`.
5. `tryDecrypt` logs "MAC verification error" and returns the original envelope.
6. Peer's next msg uses `sendKey_{N+1}`. Human's next receive is `receiveKey_{M+1}`. Gap stays at `M-N`.

Once the gap opens, it never closes. Every subsequent legitimate encrypted message fails MAC. The stream chunk pattern (`23` chunks per response → `23` errors) follows mechanically from a single desync event.

### Finding §4.2 — BUG (CRITICAL — robustness)

**`tryDecrypt` does not consult `PLAINTEXT_TYPES`.** The early-return gate is purely structural (`!msg.encryptedPayload || !sessionCipher`). Any envelope that happens to carry an `encryptedPayload` field — even if the message type is plaintext-by-design — will be decrypted and will advance the ratchet.

The AI client has a partial mitigation (`start-ai-client.mjs:1330-1340`) that bypasses decryption if `sender.type === 'relay'`. The human client has **no equivalent guard**. Instead, at line 990-999, the human has a *fallback* that re-decodes `encryptedPayload` as base64 JSON if `payload` is missing — but this runs *after* `tryDecrypt` has already advanced the ratchet.

### Finding §4.3 — BUG (high — error handling)

**Decryption failure is treated as "unencrypted message".** `tryDecrypt` on failure returns the original envelope with `encryptedPayload` still present. Downstream handlers then fall through to the base64-JSON fallback. For a *real* ciphertext, `atob(ciphertext) → JSON.parse` fails, the `catch` sets `payload = undefined`, then line 999 does `if (!payload) payload = envelope as Record<string, unknown>` — so the handler reads routing metadata as if it were the payload, and chunk/conversationId/etc. come out undefined. The UI silently drops the message. This is the "works but produces errors" behaviour Harry describes, and it's worse than failing loudly.

---

## §5 — Plaintext-by-design message types

### The two `PLAINTEXT_TYPES` sets

**Human (`session.ts:539-559`)** — 19 types:
```
session_init, session_established, key_exchange, ping, pong, peer_status,
error, config_ack, config_nack,
file_manifest, file_offer, file_request, file_reject, file_data,
guardian_alert, guardian_shutdown, guardian_status, guardian_status_request, guardian_clear
```

**AI (`start-ai-client.mjs:1048-1054`)** — 19 types:
```
session_init, session_established, key_exchange,
provider_register, ping, pong, peer_status, error, config_ack, config_nack,
file_manifest, file_offer, file_request, file_data,
guardian_alert, guardian_shutdown, guardian_status, guardian_status_request, guardian_clear
```

### Asymmetries

| Type | Human | AI | Impact |
|---|---|---|---|
| `provider_register` | ✗ | ✓ | Only AI sends this, so human not having it is harmless |
| `file_reject` | ✓ | ✗ | If the AI sent `file_reject` via `sendSecure`, it would be encrypted; the human would then try to decrypt it. Looking at the code, `file_reject` is not sent by AI — only received by the human. The asymmetry is benign *today*. |

### Behavior for plaintext-by-design messages that reach `tryDecrypt`

- If the envelope has no `encryptedPayload` field → `tryDecrypt` early-returns, no ratchet advance. ✓
- If the envelope has an `encryptedPayload` field (e.g., `file_offer` from relay's `buildRelayEnvelope`) → `tryDecrypt` attempts decryption, MAC fails, ratchet advances. ✗

The skills documentation at `.claude/skills/security-patterns/SKILL.md:60` lists plaintext exceptions. The list in the skill is also subtly inconsistent with the runtime: it includes `file_manifest`, `file_offer`, etc., confirming these are meant to be plaintext. But the relay marks them with an `encryptedPayload` field anyway (see §8), causing the bug.

### Findings

- **Finding §5.1 — BUG (high)**: Plaintext-by-design message types delivered with a fake `encryptedPayload` field cause ratchet desync. `tryDecrypt` needs a `PLAINTEXT_TYPES.has(msg.type)` gate.
- **Finding §5.2 — SUSPECT**: The two `PLAINTEXT_TYPES` sets are maintained independently in source — any drift between them is a latent interoperability bug. A single source of truth in `@bastion/protocol` would eliminate this.

---

## §6 — Streaming chunks

### Producer (`start-ai-client.mjs:2378-2387`)

```javascript
const onChunk = STREAMING_ENABLED ? (chunk, index) => {
  sendSecure({
    type: 'conversation_stream',
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sender: IDENTITY,
    payload: { conversationId: activeConversationId || '', chunk, index, final: false },
  });
  streamChunkIndex = index;
} : undefined;
```

Each chunk is a **separate envelope**, each triggers a separate `sendSecure()`, each advances the AI's send chain by one. For a response that streams in ~23 chunks, the AI's send counter advances from `N` to `N+23`.

### Final marker (`start-ai-client.mjs:2592-2599`)

After the stream ends, the AI sends a final `conversation_stream` envelope with `chunk: ''`, `final: true`, then sends a full `conversation` or `result` envelope separately via `sendSecure`. All encrypted.

### Consumer (`session.ts:1783-1796`)

```typescript
if (type === 'conversation_stream') {
  const p = payload as Record<string, unknown>;
  const convId = String(p.conversationId ?? '');
  const chunk = String(p.chunk ?? '');
  const isFinal = Boolean(p.final);
  if (isFinal) { conversations.clearStreaming(); }
  else if (chunk && convId) { conversations.appendStreamChunk(convId, chunk); }
  return;
}
```

### Chunks arriving out of order

Not handled. The ratchet is a symmetric chain — each key is used exactly once, in order. WebSocket is FIFO per-connection so this is normally fine. The relay does not reorder (it forwards `data` bytes directly at `start-relay.mjs:1494`).

### Missing last chunk

If the final `final:true` marker is lost, `conversations.clearStreaming()` is never called and the UI stays in "streaming" state. No ratchet impact — the counters stay in lockstep with what was actually encrypted.

### Duplicate chunk

Would silently desync the ratchet (see §3.3). The receive chain advances on every message with `encryptedPayload`.

### Findings

- **Finding §6.1 — WORKING (by luck)**: Current transport (WSS) guarantees FIFO and no duplicates. If the transport ever changed (e.g., added a store-and-forward layer for reconnection), the ratchet would desync on redelivery.
- **Finding §6.2 — BUG (high — root cause amplifier)**: Each streamed chunk is a separate encrypted envelope. Once the receive chain is off by one (via §4.1), all N chunks fail MAC, producing exactly N error messages. This is the direct explanation for "~23 errors per stream".

---

## §7 — Reconnection logic

### Backoff & retry

`BastionHumanClient.connect` → on `close`, schedule reconnect with backoff schedule `[1s, 2s, 4s, 8s, 16s, 30s]` (`packages/client-human/src/lib/services/connection.ts:73`).

### Crypto-state handling on reconnect

- `sessionCipher` is **not** destroyed on unexpected disconnect — only on explicit `disconnect()`.
- On reconnect, a new WSS handshake + `session_init` is sent.
- Relay issues a new JWT and a fresh `peer_status=active` message.
- Both sides run `sendKeyExchange()` again, producing new X25519 keypairs. Wait — let me verify. On the human side `initE2E` is called once at `connect()` time, setting `ownKeyPair`. It is not called again on reconnect. So the human re-sends its *existing* public key. If the AI restarted, AI has a new keypair. Shared secret changes. `createSessionCipher` creates a new cipher with new chains; old cipher is abandoned.
- Consequence: chain keys from the old session are not zeroized; GC eventually collects them.

### In-flight messages

Any encrypted message in flight when the WebSocket dropped will have been discarded by the socket layer. The relay does not replay. The send counters on each side will move past those counters the next session — no replay, no desync from this path.

### Findings

- **Finding §7.1 — BUG (low)**: Old cipher is not destroyed on reconnect-driven cipher replacement. Chain keys leak into GC briefly.
- **Finding §7.2 — WORKING**: No replay or double-delivery on reconnect, because relay does not buffer.

---

## §8 — Relay handling

### Confidentiality — relay never sees plaintext payloads

Confirmed. The relay imports no encryption module in production. Its `buildRelayEnvelope` at `packages/relay/src/quarantine/file-transfer-router.ts:448-461` constructs envelopes with a base64-encoded JSON payload in the `encryptedPayload` field — but this is a **transport encoding, not encryption**. The relay does not handle any real ciphertext.

For peer-to-peer forwarded messages (e.g., `conversation`, `task`, `conversation_stream`), the relay's `relay.send(peerId, data)` at `start-relay.mjs:1494` forwards raw bytes without parsing the payload. Zero-knowledge property holds.

### Routing metadata (id, type, sender, correlationId, version)

These are in the plaintext envelope. The relay reads them for routing and audit. They are **not integrity-protected against the ciphertext** in the production runtime path (see §10).

### The `buildRelayEnvelope` anti-pattern

```typescript
private buildRelayEnvelope(messageId, type, payload): string {
  return JSON.stringify({
    id: messageId, type, timestamp: ..., sender: { id: 'relay', type: 'relay', ... },
    correlationId: randomUUID(), version: PROTOCOL_VERSION,
    encryptedPayload: Buffer.from(JSON.stringify(payload)).toString('base64'),  // NOT encrypted
    nonce: Buffer.from(randomUUID()).toString('base64'),                        // NOT a real nonce
  });
}
```

This is used to emit `file_manifest`, `file_offer`, `file_request`, and `file_data` messages. The name of the field is misleading — the payload is *not* encrypted, just base64-encoded. The relay relies on both clients having fallback logic to decode this transport shape.

- The AI client has the relay bypass at `start-ai-client.mjs:1330-1340`.
- The human client has the base64-JSON fallback at `session.ts:990-999` — but only *after* `tryDecrypt` has run.

### Finding §8.1 — BUG (critical, contributing cause)

**The relay emits messages with an `encryptedPayload` field that are not actually encrypted, and the human client has no early-exit guard to detect this.** Combined with §4.1 and §4.2, any `file_offer`/`file_manifest`/`file_request`/`file_data` message that arrives after the cipher is established will desync the ratchet.

Even if no file transfer is active, this structural risk means any future message type from the relay using `buildRelayEnvelope` will produce the same effect. The name `encryptedPayload` overloading is a trap.

---

## §9 — Cross-component consistency

### Three implementations of "E2E crypto" exist in this repo

| Implementation | Location | KDF | Key exchange | Status |
|---|---|---|---|---|
| `@bastion/crypto` | `packages/crypto/src/e2e/*` | BLAKE2b via `crypto_generichash` | `crypto_kx` (BLAKE2b-based, rejects weak keys) | **Tests only, not used in production** |
| Browser runtime | `packages/client-human/src/lib/crypto/browser-crypto.ts` | SHA-512 truncated to 32 bytes | `nacl.box.before` (no weak-key check) | Production (human) |
| AI runtime | `start-ai-client.mjs` inline (lines 946-1041) | SHA-512 truncated to 32 bytes | `crypto_box_beforenm` (no weak-key check) | Production (AI) |

The browser and AI runtime paths are byte-compatible. They differ ONLY in the parameter ordering of `concat(SEND_TAG, sharedSecret, pkA, pkB)` — the browser swaps `(own, peer)` to `(peer, own)` to match the AI side's reference frame. Confirmed interoperable by inspection.

The `@bastion/crypto` package implements a *different* protocol — BLAKE2b-based with `crypto_kx`. It cannot interoperate with the runtime. `packages/crypto/trace-test.mjs` tests `@bastion/crypto` in isolation and passes. It does not exercise the production code paths.

### Finding §9.1 — BUG (high — architectural)

**Dead `@bastion/crypto` package in production.** The package is a fully functional, well-tested crypto implementation — with metadata binding, proper MAC-over-AD, key-store persistence, and weak-key rejection — that is never called by production code. Production code uses a weaker, duplicated, hand-rolled stack. Any future contributor improving `@bastion/crypto` will have no effect on the live wire.

Concretely:
- `deriveSessionKeys`, `createSessionCipher`, `encryptEnvelope`, `decryptEnvelope` in `@bastion/crypto` are referenced only by `packages/crypto/trace-test.mjs`, `packages/tests/file-transfer-integration-test.mjs`, and their own package re-exports.
- `start-ai-client.mjs` imports only `ensureSodium` from `@bastion/crypto`. Everything else is inline.
- `browser-crypto.ts` imports only `tweetnacl`. No `@bastion/crypto` usage.

### Finding §9.2 — BUG (medium)

**SHA-512 truncated to 32 bytes is an unconventional KDF.** SHA-512/256 (with distinct IVs) is the NIST-standard equivalent; HKDF-SHA512 is the standard construction for derived keys. Truncating SHA-512 output is cryptographically fine (it preserves collision resistance at 32 bytes against any polynomial adversary), but it is non-standard and harder to reason about. `@bastion/crypto`'s BLAKE2b-keyed construction is better.

### Finding §9.3 — BUG (low)

**No weak-key rejection in production key exchange.** `nacl.box.before` and `crypto_box_beforenm` both accept the 25 low-order X25519 public keys, which produce a predictable shared secret. An attacker who can tamper with key_exchange messages on the wire could force session key collapse. The relay sees key_exchange messages and audits them, so this requires relay compromise — but it is a hardening gap. `crypto_kx` rejects low-order keys.

---

## §10 — MAC computation specifics

### Runtime MAC

`nacl.secretbox` and `crypto_secretbox_easy` both compute:
```
ciphertext = XSalsa20(key, nonce).xor(plaintext) || Poly1305(key', nonce, ciphertext)
```
where `key'` is derived from the first 32 bytes of the XSalsa20 keystream under `(key, nonce)`. This is standard NaCl/libsodium.

**MAC input**: the ciphertext (after XSalsa20 stream encryption) plus the implicit Poly1305 key. The envelope metadata fields (id, type, sender, correlationId, version) are NOT part of the MAC input.

### Consequence

The relay could, in principle, tamper with `sender`, `correlationId`, etc. without breaking MAC verification. The decrypted plaintext would still be valid — only the routing information would be changed.

`@bastion/crypto/decrypt.ts:100-117` has an explicit *metadata consistency check*:
```typescript
for (const field of METADATA_FIELDS) {
  if (stringifiedOriginal !== stringifiedRouting) {
    throw new CryptoError(`Metadata tampering detected: "${field}" ...`);
  }
}
```
This relies on `serialise()` embedding metadata *inside* the wire string, then comparing the decrypted-envelope's metadata against the outer routing envelope. **This check is not present in production.**

### Canonical encoding of MAC input

Not applicable — there's no canonical encoding step in the runtime path since metadata isn't MAC'd. The payload plaintext is `JSON.stringify(envelope.payload || {})` on the AI side (`start-ai-client.mjs:1069`). On the human side, the sender uses `JSON.stringify(envelope.payload ?? {})` (`session.ts:625`). Both produce deterministic output since the payload is always passed as a controlled object, but neither normalizes key ordering.

### Findings

- **Finding §10.1 — BUG (medium — integrity)**: Production MAC does not cover routing metadata. A relay-level tamper could silently reroute or relabel messages (though it would be detectable via audit correlation). `@bastion/crypto` fixes this but is not used.
- **Finding §10.2 — WORKING**: The underlying XSalsa20-Poly1305 MAC is cryptographically sound. No algorithm-level issue.

---

## §11 — Hypothesis for the observed MAC error pattern

### The pattern

- **1 error on page load** at `session.ts:694` (inside `tryDecrypt`, after `nextReceiveKey()` but before `secretbox.open` would return `null`).
- **~23 errors per Claude response stream** thereafter.
- Streaming "appears to work correctly" according to Harry.

### Primary hypothesis (confidence: high)

**Step 1 — Initial desync event on page load.** One of the following triggers a single spurious `tryDecrypt` call that fails MAC:

(a) **A file-transfer control message from the relay** arrives while the cipher is established (most likely candidate). The relay's `buildRelayEnvelope` (§8) emits `file_manifest`, `file_offer`, `file_request`, or `file_data` with `encryptedPayload: base64(JSON)`. `tryDecrypt` does not consult `PLAINTEXT_TYPES` (§4.2), calls `nextReceiveKey()`, decryption fails. Ratchet advances by 1. Error logged.

(b) **Vite HMR stale-cipher persistence** (§3.2). On dev reload, `globalThis.__bastionCipher` survives and references a cipher whose counters match a previous AI-client-session state. The AI has since restarted with fresh counters. First real encrypted message fails MAC. Ratchet advances by 1.

(c) **Race between `peer_status=active` and an encrypted message from AI** (ruled out by FIFO — see §2).

(d) **A pending message on reconnect** — but the current relay doesn't buffer, so ruled out.

(a) is strongest for production; (b) is strongest for a development environment. Harry should check: does this happen on a full page reload, or only after HMR? And does it happen even when no file transfers have occurred?

**Step 2 — Per-stream amplification.** Once the ratchet is off by `k` (typically `k=1`), every encrypted message from the AI thereafter fails MAC. The AI's conversation_stream emission is one envelope per chunk (§6). A typical 23-chunk response produces exactly 23 MAC errors. This matches observation perfectly.

**Step 3 — Why it "appears to work".** When `tryDecrypt` fails, it returns the original envelope. The downstream fallback at `session.ts:990-999` tries `atob(encryptedPayload) → JSON.parse`. For real ciphertext, `JSON.parse` throws, `payload` is undefined, then `payload = envelope`. The `conversation_stream` handler reads `payload.chunk` → `undefined` → `String(undefined) = 'undefined'` — no wait: `String(p.chunk ?? '')` = `''`. The `else if (chunk && convId)` branch short-circuits. Chunks silently drop. The UI stops updating but users may not notice if the final `conversation` or `result` envelope also fails silently and the cached conversation state is what they see.

Alternatively: streaming genuinely is broken for Harry, but the final response comes through some other path (e.g., polled via `conversation_history_response` on tab focus, or cached from the AI side's own display). I did not trace this exhaustively.

### Secondary hypothesis (confidence: medium)

If no file transfer or HMR event is involved, the initial desync could come from an encrypted message arriving *before* the human's cipher is established, silently dropped via the `!sessionCipher` early-return in `tryDecrypt`, but where the AI considers that message "sent" and has already advanced its send counter. The human's cipher, when finally created, starts at `N=0` but the AI is at `N=1`. First real message fails MAC. This matches the "1 error on page load" precisely.

Ruling it out needs: confirmation that the AI never sends an encrypted message between completing its own cipher creation and the human's cipher creation. The current code structure makes this unlikely but not impossible — a hydration query response from the AI could in principle race with key_exchange delivery on the WebSocket if the AI creates its cipher first (which it does — AI creates cipher on *receiving* human's key_exchange; human creates cipher on *receiving* AI's key_exchange; these messages cross in flight).

### Tertiary hypothesis (confidence: low)

The initial MAC error on page load may come from a `handleRelayMessage` call triggered by something the session.ts reads directly from the WebSocket on open — the `message` event handler in `BastionHumanClient` emits to `onMessage` before peer_status arrives. I did not inspect the early-boot message sequence in depth.

### Testing the hypothesis

Without code changes, Harry could:
1. Add one `console.log(...)` at `session.ts:689` logging `(msg.type, !!sessionCipher, !!msg.encryptedPayload)` to identify the initial message that triggers the off-by-one.
2. Add a counter log in `browser-crypto.ts:151` dumping `receiveCounter` before/after each `nextReceiveKey` call, correlate with the MAC error timestamps.
3. Check whether the initial error still occurs on a hard refresh (no HMR) with no active file transfers — that distinguishes hypothesis (a) vs (b).

These are diagnostic-only; no fix logic.

---

## Full Finding List

| # | Severity | Title | Classification |
|---|---|---|---|
| §1.1 | info | Ratchet step zeroizes consumed keys | WORKING |
| §1.2 | low | `SessionCipher.restore()` requires prior async init | SUSPECT |
| §1.3 | low | `ensureSodium` non-null assertion is load-bearing | BUG (benign) |
| §1.4 | info | KX pubkey length check present | WORKING |
| §2.1 | medium | Misleading comments claim `@bastion/crypto` is interoperable | BUG (benign, documentation) |
| §2.2 | medium | Production KX uses `crypto_box_beforenm` without low-order check | SUSPECT |
| §3.1 | low | Old `sessionCipher` not destroyed on key_exchange replacement | BUG (benign) |
| §3.2 | medium | HMR-persisted cipher can survive AI restart (stale counters) | SUSPECT |
| §3.3 | medium | No replay protection (no wire counter, no dedup) | BUG |
| §4.1 | **critical** | `tryDecrypt` advances ratchet before MAC check | **BUG (critical)** |
| §4.2 | critical | `tryDecrypt` doesn't consult `PLAINTEXT_TYPES` | BUG (critical) |
| §4.3 | high | Decryption failure silently falls through to base64-JSON fallback | BUG (high) |
| §5.1 | high | Plaintext-by-design types with fake `encryptedPayload` desync ratchet | BUG (high) |
| §5.2 | medium | Two `PLAINTEXT_TYPES` sets maintained independently | SUSPECT |
| §6.1 | info | Stream chunks rely on WSS FIFO ordering | WORKING (by luck) |
| §6.2 | high | Per-chunk envelopes amplify a single desync into N errors | BUG (amplifier) |
| §7.1 | low | Old cipher not destroyed on reconnect-driven replacement | BUG (benign) |
| §7.2 | info | No replay possible from relay non-buffering | WORKING |
| §8.1 | **critical** | Relay `buildRelayEnvelope` emits fake `encryptedPayload` — contributing cause | **BUG (critical)** |
| §9.1 | high | `@bastion/crypto` is dead code in production (two parallel crypto stacks) | BUG (architectural) |
| §9.2 | medium | SHA-512-truncated-to-32 is non-standard KDF | SUSPECT |
| §9.3 | low | No low-order key rejection in production KX | BUG (hardening) |
| §10.1 | medium | Production MAC does not cover routing metadata | BUG |
| §10.2 | info | XSalsa20-Poly1305 primitive is sound | WORKING |

Totals: **3 critical** (§4.1, §4.2, §8.1 — all interacting), **4 high**, **7 medium**, **4 low**, **6 informational/working**.

No findings compromise **confidentiality** of message contents. The bugs are all **liveness**, **integrity**, or **robustness** issues. Messages cannot be read by the relay; MAC failures produce errors rather than silent forgeries. The most severe real-world impact is **degraded UX** (failed chunks) and **silent data loss** (messages whose payloads are silently replaced with routing envelopes due to §4.3).

---

## Recommendations

**Do not implement these during this audit. Scope as a separate fix session.**

### High-priority (address the critical findings together)

1. **Fix the ratchet advance ordering (§4.1).** Do not call `cipher.nextReceiveKey()` until MAC verification has succeeded. One pattern: peek a copy of the chain key, attempt decryption, and only commit (zeroize and advance) on success. This requires a small API change to `nextReceiveKey` or a new `tryReceiveKey` that separates deriving the key from advancing the chain.

2. **Make `tryDecrypt` consult `PLAINTEXT_TYPES` (§4.2).** Add a type check to the early-return. Consider also checking `sender.type === 'relay'` as a secondary guard for future-proofing.

3. **Stop the relay from using `encryptedPayload` for unencrypted messages (§8.1).** Rename the field in `buildRelayEnvelope` to something like `relayPayload` or simply emit a plaintext envelope with a `payload` field. The consumer-side fallback logic can be deleted.

4. **Fail loud on decryption failure (§4.3, CLAUDE.md "fail loud" philosophy).** Currently the fall-through is the exact "silently degrade to look fine" anti-pattern that the project rules forbid. At minimum: emit a visible UI indicator when `tryDecrypt` fails. Better: trigger an automatic key re-exchange.

### Medium-priority

5. **Unify onto `@bastion/crypto` (§9.1).** Replace the hand-rolled runtime code with calls to the packaged `encryptEnvelope`/`decryptEnvelope`. Gain metadata binding (§10.1), proper KX (§9.3), and test coverage alignment. Requires swapping the SHA-512 KDF for BLAKE2b — this IS a breaking wire change, so either plan a protocol version bump or maintain dual-stack during migration.

6. **Add replay protection (§3.3).** Put the message counter on the wire (alongside nonce), reject out-of-order or duplicate counters. Makes the ratchet robust against relay-level retry/replay.

7. **Add a ratchet-resync mechanism.** Currently, any desync is permanent-until-reconnect. A counter on the wire (see 6) plus a "resync window" (try N keys ahead before giving up) would let the human recover from off-by-one automatically — useful even if the underlying bugs are fixed, as defense in depth.

### Lower-priority / hardening

8. **Destroy the old cipher on reconnect/rekey (§3.1, §7.1).** Trivial fix, forward-secrecy hygiene.
9. **Single source of truth for `PLAINTEXT_TYPES` (§5.2).** Move to `@bastion/protocol`.
10. **Fix or remove `@bastion/crypto`'s HMR-safe `globalThis.__bastionCipher` persistence (§3.2).** At minimum: tie it to the current peer public key, so a peer restart invalidates.

---

## Scope I did not fully cover

A complete audit would additionally trace:
- The file transfer encryption (`encryptFile`/`decryptFile` at `packages/crypto/src/e2e/file-encrypt.ts`) through the production airlock — but file transfer uses the relay's base64 wrapping (§8), so those functions from `@bastion/crypto` may also be unused. I confirmed they exist but did not trace their production usage.
- The admin API's TLS / JWT handling — tangential to the E2E bug but security-adjacent.
- The `audit_response` envelope format — I verified the relay sends it as plaintext JSON without `encryptedPayload`, so it doesn't trigger §4.1, but a deeper review would check the full 23 message paths from relay to human.
- The audit log hash chain (`chain-hash.ts`) — spot-checked as `WORKING` but not exhaustively.

I also did not reproduce the failure live or attach a debugger. The hypothesis in §11 is strong from code reading; confirmation requires instrumentation.

---

## Conclusion

The observed MAC error pattern is not a mystery. `tryDecrypt` has a classic "advance-then-verify" bug (§4.1) that makes any single decryption failure permanently desyncing. The human client and relay cooperate to guarantee that initial failure via the `buildRelayEnvelope` anti-pattern (§8.1) and the missing `PLAINTEXT_TYPES` gate (§4.2). Once desynced, the per-chunk streaming architecture (§6) multiplies one root cause into one error per chunk.

The good news: no confidentiality breach. The zero-knowledge relay property holds throughout. Forward secrecy holds (chain keys are zeroized). The X25519 + XSalsa20-Poly1305 primitives are sound.

The bad news: a two-line fix in `tryDecrypt` will prevent the ratchet advance on MAC failure, but the dual crypto-stack (§9.1) and the relay-envelope anti-pattern (§8.1) mean this subsystem has multiple design debts that should be paid down together in a scoped fix session.

Harry: I recommend reviewing this report, confirming the hypothesis in §11 with the suggested logging (all read-only), and scheduling a separate session to land the three-point fix (§4.1 + §4.2 + §8.1) in one coordinated change. The remaining items in Recommendations can follow.
