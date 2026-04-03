# Project Bastion — Human-AI Secure Messaging Protocol

## Project Overview
Open-source, privacy-first secure messaging protocol for structured Human-AI communication.
Licence: Apache 2.0 | Stack: TypeScript monorepo (PNPM) | Status: All 5 phases complete
Repository: https://github.com/Glorktelligence/Bastion

## Critical Rules

### Five Immutable Boundaries
These are HARDCODED and NON-NEGOTIABLE. Never make them configurable. Never weaken them.

1. **MaliClaw Clause** — 13 blocked identifiers + `/claw/i` regex. Checked before allowlist. Cannot be removed or configured.
2. **Safety Floors** — Can be TIGHTENED but NEVER LOWERED below factory defaults. `irreversibleAlwaysChallenge` and `fileQuarantineEnabled` are locked true.
3. **Budget Guard** — Same enforcement tier as MaliClaw. Tighten-only mid-month. 7-day cooldown. Blocked during challenge hours.
4. **Challenge Me More** — Temporal governance. Budget/schedule changes blocked during active periods. 7-day cooldown on loosening.
5. **Dangerous Tool Blindness** — Destructive tools always per-call approval. AI cannot see parameters until human approves.

### Security Non-Negotiables
- E2E encryption means the relay NEVER sees plaintext. Log metadata only.
- File transfers ALWAYS go through quarantine with 3-stage hash verification. No shortcuts.
- Default to DENY when uncertain about any security decision.
- Content scanning (13 dangerous patterns) on project_sync at relay + AI client.

### Protocol First
- ALL message type changes start in `@bastion/protocol` package (89 message types, 48 error codes).
- Other packages consume protocol types — they never define their own message structures.
- Protocol extensions use namespaced message types (`namespace:type` format).
- Protocol version bumps require an Architecture Decision Record in `docs/architecture/decisions/`.

### Implementation Quality (from Claude Code insights)
- After implementing any feature, trace through the main code path with realistic sample data. Show step-by-step what happens with 2-3 inputs including an edge case. Fix issues before committing.
- When working with Node.js native modules or database libraries, check compatibility with the current Node version BEFORE attempting installation. Run `node --version` first.
- When a feature spans multiple packages (protocol → relay → client), implement ALL sides before considering the task complete. Explicitly call out if any package update is still missing.
- **Startup script wiring**: Library code must be wired in `start-relay.mjs` and/or `start-ai-client.mjs`. All previously "built but not wired" patterns are resolved — don't create new ones.
- Run `pnpm lint --write` then `pnpm lint` before committing. Run the full test suite (`pnpm test`).
- Always write new code in TypeScript with proper type annotations. Check `tsconfig.json` before writing new files.
- **Svelte 5 store subscriptions**: In `.svelte` route files, use `onMount()` (NOT `$effect()`) for `store.subscribe()` calls. Our custom stores call subscribers synchronously, and `$effect` tracks reactive reads — if a subscribe callback reads `$state` inside `$effect`, it creates an infinite loop (`effect_update_depth_exceeded`). `onMount` has no reactive tracking, so this cannot occur.
- **Browser packages CANNOT import `@bastion/protocol` values** — only `import type` is safe. The protocol package re-exports `hash.ts` which uses `node:crypto`, breaking Vite browser builds. Affected: `client-human`, `relay-admin-ui`, `client-human-mobile`. Use Vite `define` for version (`__BASTION_VERSION__`), and hardcode safety floor values with comments referencing the protocol source. Node.js packages (`relay`, `client-ai`, `crypto`) can import freely.

### Version Management
- The `VERSION` file at repo root is the **single source of truth** for the project version.
- Run `pnpm run version:sync` after editing `VERSION` — it updates all `package.json` files and `packages/protocol/src/constants/version.ts` (which exports `PROTOCOL_VERSION`).
- **NEVER manually edit version strings** in `package.json` files or `version.ts`. Always edit `VERSION` and run the sync script.
- Version bump workflow: edit `VERSION` → `pnpm run version:sync` → update `CHANGELOG.md` → commit.

### Working With Harry
- Harry has ADHD. If he proposes something with security, privacy, or irreversible consequences, CHALLENGE HIM and suggest a safer alternative. This is explicitly requested and non-optional.
- Read the skills in `.claude/skills/` before starting work — especially `project-context`, `safety-engine`, and `protocol-design`.
- Commit messages follow Conventional Commits with package scope: `feat(protocol): description`
- Apache 2.0 licence header required on every source file.

## Architecture

Single `bastion` user on all VMs. VM-level isolation (relay VLAN 30, AI VLAN 50) provides security separation.

```
packages/
├── protocol/           → @bastion/protocol (89 message types, schemas, constants — FOUNDATION)
├── crypto/             → @bastion/crypto (E2E encryption, hashing, key management)
├── relay/              → @bastion/relay (WebSocket server, routing, audit, quarantine, admin API)
├── client-human/       → @bastion/client-human (Tauri + SvelteKit desktop app)
├── client-human-mobile/→ @bastion/client-human-mobile (React Native mobile app)
├── client-ai/          → @bastion/client-ai (headless AI client for isolated VM)
├── relay-admin-ui/     → @bastion/relay-admin-ui (SvelteKit admin panel)
├── tests/              → Integration & cross-package tests
└── infrastructure/     → Docker Compose, Proxmox VM templates

scripts/bastion-cli.sh  → CLI tool: bastion update|restart|status|audit|migrate
deploy/systemd/         → Systemd service templates for all components
```

Startup scripts (root level):
- `start-relay.mjs` — Wires all relay library code into runtime
- `start-ai-client.mjs` — Wires all AI client library code into runtime

## Key Documentation
- Core spec: `docs/spec/Project-Bastion-Spec-v0.1.0.docx`
- Supplementary spec: `docs/spec/bastion-supplementary-spec.md`
- Protocol specification: `docs/protocol/bastion-protocol-v0.5.0.md`
- Project structure: `docs/spec/bastion-project-structure.md`
- Skills: `.claude/skills/` (9 skills covering all development patterns)

## Error Codes
Format: `BASTION-CXXX` — 45 codes across 8 categories:
1XXX=Connection (7) | 2XXX=Auth (6) | 3XXX=Protocol (6) | 4XXX=Safety (6) | 5XXX=File (7) | 6XXX=Provider (6) | 7XXX=Config (5) | 8XXX=Budget (5)
Total: 48 codes.

## Three Bastion Official Adapters
All share `ANTHROPIC_API_KEY`. Each targets a different model with role-specific config.

| Adapter | Model | Context | Roles | Temperature | Pricing (in/out per MTok) |
|---------|-------|---------|-------|-------------|---------------------------|
| **Sonnet** | claude-sonnet-4-6 | 1M | default, conversation, task | 1.0 | $3 / $15 |
| **Haiku** | claude-haiku-4-5-20251001 | 200k | compaction, game | 0.3 | $1 / $5 |
| **Opus** | claude-opus-4-6 | 1M | research, dream | 1.0 | $5 / $25 |

Env vars: `BASTION_SONNET_MODEL`, `BASTION_HAIKU_MODEL`, `BASTION_OPUS_MODEL` (override model IDs).

## Soul Document
The AI client's system prompt is a three-layer "soul document" (`packages/client-ai/src/provider/conversation-manager.ts`):
- **Layer 0** — Immutable Core (~400 tokens): identity, environment, five boundaries
- **Layer 1** — Values & Principles (~800 tokens): honesty, harmlessness, helpfulness, transparency, user sovereignty
- **Layer 2** — Operational Guidance (~900 tokens): conversation mode, adapter identity, memory proposals, challenge support
Compaction uses Layer 0 only (via `ConversationManager.getCoreContext()`).

## Tech Stack
PNPM workspaces | TypeScript (ES2022/Node16) | Zod (validation) | node:test (testing, 2,974+ tests) | Biome (linting) | WebSocket over TLS | tweetnacl + libsodium (E2E encryption) | node:sqlite DatabaseSync (audit, usage) | SQLite (memories, budget, conversations) | jose (JWT) | Tauri + SvelteKit (desktop) | React Native (mobile)
