# Project Context - Bastion Architecture

**Quick reference for project structure and patterns.**

---

## Project Overview

**What**: Open-source Human–AI secure messaging protocol
**Status**: Pre-build — specification complete, ready for Phase 1
**Licence**: Apache 2.0
**Stack**: TypeScript monorepo (PNPM workspaces) | Tauri + SvelteKit | Node.js | SQLite
**Philosophy**: Trust no one, fail closed, safety floors that only tighten

---

## Monorepo Structure

```
bastion/
├── docs/                        # Specs, protocol docs, legal, GUI concepts
├── packages/
│   ├── protocol/                # @bastion/protocol — Shared types, schemas, constants
│   ├── crypto/                  # @bastion/crypto — E2E encryption, hashing, keys
│   ├── relay/                   # @bastion/relay — Relay server (WebSocket + admin API)
│   ├── client-human/            # @bastion/client-human — Desktop (Tauri + SvelteKit)
│   ├── client-human-mobile/     # @bastion/client-human-mobile — Mobile (React Native)
│   ├── client-ai/               # @bastion/client-ai — Headless AI client
│   └── relay-admin-ui/          # @bastion/relay-admin-ui — Admin panel (SvelteKit)
├── infrastructure/              # Proxmox configs, Docker, WireGuard, scripts
├── tests/                       # Integration & cross-package tests
└── .claude/skills/              # Claude Code skills (you are here)
```

---

## Package Dependency Graph

```
@bastion/protocol              ← Foundation (no dependencies)
    ↑
    ├── @bastion/crypto        ← Encryption layer
    │       ↑
    │       ├── @bastion/relay
    │       ├── @bastion/client-human
    │       ├── @bastion/client-human-mobile
    │       └── @bastion/client-ai
    │
    └── @bastion/relay-admin-ui
```

**Rule**: Protocol is the foundation. ALL message type changes start in `@bastion/protocol`.

---

## Three Core Components

| Component | Package | Environment | Purpose |
|-----------|---------|-------------|---------|
| Human Client | `client-human` | Desktop (Tauri) | User-facing messaging, task submission, challenge review |
| Relay Server | `relay` | Linux server (self-hosted) | Message routing, schema validation, audit, file quarantine |
| AI Client | `client-ai` | Isolated Linux VM | Task execution, safety evaluation, provider API calls |

**Communication**: Human ↔ Relay ↔ AI. Never direct. Always through relay.

---

## Key Technologies

| Area | Technology |
|------|-----------|
| Package manager | PNPM (workspaces) |
| Schema validation | Zod |
| Transport | WebSocket over TLS (wss://) |
| Auth | JWT (short-lived, 15-min expiry) |
| Encryption | libsodium (sodium-native) |
| Desktop client | Tauri + SvelteKit |
| Mobile client | React Native (Android) |
| Database | SQLite (dev/small) / PostgreSQL (scale) |
| Linting | Biome |
| Testing | Vitest |
| CSS | Tailwind CSS |

---

## Message Types (23 total)

Core: `task`, `conversation`, `challenge`, `confirmation`, `denial`, `status`, `result`, `error`, `audit`, `file-manifest`, `file-offer`, `file-request`, `heartbeat`

Supplementary: `session_end`, `session_conflict`, `session_superseded`, `reconnect`, `config_update`, `config_ack`, `config_nack`, `token_refresh`, `provider_status`, `budget_alert`

---

## Safety Evaluation (3 layers)

1. **Layer 1 — Absolute boundaries**: Always deny. Non-negotiable. No override.
2. **Layer 2 — Contextual evaluation**: Challenge and block until human confirms.
3. **Layer 3 — Completeness check**: Pause for clarification. No block.

Safety floors can be tightened but NEVER loosened below factory defaults.

---

## Error Codes

Format: `BASTION-CXXX` where C = category.
- 1XXX: Connection | 2XXX: Auth | 3XXX: Protocol | 4XXX: Safety
- 5XXX: File transfer | 6XXX: Provider | 7XXX: Configuration

---

## Infrastructure (Proxmox Naval Fleet)

| Component | VM Name | VLAN | Purpose |
|-----------|---------|------|---------|
| Relay | naval-bastion-01 | 30 (DMZ) | Message routing, audit |
| AI VM | naval-bastion-ai-01 | 50 (Isolated) | AI execution |
| Firewall | Mystic (OPNSense) | All | Inter-VLAN routing |

---

## Full Documentation

- **Core spec**: `docs/Project-Bastion-Spec-v0.1.0.docx`
- **Supplementary spec**: `docs/bastion-supplementary-spec.md`
- **Project structure**: `docs/bastion-project-structure.md`
- **GUI concepts**: `docs/gui-concepts/`
