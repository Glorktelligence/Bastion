# Changelog

All notable changes to Project Bastion are documented in this file.

## [0.5.4] - 2026-03-31

### Fixed
- Admin UI: duplicate agent names on /update page — component and agentId were both set to identity.id, now component is derived (e.g. "updater-relay" → "relay")
- Admin UI: added keyed `{#each}` for agent list to prevent rendering artifacts

### Security
- Update message routing isolation: `update_*` types added to `SENDER_TYPE_RESTRICTIONS` as updater-only — AI and human clients cannot send update messages
- Generic fallthrough routing guards: `update_*` prefix blocked from peer routing; updater clients blocked from non-update message routing
- First version deployed via the self-update system

## [0.5.3] - 2026-03-31

### Fixed
- Key exchange routing deadlock when updater client connected (C-4)
- Self-update: version display hardcoded in admin UI (now reads from relay VERSION file)
- Self-update: `update_reconnected` sent before `process.exit` (now uses restart-pending flag file)
- Self-update: `cancelUpdate()` orphaned orchestrator state
- Self-update: phase state transition errors (`update_available` → `checking` not `preparing`)
- Self-update: `prepare_ack` echoed target version instead of actual current version
- Self-update: no changelog display in admin UI (now shows commit list)
- Self-update: hardcoded commit hash `HEAD` (now uses actual hash from check response)
- Self-update: GET requests to admin API missing auth headers
- Setup script now idempotent (safe to rerun for manual updates)

### Changed
- Version management centralised to VERSION file + `pnpm run version:sync`

## [0.5.2] - 2026-03-31

### Security (Audit Fixes — see SECURITY-AUDIT.md)
- **CRITICAL**: Fixed base64 encoding mismatch between human client (`btoa()` standard) and AI client (`sodium.from_base64()` URL-safe) — AI client now uses `sodium.base64_variants.ORIGINAL` for both encode and decode
- **CRITICAL**: Fixed key exchange race condition — encrypted messages are now queued until E2E cipher is established, then drained in order
- **CRITICAL**: MaliClaw Clause wired into `session_init` handler — all connections now checked BEFORE JWT issuance, not just library code
- **HIGH**: Empty content guard — empty/undefined decrypted payloads are no longer persisted to conversation history; defense-in-depth filter added to Anthropic adapter
- **MEDIUM**: Budget Guard `cooldownDays` now has minimum floor of 1 day (cannot be set to 0 via config)
- **MEDIUM**: Challenge Me More `enabled` flag now has safety floor of `true` — cannot be disabled via config file
- **MEDIUM**: Relay now validates sender type on directional messages — AI clients cannot send human-only message types and vice versa
- **MEDIUM**: Fixed `evaluateSafety()` call site — pattern history now correctly accumulates across safety evaluations
- **MEDIUM**: Challenge wait timer now enforced server-side — early confirmation responses rejected with BASTION-4006
- **MEDIUM**: High-risk hours window now floor-enforced — cannot be shrunk below 6 hours
- Settings store initialization now clamps all values to safety floors

### Fixed (Self-Update System — end-to-end audit)
- **CRITICAL**: Key exchange routing deadlock — human's key_exchange was sent to updater instead of AI when updater was connected (exclusive if/else)
- Admin UI hardcoded version to `0.5.0` — now reads `currentVersion` from relay's `GET /api/update/status` endpoint
- Admin UI showed no changelog or available version after check — now displays version and commit list
- `cancelUpdate()` didn't call `orchestrator.cancel()` — orchestrator continued its lifecycle unaware
- `update_available` prematurely set AdminRoutes phase to `'preparing'` — now correctly stays `'checking'`
- Agent `update_prepare_ack` echoed back `targetVersion` as `currentVersion` — now reads actual version from VERSION file
- Agent sent `update_reconnected` BEFORE `process.exit(0)` with `version:'pending-restart'`, never sent real version after restart — now writes restart-pending flag, sends real version from VERSION file after re-authentication
- Admin UI hardcoded `commitHash: 'HEAD'` — now uses actual commit hash from check response
- GET requests to admin API had no auth headers — all requests now include auth credentials

### Added
- `MIN_COOLDOWN_DAYS` and `HIGH_RISK_HOURS_MIN_WINDOW` constants in `SAFETY_FLOORS`
- `SENDER_TYPE_RESTRICTIONS` directional message enforcement in relay
- `pendingChallenges` server-side wait timer tracking
- `encryptedMessageQueue` for key exchange race condition handling
- Relay reads VERSION file at startup, logs version, serves via `GET /api/update/status`
- Agent `sendReconnectedIfPending()` — reads restart-pending flag after reconnect, sends real version

## [0.5.1] - 2026-03-30

### Fixed
- E2E decryption: streaming chunks (`conversation_stream`) were sent in plaintext via `client.send()` instead of `sendSecure()`, desynchronising the KDF ratchet chain and breaking all subsequent encrypted messages
- Conversation switching: message display was bound to the flat `messages` store instead of the conversations store's `activeMessages` — switching conversations now shows the correct messages
- Systemd service: removed `ProtectSystem=strict` which requires all paths to exist — the AI VM uses `/opt/bastion-ai` not `/opt/bastion`
- Update orchestrator: agents keyed by agentId instead of connectionId — reconnections now replace the old entry instead of duplicating
- Admin API: `GET /api/update/status` now includes orchestrator data (agents, buildResults, reconnections) — previously returned only the basic status object
- Setup script: strip both devDependencies and scripts from deployed package.json — `workspace:*` references break outside the monorepo
- Setup script: added `pnpm install --prod` step to install runtime dependencies (ws, zod)
- Agent entry point: added `main.ts` with config loading, reconnection (exponential backoff), SIGTERM handling
- Agent TLS: added `tls.caCertPath` (trust specific cert) and `tls.rejectUnauthorized` (accept any) config options for self-signed certs
- Command executor: configurable `buildUser` field — relay VM uses `bastion`, AI VM uses `bastion-ai`, omit for no sudo
- Version check: falls back to local `git fetch` + `git log HEAD..origin/main` when no agents are connected
- PLAINTEXT_TYPES: synced human client to include file_manifest, file_offer, file_request, file_data (matches AI client)

### Changed
- First version deployed via the self-update system

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
