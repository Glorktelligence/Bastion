# Project Bastion

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-3%2C897_passing-brightgreen.svg)](#run-tests)
[![Packages](https://img.shields.io/badge/Packages-8-purple.svg)](#packages)
[![Protocol](https://img.shields.io/badge/Protocol-95_message_types-orange.svg)](#protocol)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6.svg)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Status](https://img.shields.io/badge/Status-Pre--Release-yellow.svg)](#status)
[![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?logo=discord)](https://discord.gg/Z6bApdTFDw)

**A privacy-first secure messaging protocol for structured Human-AI communication.**

Bastion is an open-source protocol and reference implementation for a communication channel between a human operator and an AI system running in an isolated virtual machine. It provides end-to-end encryption, a three-layer safety engine, auditable file transfers, and full transparency — designed for environments where trust must be earned, not assumed.

---

## Live

> The desktop Human Client connected to a relay server routing encrypted messages to an AI client in an isolated VM — the full Bastion protocol chain, live.

<p align="center">
  <img src="docs/screenshots/1.png" alt="Bastion — first message through the protocol" width="720" />
</p>

<details>
<summary>More screenshots</summary>

<p align="center">
  <img src="docs/screenshots/2.png" alt="Bastion — protocol discussion through Bastion" width="720" />
  <br/><br/>
  <img src="docs/screenshots/3.png" alt="Bastion — zero-knowledge relay performance" width="720" />
  <br/><br/>
  <img src="docs/screenshots/4.png" alt="Bastion — hash verification and encryption discussion" width="720" />
  <br/><br/>
  <img src="docs/screenshots/6.png" alt="Bastion — industrial cyber aesthetic" width="720" />
  <br/><br/>
  <img src="docs/screenshots/challenge-activated.png" alt="Bastion — AI Challenge: Claude pushes back on removing a safety feature" width="720" />
</p>

</details>

---

## Why Bastion Exists

AI systems are powerful. They can manage infrastructure, process data, and execute complex tasks across networked environments. But delegating real authority to an AI requires more than an API key and a prayer.

Most Human-AI interaction today happens through chat interfaces with no structure, no safety boundaries, and no audit trail. If an AI system has SSH access to your servers, you should know exactly what it's doing, why, and have the ability to intervene before it does something irreversible. That's what Bastion provides.

**What makes it different:**

- **The relay never sees plaintext.** End-to-end encryption means the relay routes encrypted blobs. It cannot read message content, even if compromised.
- **Safety is structural, not bolted on.** A three-layer evaluation engine (absolute boundaries → contextual analysis → human challenge) runs on every task before execution. Safety floors can be tightened but never lowered below factory defaults.
- **Files go through quarantine.** Every file transfer passes through an airlock with hash verification at submission, quarantine, and delivery. No shortcuts.
- **The AI cannot modify its own permissions.** Tool registries, safety configurations, and API keys are controlled by the human operator through authenticated channels. This is hardcoded, not configurable.
- **Transparency is the default.** Every action is audited with a tamper-evident hash chain. The audit trail is queryable from the human client and the admin dashboard — chain integrity is verified on every read. Cost tracking, custody chains for files, and structured challenge/response flows give the human operator full visibility.
- **Session context is continuous.** The AI maintains a conversation buffer across the session with token budget enforcement. A user-defined context file injects informative context into the system prompt — below the immutable role context, never overriding safety.
- **AI providers are governed.** Providers register via the protocol with declared capabilities. The relay validates registrations against the MaliClaw Clause and capability matrix before allowing messages. The admin dashboard shows live provider status, connection counts, and message rates.
- **The MaliClaw Clause is permanent.** A hardcoded blocklist of known-dangerous AI providers and identifiers that cannot be removed, bypassed, or configured away. It exists because some doors should not be openable.

## Architecture

```
┌─────────────────────┐         ┌─────────────────────┐
│   Human Client      │  WSS    │   Relay Server      │
│   (Tauri Desktop    │◄───────►│   (Node.js)         │
│    or React Native) │  E2E    │                     │
│                     │ encrypted│  ┌───────────────┐  │
│  ┌───────────────┐  │         │  │ Message Router │  │
│  │ Safety Review  │  │         │  │ Audit Logger   │  │
│  │ Challenge UI   │  │         │  │ File Quarantine│  │
│  │ File Airlock   │  │         │  │ Auth (JWT)     │  │
│  │ Task Tracker   │  │         │  │ Admin Server   │  │
│  └───────────────┘  │         │  └───────────────┘  │
└─────────────────────┘         └─────────┬───────────┘
                                          │ WSS, E2E encrypted
                                          ▼
                                ┌─────────────────────┐
                                │   AI Client          │
                                │   (Isolated VM)      │
                                │                      │
                                │  ┌────────────────┐  │
                                │  │ Safety Engine   │  │
                                │  │ 3 Adapters      │  │
                                │  │ Soul Document   │  │
                                │  │ Skill Store     │  │
                                │  │ Tool Registry   │  │
                                │  │ File Handler    │  │
                                │  └────────────────┘  │
                                └──────────────────────┘
```

## Seven Sole Authorities

Bastion enforces single-responsibility through seven components with exclusive sovereignty over their domain. No other code may perform these operations — violations are logged and escalated.

| Authority | Scope | Description |
|-----------|-------|-------------|
| DateTimeManager | TIME | Injected into 15 managers. All business logic time calls go through DTM |
| PurgeManager | DELETE | All file deletion goes through PurgeManager. No direct `fs.unlink` |
| ToolManager | TOOLS | Tool registry with lock, violation escalation, upstream monitoring |
| SkillsManager | SKILLS | Forensic scanner, quarantine pipeline, hot-reload |
| BastionBash | EXECUTION | Three-tier command system, governed filesystem, rate limiting |
| AuditLogger | AUDIT | Tamper-evident hash chain, event type registry, chain integrity verification |
| BastionGuardian | EXISTENCE | Relay-anchored environment checks, violation monitoring, cascade shutdown across connected components. Owns the 9XXX error category. See `packages/relay/src/guardian/bastion-guardian.ts`. |

## AI Native Toolbox

The AI client can issue structured actions parsed from its response text — these are the four "powers" that make Bastion a true Human-AI protocol, not just a chat interface:

| Power | Block Syntax | Description |
|-------|-------------|-------------|
| CHALLENGE | `[BASTION:CHALLENGE]` | AI challenges human on risky actions during vulnerable hours |
| MEMORY | `[BASTION:MEMORY]` | AI proposes memories for human approval (preference, fact, workflow) |
| RECALL | `[BASTION:RECALL]` | AI searches compacted conversation history for relevant context |
| EXEC | `[BASTION:EXEC]` | AI executes governed commands via BastionBash with human oversight |

> **The AI has infrastructure to push back.** When Claude detects a risky action — like removing a safety feature at 2am — Bastion's challenge system gives it the tools to object with a proper dialog, suggested alternatives, and three choices: Accept, Override (with receipt), or Cancel.

<p align="center">
  <img src="docs/screenshots/challenge-activated.png" alt="Bastion — AI Challenge in action: Claude pushes back on removing rate limiting" width="720" />
</p>

## Extension System

Bastion supports protocol extensions for adding custom functionality without modifying the core:

- **Manifest-driven**: Extensions declare their message types, capabilities, and UI components in a structured manifest
- **Generic loading**: ExtensionHandlerLoader dynamically loads extension handlers with security scanning
- **Conversation renderers**: Extensions can provide custom UI renderers for their message types in the human client
- **Extension State Bridge**: Extensions can push, request, and synchronise state across the protocol chain via `extension_state_push`, `extension_state_request`, and `extension_state_response` messages
- **Sandboxed UI**: Extension UI components run in sandboxed iframes with a controlled message bridge
- **Rate-limited**: Extension messages are rate-limited (60/min/namespace) with direction enforcement

## Packages

| Package                          | Description                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `@bastion/protocol`            | Shared types, Zod schemas, constants, error codes — the single source of truth      |
| `@bastion/crypto`              | E2E encryption (libsodium), KDF key chain, file encrypt/decrypt, audit hash chain    |
| `@bastion/relay`               | WebSocket server, message routing, JWT auth, audit logging, file quarantine          |
| `@bastion/client-human`        | Tauri + SvelteKit desktop app — messaging, challenge review, file transfers         |
| `@bastion/client-human-mobile` | React Native mobile app — same protocol, mobile-native UI                           |
| `@bastion/client-ai`           | Headless AI client for isolated VM — safety engine, 3 adapters, skills, file handling |
| `@bastion/relay-admin-ui`      | SvelteKit admin panel — provider management, blocklist, quarantine, 5-tab config    |
| `@bastion/adapter-template`   | Community adapter reference template — build adapters for any AI provider           |

## The Three-Layer Safety Engine

Every task submitted through Bastion is evaluated by the AI client's safety engine before execution:

| Layer | Name                | Function                                                                                                                                                                    | Configurable                                                       |
| ----- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1     | Absolute Boundary   | Hardcoded denials — blocked operations, MaliClaw Clause, tool registry violations                                                                                          | No. Immutable.                                                     |
| 2     | Contextual Analysis | Risk scoring based on operation type, target sensitivity, time of day, budget impact, historical patterns                                                                   | Thresholds can be tightened only                                   |
| 3     | Human Challenge     | Operations above the risk threshold are presented to the human with full context: reason, risk assessment, contributing factors, suggested alternatives. The human decides. | Challenge threshold can be lowered (more challenges), never raised |

## Quick Start

### Prerequisites

- **Node.js** >= 20.0.0 (developed on v24)
- **PNPM** >= 9.0.0 (developed on v10.32)
- **Linux with systemd** (Ubuntu 22.04+ recommended)
- **TLS certificates** for the relay (self-signed or Let's Encrypt)

### Deploy Relay

```bash
# Clone and install
sudo mkdir -p /opt/bastion
sudo chown $(whoami) /opt/bastion
git clone https://github.com/Glorktelligence/Bastion.git /opt/bastion
cd /opt/bastion

# Run the installer (creates user, builds, installs services)
sudo bash scripts/bastion-cli.sh install --vm relay

# Configure
cp .env.example .env
# Edit .env with your settings (TLS cert paths, JWT secret, etc.)

# Verify and start
bastion doctor
bastion start --component relay
```

### Deploy AI Client (separate VM recommended)

```bash
# Same clone + install process
sudo mkdir -p /opt/bastion
sudo chown $(whoami) /opt/bastion
git clone https://github.com/Glorktelligence/Bastion.git /opt/bastion
cd /opt/bastion

sudo bash scripts/bastion-cli.sh install --vm ai

# Configure
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY, BASTION_RELAY_URL, etc.

bastion doctor
bastion start --component ai
```

### Update

```bash
sudo -u bastion bastion update --component relay   # Relay VM
sudo -u bastion bastion update --component ai      # AI VM
bastion restart --component all
```

### Human Client (Development)

```bash
cd packages/client-human
pnpm dev
# Opens at http://localhost:1420
```

### Run Tests

```bash
pnpm test    # All 3,897 tests across 14 files
pnpm lint    # Biome linting
```

## Protocol

Bastion defines 95 message types across structured categories:

- **Core** (9): `task`, `conversation`, `challenge`, `confirmation`, `denial`, `status`, `result`, `error`, `heartbeat`
- **File Transfer** (3): `file_manifest`, `file_offer`, `file_request`
- **Session** (6): `session_end`, `session_conflict`, `session_superseded`, `session_restored`, `reconnect`, `token_refresh`
- **Admin/Config** (4): `config_ack`, `config_nack`, `provider_status`, `budget_alert`
- **Audit** (2): `audit_query`, `audit_response`
- **Provider/Context** (2): `provider_register`, `context_update`
- **Memory** (6): `memory_proposal`, `memory_decision`, `memory_list`, `memory_list_response`, `memory_update`, `memory_delete`
- **Extensions** (2): `extension_query`, `extension_list_response`
- **Extension State** (3): `extension_state_push`, `extension_state_request`, `extension_state_response`
- **Project Context** (7): `project_sync`, `project_sync_ack`, `project_list`, `project_list_response`, `project_delete`, `project_config`, `project_config_ack`
- **Skills** (1): `skill_list_response`
- **Tool Integration** (9): `tool_registry_sync`, `tool_registry_ack`, `tool_request`, `tool_approved`, `tool_denied`, `tool_result`, `tool_revoke`, `tool_alert`, `tool_alert_response`
- **Challenge Me More** (3): `challenge_status`, `challenge_config`, `challenge_config_ack`
- **Budget Guard** (3): `budget_status`, `budget_config`, `usage_status`
- **E2E Encryption** (1): `key_exchange`
- **Multi-Conversation** (13): `conversation_list`, `conversation_list_response`, `conversation_create`, `conversation_create_ack`, `conversation_switch`, `conversation_switch_ack`, `conversation_history`, `conversation_history_response`, `conversation_archive`, `conversation_delete`, `conversation_compact`, `conversation_compact_ack`, `conversation_stream`
- **AI Disclosure** (1): `ai_disclosure`
- **Data Erasure** (5): `data_erasure_request`, `data_erasure_preview`, `data_erasure_confirm`, `data_erasure_complete`, `data_erasure_cancel`
- **AI Native Actions** (5): `ai_challenge`, `ai_challenge_response`, `ai_memory_proposal`, `ai_memory_proposal_batch`, `memory_batch_decision`
- **Data Portability** (6): `data_export_request`, `data_export_progress`, `data_export_ready`, `data_import_validate`, `data_import_confirm`, `data_import_complete`

All messages are validated against Zod schemas at every boundary. Unknown message types are rejected. The protocol version is checked on session establishment.

Error codes follow the format `BASTION-CXXX` across 8 categories: Connection (1XXX), Auth (2XXX), Protocol (3XXX), Safety (4XXX), File Transfer (5XXX), Provider (6XXX), Configuration (7XXX), Budget (8XXX).

### E2E Encryption

Messages are encrypted with XSalsa20-Poly1305 via a KDF ratchet chain. Each message gets a unique, irreversibly-derived key — compromising a current key does not reveal past messages (forward secrecy). The human client uses tweetnacl (pure JavaScript, zero native dependencies) and the AI client uses libsodium (WASM/native) — byte-identical NaCl implementations. The relay forwards encrypted payloads without the ability to read message content.

**Track A hardening (shipped 2026-04):** The cipher pipeline was audited and rebuilt around a **peek-then-commit** `SessionCipher` API — MAC verification happens before the receive chain advances, so a spurious failure no longer permanently desyncs the chain. The `tryDecrypt` path is gated on an explicit `PLAINTEXT_TYPES` set rather than guessing from the envelope shape. Decrypt failures now **fail loud** with a sentinel result and a visible UI banner — no silent return of undecrypted payload. Stale ciphers are reset on `peer_status=active` and `disconnected` so a reconnecting AI client cannot be answered with a ratchet key from the previous session. A pre-cipher **encrypted-message queue** on the human side holds inbound messages until key exchange completes, closing the startup race where an early-arriving envelope hit a cipher that didn't yet exist. See [`docs/audits/e2e-crypto-audit-2026-04-17.md`](docs/audits/e2e-crypto-audit-2026-04-17.md) and the [addendum](docs/audits/e2e-crypto-audit-2026-04-17-addendum.md) for the full analysis.

## Infrastructure

Bastion includes deployment templates for self-hosted environments:

- **[Proxmox Templates](packages/infrastructure/proxmox/)** — VM/LXC configs with VLAN isolation
- **[Systemd Services](packages/infrastructure/systemd/)** — Hardened service files with security directives
- **[AppArmor Profiles](packages/infrastructure/apparmor/)** — Mandatory access control for AI client VM
- **[Firewall Rules](packages/infrastructure/firewall/)** — nftables config for defence-in-depth
- **[Automated Setup](packages/infrastructure/setup/)** — Intelligent provisioning with OS disk protection
- **[Systemd Templates](deploy/systemd/)** — Service files for relay, admin UI, AI client
- **[CLI Tool](scripts/bastion-cli.sh)** — `bastion update|restart|status|audit|migrate` management CLI

## Documentation

- [Getting Started Guide](docs/guides/getting-started.md) — Clone to running local instance walkthrough
- [Deployment Guide](docs/guides/deployment.md) — Self-hosting with TLS, VLANs, and AI VM isolation
- [Protocol Specification](docs/protocol/bastion-protocol-v0.5.0.md) — All 95 message types, envelope structure, E2E encryption, safety evaluation
- [Core Specification](docs/spec/Project-Bastion-Spec-v0.1.0.docx) — The full product specification
- [Supplementary Specification](docs/spec/bastion-supplementary-spec.md) — Architectural decisions, session lifecycle, error codes, GDPR considerations
- [Project Structure](docs/spec/bastion-project-structure.md) — Package layout and task breakdown
- [Security Policy](SECURITY.md) — Vulnerability disclosure process and threat model
- [Contributing Guide](CONTRIBUTING.md) — How to contribute
- [Code of Conduct](CODE_OF_CONDUCT.md) — Community standards

## Skills System (Layer 5)

Skills are behaviour-informing documents loaded on demand into the AI's system prompt. They are the "books on the shelf" — contextual knowledge that activates when relevant triggers appear in the conversation.

- **Trigger-based loading**: each skill declares word triggers (e.g., "deploy", "commit") and optional regex patterns. When a user message matches, the skill content is injected into the system prompt for that response.
- **Always-loaded skills**: some skills are always present for their declared modes (e.g., a values skill in conversation mode).
- **Mode scoping**: skills declare which modes they apply to (conversation, task, game, compaction). A game skill won't load during compaction.
- **Security**: skill content is scanned for dangerous patterns (same as ProjectStore). Max 8KB per skill (~2000 tokens).
- **Skill index**: a compact listing of all available skills (~50 tokens) is always in the system prompt, so the AI knows what expertise is available.

Skills are loaded from the `skills/` directory on startup and locked (no mid-session injection). Two example skills ship with the repo: `security-review` and `git-workflow`.

## Current Capabilities

| Layer | Feature | Status |
|-------|---------|--------|
| 1 | E2E encrypted messaging (X25519 key exchange + XSalsa20-Poly1305 via KDF ratchet chain) | Deployed |
| 2 | Persistent memory with "Remember" button + conversation-scoped (10 global + 10 scoped) | Deployed |
| 3 | Project context file sharing with nested directory support | Deployed |
| 4 | MCP tool integration with governed approval flow (JSON-RPC 2.0) | Deployed |
| — | Multi-conversation persistence with hash-chained messages (SQLite) | Deployed |
| — | Conversation compaction (AI summarises older messages, originals preserved) | Deployed |
| — | Three official Anthropic adapters: Sonnet 4.6 (1M), Haiku 4.5 (200k), Opus 4.6 (1M) | Deployed |
| — | Soul Document v1.0 — compartmentalized 4-zone system prompt (system, operator, user, conversation) | Deployed |
| — | Usage tracking — every API call recorded to SQLite with per-adapter cost breakdown | Deployed |
| — | GDPR Article 20 data portability — full conversation export/import | Deployed |
| — | Per-conversation tool trust isolation | Deployed |
| — | Streaming responses (real-time AI typing with SSE) | Deployed |
| 5 | Skills System — trigger-based contextual knowledge loading | Deployed |
| — | Multi-adapter routing with AdapterRegistry + adapter hint resolution | Deployed |
| — | CLI management tool — `bastion doctor\|install\|update\|restart\|status\|audit\|migrate` | Deployed |
| — | AI native toolbox — AI-issued challenges and memory proposals parsed from response | Deployed |
| — | GDPR Article 17 Right to Erasure — soft delete with 30-day cancel window | Deployed |
| — | Community adapter template (@bastion/adapter-template) | Deployed |
| — | File transfer pipeline with 3-stage custody chain (fully wired) | Deployed |
| — | Protocol extension system with sandboxed UI iframes + message bridge | Deployed |
| — | Challenge Me More temporal governance (server-clock enforced) | Deployed |
| — | Advanced audit filtering (43 event types, date range, export) | Deployed |
| — | Toast notification system (cross-cutting, color-coded) | Deployed |
| — | First-launch setup wizard with connection testing | Deployed |
| — | Tamper-evident audit trail with chain integrity verification | Deployed |
| — | Admin panel with TOTP auth, live monitoring, setup wizard | Deployed |
| — | Unified test runner (auto-discovers all test files) | Deployed |
| — | AI Disclosure Banner — relay-configurable regulatory transparency (EU AI Act etc.) | Deployed |
| — | MaliClaw Clause: 13 patterns + `/claw/i` catch-all | Hardcoded |

### 5 Immutable Boundaries

These cannot be disabled, bypassed, or configured away:

1. **MaliClaw Clause** — permanent blocklist of dangerous AI providers (13 patterns + catch-all regex)
2. **Safety Floors** — minimum thresholds that can be tightened but never lowered
3. **Tool Blindness** — dangerous tools stripped entirely from conversation mode
4. **Budget Guard** — web search cost caps with SQLite persistence, tighten-only mid-month, 7-day cooldowns, enforced at protocol level
5. **Challenge Hours** — temporal governance that the client cannot override (server clock is truth)

## Status

**Pre-Release (v0.8.1).** The protocol, crypto layer, relay, AI client, desktop client, admin UI, adapter template, and infrastructure templates are all implemented and tested across 3,897 passing tests in 14 test files. All components run as a single `bastion` user with VM-level isolation providing security separation.

The desktop Human Client, relay, and AI client have been deployed and tested end-to-end on real infrastructure with full VLAN isolation. E2E encryption is active with interoperable tweetnacl (browser) and libsodium (Node.js) implementations. The protocol is stable at 95 message types with 48 error codes across 8 categories. Three official Anthropic adapters — Sonnet 4.6 (1M context), Haiku 4.5 (200k context), Opus 4.6 (1M context) — provide role-based model selection. The AI native toolbox allows Claude to issue challenges during vulnerable hours and propose memories. GDPR Articles 17 (Right to Erasure) and 20 (Data Portability) are fully implemented. The CLI tool (`bastion doctor|install|update|restart|status|audit|migrate`) provides one-stop deployment and management. The reference implementation works.

> **Mobile client note:** The React Native mobile client (`packages/client-human-mobile`) was built during the initial development phases and builds successfully, but has not been updated with Layer 2-4 features, the setup wizard, or Challenge Me More. Mobile client modernisation is on the roadmap.

See [GitHub Issues](https://github.com/Glorktelligence/Bastion/issues) for other items.

This is a framework and protocol — not a consumer product. The hard parts are done. Fork it, adapt it, build on it.

Feedback, security review, and contributions are welcome.

## Licence

[Apache License 2.0](LICENSE)

Copyright 2026 Glorktelligence — Harry Smith

The Apache 2.0 licence includes an explicit patent grant. Contributors automatically grant patent rights on their contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
