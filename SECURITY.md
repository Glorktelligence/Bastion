# Security Policy

## Scope

This security policy covers the entire Bastion protocol and reference implementation, including attack surfaces that many platforms exclude from their security programmes. Specifically:

- **Protocol-level attacks**: Message injection, replay attacks, schema manipulation, correlation ID spoofing
- **Prompt injection vectors**: Attempts to manipulate AI behaviour through crafted message content, task payloads, file metadata, or error messages that traverse the protocol
- **Relay compromise**: Scenarios where the relay server itself is compromised, including what an attacker can and cannot access (encrypted blobs vs. metadata)
- **Client impersonation**: Stolen JWTs, forged session initiation, MaliClaw bypass attempts, session hijacking during reconnection
- **File transfer attacks**: Hash manipulation, quarantine bypass, malicious file content, custody chain forgery
- **Safety engine bypass**: Attempts to lower safety floors, circumvent Layer 1 absolute boundaries, manipulate risk scoring inputs, or social-engineer challenge responses
- **Admin panel attacks**: Authentication bypass, privilege escalation, configuration tampering
- **Cryptographic weaknesses**: Key exchange vulnerabilities, KDF chain issues, encryption implementation flaws

We include prompt injection and AI manipulation vectors because Bastion is a Human-AI communication protocol — excluding the primary interaction surface from security review would be like a messaging app excluding message content from its threat model.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes (current) |

As a pre-release project, only the latest version receives security updates.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

### How to Report

Email **security@glorktelligence.co.uk** with:

1. **Description**: What the vulnerability is and which component(s) it affects
2. **Reproduction steps**: How to trigger it, including any relevant message payloads, configuration, or sequences
3. **Impact assessment**: What an attacker could achieve — be specific about what trust boundary is violated
4. **Affected packages**: Which `@bastion/*` package(s) are involved
5. **Suggested fix** (optional): If you have one, include it. We'll credit you.

### What to Expect

- **Acknowledgement**: Within 48 hours of receipt
- **Initial assessment**: Within 7 days — we'll confirm whether we consider it a valid vulnerability and its severity
- **Fix timeline**: Depends on severity:
  - **Critical** (safety bypass, encryption break, relay compromise): Patch within 72 hours of confirmation. Disclosure coordinated with reporter.
  - **High** (authentication bypass, file quarantine bypass, significant information leak): Patch within 14 days.
  - **Medium** (non-default configuration exploitation, denial of service, metadata leak): Patch within 30 days.
  - **Low** (requires physical access, unlikely attack chains, defence-in-depth improvements): Next scheduled release.
- **Disclosure**: We follow coordinated disclosure. We'll work with you on timing. If we fail to act within the timelines above, you are free to disclose publicly.

### Safe Harbour

We will not pursue legal action against security researchers who:

- Make a good-faith effort to avoid data destruction, service disruption, and privacy violations
- Report vulnerabilities through the process above before public disclosure
- Do not exploit vulnerabilities beyond what is necessary to demonstrate the issue
- Do not access, modify, or exfiltrate data belonging to other users (in multi-tenant deployments)

## Threat Model

### What the Relay Can See (Even If Compromised)

- Message metadata: timestamps, sender/receiver IDs, message types, sizes
- Session lifecycle events: connect, disconnect, reconnect times
- File transfer metadata: filenames, sizes, MIME types, transfer states
- JWT tokens (short-lived, 15-minute expiry)

### What the Relay Cannot See (Enforced)

Zero-knowledge relay is now **enforced**, not just designed. The relay forwards encrypted payloads without the ability to read them:

- Message content (E2E encrypted with XSalsa20-Poly1305 via KDF ratchet chain)
- File content (E2E encrypted, separately from message encryption)
- AI provider API keys (stored on AI VM only)
- Safety engine evaluation details (runs on AI client)
- Session keys (derived independently by each client from X25519 key exchange)

### Hardcoded Security Properties

These cannot be disabled or configured away:

1. **MaliClaw Clause**: Blocklist of known-dangerous identifiers, checked before any allowlist. Cannot be removed.
2. **Safety floors**: Minimum thresholds for safety parameters. Can be tightened, never lowered below factory defaults.
3. **File quarantine**: All file transfers pass through quarantine with hash verification. No bypass path exists.
4. **AI self-modification prohibition**: The AI client cannot modify its own tool registry, safety configuration, or API keys.
5. **Admin panel locality**: The admin server binds to localhost only. Public binding attempts are logged as security violations and refused.

### Admin Dashboard Access Model

The admin dashboard is accessed via SSH tunnel — the tunnel is the access control:

- **GET endpoints are unauthenticated**: Read-only monitoring (status, connections, audit, config) does not require credentials. The admin API server binds to `127.0.0.1` only — it is physically unreachable without an SSH tunnel or local access.
- **Mutations require admin credentials**: POST/PUT/DELETE (approve provider, revoke, set capabilities) require Basic auth + TOTP verification with scrypt-hashed password.
- **Self-signed certificate proxy**: The production admin UI (start-admin-ui.mjs) proxies `/api/*` requests to the admin HTTPS server with `rejectUnauthorized: false`. This is safe because both services run on `127.0.0.1` — traffic never leaves the loopback interface.

### Provider Registration Attack Surface

AI clients self-register via the `provider_register` message type. The relay validates all registrations:

- MaliClaw Clause is checked before registration — blocked identifiers are rejected.
- Registration creates a provider entry visible in the admin dashboard.
- Capability matrices can be restricted per-provider after registration.
- A compromised AI client could register with misleading metadata, but the relay's capability enforcement limits what any provider can actually do regardless of what they claim.

### 5 Immutable Boundaries

These are hardcoded and cannot be disabled by any configuration:

1. **MaliClaw Clause**: 13 specific patterns + `/claw/i` catch-all regex. Checked before all other authentication.
2. **Safety Floors**: Minimum thresholds that can be tightened, never lowered.
3. **Tool Blindness**: Dangerous tools stripped from conversation mode. Write tools always require per-call approval.
4. **Budget Guard**: Cost caps with 7-day cooldowns on changes, blocked during challenge hours.
5. **Challenge Hours**: Server-clock-enforced temporal governance. Client cannot override.

### Tool Governance Model

- Read-only tools with trust 4+ and session scope auto-approve. Write/destructive tools ALWAYS require per-call approval.
- Parameter validation rejects path traversal, command injection, and oversized payloads before MCP execution.
- API credentials read from env vars on the AI VM — never logged, never in protocol messages.

### Protocol Extension Security

- Every extension message type requires safety + audit declarations. Missing sections are rejected.
- 12 reserved namespaces blocked. Registry locks after startup. Tighten-only enforcement.

### Challenge Me More (Temporal Governance)

- Blocks budget changes, MCP registration, and schedule changes during vulnerable hours.
- Mandatory wait timers: dangerous tools 30s, deletions 10s, trust elevation >7 15s.
- Server clock enforcement via `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Tighten-only: enabling is immediate, disabling requires 7-day cooldown.

### E2E Encryption Implementation

Messages are encrypted end-to-end with XSalsa20-Poly1305 via a KDF ratchet chain. Key exchange uses X25519 (`key_exchange` message type). Each message gets a unique, irreversibly-derived key — per-message forward secrecy.

**Dual implementation for cross-platform interoperability:**
- **Human client (browser/Tauri):** tweetnacl (pure JavaScript, zero native dependencies)
- **AI client (Node.js):** libsodium via libsodium-wrappers-sumo (WASM/native)

Both are byte-identical NaCl implementations: `nacl.box.before()` = `crypto_box_beforenm()`, `nacl.secretbox()` = `crypto_secretbox_easy()`. The KDF uses SHA-512 truncated to 32 bytes on both sides.

### Known Limitations

- **Single-device sessions**: Only one human client device connected at a time. Session swap requires explicit confirmation but relies on the legitimacy of the JWT presented.
- **No per-message DH ratchet**: The KDF chain provides forward secrecy (old keys are zeroized), but does not perform a new Diffie-Hellman exchange per message. A compromised current chain key exposes subsequent messages in that session until reconnection.
- **Trust-on-first-use for relay**: The client trusts the relay's TLS certificate. Certificate pinning is not yet implemented.
- **Read-only admin is unauthenticated**: Anyone with SSH tunnel access can view monitoring data. This is by design (the tunnel is the access control) but means a compromised SSH session exposes relay metadata.

## Security Design Principles

1. **Default deny**: Unknown message types rejected. Unknown providers rejected. Unknown tools rejected. When uncertain, deny.
2. **Principle of least privilege**: AI capabilities are explicitly enumerated in a tool registry. Nothing is implicitly permitted.
3. **Defence in depth**: Safety is enforced at multiple layers (AI client safety engine, relay message routing, human challenge UI). Compromising one layer does not bypass the others.
4. **Transparency**: Every action is audited. Cost is visible. Custody chains track file provenance. Challenge decisions are logged with context.
5. **Past-self protection**: Budget can only be adjusted through admin panel (not the client). Drafts require manual send confirmation after reconnection. Safety floors cannot be lowered. Design decisions explicitly account for human cognitive states (fatigue, frustration, hyperfocus).
