# Project Bastion

**A privacy-first secure messaging protocol for structured Human-AI communication.**

Bastion is an open-source protocol and reference implementation for a communication channel between a human operator and an AI system running in an isolated virtual machine. It provides end-to-end encryption, a three-layer safety engine, auditable file transfers, and full transparency — designed for environments where trust must be earned, not assumed.

## Why Bastion Exists

AI systems are powerful. They can manage infrastructure, process data, and execute complex tasks across networked environments. But delegating real authority to an AI requires more than an API key and a prayer.

Most Human-AI interaction today happens through chat interfaces with no structure, no safety boundaries, and no audit trail. If an AI system has SSH access to your servers, you should know exactly what it's doing, why, and have the ability to intervene before it does something irreversible. That's what Bastion provides.

**What makes it different:**

- **The relay never sees plaintext.** End-to-end encryption means the relay routes encrypted blobs. It cannot read message content, even if compromised.
- **Safety is structural, not bolted on.** A three-layer evaluation engine (absolute boundaries → contextual analysis → human challenge) runs on every task before execution. Safety floors can be tightened but never lowered below factory defaults.
- **Files go through quarantine.** Every file transfer passes through an airlock with hash verification at submission, quarantine, and delivery. No shortcuts.
- **The AI cannot modify its own permissions.** Tool registries, safety configurations, and API keys are controlled by the human operator through authenticated channels. This is hardcoded, not configurable.
- **Transparency is the default.** Every action is audited with a tamper-evident hash chain. Cost tracking, custody chains for files, and structured challenge/response flows give the human operator full visibility.
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
                                │  │ Provider Adapter│  │
                                │  │ Tool Registry   │  │
                                │  │ File Handler    │  │
                                │  └────────────────┘  │
                                └──────────────────────┘
```

### Packages

| Package | Description |
|---------|-------------|
| `@bastion/protocol` | Shared types, Zod schemas, constants, error codes — the single source of truth |
| `@bastion/crypto` | E2E encryption (libsodium), KDF key chain, file encrypt/decrypt, audit hash chain |
| `@bastion/relay` | WebSocket server, message routing, JWT auth, audit logging, file quarantine |
| `@bastion/client-human` | Tauri + SvelteKit desktop app — messaging, challenge review, file transfers |
| `@bastion/client-human-mobile` | React Native mobile app — same protocol, mobile-native UI |
| `@bastion/client-ai` | Headless AI client for isolated VM — safety engine, provider adapter, file handling |
| `@bastion/relay-admin-ui` | SvelteKit admin panel — provider management, blocklist, quarantine viewer |

### The Three-Layer Safety Engine

Every task submitted through Bastion is evaluated by the AI client's safety engine before execution:

| Layer | Name | Function | Configurable |
|-------|------|----------|--------------|
| 1 | Absolute Boundary | Hardcoded denials — blocked operations, MaliClaw Clause, tool registry violations | No. Immutable. |
| 2 | Contextual Analysis | Risk scoring based on operation type, target sensitivity, time of day, budget impact, historical patterns | Thresholds can be tightened only |
| 3 | Human Challenge | Operations above the risk threshold are presented to the human with full context: reason, risk assessment, contributing factors, suggested alternatives. The human decides. | Challenge threshold can be lowered (more challenges), never raised |

## Quick Start

### Prerequisites

- **Node.js** >= 20.0.0 (developed on v24)
- **PNPM** >= 9.0.0 (developed on v10.32)

### Install and Build

```bash
git clone https://git.glorktelligence.co.uk/glorktelligence/bastion.git
cd bastion
pnpm install
pnpm build
```

### Run Tests

```bash
# All package tests
pnpm test

# Individual packages
node packages/tests/trace-test.mjs              # Protocol schema tests (190 checks)
node packages/tests/integration-test.mjs         # Integration round-trip tests (82 checks)
node packages/tests/file-transfer-integration-test.mjs  # File transfer E2E (105 checks)
node packages/relay/trace-test.mjs               # Relay tests (288 checks)
node packages/relay/admin-trace-test.mjs          # Admin auth & routes (185 checks)
node packages/crypto/trace-test.mjs              # Crypto tests
node packages/client-ai/trace-test.mjs           # AI client tests (239 + 155 checks)
node packages/client-human/trace-test.mjs        # Desktop client tests (272 checks)
node packages/client-human-mobile/trace-test.mjs # Mobile client tests (123 checks)
node packages/relay-admin-ui/trace-test.mjs      # Admin UI tests (192 checks)
```

### Typecheck

```bash
# All packages
pnpm -r typecheck

# Lint (requires Biome)
pnpm lint
```

### Development

```bash
# Desktop client (SvelteKit dev server)
pnpm --filter @bastion/client-human dev

# Admin UI (SvelteKit dev server)
pnpm --filter @bastion/relay-admin-ui dev
```

## Protocol

Bastion defines 23 message types across structured categories:

- **Session**: `session_init`, `session_established`, `session_end`, `heartbeat`, `token_refresh`
- **Conversation**: `conversation`, `task`, `result`, `status`, `denial`, `error`, `confirmation`
- **Safety**: `challenge`, `challenge_response`
- **File Transfer**: `file_manifest`, `file_offer`, `file_request`, `file_chunk`, `file_complete`, `file_ack`
- **Admin**: `config_update`, `config_ack`, `provider_status`, `capability_update`

All messages are validated against Zod schemas at every boundary. Unknown message types are rejected. The protocol version is checked on session establishment.

Error codes follow the format `BASTION-CXXX` across 7 categories: Connection (1XXX), Auth (2XXX), Protocol (3XXX), Safety (4XXX), File Transfer (5XXX), Provider (6XXX), Configuration (7XXX).

## Documentation

- [Getting Started Guide](docs/guides/getting-started.md) — Clone to running local instance walkthrough
- [Deployment Guide](docs/guides/deployment.md) — Self-hosting with TLS, VLANs, and AI VM isolation
- [Protocol Specification](docs/protocol/bastion-protocol-v0.1.0.md) — All 23 message types, envelope structure, safety evaluation
- [Core Specification](docs/spec/Project-Bastion-Spec-v0.1.0.docx) — The full product specification
- [Supplementary Specification](docs/spec/bastion-supplementary-spec.md) — Architectural decisions, session lifecycle, error codes, GDPR considerations
- [Project Structure](docs/spec/bastion-project-structure.md) — Package layout and task breakdown
- [Security Policy](SECURITY.md) — Vulnerability disclosure process and threat model
- [Contributing Guide](CONTRIBUTING.md) — How to contribute
- [Code of Conduct](CODE_OF_CONDUCT.md) — Community standards

### Infrastructure

- [Docker Compose](packages/infrastructure/docker/) — Dev environment with relay, AI client, and admin UI
- [Proxmox Templates](packages/infrastructure/proxmox/) — VM/LXC configs for Naval Fleet deployment

## Status

**Phase 5 complete.** The protocol, crypto layer, relay, AI client, desktop client, mobile client, admin UI, community documentation, CI/CD, and infrastructure templates are all implemented and tested. See the [project structure doc](docs/spec/bastion-project-structure.md) for the full task breakdown.

This is a pre-release project. The protocol is stable but has not yet been deployed in production. Feedback, security review, and contributions are welcome.

## Licence

[Apache License 2.0](LICENSE)

Copyright 2026 Glorktelligence — Harry Smith

The Apache 2.0 licence includes an explicit patent grant. Contributors automatically grant patent rights on their contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
