# Changelog

All notable changes to Project Bastion are documented in this file.

## [0.8.1] - 2026-04-03

### Added
- GDPR Article 17 — Right to Erasure (soft delete with 30-day window, hard delete, cancel)
- AI Native Toolbox: ai_challenge (AI-issued challenges during challenge hours)
- AI Native Toolbox: ai_memory_proposal (AI proposes memories for user approval)
- AI Native Toolbox: ai_challenge_response handler
- Context budget display in Settings Usage tab (per-zone progress bars)
- Challenge Me More persistent UI status bar (active/inactive with countdown)
- Mid-conversation adapter switching (model badge dropdown in chat header)
- CLI commands: bastion doctor, bastion install, bastion install --fresh [--data]
- CLI self-update on bastion update
- .gitattributes for LF line ending normalisation
- .env.example with all environment variables documented
- docs/architecture/decisions/ directory
- deploy/operator-context.example.md
- Input validation (parseIntEnv/parseFloatEnv) for all numeric env vars
- Sender type restrictions for 28 previously unprotected message types

### Changed
- Admin UI switched from adapter-static to adapter-node (produces Node.js server)
- Single bastion user architecture across all VMs (no more bastion-ai, bastion-updater)
- CLI migration tool handles mount points (fstab remount for separate data disks)
- Default library paths updated from /var/lib/bastion-ai/ to /var/lib/bastion/
- Docker Compose JWT secret now requires .env (no hardcoded dev secret)
- Dead/phantom env vars wired: BASTION_JWT_ISSUER, BASTION_ADMIN_HOST, BASTION_INTAKE_DIR, BASTION_OUTBOUND_DIR
- Hardcoded values now configurable: MAX_PROMPT_MEMORIES, COMPACTION_TRIGGER_PERCENT, COMPACTION_KEEP_RECENT, INTAKE_MAX_FILES, OUTBOUND_MAX_FILES, FILE_PURGE_TIMEOUT_MS, PROJECT_SYNC_MAX_CONTENT
- TLS reject-unauthorized default changed to secure (strict TLS by default)

### Fixed
- Desktop client sent wrong message type names (task_submission->task, challenge_response->confirmation)
- auditLogger undefined in erasure handlers (removed — relay audit chain is single source of truth)
- DataEraser temporal dead zone (moved after UsageTracker initialisation)
- TLS reject-unauthorized logic inverted (default-secure now)
- Messaging bug: adapterReason variable name mismatch (was 'reason')
- Admin UI HOST binding: 0.0.0.0 hardcoded to 127.0.0.1 (now configurable with private-address validation)

### Removed
- Self-update agent system (packages/update-agent — 2,545 lines)
- UpdateOrchestrator from relay (657 lines) + admin UI update page/store
- 10 dead self-update protocol message types
- 4 dead protocol types (audit, config_update, skill_list, skill_config)
- bastion-updater user from both VMs

## [0.8.0] - 2026-04-02

### Added
- **UsageTracker** — SQLite-persisted API token usage tracking (`usage-tracker.ts`). Records every Anthropic API call: adapter ID, role, purpose, conversation, input/output tokens, and computed cost. Provides summaries by time period, adapter, purpose, conversation, and daily breakdowns.
- **usage_status protocol message** (AI → Human) — comprehensive usage report with today/month summaries, per-adapter breakdown, and budget status. Sent on authentication and debounced (max 30s) after every API call.
- **Usage tab** in Settings — token tracking dashboard showing today/month call counts, token totals, cost, budget bar (percentage used), per-adapter breakdown, and budget configuration display.
- **Tab-based Settings navigation** — 9 tabs (Profile, Safety, Context, Files, Privacy, Usage, Tools, Provider, About) replace the single scroll layout. Direct linking via tab click.
- UsageTracker wired into AnthropicAdapter response flow and compaction calls in start-ai-client.mjs
- usageStatus store in session.ts with usage_status message handler

### Changed
- Protocol version: 0.8.0 (91 message types, was 90)
- Test count: 3,032 (was 3,030)
- Settings page restructured from long scroll into tabbed interface

## [0.7.3] - 2026-04-02

### Added
- **GDPR Article 20 Data Portability** — full export/import system for user data
  - `DataExporter` class: builds .bdp (Bastion Data Package) ZIP archives containing conversations, memories, project files, skills, config, audit metadata, and integrity checksum
  - `ImportAdapter` interface with pluggable adapter system; ships with `BastionImportAdapter`
  - `ImportRegistry`: auto-detects format from file contents, returns appropriate adapter
  - `BastionImportAdapter`: validates .bdp files (unzip, manifest verification, SHA-256 checksum), extracts data with conflict detection
  - `ImportExecutor`: executes import with user-selected sections — conversations APPEND, memories MERGE (content hash dedup), project files MERGE (conflict resolution), skills MERGE (version conflict detection), config (user choice)
  - All imported content goes through content scanner (13 dangerous patterns)
  - 6 new protocol message types: `data_export_request`, `data_export_progress`, `data_export_ready`, `data_import_validate`, `data_import_confirm`, `data_import_complete` (90 total)
  - Zod schemas with sender type restrictions for all 6 messages
  - AI client handlers wired in start-ai-client.mjs: export → progress → file airlock delivery; import file with purpose 'import' → validate → confirm → execute
  - Human client Settings page "Data & Privacy" section: Export All Data button with progress bar, Import Data button with validation preview dialog and conflict display
  - Data portability state store in session.ts for cross-component reactivity
  - 80 new tests: ZIP structure verification, manifest checksum, tampered file rejection, conversation append, memory deduplication, project file conflicts, content scanning on import, selective import, protocol schema validation

### Changed
- Protocol version: 0.7.3 (90 message types, was 84)
- Test count: 3,030 (was 2,944)
- Added archiver (^7.0.1) and adm-zip (^0.5.17) to @bastion/client-ai dependencies

## [0.7.2] - 2026-04-02

### Added
- **Task UI rework** — InputBar task mode gains description/notes textarea, inline help text explaining safety pipeline, "Submitting..." → green "Submitted" button flash
- **TaskTracker** — filter bar (All/Active/Completed/Denied), sort toggle (Newest/Oldest), expandable task cards with full detail view (parameters, constraints, timeline), "Clear completed" button
- **Safety evaluation display** — challenged/denied tasks show Layer 2 factor breakdown: factor name, triggered status, weight, detail, risk score bar with threshold indicator, suggested alternatives
- **Challenge action buttons** — "Accept Challenge" and "Cancel Task" buttons directly on challenged task cards, calling resolveChallenge()
- **File Airlock upload** — paperclip/attachment button in chat InputBar with file picker, type validation (allowed/blocked extension sets), size validation (50 MB limit), clear error messages explaining WHY blocked files are rejected
- **Settings page file upload** — "Upload Skill" and "Upload Project File" buttons send files through the security airlock (quarantine + hash verification) with purpose-tagged file_manifest messages
- **Memory management UI** — "Add Memory" button in Settings with inline form (content textarea + category dropdown), global toast notification on memory save/reject via memory_decision handler
- TrackedTask type extended with: `parameters`, `description`, `challengeFactors`, `challengeRiskScore`, `challengeThreshold`, `challengeSuggestedAlternatives`, `denialDetail`
- `clearCompleted()` method on tasks store
- `fileTransfers` store exported from session singleton
- Challenge/denial handlers in session.ts now pass full factor data, risk scores, and detail fields

### Changed
- Protocol version: 0.7.2
- Test count: 2,944 (was 2,896)
- InputBar TaskFields type now includes `description` field
- Task submission flow passes description and parameters to tasks store

## [0.7.1] - 2026-04-01

### Changed
- Documentation refresh — README updated to reflect v0.7.1 features (84 message types, 2,945+ tests, Skills System, adapter hints, Soul Document)
- CHANGELOG entries added for v0.6.0, v0.7.0, v0.7.1
- JSDoc added to adapter-registry.ts (getCheapestByRole, getMostCapableByRole, resolveHint) and agent.ts (handleUpdateCheck)
- SECURITY-AUDIT.md updated with 3 new findings from v0.6.0 session

### Fixed
- Self-update agent: `handleUpdateCheck()` git commands now use `sudo -u buildUser` (was running without sudo, failing silently due to `2>/dev/null`)
- Admin UI update page: added phase progress indicator, version check result caching, update history panel
- `getUpdateStatus()` now includes `checkResult` from last version check

## [0.7.0] - 2026-04-01

### Added
- **Layer 5: Skills System** — contextual knowledge loading with trigger matching
  - SkillStore class: manifest loading, word/regex triggers, mode scoping, content scanning, lock-after-startup
  - ConversationManager.getSystemPrompt() accepts optional currentMessage for trigger matching
  - Skill index (~50 tokens) always in system prompt; triggered skills loaded on demand
  - 3 new protocol message types: `skill_list`, `skill_list_response`, `skill_config` (84 total)
  - Example skills: security-review, git-workflow (shipped with `_example: true`)
  - 30 new tests for skills system

### Changed
- Protocol version: 84 message types (was 81)
- Version bump to 0.7.0

## [0.6.0] - 2026-04-01

### Added
- AI Disclosure config persistence — `PUT /api/disclosure` writes to `/var/lib/bastion/disclosure-config.json`. Precedence: file > env vars > defaults. Survives self-update (outside git repo).
- Challenge Me More temporal injection — `ConversationManager.getSystemPrompt()` injects temporal context block showing current challenge status. Claude knows when challenge hours are active.
- Self-update agent `update_check` handler — agent runs git fetch + log, responds with `update_available` or `up_to_date`. Relay routes `up_to_date` to admin status.
- Adapter hint system — `getCheapestByRole()`, `getMostCapableByRole()`, `resolveHint()` on AdapterRegistry. Extensions declare `adapterHint` per message type.
- Extension UI content delivery — relay reads HTML files and includes inline in `extension_list_response`. Client renders in sandboxed iframe with bridge script injection. ExtensionRegistry scans subdirectories.
- Challenge Me More unification — Layer 2 `evaluateTimeOfDay()` and ChallengeManager now always agree via `challengeActive` parameter.
- Admin UI: Challenge Me More config section with schedule, cooldowns, status badge, 5 hardened immutability guards.
- Admin API: `GET/PUT /api/challenge` endpoints with relay-side caching and AI client forwarding.
- Sonnet adapter gains `'game'` role alongside Haiku.
- `RegisteredAdapter` stores `pricingInputPerMTok` for efficient hint resolution.
- Persistence audit documented in startup scripts (what survives restart).
- ChallengeManager.updateConfig() enforces minimum 6-hour window.
- ChallengeManager.getStatus() returns full config for admin API caching.
- 15 new adapter hint tests.

### Fixed
- Audit trail UI `{@const}` placement for Svelte 5 compliance (fixed in prior session, verified).

## [0.5.9] - 2026-03-31

### Added
- Three Bastion Official Anthropic Adapters:
  - **Sonnet** — default, conversation, task (claude-sonnet-4, $3/$15 per MTok)
  - **Haiku** — compaction, game (claude-haiku-4.5, $0.80/$4 per MTok, 4x cheaper)
  - **Opus** — research, dream (claude-opus-4.6, $15/$75 per MTok, 8192 max tokens, 2x timeout)
- Per-adapter env vars: `BASTION_SONNET_MODEL`, `BASTION_HAIKU_MODEL`, `BASTION_OPUS_MODEL` + pricing overrides
- Provider registration now advertises all three adapters to the relay

### Changed
- Replaced old single adapter + optional compaction adapter with three dedicated adapters
- Adapter registry routes operations to the correct model by role (conversation→Sonnet, compaction→Haiku, research→Opus)
- All adapters share `ANTHROPIC_API_KEY` — deployers only need one API key

## [0.5.8] - 2026-03-31

### Added
- Soul Document v1.0 — Bastion's constitution in three layers
  - Layer 0: Immutable Core (identity, environment, five boundaries)
  - Layer 1: Values & Principles (honesty, harmlessness, helpfulness, transparency, user sovereignty, hierarchy respect, user vulnerability awareness)
  - Layer 2: Operational Guidance (conversation mode, adapter identity, memory proposals, challenge support, budget awareness)
- `ConversationManager.getCoreContext()` — returns Layer 0 only for compaction/minimal context

### Changed
- System prompt upgraded from basic role context to full three-layer soul document (~2,100 tokens)
- Compaction uses Layer 0 only (minimal context for summarisation, saves ~1,700 tokens)

## [0.5.7] - 2026-03-31

### Fixed
- Human client + admin UI: `@bastion/protocol` imports pulled in `node:crypto` via `hash.ts`, breaking Vite browser builds. Replaced with build-time `__BASTION_VERSION__` via Vite `define` (reads VERSION file at build time). Safety floor values reverted to local constants with protocol source comments.

### Changed
- Both SvelteKit apps (client-human, relay-admin-ui) now inject version at build time via `vite.config.ts` `define: { __BASTION_VERSION__ }` — no runtime Node.js dependency

## [0.5.6] - 2026-03-31

### Fixed
- **CRITICAL**: Updater routing used single variable — only one agent received commands. Replaced `updaterConnectionId` with `updaterClients` Map tracking all connected updaters by agentId. `onUpdateMessage` now targets specific component or broadcasts to all. Key exchange forwarded to all updaters. Disconnect properly removes from Map.

### Security
- Update commands now correctly route to per-component agents (relay build → relay agent, AI build → AI agent)
- Key exchange forwarded to ALL updater clients, not just the last one connected

## [0.5.5] - 2026-03-31

### Fixed
- Security audit L-1: `shouldAutoApprove` now checks `dangerous` flag — dangerous tools never auto-approve
- Security audit I-2: Admin UI imports safety floors from `@bastion/protocol` (no more hardcoded literals)
- Cross-package: `CHALLENGE_THRESHOLD` (0.6) and `DENIAL_THRESHOLD` (0.9) added to protocol `SAFETY_FLOORS`
- Human client `SAFETY_FLOOR_VALUES` now references protocol constants instead of local literals

### Added
- Human client sidebar footer showing "Bastion v{version}" (visual proof of self-update)
- First version with all security audit findings resolved (except I-1 mobile — deferred)

### Security
- SECURITY-AUDIT.md: 4 CRITICAL, 1 HIGH, 7 MEDIUM, 2 LOW — all resolved
- Only remaining item: I-1 (mobile safety floor infrastructure) deferred to mobile modernisation roadmap

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
