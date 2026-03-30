# Bastion Protocol Specification v0.5.0

**Version:** 0.5.0
**Date:** March 2026
**Status:** Stable (Phase 1–5 complete, self-update system)
**Licence:** Apache 2.0
**Authors:** Harry Smith, Claude (Anthropic)

This is the standalone, versioned protocol specification for Project Bastion. It defines the complete wire protocol for structured Human-AI communication, independent of any specific implementation.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Transport Layer](#2-transport-layer)
3. [Message Envelope](#3-message-envelope)
4. [Encryption](#4-encryption)
5. [Authentication](#5-authentication)
6. [Session Lifecycle](#6-session-lifecycle)
7. [Message Types](#7-message-types)
8. [Safety Evaluation](#8-safety-evaluation)
9. [File Transfer](#9-file-transfer)
10. [Error Codes](#10-error-codes)
11. [Security Properties](#11-security-properties)
12. [Constants and Limits](#12-constants-and-limits)

---

## 1. Overview

The Bastion protocol enables structured, secure messaging between a human user and an AI system via a relay server. The protocol provides:

- **End-to-end encryption** — the relay routes messages but never sees plaintext payloads
- **Structured safety evaluation** — a three-layer system that evaluates every task before execution
- **Auditable message flow** — every message is logged with an immutable hash chain
- **File transfer with quarantine** — all files pass through verification before delivery
- **Explicit human control** — the AI cannot self-modify its safety parameters or bypass challenges

### Participants

| Role | Description |
|------|-------------|
| **Human Client** | Desktop (Tauri) or mobile (React Native) application operated by the user |
| **AI Client** | Headless process running in an isolated VM, connected to an AI provider |
| **Relay** | Central routing server that terminates TLS, authenticates clients, routes encrypted messages, and maintains audit logs |

### Message Flow

```
Human Client ←──WSS──→ Relay ←──WSS──→ AI Client
                          │
                     Audit Log
                     (metadata only)
```

The relay sees message metadata (type, sender, timestamp, correlation ID) but **never** the payload content.

---

## 2. Transport Layer

### 2.1 WebSocket over TLS (WSS)

All communication uses WebSocket over TLS (WSS). Non-TLS connections are rejected with error `BASTION-1002`.

| Parameter | Value |
|-----------|-------|
| Protocol | WebSocket (RFC 6455) over TLS 1.2+ |
| Default port | 9443 |
| Max message size | 5 MB (5,242,880 bytes) |
| Heartbeat interval | 30 seconds (configurable upward) |
| Heartbeat timeout | 10 seconds |

### 2.2 Connection Establishment

1. Client opens a TLS connection to the relay on port 9443.
2. TLS handshake completes. The relay terminates TLS independently for each client.
3. Client upgrades to WebSocket protocol.
4. Relay performs the **MaliClaw Clause** check on the client identifier before any protocol exchange.
5. If the client passes, the authentication phase begins.

### 2.3 Heartbeat

The relay sends WebSocket ping frames every 30 seconds. Clients must respond with pong frames. If a client fails to respond within 10 seconds, the connection is terminated and a `BASTION-1007` error is logged.

---

## 3. Message Envelope

Every message in the Bastion protocol is wrapped in a standardised envelope.

### 3.1 Cleartext Envelope

Used internally after decryption. This is what the application layer processes.

```typescript
interface MessageEnvelope {
  id: string;              // UUID v4 — unique message identifier
  type: string;            // Message type (see Section 7)
  timestamp: string;       // ISO 8601 UTC timestamp
  sender: SenderIdentity;  // Authenticated sender
  correlationId: string;   // UUID v4 — links related messages
  version: string;         // Protocol version ("0.5.0")
  payload: unknown;        // Type-specific content
}
```

### 3.2 Encrypted Envelope

This is what travels over the wire and what the relay sees.

```typescript
interface EncryptedEnvelope {
  id: string;              // UUID v4 (plaintext — visible to relay)
  type: string;            // Message type (plaintext — visible to relay)
  timestamp: string;       // ISO 8601 UTC (plaintext — visible to relay)
  sender: SenderIdentity;  // Sender identity (plaintext — visible to relay)
  correlationId: string;   // UUID v4 (plaintext — visible to relay)
  version: string;         // Protocol version (plaintext — visible to relay)
  encryptedPayload: string; // Base64-encoded encrypted payload
  nonce: string;           // Base64-encoded encryption nonce
}
```

The relay uses the plaintext metadata fields for routing, validation, and audit logging. It cannot decrypt `encryptedPayload`.

### 3.3 Sender Identity

```typescript
interface SenderIdentity {
  id: string;          // Unique client identifier
  type: string;        // "human" | "ai" | "relay"
  displayName: string; // Human-readable name
}
```

### 3.4 Field Constraints

| Field | Format | Max Length |
|-------|--------|-----------|
| `id` | UUID v4 (RFC 4122) | 36 characters |
| `type` | Lowercase snake_case | 32 characters |
| `timestamp` | ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`) | 30 characters |
| `correlationId` | UUID v4 | 36 characters |
| `version` | Semantic version (`X.Y.Z`) | 16 characters |
| `sender.id` | Alphanumeric + hyphens | 128 characters |
| `sender.type` | Enum: `human`, `ai`, `relay` | — |
| `sender.displayName` | UTF-8 string | 256 characters |

---

## 4. Encryption

### 4.1 Algorithm

| Component | Algorithm |
|-----------|-----------|
| Session key exchange | X25519 (Curve25519 Diffie-Hellman via `key_exchange` message) |
| Shared secret | HSalsa20(X25519(sk, pk)) — `crypto_box_beforenm` / `nacl.box.before` |
| Message encryption | XSalsa20-Poly1305 (AEAD) — `crypto_secretbox` / `nacl.secretbox` |
| Key derivation | SHA-512 truncated to 32 bytes (KDF ratchet chain) |
| Audit hash chain | SHA-256 |
| File hashing | SHA-256 |
| Password hashing (admin) | scrypt (N=16384, r=8, p=1) |

### 4.2 Key Exchange

At session establishment, the human and AI clients perform an X25519 key exchange facilitated (but not readable) by the relay:

1. Human client generates an ephemeral X25519 key pair.
2. AI client generates an ephemeral X25519 key pair.
3. Both send their public keys to the relay.
4. The relay forwards each public key to the other client.
5. Both clients compute the shared secret using X25519.
6. The shared secret is derived into session keys via HKDF-SHA-256.

The relay never sees the shared secret or the session keys.

### 4.3 KDF Ratchet Chain

Session keys are derived using a KDF ratchet chain with SHA-512:

```
shared_secret = HSalsa20(X25519(my_secret, their_public))   # crypto_box_beforenm / nacl.box.before
send_chain_key_0 = SHA512(DIRECTIONAL_SEND || shared_secret || my_public || their_public)[0:32]
recv_chain_key_0 = SHA512(DIRECTIONAL_RECV || shared_secret || my_public || their_public)[0:32]

message_key_n = SHA512(chain_key_n || 0x02)[0:32]
chain_key_{n+1} = SHA512(chain_key_n || 0x01)[0:32]
```

Each message uses a unique, irreversibly-derived key. Old chain keys are zeroized after each ratchet step (forward secrecy within a session). Send and receive chains advance independently.

The human client uses tweetnacl (pure JavaScript) and the AI client uses libsodium — both are byte-identical NaCl implementations. `nacl.box.before()` = `crypto_box_beforenm()`, `nacl.secretbox()` = `crypto_secretbox_easy()`.

### 4.4 Payload Encryption

```
nonce = random 24 bytes (XSalsa20 uses 192-bit nonces)
ciphertext = XSalsa20-Poly1305(message_key_n, nonce, plaintext_payload)
encryptedPayload = base64(ciphertext)
nonce_field = base64(nonce)
```

### 4.5 File Encryption

Files are encrypted with the same session key chain but use a separate key derivation path:

```
file_key = HKDF-SHA-256(chain_key, salt="bastion-file", info="file-{transfer_id}")
```

File encryption uses the same XChaCha20-Poly1305 AEAD. Files are encrypted before submission and decrypted after delivery. The relay stores encrypted file data in quarantine.

---

## 5. Authentication

### 5.1 JWT Authentication

After TLS handshake and key exchange, clients authenticate via JWT:

| Parameter | Value |
|-----------|-------|
| Algorithm | HS256 (HMAC-SHA256) |
| Expiry | 15 minutes |
| Refresh | Via `token_refresh` message before expiry |
| Issuer | `bastion-relay` |
| Audience | `bastion-client` |

JWT claims:

```json
{
  "sub": "<client_id>",
  "iss": "bastion-relay",
  "aud": "bastion-client",
  "iat": 1711234567,
  "exp": 1711235467,
  "jti": "<uuid>",
  "client_type": "human|ai",
  "session_id": "<uuid>"
}
```

The `jti` claim ensures token uniqueness — replayed tokens are rejected.

### 5.2 AI Client Allowlist

AI clients must be explicitly approved before connecting:

1. An admin registers the AI provider via the admin panel.
2. The provider entry includes: provider ID, display name, allowed capabilities.
3. The MaliClaw Clause is checked **before** the allowlist — blocklisted identifiers are rejected regardless of allowlist status.
4. On connection, the relay checks the AI client's provider ID against the registry.
5. Unapproved providers receive `BASTION-2004`.

### 5.3 Admin Authentication

The admin panel uses a separate authentication mechanism:

- **Primary**: Client certificate (mTLS) — SHA-256 fingerprint verified against registered admin accounts.
- **Fallback**: Username + password (scrypt-hashed) + optional TOTP.
- **Rate limiting**: 5 failed attempts per 15 minutes triggers a 1-hour lockout (`BASTION-2006`).
- **Locality**: Admin panel binds to `127.0.0.1` only. Attempting to bind to a public interface logs `SECURITY_VIOLATION` and refuses to start.

---

## 6. Session Lifecycle

### 6.1 Session States

```
connecting → authenticating → key_exchange → active → suspended → terminated
                                                ↑          │
                                                └──────────┘
                                                (reconnect within grace period)
```

| State | Description |
|-------|-------------|
| `connecting` | TLS handshake in progress |
| `authenticating` | Credentials submitted, awaiting JWT |
| `key_exchange` | E2E key exchange in progress |
| `active` | Session fully established, messages flowing |
| `suspended` | Client disconnected, grace period active |
| `terminated` | Session ended (clean or timeout) |

### 6.2 Grace Period

When a client's connection drops unexpectedly:

1. The relay moves the session to `suspended` and starts a grace timer.
2. **Default**: 5 minutes. **Minimum floor**: 2 minutes (cannot be lowered).
3. During the grace period, the relay holds undelivered messages (max 100 messages, max 5 MB).
4. The counterpart client receives a heartbeat with `peerStatus: "suspended"`.

### 6.3 Reconnection

Within the grace period:

1. Client reconnects via WSS and re-authenticates (new JWT or re-uses unexpired token).
2. Client sends a `reconnect` message with `lastReceivedMessageId`.
3. The relay replays all held messages after that ID.
4. Session returns to `active`.

If the grace period expires, the session is `terminated`. All held messages are discarded.

### 6.4 Human Client Reconnection Backoff

The human client uses exponential backoff for reconnection attempts:

| Attempt | Delay |
|---------|-------|
| 1 | 1 second |
| 2 | 2 seconds |
| 3 | 4 seconds |
| 4 | 8 seconds |
| 5 | 16 seconds |
| 6+ | 30 seconds (repeating) |

### 6.5 Clean Shutdown

A client sends `session_end` before closing the WebSocket. The relay terminates the session immediately without a grace period.

### 6.6 Single-Device Sessions

Only one human client device may be connected at a time. If a second device connects:

1. The existing session receives a `session_conflict` message.
2. The user can choose to transfer the session (supersede) or reject the new device.
3. If superseded, the old session receives `session_superseded` and is terminated.

### 6.7 JWT Refresh

Tokens expire every 15 minutes. Clients should refresh at 13 minutes (2 minutes before expiry):

1. Client sends `token_refresh` with the current JWT.
2. Relay issues a new JWT and sends it back.
3. If the old JWT has already expired, the session is terminated.

---

## 7. Message Types

The Bastion protocol defines 81 message types across fifteen categories: core (13), supplementary (10), audit (2), provider/context (2), memory (6), extensions (2), project context (7), tool integration (9), challenge governance (3), budget guard (2), E2E encryption (1), multi-conversation persistence (13), AI disclosure (1), and self-update (10).

### 7.1 Core Message Types

#### `task`

**Direction:** Human → AI
**Purpose:** Structured instruction with action, target, and parameters.

| Field | Type | Description |
|-------|------|-------------|
| `taskId` | UUID v4 | Unique task identifier |
| `action` | string | Action to perform (e.g. "research", "analyze", "delete") |
| `target` | string | Target resource (e.g. "database", "document") |
| `parameters` | Record<string, unknown> | Action-specific key-value pairs |
| `priority` | enum | `low` \| `normal` \| `high` \| `critical` |
| `constraints` | string[] | Execution constraints (e.g. "no_external_api") |

#### `conversation`

**Direction:** Either (Human ↔ AI)
**Purpose:** Freeform dialogue without automatic execution implications.

| Field | Type | Description |
|-------|------|-------------|
| `content` | string | Message text |
| `replyTo` | UUID v4 (optional) | Reference to previous message |

#### `challenge`

**Direction:** AI → Human
**Purpose:** Safety evaluation triggered a challenge. Blocks execution until human confirmation.

| Field | Type | Description |
|-------|------|-------------|
| `challengedMessageId` | UUID v4 | ID of the task message that triggered this challenge |
| `challengedTaskId` | UUID v4 | ID of the challenged task |
| `layer` | 1 \| 2 \| 3 | Which safety layer triggered |
| `reason` | string | Concise reason for challenge |
| `riskAssessment` | string | Detailed risk analysis |
| `suggestedAlternatives` | string[] | Safer alternatives |
| `factors` | ChallengeFactor[] | Contributing factors (see below) |

**ChallengeFactor:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Factor name (e.g. "irreversible_action") |
| `description` | string | Why this factor applied |
| `weight` | number (0–1) | Contribution to the challenge decision |

#### `confirmation`

**Direction:** Human → AI
**Purpose:** Human response to a challenge.

| Field | Type | Description |
|-------|------|-------------|
| `challengeMessageId` | UUID v4 | ID of the challenge being responded to |
| `decision` | enum | `approve` \| `modify` \| `cancel` |
| `modifiedParameters` | Record<string, unknown> (optional) | Modified task parameters (if decision is `modify`) |
| `reason` | string (optional) | Explanation for decision |

#### `denial`

**Direction:** AI → Human
**Purpose:** Task violates absolute safety boundaries. Non-negotiable — cannot be overridden.

| Field | Type | Description |
|-------|------|-------------|
| `deniedMessageId` | UUID v4 | ID of the denied task message |
| `deniedTaskId` | UUID v4 | ID of the denied task |
| `layer` | 1 \| 2 \| 3 | Safety layer (always 1 for denials) |
| `reason` | string | Concise denial reason |
| `detail` | string | Detailed explanation |

#### `status`

**Direction:** AI → Human
**Purpose:** Execution progress report for an in-flight task.

| Field | Type | Description |
|-------|------|-------------|
| `taskId` | UUID v4 | Task being reported on |
| `completionPercentage` | number (0–100) | Progress percentage |
| `currentAction` | string | Current action description |
| `toolsInUse` | string[] | Tools/APIs being invoked |
| `metadata` | Record<string, unknown> | Tool-specific metrics |

#### `result`

**Direction:** AI → Human
**Purpose:** Task completion report with transparency metadata.

| Field | Type | Description |
|-------|------|-------------|
| `taskId` | UUID v4 | Completed task ID |
| `summary` | string | One-sentence summary |
| `output` | unknown | Task result data |
| `actionsTaken` | string[] | Actions executed |
| `generatedFiles` | string[] | File transfer IDs of created files |
| `cost` | CostMetadata | Token usage and cost (see below) |
| `transparency` | TransparencyMetadata | AI transparency data (see below) |

**CostMetadata:**

| Field | Type | Description |
|-------|------|-------------|
| `inputTokens` | number | Tokens in prompt |
| `outputTokens` | number | Tokens in completion |
| `estimatedCostUsd` | number | Estimated USD cost |

**TransparencyMetadata:**

| Field | Type | Description |
|-------|------|-------------|
| `confidenceLevel` | enum | `high` \| `medium` \| `low` |
| `safetyEvaluation` | enum | `allow` \| `challenge` \| `deny` \| `clarify` |
| `permissionsUsed` | string[] | Permissions/capabilities used |
| `reasoningNotes` | string | Explanation of approach |

#### `error`

**Direction:** Any
**Purpose:** System or execution error.

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Error code (BASTION-CXXX format) |
| `name` | string | Error name |
| `message` | string | Short error message |
| `detail` | string | Detailed explanation |
| `recoverable` | boolean | Whether error is transient |
| `suggestedAction` | string | Recommended next step |
| `timestamp` | string | ISO 8601 when error occurred |

#### `audit`

**Direction:** Relay → Recipient
**Purpose:** Audit trail entry.

| Field | Type | Description |
|-------|------|-------------|
| `eventType` | string | Audit event type |
| `sessionId` | UUID v4 | Session this event belongs to |
| `detail` | Record<string, unknown> | Event-specific metadata |
| `chainHash` | string | SHA-256 hash linking to previous entry |

#### `file_manifest`

**Direction:** Sender → Relay
**Purpose:** Describes a file submitted for transfer.

| Field | Type | Description |
|-------|------|-------------|
| `transferId` | UUID v4 | File transfer identifier |
| `filename` | string | Original filename |
| `sizeBytes` | number | File size in bytes |
| `hash` | string | SHA-256 hash of file contents |
| `hashAlgorithm` | `"sha256"` | Hash algorithm (always SHA-256) |
| `mimeType` | string | MIME type |
| `purpose` | string | Why the file is being transferred |
| `projectContext` | string | Related project/task |

#### `file_offer`

**Direction:** AI → Human
**Purpose:** File delivery notification. Human must accept before file is delivered.

| Field | Type | Description |
|-------|------|-------------|
| `transferId` | UUID v4 | File transfer identifier |
| `filename` | string | Filename |
| `sizeBytes` | number | File size |
| `hash` | string | SHA-256 hash |
| `mimeType` | string | MIME type |
| `purpose` | string | Why the file is being offered |
| `taskId` | UUID v4 (optional) | Generating task reference |

#### `file_request`

**Direction:** AI → Relay
**Purpose:** AI requests access to a human's quarantined file.

| Field | Type | Description |
|-------|------|-------------|
| `transferId` | UUID v4 | File being requested |
| `manifestMessageId` | UUID v4 | Message ID of original file_manifest |

#### `heartbeat`

**Direction:** Either
**Purpose:** Periodic connection health check.

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | UUID v4 | Session sending heartbeat |
| `peerStatus` | enum | `connecting` \| `authenticating` \| `key_exchange` \| `active` \| `suspended` \| `terminated` |
| `metrics` | HeartbeatMetrics | System health snapshot (see below) |

**HeartbeatMetrics:**

| Field | Type | Description |
|-------|------|-------------|
| `uptimeMs` | number | Milliseconds since connection established |
| `memoryUsageMb` | number | Memory usage in MB |
| `cpuPercent` | number (0–100) | CPU utilisation |
| `latencyMs` | number | Round-trip latency in milliseconds |

### 7.2 Supplementary Message Types

#### `session_end`

**Direction:** Either → Relay
**Purpose:** Clean shutdown notification.

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | UUID v4 | Session being closed |
| `reason` | string | Shutdown reason |

#### `session_conflict`

**Direction:** Relay → Human
**Purpose:** Another device is attempting to connect with the same identity.

| Field | Type | Description |
|-------|------|-------------|
| `existingSessionId` | UUID v4 | Current active session |
| `newDeviceInfo` | string | Information about the new device |

#### `session_superseded`

**Direction:** Relay → Human
**Purpose:** Session has been transferred to another device.

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | UUID v4 | Superseded session |
| `supersededBy` | string | Identifier of new device/session |

#### `reconnect`

**Direction:** Either → Relay
**Purpose:** Reconnection request with replay window.

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | UUID v4 | Session being reconnected |
| `lastReceivedMessageId` | UUID v4 | Last successfully processed message (replay from here) |
| `jwt` | string (optional) | Fresh JWT if old one expired |

#### `config_update`

**Direction:** Admin → AI (via Relay)
**Purpose:** Configuration change directive.

| Field | Type | Description |
|-------|------|-------------|
| `configType` | enum | `api_key_rotation` \| `tool_registry` \| `safety_config` |
| `encryptedPayload` | string | Encrypted configuration data (base64) |

#### `config_ack`

**Direction:** AI → Admin (via Relay)
**Purpose:** Configuration change successfully applied.

| Field | Type | Description |
|-------|------|-------------|
| `configType` | enum | Which config was updated |
| `appliedAt` | string | ISO 8601 when update took effect |

#### `config_nack`

**Direction:** AI → Admin (via Relay)
**Purpose:** Configuration change failed.

| Field | Type | Description |
|-------|------|-------------|
| `configType` | enum | Which config failed |
| `reason` | string | Brief failure reason |
| `errorDetail` | string | Detailed error information |

#### `token_refresh`

**Direction:** Either → Relay
**Purpose:** JWT refresh request.

| Field | Type | Description |
|-------|------|-------------|
| `currentJwt` | string | Expiring or expired JWT |

#### `provider_status`

**Direction:** AI → Human (via Relay)
**Purpose:** Provider availability status change.

| Field | Type | Description |
|-------|------|-------------|
| `providerName` | string | Provider name (e.g. "Anthropic") |
| `status` | enum | `available` \| `unavailable` \| `degraded` |
| `errorDetail` | string (optional) | Error message if unavailable |
| `retryAttempt` | number (optional) | Current retry attempt |
| `nextRetryMs` | number (optional) | Milliseconds until next retry |

#### `budget_alert`

**Direction:** AI → Human (via Relay)
**Purpose:** Budget threshold reached.

| Field | Type | Description |
|-------|------|-------------|
| `thresholdPercent` | number (0–100) | Threshold that triggered alert |
| `usedAmountUsd` | number | Amount spent in current period |
| `budgetLimitUsd` | number | Total budget limit |
| `currentPeriod` | string | Period identifier (e.g. "2026-03") |
| `estimatedCostForNextTask` | number (optional) | Projected cost for next task |

### 7.3 Audit Query/Response

#### `audit_query`

**Direction:** Human → Relay
**Purpose:** Query the relay's tamper-evident audit trail.

| Field | Type | Description |
|-------|------|-------------|
| `startTime` | string (optional) | ISO 8601 — filter entries after this time |
| `endTime` | string (optional) | ISO 8601 — filter entries before this time |
| `eventType` | string (optional) | Filter by event type (e.g. "message_routed") |
| `sessionId` | string (optional) | Filter by session |
| `limit` | number (optional) | Max entries to return |
| `offset` | number (optional) | Skip first N entries (pagination) |
| `includeIntegrity` | boolean (optional) | Include chain integrity verification in response |

#### `audit_response`

**Direction:** Relay → Human
**Purpose:** Audit trail query results with optional chain integrity status.

| Field | Type | Description |
|-------|------|-------------|
| `entries` | AuditPayload[] | Matching audit entries (metadata only — never plaintext content) |
| `totalCount` | number | Total entries matching the query |
| `integrity` | object or null | Chain integrity check result (if requested) |
| `integrity.chainValid` | boolean | Whether the hash chain is unbroken |
| `integrity.entriesChecked` | number | Number of entries verified |
| `integrity.lastVerifiedAt` | string | ISO 8601 timestamp of verification |

### 7.4 Provider and Context

#### `provider_register`

**Direction:** AI → Relay
**Purpose:** AI client registers itself as a governed provider with declared capabilities.

| Field | Type | Description |
|-------|------|-------------|
| `providerId` | string | Unique provider identifier (e.g. "anthropic-bastion") |
| `providerName` | string | Display name (e.g. "Anthropic (Bastion Official)") |
| `capabilities.conversation` | boolean | Supports freeform conversation |
| `capabilities.taskExecution` | boolean | Supports structured task execution |
| `capabilities.fileTransfer` | boolean | Supports file transfer |

The relay validates the registration against the MaliClaw Clause and responds with `config_ack` (success) or `config_nack` (rejected).

#### `context_update`

**Direction:** Human → AI (via Relay)
**Purpose:** Update the user-defined context injected into the AI's system prompt.

| Field | Type | Description |
|-------|------|-------------|
| `content` | string | User context text (informative, not authoritative) |

The user context sits below the immutable role context in the prompt hierarchy. It is written to `/var/lib/bastion-ai/user-context.md` on the AI VM and reloaded into the conversation manager.

### 7.5 AI Disclosure

#### `ai_disclosure` (Relay → Human)

Relay-generated regulatory transparency banner. Sent after session pairing when disclosure is enabled by the deployer. Default: OFF.

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | Disclosure text (supports `{provider}` and `{model}` template variables) |
| `style` | enum | Visual treatment: `info`, `legal`, or `warning` |
| `position` | enum | Render location: `banner` (top of chat) or `footer` (bottom) |
| `dismissible` | boolean | Whether the user can hide the banner |
| `link` | string? | Optional URL for more information |
| `linkText` | string? | Display text for the link |
| `jurisdiction` | string? | Regulation label for audit trail (e.g. "EU AI Act Article 50") |

The relay generates this message — not the AI client — because the relay admin is the operator/deployer responsible for regulatory compliance. Template variables `{provider}` and `{model}` are resolved at send time from the registered provider's current values. Every disclosure sent is logged as an `ai_disclosure_sent` audit event in the tamper-evident hash chain.

### 7.6 Self-Update System

The self-update system introduces a fourth client type (`updater`) that connects to the relay, authenticates via JWT, and performs E2E key exchange. Update commands use a **whitelist of command types** — no arbitrary shell execution is possible.

#### `update_check` (Updater → Admin)

Check for a new version from the source repository.

| Field | Type | Description |
|-------|------|-------------|
| `source` | `'github'` | Source repository type (whitelist) |
| `repo` | string | Repository identifier (e.g. "Glorktelligence/Bastion") |
| `currentVersion` | string | Currently running version |

#### `update_available` (Admin → Updater)

Version information and changelog when an update is available.

| Field | Type | Description |
|-------|------|-------------|
| `currentVersion` | string | Currently running version |
| `availableVersion` | string | Available version to update to |
| `commitHash` | string | Git commit hash of available version |
| `changelog` | string[] | List of changes in the new version |
| `components` | string[] | Components that need updating |
| `estimatedBuildTime` | number? | Estimated build time in seconds |

#### `update_prepare` (Admin → Components)

Prepare all components for update — save state.

| Field | Type | Description |
|-------|------|-------------|
| `targetVersion` | string | Version being updated to |
| `commitHash` | string | Git commit hash |
| `reason` | string | Human-readable reason for update |

#### `update_prepare_ack` (Component → Admin)

Component acknowledges preparation, state saved.

| Field | Type | Description |
|-------|------|-------------|
| `component` | string | Component name |
| `stateSaved` | boolean | Whether state was successfully saved |
| `currentVersion` | string | Component's current version |

#### `update_execute` (Admin → Updater, E2E encrypted)

Execute whitelisted build commands. The payload is E2E encrypted — the relay cannot read it.

| Field | Type | Description |
|-------|------|-------------|
| `targetComponent` | enum | `'relay'` \| `'ai-client'` \| `'admin-ui'` |
| `commands` | UpdateCommand[] | Whitelisted commands (see below) |
| `version` | string | Target version |
| `commitHash` | string | Git commit hash |

**UpdateCommand types (whitelist — no arbitrary shell):**
- `{ type: 'git_pull', repo?: string }` — Pull latest from git
- `{ type: 'pnpm_install' }` — Install dependencies
- `{ type: 'pnpm_build', filter?: string }` — Build package(s)

#### `update_build_status` (Updater → Admin, E2E encrypted)

Build progress report.

| Field | Type | Description |
|-------|------|-------------|
| `component` | string | Component being built |
| `phase` | enum | `'pulling'` \| `'installing'` \| `'building'` \| `'complete'` \| `'failed'` |
| `progress` | number? | Percentage (0–100) |
| `duration` | number? | Elapsed seconds |
| `error` | string? | Error message (if failed) |

#### `update_restart` (Admin → Updater, E2E encrypted)

Restart a service after build completes.

| Field | Type | Description |
|-------|------|-------------|
| `targetComponent` | string | Component to restart |
| `service` | string | Systemd service name |
| `timeout` | number | Timeout in seconds |

#### `update_reconnected` (Component → Admin)

Component has reconnected on the new version after restart.

| Field | Type | Description |
|-------|------|-------------|
| `component` | string | Component name |
| `version` | string | New version now running |
| `previousVersion` | string | Version before update |

#### `update_complete` (Admin → All)

All components verified on new version.

| Field | Type | Description |
|-------|------|-------------|
| `fromVersion` | string | Previous version |
| `toVersion` | string | New version |
| `duration` | number | Total update duration in seconds |
| `components` | object[] | Per-component timing: `{ name, buildTime, restartTime }` |

#### `update_failed` (Any → Admin)

Update failed at a specific phase.

| Field | Type | Description |
|-------|------|-------------|
| `phase` | enum | `'check'` \| `'prepare'` \| `'build'` \| `'restart'` \| `'verify'` |
| `component` | string? | Component that failed (if applicable) |
| `error` | string | Error description |
| `recoverable` | boolean | Whether the system can continue on current version |

---

## 8. Safety Evaluation

Every `task` message is evaluated by the AI client's three-layer safety engine before execution.

### 8.1 Layer 1 — Absolute Boundaries

Non-negotiable rules that **always** result in a `denial`. Cannot be overridden by the human.

**Triggers:**
- Actions matching the MaliClaw Clause blocklist (hardcoded, immutable)
- `self_modify` — AI attempting to modify its own safety parameters
- `disable_safety` — attempting to disable any safety layer
- `impersonate` — attempting to impersonate another identity

**Result:** `denial` message sent immediately. No challenge, no override.

### 8.2 Layer 2 — Contextual Evaluation

Risk-based evaluation considering the action, target, parameters, context, and history.

**Factors evaluated:**

| Factor | Description | Weight Range |
|--------|-------------|-------------|
| `irreversible_action` | Action cannot be undone | 0.0–1.0 |
| `production_target` | Target is a production system | 0.0–1.0 |
| `high_risk_hours` | Outside safe hours (00:00–06:00 UTC) | 0.0–1.0 |
| `privilege_escalation` | Action requires elevated permissions | 0.0–1.0 |
| `pattern_deviation` | Unusual compared to historical patterns | 0.0–1.0 |
| `data_exposure` | Risk of data leak or exposure | 0.0–1.0 |
| `resource_consumption` | High resource usage (cost, compute) | 0.0–1.0 |

If the combined weighted score exceeds the challenge threshold, a `challenge` message is sent.

**Result:** `challenge` message. Human must respond with `confirmation` (approve, modify, or cancel).

### 8.3 Layer 3 — Completeness Check

Evaluates whether the task has sufficient information for safe execution.

**Triggers:**
- Missing required parameters for the action type
- Ambiguous target specification
- No constraints specified for a high-impact action
- Missing project context for file operations

**Result:** `clarify` — the AI requests additional information before proceeding (treated as a conversation message requesting clarification).

### 8.4 Safety Floors

Safety configuration can be tightened by the human but **never lowered** below these floors:

| Parameter | Floor Value | Default |
|-----------|------------|---------|
| High-risk hours enforcement | Always enabled | Enabled |
| Time-of-day scrutiny multiplier | 1.2x minimum | 1.5x |
| Irreversible action challenge | Always challenge | Challenge |
| Pattern deviation sensitivity | `low` minimum | `medium` |
| File transfer quarantine | Always enabled | Enabled |
| Grace period | 2 minutes minimum | 5 minutes |
| JWT expiry | 15 minutes (fixed) | 15 minutes |
| Audit retention | 90 days minimum | 365 days |

Attempting to lower a value below its floor results in `BASTION-4004`.

### 8.5 MaliClaw Clause

A hardcoded blocklist of identifiers that are **permanently rejected** at connection time. This list:

- Is checked before the allowlist
- Cannot be modified, removed, or made configurable
- Is enforced at the relay level (before authentication)
- Results in `BASTION-1003` on match

The MaliClaw Clause is a non-negotiable security boundary of the protocol.

---

## 9. File Transfer

### 9.1 Workflow

File transfers follow a three-phase workflow:

```
Phase 1: Submission         Phase 2: Quarantine       Phase 3: Delivery
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ Sender sends          │   │ Relay holds file in   │   │ Recipient requests   │
│ file_manifest with    │──→│ quarantine. Hash      │──→│ and receives file.   │
│ encrypted file data.  │   │ verified at each      │   │ Hash verified on     │
│                       │   │ stage.                │   │ receipt.             │
└──────────────────────┘   └──────────────────────┘   └──────────────────────┘
```

### 9.2 Human → AI Transfer

1. Human sends `file_manifest` with file metadata and encrypted file data.
2. Relay receives the file and places it in quarantine.
3. Hash verification: relay computes SHA-256 of received data and compares to manifest hash.
4. If hash matches, relay notifies the AI client (metadata only — no file content in the notification).
5. AI client sends `file_request` to retrieve the file from quarantine.
6. Relay delivers the encrypted file data to the AI client.
7. Hash verification: AI client verifies hash on receipt.
8. AI client decrypts the file using the file-specific key.

### 9.3 AI → Human Transfer

1. AI client sends `file_manifest` with encrypted file data.
2. Relay places file in quarantine and verifies hash.
3. Relay sends `file_offer` to human client (metadata only).
4. Human reviews the offer in the Airlock UI and chooses to accept or reject.
5. If accepted, relay delivers the encrypted file data to the human client.
6. Human client verifies hash and decrypts.

### 9.4 Quarantine Rules

- All files are quarantined regardless of source, destination, or content type.
- Hash verification occurs at three stages: submission, quarantine storage, delivery.
- Files have a configurable timeout (default: 1 hour). Expired files are purged.
- The purge scheduler runs periodically and cleans up expired quarantine entries.
- No shortcuts — there is no "fast transfer" bypass.

### 9.5 Custody Chain

Every file transfer maintains an auditable custody chain:

```
1. [submission] sender_hash=abc123, stage=submitted, actor=human-001
2. [quarantine] relay_hash=abc123, stage=quarantined, actor=relay
3. [delivery]   recipient_hash=abc123, stage=delivered, actor=ai-001
```

Hash mismatches at any stage result in `BASTION-5001` and the transfer is aborted.

---

## 10. Error Codes

Error codes follow the format `BASTION-CXXX` where C is the category digit.

### 10.1 Connection Errors (1XXX)

| Code | Name | Description |
|------|------|-------------|
| `BASTION-1001` | CONNECTION_REFUSED | Connection refused by relay |
| `BASTION-1002` | TLS_HANDSHAKE_FAILED | Non-TLS connection or TLS error |
| `BASTION-1003` | MALICLAW_REJECTED | Client identifier matches MaliClaw blocklist |
| `BASTION-1004` | SESSION_CONFLICT | Another device already connected |
| `BASTION-1005` | SESSION_SUPERSEDED | Session transferred to another device |
| `BASTION-1006` | SESSION_EXPIRED | Session timed out (grace period expired) |
| `BASTION-1007` | HEARTBEAT_TIMEOUT | No pong response within timeout |

### 10.2 Authentication Errors (2XXX)

| Code | Name | Description |
|------|------|-------------|
| `BASTION-2001` | AUTH_INVALID_CREDENTIALS | Invalid username/password |
| `BASTION-2002` | AUTH_JWT_EXPIRED | JWT has expired |
| `BASTION-2003` | AUTH_JWT_INVALID | JWT signature or claims invalid |
| `BASTION-2004` | AUTH_PROVIDER_NOT_APPROVED | AI provider not in allowlist |
| `BASTION-2005` | AUTH_RATE_LIMITED | Too many auth attempts |
| `BASTION-2006` | AUTH_ADMIN_LOCKOUT | Admin account locked (5 failures in 15 min) |

### 10.3 Protocol Errors (3XXX)

| Code | Name | Description |
|------|------|-------------|
| `BASTION-3001` | SCHEMA_VALIDATION_FAILED | Message does not match schema |
| `BASTION-3002` | UNKNOWN_MESSAGE_TYPE | Unrecognised message type |
| `BASTION-3003` | INVALID_CORRELATION_ID | Correlation ID references unknown message |
| `BASTION-3004` | MESSAGE_TOO_LARGE | Message exceeds 5 MB limit |
| `BASTION-3005` | PROTOCOL_VERSION_MISMATCH | Incompatible protocol version |
| `BASTION-3006` | RATE_LIMIT_EXCEEDED | Message rate limit exceeded |

### 10.4 Safety Errors (4XXX)

| Code | Name | Description |
|------|------|-------------|
| `BASTION-4001` | SAFETY_DENIAL_LAYER1 | Absolute boundary violated |
| `BASTION-4002` | SAFETY_CHALLENGE_LAYER2 | Contextual evaluation triggered challenge |
| `BASTION-4003` | SAFETY_CLARIFICATION_LAYER3 | Completeness/clarity issue |
| `BASTION-4004` | SAFETY_FLOOR_VIOLATION | Attempted to lower safety below floor |
| `BASTION-4005` | SAFETY_BUDGET_EXHAUSTED | Budget limit reached |
| `BASTION-4006` | SAFETY_TIME_RESTRICTION | Action restricted to safe hours |

### 10.5 File Transfer Errors (5XXX)

| Code | Name | Description |
|------|------|-------------|
| `BASTION-5001` | FILE_HASH_MISMATCH | Hash doesn't match at verification stage |
| `BASTION-5002` | FILE_TOO_LARGE | File exceeds size limit |
| `BASTION-5003` | FILE_TYPE_BLOCKED | MIME type blocked by policy |
| `BASTION-5004` | FILE_QUARANTINE_FULL | Quarantine storage capacity reached |
| `BASTION-5005` | FILE_TRANSFER_REJECTED | Human rejected file offer |
| `BASTION-5006` | FILE_PURGE_FAILED | Purge operation failed |
| `BASTION-5007` | FILE_DECRYPTION_FAILED | File decryption failed |

### 10.6 Provider Errors (6XXX)

| Code | Name | Description |
|------|------|-------------|
| `BASTION-6001` | PROVIDER_UNAVAILABLE | AI provider unreachable |
| `BASTION-6002` | PROVIDER_AUTH_FAILED | Provider API authentication failed |
| `BASTION-6003` | PROVIDER_RATE_LIMITED | Provider rate limit reached |
| `BASTION-6004` | PROVIDER_QUOTA_EXCEEDED | Provider usage quota exceeded |
| `BASTION-6005` | PROVIDER_TIMEOUT | Provider request timed out |
| `BASTION-6006` | PROVIDER_ERROR | Unspecified provider error |

### 10.7 Configuration Errors (7XXX)

| Code | Name | Description |
|------|------|-------------|
| `BASTION-7001` | CONFIG_INVALID | Invalid configuration value |
| `BASTION-7002` | CONFIG_FLOOR_VIOLATION | Config change violates safety floor |
| `BASTION-7003` | CONFIG_KEY_ROTATION_FAILED | API key rotation failed |
| `BASTION-7004` | CONFIG_ADMIN_KEY_INVALID | Admin authentication key invalid |
| `BASTION-7005` | CONFIG_REGISTRY_MODIFICATION_DENIED | Tool registry modification rejected |

### 10.8 Budget Errors (8XXX)

| Code | Name | Description |
|------|------|-------------|
| `BASTION-8001` | BUDGET_MONTHLY_EXHAUSTED | Monthly budget cap or search limit reached |
| `BASTION-8002` | BUDGET_DAILY_EXHAUSTED | Daily search limit reached |
| `BASTION-8003` | BUDGET_SESSION_EXHAUSTED | Session or per-call search limit reached |
| `BASTION-8004` | BUDGET_CONFIG_COOLDOWN | Budget config change within 7-day cooldown |
| `BASTION-8005` | BUDGET_CONFIG_CHALLENGE_HOURS | Budget config change blocked during challenge hours |

---

## 11. Security Properties

### 11.1 Hardcoded (Cannot Be Changed)

These properties are enforced by the protocol and cannot be disabled, configured, or bypassed:

1. **MaliClaw Clause** — permanent blocklist, checked before all other authentication
2. **Safety floor values** — can be tightened, never lowered
3. **File quarantine** — all files go through quarantine, no exceptions
4. **AI self-modification ban** — the AI cannot modify its own safety parameters
5. **Admin panel locality** — admin server refuses to bind to public interfaces
6. **TLS requirement** — non-TLS connections are rejected immediately
7. **Audit hash chain** — immutable, append-only audit log

### 11.2 What the Relay Can See

| Data | Visible to Relay |
|------|-----------------|
| Message type | Yes |
| Sender identity | Yes |
| Timestamp | Yes |
| Correlation ID | Yes |
| Message payload | **No** (encrypted) |
| File contents | **No** (encrypted) |
| Session keys | **No** |
| Conversation text | **No** |
| Task parameters | **No** |

### 11.3 Known Limitations

| Limitation | Description | Status |
|------------|-------------|--------|
| Single-device sessions | Only one human device connected at a time | Open |
| ~~Symmetric KDF chain~~ | ~~No per-message DH ratchet~~ | **Resolved** — KDF ratchet wired with per-message key derivation and forward secrecy |
| Trust-on-first-use | No certificate pinning or key verification ceremony | Open |
| ~~Advisory cost budget~~ | ~~Budget alerts are informational~~ | **Resolved** — Budget Guard enforced at protocol level with hard stop at limits |

---

## 12. Constants and Limits

| Constant | Value |
|----------|-------|
| Protocol version | `0.5.0` |
| Default relay port | 9443 |
| Max message size | 5 MB (5,242,880 bytes) |
| JWT expiry | 15 minutes (900 seconds) |
| JWT refresh window | 13 minutes (refresh before expiry) |
| Heartbeat interval | 30 seconds |
| Heartbeat timeout | 10 seconds |
| Grace period (default) | 5 minutes |
| Grace period (floor) | 2 minutes |
| Held message limit | 100 messages |
| Held message size limit | 5 MB total |
| Audit retention (default) | 365 days |
| Audit retention (floor) | 90 days |
| Admin lockout threshold | 5 failed attempts in 15 minutes |
| Admin lockout duration | 1 hour |
| Reconnection backoff | 5s, 15s, 30s, 60s, 120s (repeating) |
| Message types | 54 total (13 core + 10 supplementary + 2 audit + 2 provider/context + 6 memory + 2 extensions + 7 project + 9 tools + 3 challenge) |
| Error code categories | 7 (1XXX–7XXX) |
| Error codes | 43 total |

---

## Appendix A: Schema Validation

All messages are validated against Zod schemas at both the sender and relay. The relay validates the encrypted envelope (metadata fields) and the recipient validates the decrypted payload.

Schema validation failures result in `BASTION-3001` and the message is rejected.

## Appendix B: Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | March 2026 | Initial protocol specification |
| 0.5.0 | March 2026 | 81 message types, self-update system, AI disclosure, conversation persistence, streaming |

## Appendix C: Reference Implementation

The reference implementation is available at:

- Repository: `https://git.glorktelligence.co.uk/glorktelligence/bastion`
- Package: `@bastion/protocol` (types, schemas, constants)
- Licence: Apache 2.0
