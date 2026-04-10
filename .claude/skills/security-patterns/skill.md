---
name: security-patterns
description: Security patterns for Bastion — E2E encryption, authentication, file airlock, MaliClaw Clause, content scanning, tool governance. Read before implementing any security-sensitive code.
user-invocable: false
---

# Security Patterns - Encryption, Auth, File Airlock

**Read this before implementing any security-sensitive code.**

---

## Core Principles

1. Trust no one — not the human, not the AI, not the relay
2. Every file crosses the boundary through quarantine — no exceptions
3. E2E encryption means the relay is zero-knowledge
4. Allowlist, not blocklist — default deny
5. The MaliClaw Clause is hardcoded and non-negotiable

---

## E2E Encryption

### Architecture
- Human client encrypts → relay transports encrypted blob → AI client decrypts
- Relay NEVER sees plaintext. Relay transports opaque blobs.
- Key exchange via `key_exchange` protocol message (X25519 public keys)
- Symmetric encryption: XSalsa20-Poly1305 (crypto_secretbox)
- KDF ratchet: SHA-512 truncated to 32 bytes, directional keys, chain stepping

### Implementation (two interoperable stacks)

**Browser (client-human)**: tweetnacl
```typescript
// browser-crypto.ts — uses tweetnacl's nacl.box.before + nacl.secretbox
const keyPair = generateKeyPair();              // nacl.box.keyPair()
const sessionKeys = deriveSessionKeys('initiator', keyPair, peerPublicKey);
const cipher = createSessionCipher(sessionKeys); // KDF ratchet
const { encryptedPayload, nonce } = encryptPayload(json, cipher);
```

**Node.js (client-ai, relay)**: libsodium-wrappers-sumo
```typescript
// Uses sodium.crypto_box_keypair(), crypto_box_beforenm(), crypto_secretbox_easy()
// Interoperable — identical shared secret and KDF chain as tweetnacl
const sodium = await ensureSodium();
const sharedSecret = sodium.crypto_box_beforenm(peerPublicKey, ownKeyPair.privateKey);
```

### Key Exchange Flow
1. Both clients generate X25519 keypairs on connect
2. When peer_status='active', initiator sends `key_exchange` with public key
3. Responder derives shared secret and creates session cipher
4. Directional keys prevent replay: initiator send=keyA, receive=keyB; responder swaps
5. KDF chain steps on every message — forward secrecy within session

### Plaintext Exceptions
These message types are NEVER encrypted (relay needs to read them):
`session_init`, `session_established`, `key_exchange`, `token_refresh`, `provider_register`, `ping`, `pong`, `peer_status`, `error`, `config_ack`, `config_nack`, `file_manifest`, `file_offer`, `file_request`, `file_data`

### E2E Status Indicator
- Session.ts exposes `e2eStatus` writable: `{ available: boolean, active: boolean }`
- StatusIndicator shows green "Encrypted" badge or yellow "Unencrypted" warning

---

## Authentication

### JWT Flow
1. Client connects via WSS
2. Client sends `session_init` with identity
3. Relay validates, issues JWT (jose library, HS256, 15-min expiry, jti uniqueness)
4. Client includes JWT in subsequent messages
5. Client refreshes via `token_refresh` before expiry
6. Expired JWT → session terminated

### Provider Approval (AI clients)
- Self-registration via `provider_register` message (approved through AdminRoutes)
- MaliClaw Clause checked at approval time
- Each provider has capability matrix (allowed message types, file transfer perms, max concurrent tasks)

### Admin Auth
- Primary: Client certificates (SHA-256 fingerprint matching)
- Fallback: Username + TOTP (scrypt N=16384 password hash)
- Rate limited: 5 attempts / 15 min, then 1-hour lockout
- Admin panel ONLY on 127.0.0.1:9444 — use SSH tunnel for remote access
- Setup wizard for first-time credential creation (TOTP secret display + verification)

---

## The MaliClaw Clause

**Non-negotiable. Non-bypassable. Hardcoded.**

**13 blocked identifiers** (case-insensitive partial matching):
`openclaw`, `clawdbot`, `moltbot`, `copaw`, `nanoclaw`, `zeroclaw`, `clawhub`, `hiclaw`, `tuwunel`, `lobster`, `ai.openclaw.client`, `openclaw.ai`, `docs.openclaw.ai`

**Plus catch-all regex**: `/claw/i` — blocks ANY identifier containing 'claw'

Located in: `packages/relay/src/auth/allowlist.ts` (also mirrored in `packages/relay-admin-ui/src/lib/stores/blocklist.ts`)

**Rules:**
- This check is HARDCODED — no config file, no environment variable, no flag
- Adding to the list: allowed (via code change + PR)
- Removing from the list: NOT allowed
- Making it configurable: NOT allowed
- Checked BEFORE the allowlist — MaliClaw overrides all approvals
- Tests must verify it cannot be bypassed

---

## Content Scanning

### Relay-side (project_sync validation in start-relay.mjs)
13 dangerous content patterns scanned before forwarding project files:

| Pattern | Threat |
|---------|--------|
| `<script>` tags | XSS |
| `javascript:` URIs | XSS |
| HTML event handlers (onload, onerror, etc.) | XSS |
| `<iframe>`, `<object>`, `<embed>` tags | Embedding attacks |
| HTML import links | Resource injection |
| `data:text/html` URIs | XSS via data URIs |
| YAML language-specific type tags | Deserialization attacks |
| `__proto__` / `constructor` / `prototype` | JSON prototype pollution |

Also enforced: path traversal prevention, hidden file blocking, extension allowlist (.md/.json/.yaml/.yml/.txt only), 1MB content limit.

### AI Client-side (ProjectStore in client-ai)
Same path validation and content scanning applied independently.

---

## Tool Governance

### Trust Model
- **Read-only tools**: Can be auto-approved at session scope (low risk)
- **Write tools**: Always require per-call human approval
- **Destructive tools**: Always per-call, AI cannot see parameters until approved (Dangerous Tool Blindness)

### MCP Integration
- ToolRegistryManager tracks available tools and session trust
- McpClientAdapter: JSON-RPC 2.0 over WebSocket to MCP providers
- Tool discovery: `listTools()` on connect, registered in AI client's tool registry
- Execution: human approves → AI validates parameters → MCP call → result displayed

### Message Flow
`tool_request` (AI→Human) → `tool_approved`/`tool_denied` (Human→AI) → `tool_result` (AI→Human)
`tool_revoke` (Human→AI) — revoke session trust at any time

---

## File Transfer Airlock

### 3-Stage Custody Chain (now fully wired in runtime)

**Human → AI:**
1. Human sends `file_manifest` (with embedded `fileData`) → relay intercepts
2. **[Stage 1: Submission]** — Relay verifies SHA-256 hash, quarantines file
3. Relay sends `file_manifest` (metadata only, NO file content) to AI
4. AI auto-accepts project files (has `projectContext`), sends `file_request`
5. **[Stage 2: Quarantine]** — Relay re-verifies hash in quarantine
6. **[Stage 3: Delivery]** — Relay verifies hash, releases `file_data` to AI
7. AI verifies hash at receipt, stores in IntakeDirectory (read-only)

**AI → Human:**
Same flow but with `file_offer` instead of `file_manifest`.

### Hash Mismatch at Any Stage → BASTION-5001, Transfer Aborted

### Components
- **FileTransferRouter** (relay): Orchestrates manifest/offer/request workflow
- **FileQuarantine** (relay): In-memory store with custody chain
- **HashVerifier** (relay): 3-stage SHA-256 integrity verification
- **PurgeScheduler** (relay): Automatic timeout cleanup (default 1 hour)
- **IntakeDirectory** (client-ai): Read-only received files (50 file max)
- **OutboundStaging** (client-ai): Write-only produced files (50 file max)
- **FilePurgeManager** (client-ai): Task lifecycle cleanup

---

## Session Security

### Single Device
- Only one human client at a time
- `session_conflict` notifies on duplicate connection attempt
- `session_superseded` auto-disconnects the old session
- StatusIndicator shows toast notification for both

### Reconnection
- Exponential backoff (1s → 2s → 4s → 8s → 16s → 30s)
- State re-hydrated via `sendHydrationQueries()` on reconnect
- JWT refreshed on `tokenRefreshNeeded` event

---

## Checklist: Security Code

```
□ E2E encryption used for all message/file content
□ Relay never sees plaintext
□ JWT validated on every message
□ Allowlist checked before routing
□ MaliClaw Clause fires before allowlist
□ File transfers go through quarantine with 3-stage hash verification
□ Content scanning applied to project files
□ Tool governance respects trust model (read/write/destructive)
□ Audit events logged for all security actions
□ No hardcoded secrets (except MaliClaw blocklist)
□ Admin panel not exposed publicly (127.0.0.1 only)
□ Five immutable boundaries not violated
```
