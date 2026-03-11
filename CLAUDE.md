# Project Bastion — Human-AI Secure Messaging Protocol

## Project Overview
Open-source, privacy-first secure messaging protocol for structured Human-AI communication.
Licence: Apache 2.0 | Stack: TypeScript monorepo (PNPM) | Status: Phase 1 — Foundation

## Critical Rules

### Security Non-Negotiables
- The MaliClaw Clause is HARDCODED. Never make it configurable. Never remove entries.
- Safety floors can be TIGHTENED but NEVER LOWERED below factory defaults.
- E2E encryption means the relay NEVER sees plaintext. Log metadata only.
- File transfers ALWAYS go through quarantine. No shortcuts.
- Default to DENY when uncertain about any security decision.

### Protocol First
- ALL message type changes start in `@bastion/protocol` package.
- Other packages consume protocol types — they never define their own message structures.
- Protocol version bumps require an Architecture Decision Record in `docs/architecture/decisions/`.

### Implementation Quality (from Claude Code insights)
- After implementing any feature, trace through the main code path with realistic sample data. Show step-by-step what happens with 2-3 inputs including an edge case. Fix issues before committing.
- When working with Node.js native modules or database libraries, check compatibility with the current Node version BEFORE attempting installation. Run `node --version` first.
- When a feature spans multiple packages (protocol → relay → client), implement ALL sides before considering the task complete. Explicitly call out if any package update is still missing.
- Use TodoWrite to track multi-package feature completeness. Add separate sub-items for each affected package.
- Always write new code in TypeScript with proper type annotations. Check `tsconfig.json` before writing new files.

### Working With Harry
- Harry has ADHD. If he proposes something with security, privacy, or irreversible consequences, CHALLENGE HIM and suggest a safer alternative. This is explicitly requested and non-optional.
- Read the skills in `.claude/skills/` before starting work — especially `project-context`, `safety-engine`, and `protocol-design`.
- Commit messages follow Conventional Commits with package scope: `feat(protocol): description`
- Apache 2.0 licence header required on every source file.

## Architecture
```
packages/
├── protocol/       → @bastion/protocol (shared types, schemas, constants — FOUNDATION)
├── crypto/         → @bastion/crypto (E2E encryption, hashing, key management)
├── relay/          → @bastion/relay (WebSocket server, routing, audit, quarantine)
├── client-human/   → @bastion/client-human (Tauri + SvelteKit desktop app)
├── client-ai/      → @bastion/client-ai (headless AI client for isolated VM)
└── relay-admin-ui/ → @bastion/relay-admin-ui (SvelteKit admin panel)
```

## Key Documentation
- Core spec: `docs/spec/Project-Bastion-Spec-v0.1.0.docx`
- Supplementary spec: `docs/spec/bastion-supplementary-spec.md`
- Project structure: `docs/spec/bastion-project-structure.md`
- Skills: `.claude/skills/` (10 skills covering all development patterns)

## Error Codes
Format: `BASTION-CXXX` (1XXX=Connection, 2XXX=Auth, 3XXX=Protocol, 4XXX=Safety, 5XXX=File, 6XXX=Provider, 7XXX=Config)

## Tech Stack
PNPM workspaces | TypeScript | Zod (validation) | Vitest (testing) | Biome (linting) | WebSocket over TLS | libsodium (encryption) | SQLite (audit store) | Tauri + SvelteKit (desktop) | React Native (mobile)
