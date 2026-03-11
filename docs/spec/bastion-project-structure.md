# Project Bastion — Repository Structure & Development Map

## Overview

This document defines the complete project structure for Bastion, an open-source Human–AI secure messaging protocol. It is designed to serve as the authoritative reference for development using Claude Code, ensuring consistent architecture, naming conventions, and component boundaries across all work sessions.

**Repository Root:** `G:\Glorktelligence\Projects\Bastion`  
**Remote Origin:** `git.glorktelligence.co.uk` (Gitea, self-hosted)  
**Licence:** Apache 2.0  
**Protocol Version:** 0.1.0

---

## Directory Tree

```
bastion/
│
├── docs/                              # Documentation & specifications
│   ├── spec/
│   │   ├── Project-Bastion-Spec-v0.1.0.docx    # Product specification
│   │   ├── bastion-supplementary-spec.md        # Supplementary specification (gaps & decisions)
│   │   └── changelog.md                         # Spec version history
│   ├── protocol/
│   │   ├── message-schema.json                  # JSON Schema for all message types
│   │   ├── message-types.md                     # Detailed message type documentation
│   │   ├── message-types-supplementary.md       # Additional message types (session, config, budget)
│   │   ├── error-codes.md                       # Error code reference (BASTION-XXXX)
│   │   ├── session-lifecycle.md                 # Session states & reconnection
│   │   ├── safety-engine.md                     # Safety evaluation engine spec
│   │   ├── file-transfer.md                     # File airlock protocol spec
│   │   └── authentication.md                    # Auth & JWT flow documentation
│   ├── architecture/
│   │   ├── system-overview.md                   # High-level architecture
│   │   ├── network-topology.md                  # VLAN layout & firewall rules
│   │   ├── threat-model.md                      # Threat modelling document
│   │   └── decisions/                           # Architecture Decision Records (ADRs)
│   │       ├── 001-websocket-over-rest.md
│   │       ├── 002-allowlist-over-blocklist.md
│   │       ├── 003-e2e-encryption-approach.md
│   │       └── 004-tauri-for-desktop-client.md
│   ├── guides/
│   │   ├── getting-started.md                   # Quick start guide
│   │   ├── deployment.md                        # Self-hosting deployment guide
│   │   ├── contributing.md                      # Contribution guidelines
│   │   └── security-disclosure.md               # Responsible disclosure process
│   ├── legal/
│   │   ├── privacy-policy.md                    # Privacy policy (GDPR compliant)
│   │   ├── data-processing-record.md            # Article 30 processing record
│   │   └── dpia.md                              # Data Protection Impact Assessment
│   └── gui-concepts/
│       ├── bastion-gui-concept.jsx              # Human client GUI mockup
│       └── bastion-relay-admin.jsx              # Relay admin GUI mockup
│
├── packages/                          # Monorepo packages
│   │
│   ├── protocol/                      # @bastion/protocol — Shared protocol definitions
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                         # Package exports
│   │       ├── types/
│   │       │   ├── messages.ts                  # Message type definitions
│   │       │   ├── envelope.ts                  # Message envelope structure
│   │       │   ├── file-transfer.ts             # File manifest/offer/request types
│   │       │   ├── safety.ts                    # Safety evaluation types
│   │       │   ├── auth.ts                      # Authentication types
│   │       │   └── common.ts                    # Shared types (UUID, timestamps, etc.)
│   │       ├── schemas/
│   │       │   ├── message.schema.ts            # Zod schemas for message validation
│   │       │   ├── envelope.schema.ts           # Envelope schema
│   │       │   └── file.schema.ts               # File transfer schemas
│   │       ├── constants/
│   │       │   ├── message-types.ts             # Message type enum
│   │       │   ├── safety-levels.ts             # Safety layer definitions
│   │       │   ├── error-codes.ts               # Protocol error codes
│   │       │   └── version.ts                   # Protocol version
│   │       └── utils/
│   │           ├── validation.ts                # Schema validation helpers
│   │           ├── hash.ts                      # Hashing utilities (SHA-256)
│   │           └── serialisation.ts             # Message serialisation/deserialisation
│   │
│   ├── crypto/                        # @bastion/crypto — Encryption layer
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── e2e/
│   │       │   ├── session-keys.ts              # Key exchange (Double Ratchet adapted)
│   │       │   ├── encrypt.ts                   # Message/file encryption
│   │       │   ├── decrypt.ts                   # Message/file decryption
│   │       │   └── key-store.ts                 # Local key storage (encrypted at rest)
│   │       ├── integrity/
│   │       │   ├── chain-hash.ts                # Audit log hash chain
│   │       │   └── file-hash.ts                 # File integrity hashing
│   │       └── tls/
│   │           └── cert-utils.ts                # TLS certificate helpers
│   │
│   ├── relay/                         # @bastion/relay — Relay server
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── index.ts                         # Entry point
│   │       ├── server/
│   │       │   ├── websocket.ts                 # WebSocket server (wss://)
│   │       │   ├── tls.ts                       # TLS termination config
│   │       │   └── heartbeat.ts                 # Heartbeat monitoring
│   │       ├── auth/
│   │       │   ├── jwt.ts                       # JWT issuance & validation
│   │       │   ├── provider-registry.ts         # Approved provider management
│   │       │   ├── allowlist.ts                 # Allowlist enforcement
│   │       │   └── maliclaw-clause.ts           # The MaliClaw Clause (hardcoded)
│   │       ├── routing/
│   │       │   ├── message-router.ts            # Message routing logic
│   │       │   ├── schema-validator.ts          # Inbound message schema validation
│   │       │   └── rate-limiter.ts              # Rate limiting per client
│   │       ├── quarantine/
│   │       │   ├── file-quarantine.ts           # File quarantine management
│   │       │   ├── hash-verifier.ts             # Hash integrity verification
│   │       │   └── purge-scheduler.ts           # Automatic purge on timeout
│   │       ├── audit/
│   │       │   ├── audit-logger.ts              # Append-only audit logging
│   │       │   ├── chain-integrity.ts           # Hash chain tamper detection
│   │       │   └── audit-store.ts               # SQLite/PostgreSQL storage
│   │       ├── alerts/
│   │       │   ├── alert-manager.ts             # Alert dispatch orchestrator
│   │       │   ├── deduplicator.ts              # Alert fatigue prevention
│   │       │   ├── severity.ts                  # Severity level definitions
│   │       │   └── channels/
│   │       │       ├── discord-webhook.ts       # Discord webhook channel
│   │       │       ├── minx-bot.ts              # Minx bot integration channel
│   │       │       ├── email.ts                 # SMTP email channel
│   │       │       └── local-file.ts            # Local file fallback channel
│   │       ├── sessions/
│   │       │   ├── session-manager.ts           # Session state machine
│   │       │   ├── grace-timer.ts               # Disconnection grace period
│   │       │   ├── message-queue.ts             # Held messages during suspension
│   │       │   └── conflict-resolver.ts         # Single-device conflict handling
│   │       ├── admin/
│   │       │   ├── admin-server.ts              # Admin interface HTTP server
│   │       │   ├── admin-routes.ts              # API routes for admin panel
│   │       │   └── admin-auth.ts                # Admin authentication (separate from protocol auth)
│   │       └── config/
│   │           ├── defaults.ts                  # Factory defaults (safety floors)
│   │           ├── loader.ts                    # Configuration loader
│   │           └── schema.ts                    # Config validation schema
│   │
│   ├── client-human/                  # @bastion/client-human — Human client (Tauri + SvelteKit)
│   │   ├── package.json
│   │   ├── svelte.config.js
│   │   ├── vite.config.ts
│   │   ├── src-tauri/                           # Tauri Rust backend
│   │   │   ├── Cargo.toml
│   │   │   ├── tauri.conf.json
│   │   │   ├── src/
│   │   │   │   ├── main.rs                      # Tauri entry point
│   │   │   │   ├── commands/
│   │   │   │   │   ├── connection.rs            # WebSocket connection management
│   │   │   │   │   ├── crypto.rs                # Client-side encryption calls
│   │   │   │   │   ├── files.rs                 # File transfer handlers
│   │   │   │   │   └── storage.rs               # Local SQLite for chat history
│   │   │   │   └── lib.rs
│   │   │   └── icons/                           # App icons
│   │   └── src/                                 # SvelteKit frontend
│   │       ├── app.html
│   │       ├── app.css                          # Global styles
│   │       ├── lib/
│   │       │   ├── components/
│   │       │   │   ├── MessageBubble.svelte     # Message display component
│   │       │   │   ├── ChallengeBanner.svelte   # Challenge UI with actions
│   │       │   │   ├── FileAirlock.svelte       # File transfer interface
│   │       │   │   ├── AuditLog.svelte          # Audit log explorer
│   │       │   │   ├── TaskView.svelte          # Task status tracking
│   │       │   │   ├── StatusBar.svelte         # Connection & time-of-day status
│   │       │   │   ├── InputBar.svelte          # Message/task input with mode toggle
│   │       │   │   ├── Sidebar.svelte           # Navigation sidebar
│   │       │   │   ├── Settings.svelte          # Safety config interface
│   │       │   │   ├── OfflineBanner.svelte     # Relay unreachable indicator
│   │       │   │   ├── DraftQueue.svelte        # Draft review & send interface
│   │       │   │   ├── BudgetIndicator.svelte   # API budget status display
│   │       │   │   ├── ProviderStatus.svelte    # AI provider availability banner
│   │       │   │   ├── SessionConflict.svelte   # Device conflict resolution UI
│   │       │   │   └── ConnectionQuality.svelte # Connection health indicator
│   │       │   ├── stores/
│   │       │   │   ├── connection.ts            # WebSocket connection state
│   │       │   │   ├── messages.ts              # Message history store
│   │       │   │   ├── challenges.ts            # Active challenges store
│   │       │   │   ├── files.ts                 # File transfer state
│   │       │   │   ├── audit.ts                 # Audit log cache
│   │       │   │   ├── settings.ts              # User settings store
│   │       │   │   └── drafts.ts                # Offline draft queue store
│   │       │   ├── services/
│   │       │   │   ├── websocket.ts             # WebSocket client service
│   │       │   │   ├── crypto.ts                # Encryption service (Tauri bridge)
│   │       │   │   ├── notifications.ts         # Desktop notification service
│   │       │   │   └── reconnection.ts          # Reconnection logic with backoff
│   │       │   └── utils/
│   │       │       ├── formatting.ts            # Time, size, hash formatting
│   │       │       └── theme.ts                 # Colour palette & design tokens
│   │       └── routes/
│   │           ├── +layout.svelte               # Root layout
│   │           ├── +page.svelte                 # Messages view (default)
│   │           ├── tasks/+page.svelte           # Tasks view
│   │           ├── challenges/+page.svelte      # Challenges view
│   │           ├── files/+page.svelte           # File airlock view
│   │           ├── audit/+page.svelte           # Audit log view
│   │           └── settings/+page.svelte        # Settings view
│   │
│   ├── client-human-mobile/           # @bastion/client-human-mobile — Mobile client (React Native)
│   │   ├── package.json
│   │   ├── app.json
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── screens/
│   │       │   ├── MessagesScreen.tsx
│   │       │   ├── TasksScreen.tsx
│   │       │   ├── ChallengesScreen.tsx
│   │       │   ├── FilesScreen.tsx
│   │       │   └── SettingsScreen.tsx
│   │       ├── components/                      # Mirrors desktop components
│   │       │   └── ...
│   │       └── services/
│   │           └── ...
│   │
│   ├── client-ai/                     # @bastion/client-ai — AI client (headless)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── index.ts                         # Entry point
│   │       ├── connection/
│   │       │   ├── websocket-client.ts          # WebSocket client to relay
│   │       │   ├── session.ts                   # Session management & JWT refresh
│   │       │   └── heartbeat.ts                 # Heartbeat sender
│   │       ├── safety/
│   │       │   ├── engine.ts                    # Safety evaluation engine (orchestrator)
│   │       │   ├── layer1-absolute.ts           # Layer 1: Absolute boundaries
│   │       │   ├── layer2-contextual.ts         # Layer 2: Contextual evaluation
│   │       │   ├── layer3-completeness.ts       # Layer 3: Completeness & clarity
│   │       │   ├── time-of-day.ts               # Time-of-day scrutiny weight
│   │       │   ├── pattern-tracker.ts           # User behaviour pattern tracking
│   │       │   └── config.ts                    # Safety configuration (floors + user adjustments)
│   │       ├── execution/
│   │       │   ├── task-executor.ts             # Task execution orchestrator
│   │       │   ├── tool-registry.ts             # Available tool definitions
│   │       │   └── sandbox.ts                   # Execution sandboxing
│   │       ├── files/
│   │       │   ├── intake.ts                    # Read-only intake directory handler
│   │       │   ├── outbound.ts                  # Write-only outbound staging
│   │       │   └── purge.ts                     # Automatic file purge
│   │       ├── provider/
│   │       │   ├── anthropic.ts                 # Anthropic Claude API adapter
│   │       │   ├── provider-interface.ts        # Provider abstraction layer
│   │       │   └── key-rotation.ts              # API key rotation handler
│   │       ├── budget/
│   │       │   ├── token-tracker.ts             # Per-call token usage tracking
│   │       │   ├── cost-calculator.ts           # Cost estimation using provider pricing
│   │       │   └── budget-enforcer.ts           # Threshold checks & automatic challenges
│   │       ├── tools/
│   │       │   ├── registry.ts                  # Tool registry loader & validator
│   │       │   ├── registry-guard.ts            # Prevents AI self-modification of registry
│   │       │   └── definitions/
│   │       │       ├── ssh-command.ts            # SSH command tool definition
│   │       │       ├── file-read.ts             # File reading tool
│   │       │       ├── file-write.ts            # File writing tool (permitted dirs only)
│   │       │       └── http-request.ts          # Outbound HTTP tool (whitelisted endpoints)
│   │       ├── metadata/
│   │       │   ├── transparency.ts              # AI transparency metadata builder
│   │       │   └── confidence.ts                # Confidence level assessment
│   │       └── config/
│   │           ├── defaults.ts                  # AI client defaults
│   │           ├── loader.ts                    # Config loader
│   │           └── api-key.ts                   # API key loader (local, encrypted)
│   │
│   └── relay-admin-ui/                # @bastion/relay-admin-ui — Relay admin panel (SvelteKit)
│       ├── package.json
│       ├── svelte.config.js
│       ├── vite.config.ts
│       └── src/
│           ├── app.html
│           ├── lib/
│           │   ├── components/
│           │   │   ├── MetricCard.svelte
│           │   │   ├── ProviderTable.svelte
│           │   │   ├── BlocklistManager.svelte
│           │   │   ├── QuarantineView.svelte
│           │   │   ├── ConnectionLog.svelte
│           │   │   ├── NetworkTopology.svelte
│           │   │   └── SystemConfig.svelte
│           │   ├── stores/
│           │   │   ├── relay-status.ts
│           │   │   ├── providers.ts
│           │   │   ├── connections.ts
│           │   │   └── quarantine.ts
│           │   └── services/
│           │       └── admin-api.ts             # Admin API client
│           └── routes/
│               ├── +layout.svelte
│               ├── +page.svelte                 # Overview dashboard
│               ├── providers/+page.svelte
│               ├── blocklist/+page.svelte
│               ├── quarantine/+page.svelte
│               ├── connections/+page.svelte
│               └── system/+page.svelte
│
├── infrastructure/                    # Deployment & infrastructure config
│   ├── proxmox/
│   │   ├── vm-relay.conf                        # Proxmox VM config for relay
│   │   ├── vm-ai-client.conf                    # Proxmox VM config for AI VM
│   │   └── firewall-rules.conf                  # OPNSense rules template
│   ├── docker/
│   │   ├── docker-compose.yml                   # Dev environment compose
│   │   ├── docker-compose.prod.yml              # Production compose
│   │   ├── relay.Dockerfile
│   │   └── ai-client.Dockerfile
│   ├── wireguard/
│   │   └── bastion-vpn.conf.template            # WireGuard config template
│   └── scripts/
│       ├── setup-relay.sh                       # Relay server setup script
│       ├── setup-ai-vm.sh                       # AI VM provisioning script
│       ├── rotate-jwt-keys.sh                   # JWT key rotation
│       └── backup-audit-log.sh                  # Audit log backup script
│
├── tests/                             # Test suites
│   ├── protocol/
│   │   ├── message-validation.test.ts           # Schema validation tests
│   │   ├── envelope.test.ts                     # Envelope structure tests
│   │   └── serialisation.test.ts                # Serialisation round-trip tests
│   ├── relay/
│   │   ├── routing.test.ts                      # Message routing tests
│   │   ├── auth.test.ts                         # Authentication tests
│   │   ├── maliclaw-clause.test.ts              # MaliClaw Clause enforcement tests
│   │   ├── quarantine.test.ts                   # File quarantine tests
│   │   └── audit.test.ts                        # Audit logging tests
│   ├── safety/
│   │   ├── layer1.test.ts                       # Absolute boundary tests
│   │   ├── layer2.test.ts                       # Contextual evaluation tests
│   │   ├── layer3.test.ts                       # Completeness tests
│   │   ├── time-of-day.test.ts                  # Time weighting tests
│   │   └── floors.test.ts                       # Safety floor enforcement tests
│   ├── crypto/
│   │   ├── encryption.test.ts                   # E2E encryption tests
│   │   ├── key-exchange.test.ts                 # Key exchange tests
│   │   └── hash-chain.test.ts                   # Audit hash chain integrity tests
│   └── integration/
│       ├── full-flow.test.ts                    # End-to-end message flow
│       ├── challenge-cycle.test.ts              # Challenge → confirmation flow
│       ├── file-transfer.test.ts                # Complete file airlock flow
│       └── connection-rejection.test.ts         # Blocklist & auth rejection tests
│
├── .github/                           # CI/CD (mirrored to Gitea Actions)
│   └── workflows/
│       ├── test.yml                             # Run tests on PR
│       ├── lint.yml                             # Linting & formatting
│       ├── security-audit.yml                   # Dependency security audit
│       └── release.yml                          # Release workflow
│
├── .gitignore
├── package.json                       # Root workspace package.json
├── pnpm-workspace.yaml                # PNPM workspace config
├── tsconfig.base.json                 # Shared TypeScript config
├── biome.json                         # Linting & formatting (Biome)
├── LICENSE                             # Apache 2.0
├── NOTICE                             # Apache 2.0 required attribution file
├── README.md                          # Project README
├── SECURITY.md                        # Security policy & disclosure process
├── CODE_OF_CONDUCT.md
└── CHANGELOG.md                       # Project-level changelog
```

---

## Package Dependency Graph

```
@bastion/protocol          ← Shared types, schemas, constants (no dependencies)
    ↑
    ├── @bastion/crypto    ← Encryption, hashing, key management
    │       ↑
    │       ├── @bastion/relay           ← Relay server
    │       ├── @bastion/client-human    ← Human desktop client
    │       ├── @bastion/client-human-mobile  ← Human mobile client
    │       └── @bastion/client-ai       ← AI headless client
    │
    └── @bastion/relay-admin-ui          ← Relay admin panel (talks to relay admin API)
```

---

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Shared across all packages, strong typing for protocol safety, Harry's existing experience |
| Package Manager | PNPM | Workspace support, disk efficiency, strict dependency resolution |
| Monorepo | PNPM Workspaces | All packages in one repo, shared config, atomic commits across protocol changes |
| Desktop Client | Tauri + SvelteKit | Lightweight, native performance, Harry has Cosmos Reader experience with this stack |
| Mobile Client | React Native | Android-first, Harry has Aurora Paws experience with this stack |
| Relay Server | Node.js (ws + fastify) | WebSocket native support, Fastify for admin API, familiar ecosystem |
| AI Client | Node.js (headless) | Shares protocol package, Anthropic SDK is TypeScript-native |
| Database | SQLite (dev/small) / PostgreSQL (larger) | SQLite for single-relay deployments, Postgres for future scaling |
| Encryption | libsodium (via sodium-native) | Battle-tested, fast, well-documented, NaCl-based |
| Schema Validation | Zod | TypeScript-first, runtime validation, composable schemas |
| Linting/Formatting | Biome | Fast, opinionated, replaces ESLint + Prettier |
| Testing | Vitest | Fast, TypeScript-native, compatible with monorepo structure |
| Relay Admin UI | SvelteKit (standalone) | Separate from human client, served by relay's admin HTTP server |
| CSS | Tailwind CSS (clients) | Utility-first, consistent with Glorktelligence platform approach |

---

## Development Phases & Claude Code Task Mapping

### Phase 1: Foundation
**Priority: Critical — Must complete before anything else**

| Task | Package | Description | Estimated Effort |
|------|---------|-------------|-----------------|
| 1.1 | `protocol` | Define all message type interfaces & Zod schemas | Medium |
| 1.2 | `protocol` | Message envelope structure with UUID, timestamps, correlation IDs | Small |
| 1.3 | `protocol` | Schema validation utility functions | Small |
| 1.4 | `protocol` | Serialisation/deserialisation with integrity checks | Small |
| 1.5 | `crypto` | E2E encryption: session key exchange | Large |
| 1.6 | `crypto` | Message encryption/decryption | Medium |
| 1.7 | `crypto` | File encryption/decryption | Medium |
| 1.8 | `crypto` | Audit log hash chain | Medium |
| 1.9 | `relay` | WebSocket server with TLS termination | Medium |
| 1.10 | `relay` | Message routing (human ↔ AI via relay) | Medium |
| 1.11 | `relay` | Schema validation on all inbound messages | Small |
| 1.12 | `relay` | JWT authentication: issuance & validation | Medium |
| 1.13 | `relay` | Provider registry & allowlist enforcement | Medium |
| 1.14 | `relay` | MaliClaw Clause: hardcoded rejection | Small |
| 1.15 | `relay` | Audit logger: append-only with hash chain | Medium |
| 1.16 | `relay` | Heartbeat monitoring & alerting | Small |
| 1.17 | `client-ai` | WebSocket client connecting to relay | Medium |
| 1.18 | `client-ai` | Safety engine: Layer 1 (absolute boundaries) | Medium |
| 1.19 | `client-ai` | Safety engine: Layer 2 (contextual evaluation) | Large |
| 1.20 | `client-ai` | Safety engine: Layer 3 (completeness check) | Medium |
| 1.21 | `client-ai` | Time-of-day scrutiny weighting | Small |
| 1.22 | `client-ai` | Challenge/denial message generation | Medium |
| 1.23 | `client-ai` | Anthropic provider adapter | Medium |
| 1.24 | `client-human` | Tauri + SvelteKit scaffold | Medium |
| 1.25 | `client-human` | WebSocket connection to relay | Medium |
| 1.26 | `client-human` | Message display (conversation & task types) | Medium |
| 1.27 | `client-human` | Challenge UI with accept/proceed/cancel actions | Medium |
| 1.28 | `client-human` | Input bar with conversation/task mode toggle | Small |
| 1.29 | `tests` | Protocol schema validation test suite | Medium |
| 1.30 | `tests` | Integration: full message round-trip test | Large |

### Phase 2: File Transfer
**Priority: High — Core security feature**

| Task | Package | Description | Estimated Effort |
|------|---------|-------------|-----------------|
| 2.1 | `relay` | File quarantine: inbound & outbound stores | Medium |
| 2.2 | `relay` | Hash verification at every transfer stage | Medium |
| 2.3 | `relay` | Purge scheduler: timeout-based cleanup | Small |
| 2.4 | `relay` | File-manifest/file-offer/file-request routing | Medium |
| 2.5 | `crypto` | File-specific E2E encryption (zero-knowledge relay) | Medium |
| 2.6 | `client-ai` | Read-only intake directory handler | Small |
| 2.7 | `client-ai` | Write-only outbound staging | Small |
| 2.8 | `client-ai` | Automatic file purge on completion | Small |
| 2.9 | `client-human` | File airlock UI (offer review, accept/reject) | Medium |
| 2.10 | `client-human` | File transfer history with chain of custody | Medium |
| 2.11 | `tests` | File transfer integration tests | Large |

### Phase 3: Multi-Provider & Admin
**Priority: Medium — Enables broader usage**

| Task | Package | Description | Estimated Effort |
|------|---------|-------------|-----------------|
| 3.1 | `relay` | Admin HTTP server & API routes | Medium |
| 3.2 | `relay` | Admin authentication (separate from protocol) | Medium |
| 3.3 | `relay` | Provider approval/revocation API | Medium |
| 3.4 | `relay` | Capability matrix per provider | Medium |
| 3.5 | `relay-admin-ui` | SvelteKit scaffold | Medium |
| 3.6 | `relay-admin-ui` | Overview dashboard | Medium |
| 3.7 | `relay-admin-ui` | Provider management interface | Medium |
| 3.8 | `relay-admin-ui` | Blocklist manager | Small |
| 3.9 | `relay-admin-ui` | Quarantine viewer | Medium |
| 3.10 | `relay-admin-ui` | Connection log | Medium |
| 3.11 | `relay-admin-ui` | System configuration view | Medium |

### Phase 4: Client Polish
**Priority: Medium — User experience**

| Task | Package | Description | Estimated Effort |
|------|---------|-------------|-----------------|
| 4.1 | `client-human` | Audit log explorer with filtering | Medium |
| 4.2 | `client-human` | Settings UI (safety config with tighten-only) | Medium |
| 4.3 | `client-human` | Task tracking view | Medium |
| 4.4 | `client-human` | Challenge history & statistics | Small |
| 4.5 | `client-human` | Desktop notifications | Small |
| 4.6 | `client-human` | Local chat history (SQLite via Tauri) | Medium |
| 4.7 | `client-human-mobile` | React Native scaffold | Large |
| 4.8 | `client-human-mobile` | Core messaging screens | Large |
| 4.9 | `client-human-mobile` | Challenge & file transfer screens | Large |

### Phase 5: Community & Release
**Priority: Lower — Public launch preparation**

| Task | Package | Description | Estimated Effort |
|------|---------|-------------|-----------------|
| 5.1 | root | README with project overview & philosophy | Small |
| 5.2 | root | SECURITY.md with full disclosure process | Small |
| 5.3 | root | CODE_OF_CONDUCT.md | Small |
| 5.4 | root | CONTRIBUTING.md with PR workflow | Medium |
| 5.5 | root | CI/CD workflows (test, lint, security audit) | Medium |
| 5.6 | docs | Getting started guide | Medium |
| 5.7 | docs | Deployment guide (self-hosting) | Large |
| 5.8 | docs | Protocol specification (standalone, versioned) | Large |
| 5.9 | `infrastructure` | Docker Compose for dev environment | Medium |
| 5.10 | `infrastructure` | Proxmox VM templates | Medium |

---

## Naming Conventions

| Area | Convention | Example |
|------|-----------|---------|
| Packages | `@bastion/kebab-case` | `@bastion/client-human` |
| Files | `kebab-case.ts` | `message-router.ts` |
| Svelte components | `PascalCase.svelte` | `ChallengeBanner.svelte` |
| Types/Interfaces | `PascalCase` | `TaskMessage`, `SafetyEvaluation` |
| Constants | `SCREAMING_SNAKE_CASE` | `MESSAGE_TYPES`, `SAFETY_FLOORS` |
| Functions | `camelCase` | `validateMessage()`, `encryptPayload()` |
| Database tables | `snake_case` | `audit_entries`, `file_transfers` |
| Environment variables | `BASTION_SCREAMING_SNAKE` | `BASTION_RELAY_PORT`, `BASTION_JWT_SECRET` |

---

## Infrastructure Mapping (Proxmox Naval Fleet)

| Component | VM/LXC Name | VLAN | IP Range | Purpose |
|-----------|-------------|------|----------|---------|
| Relay Server | naval-bastion-01 | 30 (DMZ) | 10.0.30.x | Message routing, audit, quarantine |
| AI Client VM | naval-bastion-ai-01 | 50 (Isolated) | 10.0.50.x | Isolated AI execution environment |
| Human Client | Desktop/Mobile | 10 (User) | 10.0.10.x | User's device |
| Firewall | Mystic (OPNSense) | All | — | Inter-VLAN routing & rules |

---

## Claude Code Session Guidelines

When working on Bastion with Claude Code, the following guidelines apply:

1. **Always start by reading the relevant package's existing code** before making changes.
2. **Every new message type must be added to `@bastion/protocol` first**, then consumed by other packages.
3. **Safety engine changes require corresponding test updates** — no untested safety code.
4. **The MaliClaw Clause is hardcoded** — any attempt to parameterise or make it configurable should be rejected.
5. **Safety floors are immutable minimums** — code that allows lowering below the floor is a bug, not a feature.
6. **All file transfers go through quarantine** — no shortcuts, no "quick transfer" bypass.
7. **Challenge me on anything irreversible** — this is explicitly part of the development workflow.
8. **Commit messages follow Conventional Commits** — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
9. **Protocol version bumps require an ADR** explaining the change.
10. **When in doubt, deny** — the protocol defaults to rejection, not acceptance.
