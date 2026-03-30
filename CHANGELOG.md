# Changelog

All notable changes to Project Bastion are documented in this file.

## [0.5.0] - 2026-03-30

### Protocol
- 81 message types across 15 categories (was 23 at v0.1.0)
- 48 error codes across 8 categories
- Update agent client type (`updater`) + 10 update message types
- AI disclosure message type (regulatory transparency)
- Conversation persistence (13 message types: list, create, switch, history, archive, delete, compact, stream)
- Streaming responses (`conversation_stream`)
- Extension system with namespaced message types
- Budget Guard messages (`budget_status`, `budget_config`)
- Challenge Me More temporal governance messages
- Tool integration (9 message types: registry sync, request, approve, deny, result, revoke, alert)
- Memory system (6 message types: proposal, decision, list, update, delete)
- Project context sync (7 message types)

### Security
- E2E encryption with KDF ratchet (X25519 key exchange + XSalsa20-Poly1305)
- Interoperable implementations: tweetnacl (browser) + libsodium (Node.js)
- Five immutable safety boundaries (MaliClaw Clause, safety floors, Budget Guard, Challenge Me More, Dangerous Tool Blindness)
- MaliClaw Clause: 13 blocked identifiers + `/claw/i` regex, hardcoded, non-configurable
- Content scanning: 13 dangerous patterns on project_sync at relay + AI client
- File quarantine with 3-stage hash verification (submission, quarantine, delivery)
- Hash-chained tamper-evident audit trail (SHA-256, SQLite-persisted)
- Admin panel locked to 127.0.0.1 with client cert + TOTP authentication

### Features
- Multi-conversation persistence with SQLite storage + hash-chain integrity
- Conversation compaction (summarise older messages to save tokens)
- Multi-adapter routing (Sonnet/Haiku/Opus model selection per conversation type)
- Streaming responses with real-time cursor animation
- Extension UI system (sandboxed iframes + message bridge API)
- AI disclosure banner (deployer-configurable, default off, EU AI Act Article 50)
- Self-update system: E2E encrypted commands, whitelisted execution (git_pull, pnpm_install, pnpm_build only)
- Update orchestrator with 4-phase state machine (check, prepare, build, restart)
- Restart recovery via pending-update.json state file
- Budget Guard with tighten-only mid-month enforcement + 7-day cooldown
- Challenge Me More temporal governance (server-side timezone, blocked during active periods)
- Toast notification system
- Connection quality indicators

### Infrastructure
- 10 packages in TypeScript monorepo (PNPM workspaces)
- 2,880 tests across 14 test files (node:test, trace-test.mjs pattern)
- Unified test runner with auto-discovery (`run-all-tests.mjs`)
- Admin UI (SvelteKit): overview, providers, blocklist, quarantine, connections, audit, config, update
- Community adapter template with documentation
- Deployment tooling: Docker Compose, Proxmox VM templates, systemd services, AppArmor profiles, nftables firewall
- Update agent deployment: systemd service, sudoers whitelist, setup script, example configs
- CI/CD: GitHub Actions (build + typecheck + lint + 9 parallel test jobs), weekly security audit
- Biome linting with import sorting and formatting

### Client Applications
- Desktop client (Tauri + SvelteKit): connection, messaging, challenges, tasks, settings, audit log, file transfer
- Mobile client (React Native): messaging, challenges, file transfers
- AI client (headless Node.js): safety engine, provider adapter, budget guard, file handling
- Relay admin UI (SvelteKit): full admin panel with TOTP authentication

## [0.1.0] - 2026-03-08

### Initial Release
- Core protocol: 23 message types, 43 error codes
- E2E encryption: X25519 + XSalsa20-Poly1305 with KDF ratchet
- Relay server with WebSocket routing, JWT authentication, audit logging
- AI client with 3-layer safety engine
- Human client (Tauri + SvelteKit) with challenge UI
- File transfer with quarantine and 3-stage hash verification
- MaliClaw Clause enforcement
