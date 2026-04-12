---
name: project-context
description: Bastion project architecture, package structure, protocol types, immutable boundaries, and infrastructure layout. Background knowledge for all Bastion work.
user-invocable: false
---

# Project Context - Bastion Architecture

**Quick reference for project structure, capabilities, and patterns.**

---

## Project Overview

**What**: Open-source Human–AI secure messaging protocol
**Status**: Post-build — all 5 phases complete, community release done
**Licence**: Apache 2.0
**Stack**: TypeScript monorepo (PNPM workspaces) | Tauri + SvelteKit | Node.js | SQLite
**Philosophy**: Trust no one, fail closed, safety floors that only tighten
**Repository**: https://github.com/Glorktelligence/Bastion

---

## Monorepo Structure

```
bastion/
├── CLAUDE.md                    # Master project instructions
├── start-relay.mjs              # Relay startup script (wires all library code)
├── start-ai-client.mjs          # AI client startup script (wires all library code)
├── docs/                        # Specs, protocol docs, guides, architecture decisions
├── packages/
│   ├── protocol/                # @bastion/protocol — 93 message types, schemas, constants
│   ├── crypto/                  # @bastion/crypto — E2E encryption, hashing, key management
│   ├── relay/                   # @bastion/relay — WSS server, routing, audit, quarantine, admin
│   ├── client-human/            # @bastion/client-human — Desktop (Tauri + SvelteKit)
│   ├── client-human-mobile/     # @bastion/client-human-mobile — Mobile (React Native)
│   ├── client-ai/               # @bastion/client-ai — Headless AI client (isolated VM)
│   ├── relay-admin-ui/          # @bastion/relay-admin-ui — Admin panel (SvelteKit)
│   ├── tests/                   # Integration & cross-package tests
│   └── infrastructure/          # Docker Compose, Proxmox VM templates
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

## Protocol — 93 Message Types

| Category | Count | Types |
|----------|-------|-------|
| Core | 9 | task, conversation, challenge, confirmation, denial, status, result, error, heartbeat |
| File Transfer | 3 | file_manifest, file_offer, file_request |
| Session | 6 | session_end, session_conflict, session_superseded, session_restored, reconnect, token_refresh |
| Admin/Config | 4 | config_ack, config_nack, provider_status, budget_alert |
| Audit | 2 | audit_query, audit_response |
| Provider/Context | 2 | provider_register, context_update |
| Memory | 6 | memory_proposal, memory_decision, memory_list, memory_list_response, memory_update, memory_delete |
| Extensions | 2 | extension_query, extension_list_response |
| Extension State | 3 | extension_state_push, extension_state_request, extension_state_response |
| Project Context | 7 | project_sync, project_sync_ack, project_list, project_list_response, project_delete, project_config, project_config_ack |
| Skills | 1 | skill_list_response |
| Tool Integration | 9 | tool_registry_sync, tool_registry_ack, tool_request, tool_approved, tool_denied, tool_result, tool_revoke, tool_alert, tool_alert_response |
| Challenge Me More | 3 | challenge_status, challenge_config, challenge_config_ack |
| Budget Guard | 3 | budget_status, budget_config, usage_status |
| E2E Key Exchange | 1 | key_exchange |
| Multi-Conversation | 13 | conversation_list, conversation_list_response, conversation_create, conversation_create_ack, conversation_switch, conversation_switch_ack, conversation_history, conversation_history_response, conversation_archive, conversation_delete, conversation_compact, conversation_compact_ack, conversation_stream |
| AI Disclosure | 1 | ai_disclosure |
| Data Portability | 6 | data_export_request, data_export_progress, data_export_ready, data_import_validate, data_import_confirm, data_import_complete |
| Data Erasure | 5 | data_erasure_request, data_erasure_preview, data_erasure_confirm, data_erasure_complete, data_erasure_cancel |
| AI Native Actions | 3 | ai_challenge, ai_challenge_response, ai_memory_proposal |

---

## Error Codes — 48 codes, 8 categories

Format: `BASTION-CXXX` where C = category.
- 1XXX: Connection (7) | 2XXX: Auth (6) | 3XXX: Protocol (6) | 4XXX: Safety (6)
- 5XXX: File transfer (7) | 6XXX: Provider (6) | 7XXX: Configuration (5) | 8XXX: Budget (5)

---

## Five Immutable Boundaries

These are **hardcoded** and **non-negotiable**. Never make them configurable.

1. **MaliClaw Clause** — 13 blocked identifiers + `/claw/i` catch-all regex. Checked before allowlist. Cannot be removed.
2. **Safety Floors** — Floors can be tightened but NEVER lowered below factory defaults. `irreversibleAlwaysChallenge` and `fileQuarantineEnabled` are locked true.
3. **Budget Guard** — Same enforcement tier as MaliClaw. Tighten-only mid-month. 7-day cooldown on loosening. Blocked during challenge hours.
4. **Challenge Me More** — Temporal governance. Server-side timezone. Budget/schedule changes blocked during active periods. 7-day cooldown on loosening restrictions.
5. **Dangerous Tool Blindness** — Destructive tools always require per-call approval (never session-scope). AI cannot see parameters of dangerous tools until human approves.

---

## Six Context Layers

| Layer | Status | Description |
|-------|--------|-------------|
| 1. Session | ✅ Built | JWT auth, 15-min expiry, session lifecycle |
| 2. Memory | ✅ Built | Persistent memories (preference, fact, workflow, project), SQLite, top 20 in prompt |
| 3. Project Context | ✅ Built | Project files synced to AI VM, alwaysLoaded/available config, token budget estimate |
| 4. MCP Tools | ✅ Built | ToolRegistryManager, McpClientAdapter (JSON-RPC 2.0 over WebSocket), trust model |
| 5. Skills | ✅ Built | SkillsManager with forensic scanner, quarantine pipeline, hot-reload, trigger-based loading |
| 6. Dream Cycle | Designed | Not yet implemented — background processing |

---

## Three Core Components

| Component | Package | Startup Script | Environment |
|-----------|---------|---------------|-------------|
| Relay Server | `relay` | `start-relay.mjs` | Linux server (self-hosted) |
| AI Client | `client-ai` | `start-ai-client.mjs` | Isolated Linux VM |
| Human Client | `client-human` | Tauri app | Desktop (Windows/Mac/Linux) |

**Communication**: Human ↔ Relay ↔ AI. Never direct. Always through relay.

**Important**: Startup scripts (`start-relay.mjs`, `start-ai-client.mjs`) are where library code gets WIRED into runtime. All previously "built but not wired" patterns are now resolved. New features must be wired in startup scripts, not just implemented as library code.

---

## Key Technologies

| Area | Technology |
|------|-----------|
| Package manager | PNPM v10.32+ (workspaces) |
| Runtime | Node.js v24+ (ES modules) |
| Schema validation | Zod |
| Transport | WebSocket over TLS (wss://) |
| Auth | JWT (jose library, HS256, 15-min expiry) |
| E2E Encryption | tweetnacl (browser) + libsodium-wrappers-sumo (Node.js) |
| Desktop client | Tauri + SvelteKit (Svelte 5 runes — use `onMount` not `$effect` for store subscriptions) |
| Mobile client | React Native (Android) |
| Database | node:sqlite DatabaseSync (audit), SQLite (memories, budget) |
| Linting | Biome |
| Testing | node:test (trace-test.mjs pattern), 3,862 tests across 14 files |

---

## Safety Evaluation (3 layers)

1. **Layer 1 — Absolute boundaries**: Always deny. Non-negotiable. No override.
2. **Layer 2 — Contextual evaluation**: Challenge and block until human confirms.
3. **Layer 3 — Completeness check**: Pause for clarification. No block.

Safety floors can be tightened but NEVER loosened below factory defaults.

---

## Testing

14 test files, 3,862 tests total. Run all with:
```bash
pnpm test    # or run individually with: node packages/<path>/trace-test.mjs
```

| Test File | Approx Count |
|-----------|-------------|
| packages/tests/trace-test.mjs (protocol schemas) | ~340 |
| packages/tests/integration-test.mjs | ~90 |
| packages/tests/file-transfer-integration-test.mjs | ~110 |
| packages/crypto/trace-test.mjs | ~145 |
| packages/relay/trace-test.mjs | ~420 |
| packages/relay/admin-trace-test.mjs | ~370 |
| packages/relay/quarantine-trace-test.mjs | ~120 |
| packages/relay/file-transfer-trace-test.mjs | ~105 |
| packages/client-ai/trace-test.mjs | ~500 |
| packages/client-ai/file-handling-trace-test.mjs | ~175 |
| packages/client-human/trace-test.mjs | ~380 |
| packages/client-human-mobile/trace-test.mjs | ~135 |
| packages/relay-admin-ui/trace-test.mjs | ~280 |

> **Note:** These counts are approximate. Run `pnpm test` for exact numbers.

---

## Infrastructure (Proxmox Naval Fleet)

| Component | VM Name | VLAN | Purpose |
|-----------|---------|------|---------|
| Relay | naval-bastion-01 | 30 (DMZ) | Message routing, audit |
| AI VM | naval-bastion-ai-01 | 50 (Isolated) | AI execution |
| Firewall | Mystic (OPNSense) | All | Inter-VLAN routing |

Docker Compose available in `packages/infrastructure/docker/`.
Proxmox templates in `packages/infrastructure/proxmox/`.

---

## Six Sole Authorities

| Authority | Scope | Description |
|-----------|-------|-------------|
| DateTimeManager | TIME | Injected into 15 managers. All business logic time calls go through DTM |
| PurgeManager | DELETE | All file deletion goes through PurgeManager. No direct `fs.unlink` |
| ToolManager | TOOLS | Tool registry with lock, violation escalation, upstream monitoring |
| SkillsManager | SKILLS | Forensic scanner, quarantine pipeline, hot-reload |
| BastionBash | EXECUTION | Three-tier command system, governed filesystem, rate limiting |
| AuditLogger | AUDIT | Tamper-evident hash chain, event type registry, chain integrity verification |

Violations are logged as audit events (`PURGE_VIOLATION`, `TOOL_VIOLATION`, `SKILL_VIOLATION`, etc.) and escalated.

---

## AI Native Toolbox — Four Powers

| Power | Block | Description |
|-------|-------|-------------|
| CHALLENGE | `[BASTION:CHALLENGE]` | AI challenges human on risky actions |
| MEMORY | `[BASTION:MEMORY]` | AI proposes memories for human approval |
| RECALL | `[BASTION:RECALL]` | AI searches compacted conversation history |
| EXEC | `[BASTION:EXEC]` | AI executes governed commands via BastionBash |

These are parsed from the AI response text by `AiNativeActionParser` in the AI client. The human client renders them as interactive UI elements (challenge cards, memory approval buttons, etc.).

---

## Extension System

- **Manifest-driven**: Extensions declare message types, capabilities, and UI components in a structured manifest
- **Generic loading**: `ExtensionHandlerLoader` dynamically loads handlers with forensic security scanning
- **Conversation renderers**: Extensions provide custom UI renderers for their message types in the human client
- **Extension State Bridge**: State synchronisation via `extension_state_push`, `extension_state_request`, `extension_state_response`
- **Sandboxed UI**: Extension UI components run in sandboxed iframes with a controlled message bridge
- **Rate-limited**: 60 messages/min/namespace, direction enforcement (human_to_ai, ai_to_human, bidirectional)

---

## Full Documentation

- **Core spec**: `docs/spec/Project-Bastion-Spec-v0.1.0.docx`
- **Supplementary spec**: `docs/spec/bastion-supplementary-spec.md`
- **Protocol specification**: `docs/protocol/bastion-protocol-v0.5.0.md`
- **Project structure**: `docs/spec/bastion-project-structure.md`
- **Getting started guide**: `docs/guides/getting-started.md`
- **Deployment guide**: `docs/guides/deployment.md`
