# Project Bastion — Supplementary Specification

**Version:** 0.5.0-supplement-1
**Date:** March 2026
**Status:** Stable
**Licence:** Apache 2.0  
**Authors:** Harry Smith, Claude (Anthropic)

This document addresses all outstanding architectural decisions, unanswered questions, and specification gaps identified during the design review. It supplements the core Product Specification (v0.5.0) and the Project Structure document. All decisions documented here are binding for the initial implementation.

---

## 1. Licence

**Decision:** Apache 2.0

**Rationale:** Bastion is a security tool where trust and legal clarity are foundational. Apache 2.0 provides explicit patent protection that MIT does not — if a contributor introduces a technique covered by a patent they hold, they grant an automatic licence to all users. This prevents the scenario where someone forks Bastion, patents an approach derived from the codebase, and then litigates against the original project or its users.

**Implications for development:**

- Every source file must include the Apache 2.0 header comment.
- The `NOTICE` file is required alongside `LICENSE` — it must credit original authors and any third-party components.
- Contributors implicitly grant patent rights on their contributions. This must be stated clearly in `CONTRIBUTING.md`.
- Third-party dependencies must be checked for licence compatibility. Apache 2.0 is compatible with MIT, BSD, ISC. It is NOT compatible with GPLv2 (but is compatible with GPLv3). Any dependency with an incompatible licence must be flagged and replaced.

**File header template:**

```
// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms
```

---

## 2. Session Lifecycle & Reconnection

### 2.1 Session Establishment

A session begins with a three-phase handshake:

1. **TLS Connection:** Client connects to relay via WSS. TLS is terminated at the relay. The relay performs the MaliClaw Clause check on the client identifier at this stage — before any further protocol exchange.

2. **Authentication:** Client sends a session initiation message containing its identity credentials. The relay validates against the allowlist (for AI clients) or user credentials (for human clients), and issues a JWT with a 15-minute expiry.

3. **Key Exchange:** Client and relay perform an E2E key exchange. The relay facilitates the exchange between human and AI clients but cannot read the resulting session keys. Upon successful key exchange, both clients confirm readiness.

The session is now active. The relay logs a `SESSION_ESTABLISHED` audit event.

### 2.2 Session State

Each session has a defined state:

| State | Description |
|-------|-------------|
| `connecting` | TLS handshake in progress |
| `authenticating` | Credentials submitted, awaiting JWT |
| `key_exchange` | E2E key exchange in progress |
| `active` | Session fully established, messages flowing |
| `suspended` | Client disconnected, grace period active |
| `terminated` | Session ended (clean or timeout) |

### 2.3 Disconnection & Reconnection

When a client's WebSocket connection drops (network failure, device sleep, crash):

1. The relay moves the session to `suspended` state and starts a **grace timer** (default: 5 minutes, configurable upward only, minimum floor: 2 minutes).

2. During the grace period, the relay **holds undelivered messages** in a bounded queue (max 100 messages, max 5MB total). Messages exceeding the queue limit are dropped — oldest first — and a `MESSAGES_DROPPED` audit event is logged.

3. The disconnected client's counterpart (the other end of the conversation) receives a `heartbeat` message with a status field indicating the peer is `suspended`. The human client displays a clear "AI disconnected — reconnecting" or "Connection lost — reconnecting" indicator.

4. When the client reconnects within the grace period, it performs a **reconnection handshake:**
   - Presents its existing JWT (if not expired) or re-authenticates.
   - Sends a `reconnect` message containing the ID of the last message it successfully received.
   - The relay replays all held messages after that ID.
   - Session returns to `active` state.

5. If the grace period expires without reconnection, the session moves to `terminated`. All held messages are discarded. In-progress tasks are marked as `interrupted` in the audit log. A new session must be established from scratch.

### 2.4 Clean Shutdown

A client that intends to disconnect cleanly sends a `session_end` message before closing the WebSocket. The relay immediately terminates the session without a grace period and logs a `SESSION_TERMINATED_CLEAN` audit event.

### 2.5 JWT Refresh

JWTs expire every 15 minutes. The client must refresh before expiry by sending a `token_refresh` message over the active WebSocket. The relay issues a new JWT and logs the refresh. If a JWT expires without refresh, the relay terminates the session.

---

## 3. Single-Device Session Management

### 3.1 Decision

**Only one human client device may be connected at a time.** This simplifies E2E encryption (single key pair per session), eliminates message deduplication complexity, and avoids the significant cryptographic challenge of multi-device key management.

### 3.2 Session Swap Mechanism

When a human client connects while another human client session is already active:

1. The relay sends a `session_conflict` message to the **new** client, informing it that an existing session is active.

2. The new client presents this to the user with two options:
   - **Take over:** Terminate the existing session and establish a new one on this device.
   - **Cancel:** Disconnect the new client, leave the existing session active.

3. If the user chooses "take over," the relay sends a `session_superseded` message to the **old** client, which displays a notification: "Session transferred to another device." The old session terminates cleanly.

4. The new session establishes with a fresh key exchange.

### 3.3 No Implicit Takeover

Session takeover always requires explicit human confirmation through the new client. This prevents a stolen JWT from silently disconnecting the legitimate user — they would notice the "session transferred" notification on their current device.

### 3.4 Message History

Because only one device is active at a time, message history lives on the relay's audit log (authoritative) and in the active client's local SQLite database. When swapping devices, the new client can request a message history replay from the relay (limited to the current day, configurable). This replay contains message envelopes only — the E2E encrypted payloads cannot be decrypted by the new session's keys unless the user exports and imports their key material, which is a deliberate manual step.

**Practical implication:** If Harry is using the desktop, switches to mobile, and switches back to desktop, the desktop's local history is still intact. The mobile session's messages are in the relay log but not in the desktop's local store unless explicitly synced.

---

## 4. AI Client Capabilities & Tool Registry

### 4.1 Capability Model

The AI client operates within a strictly defined capability boundary. It can only invoke tools that are explicitly registered in its tool registry. Any task that requires a tool not in the registry is automatically denied (Layer 1 — absolute boundary).

### 4.2 Tool Registry Structure

The tool registry is a configuration file on the AI VM that defines every operation the AI is permitted to perform. Each tool entry includes:

```
{
  "id": "ssh_command",
  "name": "Execute SSH Command",
  "description": "Run a command on a permitted remote host via SSH",
  "permitted_hosts": ["naval-app-01", "naval-app-02"],
  "blocked_commands": ["rm -rf", "dd", "mkfs", "passwd", "userdel", "chmod 777"],
  "requires_challenge": false,
  "max_execution_time": 30,
  "safety_notes": "Scoped to app servers only. No access to backup, deploy, or firewall hosts."
}
```

### 4.3 Default Tool Categories

The reference implementation ships with the following tool categories. Each category has a safety classification that determines whether it triggers a Layer 2 challenge by default:

| Category | Examples | Default Challenge |
|----------|----------|-------------------|
| Read-only inspection | File listing, log reading, status checks, certificate validation | No |
| Configuration reading | Reading config files, checking service status | No |
| Non-destructive writes | Creating new files in permitted directories, writing reports | No |
| Service management | Restarting a service, reloading nginx | Yes |
| Destructive operations | Deleting files, modifying configs, database operations | Always |
| Network operations | HTTP requests, DNS lookups (from within VM) | Yes |
| System administration | Package management, user management, cron modification | Always + elevated scrutiny |

### 4.4 Fleet Access Scope

**Decision:** The AI VM does NOT have direct SSH access to the wider Naval Fleet by default.

The tool registry can include SSH-based tools that target specific hosts, but each host must be explicitly listed. The AI cannot discover or scan for hosts. The firewall (Mystic/OPNSense) enforces this at the network level — the AI VM's VLAN (50) only has routes to explicitly permitted destinations.

**Rationale:** If the AI VM is compromised, the blast radius must not extend to the fleet. Access to fleet hosts is opt-in per host, not blanket.

### 4.5 Tool Registry Modification

The tool registry can only be modified through two mechanisms:

1. **Direct file edit on the VM** — requires SSH access to the VM, which is restricted to the relay operator (Harry).
2. **Configuration message via Bastion protocol** — an authenticated configuration message from the relay admin, signed with the admin key. The AI client validates the signature before applying any changes.

The AI itself cannot modify its own tool registry. This is a hardcoded constraint.

---

## 5. API Key Rotation

### 5.1 The Problem

The API key (e.g., Anthropic API key) lives on the AI VM, encrypted at rest. The isolation model means we don't routinely SSH into the VM after initial setup. We need a mechanism to rotate the key without breaking isolation.

### 5.2 Solution: Configuration Message Channel

The relay admin can issue a `config_update` message type through the Bastion protocol. This message:

1. Is only accepted from the relay admin interface (authenticated with admin credentials).
2. Is encrypted with an additional **admin configuration key** that is separate from the E2E session keys. This key is established during initial VM setup and is known only to the relay admin and the AI client.
3. Contains a `config_type: "api_key_rotation"` payload with the new key, encrypted.
4. Is logged in the audit trail as `CONFIG_UPDATE_API_KEY` (the key value itself is NOT logged — only the event).

### 5.3 Rotation Flow

1. Admin generates a new API key from the provider's dashboard (e.g., Anthropic console).
2. Admin opens the relay admin panel and navigates to System → API Key Rotation.
3. Admin enters the new key. The admin panel encrypts it with the admin configuration key.
4. The relay transmits the encrypted `config_update` message to the AI client.
5. The AI client decrypts the new key, validates that it works (makes a test API call), and if successful, replaces the stored key.
6. The AI client sends a `config_ack` message back confirming the rotation.
7. If the test call fails, the AI client retains the old key and sends a `config_nack` with an error description.

### 5.4 Emergency Rotation

If the API key is believed compromised, the admin can revoke it at the provider level immediately (Anthropic dashboard), then use the rotation flow above to install a new one. During the gap, the AI client will fail API calls and report `provider_unavailable` status.

---

## 6. Relay Admin Authentication

### 6.1 Decision

The relay admin panel uses **client certificate authentication** as the primary mechanism, with a fallback to **username + TOTP** for situations where client certs are impractical.

### 6.2 Client Certificate Auth

- A self-signed CA is generated during relay setup and stored on the relay.
- Admin client certificates are issued from this CA and installed on the admin's devices.
- The relay admin HTTP server requires a valid client certificate for all requests.
- Certificates can be revoked by adding them to a local CRL on the relay.

### 6.3 Username + TOTP Fallback

- A local admin account is created during relay setup.
- Password is stored as an Argon2id hash.
- TOTP (e.g., via a standard authenticator app) is mandatory — password alone is never sufficient.
- Failed login attempts are rate-limited: 5 attempts per 15 minutes, then lockout for 1 hour.

### 6.4 Access Restrictions

- The admin panel is only accessible from the local network or via WireGuard VPN. It does not bind to a public interface under any configuration.
- This restriction is enforced at the relay's HTTP server level (bind address) and at the firewall level (OPNSense rules).
- Attempting to configure the admin panel on a public interface logs a `SECURITY_VIOLATION` audit event and refuses to start.

---

## 7. Alerting & Notifications

### 7.1 The Problem

Critical events can occur when the human client is not open — failed heartbeats, hash mismatches, rejected connections, AI provider failures, session terminations. The relay needs an out-of-band notification channel.

### 7.2 Alert Channels

The relay supports configurable alert channels. Multiple channels can be active simultaneously:

| Channel | Configuration | Use Case |
|---------|---------------|----------|
| Discord Webhook | Webhook URL to a private channel | Primary alerting — integrates with existing Glorktelligence Discord |
| Minx Bot Integration | API endpoint on Minx bot for alert messages | Fleet-native alerting through existing infrastructure |
| Email (SMTP) | SMTP server details | Backup channel for critical-only alerts |
| Local file | Path to alert log file | Always active, fallback if all external channels fail |

### 7.3 Alert Severity Levels

| Level | Trigger Examples | Channels Notified |
|-------|-----------------|-------------------|
| `critical` | Hash mismatch detected, safety floor modification attempt, admin auth failure, relay crash | All configured channels |
| `warning` | Heartbeat missed (2 consecutive), session terminated unexpectedly, API key rotation failure, provider unavailable | Discord + Minx + local file |
| `info` | Session established, session terminated cleanly, provider reconnected, config update applied | Local file only |

### 7.4 Alert Fatigue Prevention

- Alerts of the same type are **deduplicated** within a 5-minute window. If the heartbeat fails 30 times in 5 minutes, one alert is sent with a count, not 30 individual alerts.
- `info` level events never trigger external notifications — they are logged locally only.
- The admin can configure a **quiet hours** window where only `critical` alerts are sent externally. This defaults to disabled (all alerts at all times).

---

## 8. Graceful Degradation

### 8.1 Provider Unavailability

When the AI provider (e.g., Anthropic API) is unreachable or returning errors:

1. The AI client detects the failure and sends a `status` message to the relay with `provider_status: "unavailable"` and the error details.
2. The relay forwards this to the human client, which displays a clear banner: "AI provider unavailable — tasks cannot be processed."
3. The human client **disables the task input mode**. Conversation mode remains available for local features (viewing history, reviewing audit logs, managing settings) but the user cannot submit tasks that require AI processing.
4. The AI client enters a **retry loop** with exponential backoff (5s, 15s, 30s, 60s, 120s, then every 120s). Each retry attempt is logged.
5. When the provider recovers, the AI client sends a `status` message with `provider_status: "available"`. The human client removes the unavailability banner and re-enables task mode.

### 8.2 Relay Unavailability

If the relay itself goes down:

1. Both clients lose their WebSocket connections and enter reconnection loops with exponential backoff.
2. The human client displays "Relay unreachable — attempting to reconnect."
3. No messages can be sent or received. The human client allows local-only actions: browsing cached message history, reviewing locally-stored audit entries, viewing settings.
4. When the relay recovers, clients reconnect using the reconnection handshake (Section 2.3). Messages sent by either side during the outage are lost — there is no offline queue at the relay level (the relay was down, it couldn't queue anything).

### 8.3 AI VM Crash / Restart

If the AI VM crashes or restarts:

1. The AI client process restarts and re-establishes a session with the relay.
2. All in-memory state is lost. In-progress tasks are abandoned.
3. The AI client sends a `status` message indicating it has restarted, including `tasks_interrupted: true`.
4. The relay marks any in-progress tasks as `interrupted` in the audit log and notifies the human client.
5. The human client displays which tasks were interrupted and asks the user whether to resubmit them.
6. The user must explicitly resubmit — the relay does not automatically replay tasks after a VM restart. This prevents the scenario where a task that caused the crash is immediately replayed.

---

## 9. Cost Tracking

### 9.1 Rationale

API calls cost money. Harry operates on a fixed budget (Carers Allowance / Universal Credit). Runaway API usage could have real financial consequences. The safety engine should treat budget as a resource constraint, just like it treats disk space or CPU.

### 9.2 Token Usage Tracking

The AI client tracks token usage per API call:

- Input tokens consumed
- Output tokens consumed
- Total cost (calculated using the provider's pricing model, configured locally)
- Running total for the current billing period (calendar month)

### 9.3 Budget Thresholds

The AI client maintains configurable budget thresholds that trigger safety actions:

| Threshold | Action |
|-----------|--------|
| 50% of monthly budget | `status` message to human client: "50% of monthly API budget used." Informational only. |
| 75% of monthly budget | `status` message with elevated visibility. Human client displays a persistent budget indicator. |
| 90% of monthly budget | **Automatic challenge** on all new tasks: "You've used 90% of this month's API budget. Proceeding with this task will cost approximately X tokens. Confirm?" |
| 100% of monthly budget | **Automatic denial** of new tasks. Human client displays: "Monthly API budget exhausted. Tasks will resume next billing period or when budget is adjusted." |

### 9.4 Budget Configuration

- Monthly budget is set in the AI client's configuration (amount in USD/GBP, provider pricing per token).
- The budget floor is $0 — you can set it to zero to disable the AI entirely without revoking the API key.
- Budget can only be adjusted through the relay admin panel (not through the human client). This prevents a frustrated or hyperfocused user from raising their own budget at 3am. Past Harry protects future Harry.
- Budget resets on the 1st of each calendar month, logged as a `BUDGET_RESET` audit event.

### 9.5 Cost Transparency

Every `result` message from the AI includes a `cost` metadata field showing the tokens consumed and estimated cost for that task. The human client can display cumulative session costs in the status bar.

---

## 10. Data Retention & GDPR

### 10.1 Legal Basis

Bastion processes personal data in the form of message content, IP addresses, session metadata, and audit logs. As a self-hosted tool operating under UK jurisdiction, it falls under the UK Data Protection Act 2018 (UK GDPR).

The legal basis for processing is **Article 6(1)(f) — legitimate interests.** The legitimate interest is security auditing and system integrity. The relay operator (Harry) is both the data controller and the primary data subject in a self-hosted deployment.

### 10.2 Audit Log Retention

The audit log is append-only and tamper-evident by design. This creates a tension with the right to erasure (Article 17). The resolution:

- **Audit log entries are retained for a configurable retention period** (default: 365 days, minimum floor: 90 days).
- After the retention period, entries are **anonymised**, not deleted. Anonymisation replaces all identifying information (IP addresses, user identifiers, message content references) with hashed placeholders. The audit chain's integrity is preserved, but the data can no longer identify individuals.
- The anonymisation process is logged as an `AUDIT_ANONYMISED` event.
- **During the retention period, erasure requests are declined** under the Article 17(3)(e) exemption (establishment, exercise, or defence of legal claims) and Article 17(3)(d) (archiving in the public interest for scientific or historical research purposes, insofar as the right to erasure is likely to render impossible or seriously impair the achievement of the objectives of that processing — in this case, the security audit objective).

### 10.3 Message Content Retention

Messages stored in the relay's audit log are E2E encrypted. The relay cannot read them. This is privacy by design (Article 25).

- The relay stores encrypted blobs with metadata (timestamps, message types, sender/receiver IDs).
- The human client stores decrypted message history locally in SQLite.
- The user controls their local history and can delete it at any time from the client settings.
- The relay's encrypted blobs are subject to the same retention/anonymisation policy as audit entries.

### 10.4 File Transfer Data

- Files in quarantine are encrypted and automatically purged on completion or timeout.
- File metadata (name, size, hash, transfer timestamps) is retained in the audit log for the retention period, then anonymised.
- File content is never retained beyond the active transfer.

### 10.5 Privacy Documentation

The project must ship with:

1. **Privacy Policy** — clear, readable, explaining what data is processed, why, and for how long. Unlike some platforms, this is non-negotiable.
2. **Data Processing Record** — internal document listing all processing activities (Article 30 requirement for controllers).
3. **Data Protection Impact Assessment (DPIA)** — given the security-sensitive nature of the processing, a DPIA is prudent even if not strictly required for a self-hosted tool. This document assesses risks to data subjects and documents mitigations.

These documents live in `docs/legal/` and are referenced from the project README.

---

## 11. Offline Behaviour

### 11.1 Human Client — Desktop (Tauri)

When the relay is unreachable:

- The client displays a clear, persistent "Offline — Relay unreachable" banner.
- **Drafting is enabled.** The user can compose messages and tasks locally. These are stored in a local `drafts` queue in SQLite.
- When the relay becomes reachable again and a session is re-established, the client presents the drafts queue to the user: "You have 3 unsent messages. Send now?"
- **Drafts are NOT automatically sent.** The user must review and confirm. This prevents the scenario where something drafted at 4am while frustrated gets sent automatically when the connection recovers at 8am. Past Harry protects future Harry, even offline.
- Local features remain available: browsing cached message history, reviewing locally-cached audit entries, viewing settings.

### 11.2 Human Client — Mobile (React Native)

Same behaviour as desktop, with an additional consideration:

- Mobile connections are inherently less reliable. The client implements a **connection quality indicator** (good/fair/poor/offline) based on WebSocket latency and heartbeat response times.
- On `poor` connection quality, the client preemptively warns the user that messages may be delayed.
- Mobile draft queue is limited to 10 messages to prevent excessive local storage usage.

### 11.3 AI Client

The AI client does not have offline behaviour in the traditional sense — if it cannot reach the relay, it has nothing to do. It enters a reconnection loop and waits. No tasks are processed, no messages are generated.

If the AI client can reach the relay but not the AI provider (Anthropic API), it follows the graceful degradation rules (Section 8.1).

---

## 12. Error Codes & Categories

### 12.1 Error Code Structure

All error codes follow the format: `BASTION-CXXX` where C is the category and XXX is the specific error.

### 12.2 Error Categories

**1XXX — Connection Errors**

| Code | Name | Description |
|------|------|-------------|
| `BASTION-1001` | `CONNECTION_REFUSED` | WebSocket connection refused by relay |
| `BASTION-1002` | `TLS_HANDSHAKE_FAILED` | TLS negotiation failed |
| `BASTION-1003` | `MALICLAW_REJECTED` | Connection rejected by MaliClaw Clause |
| `BASTION-1004` | `SESSION_CONFLICT` | Another device is already connected |
| `BASTION-1005` | `SESSION_SUPERSEDED` | Session transferred to another device |
| `BASTION-1006` | `SESSION_EXPIRED` | Session grace period expired |
| `BASTION-1007` | `HEARTBEAT_TIMEOUT` | Heartbeat not received within timeout |

**2XXX — Authentication Errors**

| Code | Name | Description |
|------|------|-------------|
| `BASTION-2001` | `AUTH_INVALID_CREDENTIALS` | Invalid authentication credentials |
| `BASTION-2002` | `AUTH_JWT_EXPIRED` | JWT token has expired |
| `BASTION-2003` | `AUTH_JWT_INVALID` | JWT token is malformed or tampered |
| `BASTION-2004` | `AUTH_PROVIDER_NOT_APPROVED` | AI provider not in allowlist |
| `BASTION-2005` | `AUTH_RATE_LIMITED` | Too many authentication attempts |
| `BASTION-2006` | `AUTH_ADMIN_LOCKOUT` | Admin account locked due to failed attempts |

**3XXX — Protocol Errors**

| Code | Name | Description |
|------|------|-------------|
| `BASTION-3001` | `SCHEMA_VALIDATION_FAILED` | Message does not conform to schema |
| `BASTION-3002` | `UNKNOWN_MESSAGE_TYPE` | Unrecognised message type |
| `BASTION-3003` | `INVALID_CORRELATION_ID` | Correlation ID references unknown message |
| `BASTION-3004` | `MESSAGE_TOO_LARGE` | Message exceeds maximum size |
| `BASTION-3005` | `PROTOCOL_VERSION_MISMATCH` | Client protocol version incompatible |
| `BASTION-3006` | `RATE_LIMIT_EXCEEDED` | Message rate limit exceeded |

**4XXX — Safety Errors**

| Code | Name | Description |
|------|------|-------------|
| `BASTION-4001` | `SAFETY_DENIAL_LAYER1` | Task denied by absolute boundary |
| `BASTION-4002` | `SAFETY_CHALLENGE_LAYER2` | Task challenged by contextual evaluation |
| `BASTION-4003` | `SAFETY_CLARIFICATION_LAYER3` | Task requires clarification |
| `BASTION-4004` | `SAFETY_FLOOR_VIOLATION` | Attempt to lower safety below floor |
| `BASTION-4005` | `SAFETY_BUDGET_EXHAUSTED` | Monthly API budget exceeded |
| `BASTION-4006` | `SAFETY_TIME_RESTRICTION` | Operation restricted during high-risk hours |

**5XXX — File Transfer Errors**

| Code | Name | Description |
|------|------|-------------|
| `BASTION-5001` | `FILE_HASH_MISMATCH` | File hash at delivery does not match receipt |
| `BASTION-5002` | `FILE_TOO_LARGE` | File exceeds maximum transfer size |
| `BASTION-5003` | `FILE_TYPE_BLOCKED` | MIME type not in allowed list |
| `BASTION-5004` | `FILE_QUARANTINE_FULL` | Quarantine storage capacity reached |
| `BASTION-5005` | `FILE_TRANSFER_REJECTED` | Human rejected the file offer |
| `BASTION-5006` | `FILE_PURGE_FAILED` | Automatic purge failed (disk error) |
| `BASTION-5007` | `FILE_DECRYPTION_FAILED` | E2E decryption failed (key mismatch) |

**6XXX — Provider Errors**

| Code | Name | Description |
|------|------|-------------|
| `BASTION-6001` | `PROVIDER_UNAVAILABLE` | AI provider API unreachable |
| `BASTION-6002` | `PROVIDER_AUTH_FAILED` | API key rejected by provider |
| `BASTION-6003` | `PROVIDER_RATE_LIMITED` | Provider rate limit exceeded |
| `BASTION-6004` | `PROVIDER_QUOTA_EXCEEDED` | Provider usage quota exceeded |
| `BASTION-6005` | `PROVIDER_TIMEOUT` | Provider response timed out |
| `BASTION-6006` | `PROVIDER_ERROR` | Provider returned an error response |

**7XXX — Configuration Errors**

| Code | Name | Description |
|------|------|-------------|
| `BASTION-7001` | `CONFIG_INVALID` | Configuration value failed validation |
| `BASTION-7002` | `CONFIG_FLOOR_VIOLATION` | Attempted to set value below safety floor |
| `BASTION-7003` | `CONFIG_KEY_ROTATION_FAILED` | API key rotation test call failed |
| `BASTION-7004` | `CONFIG_ADMIN_KEY_INVALID` | Admin configuration key validation failed |
| `BASTION-7005` | `CONFIG_REGISTRY_MODIFICATION_DENIED` | AI attempted to modify its own tool registry |

### 12.3 Error Message Structure

All error messages follow this structure within the message payload:

```json
{
  "code": "BASTION-4001",
  "name": "SAFETY_DENIAL_LAYER1",
  "message": "Task denied: operation targets a directory outside the permitted scope.",
  "detail": "The requested path /etc/ssh/ is in the AI VM's blacklisted directory list.",
  "recoverable": false,
  "suggested_action": "Resubmit the task targeting a permitted directory, or contact the relay admin to modify the tool registry.",
  "timestamp": "2026-03-08T14:25:32.000Z"
}
```

The `recoverable` field indicates whether the client should offer a retry option. Connection errors are generally recoverable; safety denials are not.

---

## 13. Additional Message Types

The gap analysis revealed that the core spec's message types need to be supplemented with the following:

| Type | Direction | Purpose |
|------|-----------|---------|
| `session_end` | Either → Relay | Clean shutdown notification |
| `session_conflict` | Relay → Human | Another device is attempting to connect |
| `session_superseded` | Relay → Human | Session has been transferred to another device |
| `reconnect` | Either → Relay | Reconnection request with last-received message ID |
| `config_update` | Admin → AI (via Relay) | Configuration change (API key rotation, tool registry) |
| `config_ack` | AI → Admin (via Relay) | Configuration change applied successfully |
| `config_nack` | AI → Admin (via Relay) | Configuration change failed |
| `token_refresh` | Either → Relay | JWT refresh request |
| `provider_status` | AI → Human (via Relay) | AI provider availability status change |
| `budget_alert` | AI → Human (via Relay) | Budget threshold reached |

These are added to the 13 message types in the core spec, bringing the total to 23.

---

## 14. Additional Project Structure Entries

Based on this supplementary spec, the following additions are needed in the project structure:

```
docs/
├── legal/
│   ├── privacy-policy.md              # Privacy policy
│   ├── data-processing-record.md      # Article 30 processing record
│   └── dpia.md                        # Data Protection Impact Assessment
├── protocol/
│   ├── error-codes.md                 # Error code reference (this document, Section 12)
│   ├── session-lifecycle.md           # Session states & reconnection (Section 2)
│   └── message-types-supplementary.md # Additional message types (Section 13)
```

```
packages/
├── relay/src/
│   ├── alerts/
│   │   ├── alert-manager.ts           # Alert dispatch orchestrator
│   │   ├── channels/
│   │   │   ├── discord-webhook.ts     # Discord webhook channel
│   │   │   ├── minx-bot.ts           # Minx bot integration channel
│   │   │   ├── email.ts              # SMTP email channel
│   │   │   └── local-file.ts         # Local file fallback channel
│   │   ├── deduplicator.ts           # Alert fatigue prevention
│   │   └── severity.ts               # Severity level definitions
│   ├── sessions/
│   │   ├── session-manager.ts         # Session state machine
│   │   ├── grace-timer.ts            # Disconnection grace period
│   │   ├── message-queue.ts          # Held messages during suspension
│   │   └── conflict-resolver.ts      # Multi-device conflict handling
│   └── config/
│       └── admin-auth.ts             # Client cert + TOTP auth for admin panel
```

```
packages/
├── client-ai/src/
│   ├── budget/
│   │   ├── token-tracker.ts           # Per-call token usage tracking
│   │   ├── cost-calculator.ts         # Cost estimation using provider pricing
│   │   └── budget-enforcer.ts         # Threshold checks & automatic challenges
│   ├── tools/
│   │   ├── registry.ts               # Tool registry loader & validator
│   │   ├── registry-guard.ts         # Prevents AI self-modification of registry
│   │   └── definitions/
│   │       ├── ssh-command.ts         # SSH command tool definition
│   │       ├── file-read.ts          # File reading tool
│   │       ├── file-write.ts         # File writing tool (permitted dirs only)
│   │       └── http-request.ts       # Outbound HTTP tool (whitelisted endpoints)
│   └── provider/
│       └── key-rotation.ts           # API key rotation handler
```

```
packages/
├── client-human/src/lib/
│   ├── stores/
│   │   └── drafts.ts                 # Offline draft queue store
│   ├── components/
│   │   ├── OfflineBanner.svelte      # Relay unreachable indicator
│   │   ├── DraftQueue.svelte         # Draft review & send interface
│   │   ├── BudgetIndicator.svelte    # API budget status display
│   │   ├── ProviderStatus.svelte     # AI provider availability banner
│   │   ├── SessionConflict.svelte    # Device conflict resolution UI
│   │   └── ConnectionQuality.svelte  # Connection health indicator
│   └── services/
│       └── reconnection.ts           # Reconnection logic with backoff
```

---

## 15. Open Questions for Future Iterations

The following items are acknowledged but intentionally deferred to post-v1.0:

1. **macOS testing** — Tauri cross-compiles for macOS but we cannot test without hardware. Community testing will be needed.
2. **iOS client** — React Native supports iOS but requires Apple Developer Program membership. Deferred.
3. **Multiple AI providers simultaneously** — The architecture supports this (the relay routes between clients) but the UX for managing multiple AI sessions needs design work.
4. **Plugin system for the AI client** — Custom tool definitions beyond the reference set. Needs careful security analysis before implementation.
5. **Relay federation** — Multiple relay servers communicating. Interesting for distributed deployments but adds significant complexity.
6. **PostgreSQL migration** — Moving from SQLite to PostgreSQL for the audit store. Planned for when single-relay SQLite hits performance limits.
7. **Internationalisation** — UI translation. The reference implementation is English-only initially.

---

*This document is a living specification. Updates will be tracked in the changelog alongside the core spec.*
