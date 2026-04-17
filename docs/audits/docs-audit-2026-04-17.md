# Documentation Audit — Full Sweep (2026-04-17)

**Auditor:** Claude Opus 4.7 (1M context), invoked via `/audit` skill in READONLY mode
**Baseline:** `pnpm test` → **4,453 / 4,453 passing** across 14 test files (confirmed before audit)
**Git state:** branch `main`, HEAD `f652a9b`, 5 untracked `PIXEL-AUDIT.md` files (unrelated), 3 new audit reports from today (untracked), `.claude/settings.local.json` modified
**Repo version (VERSION file):** 0.8.1
**Protocol version (packages/protocol/src/constants/version.ts):** 0.8.1
**Scope:** Every Markdown doc in the repo — root, `docs/**`, `packages/**/*.md` — compared against actual code state.
**Output:** Findings only. **No documentation was modified.**

---

## Executive Summary — Top Findings, Ranked by Cloner Impact

| # | Finding | Classification | Cost | Cloner Impact |
|---|---|---|---|---|
| 1 | **Git remote URL contradicts across docs.** README points cloners at `github.com/Glorktelligence/Bastion`; `CONTRIBUTING.md:21`, `docs/guides/getting-started.md:37`, `docs/guides/deployment.md:157,285` all use `git.glorktelligence.co.uk` (self-hosted Gitea, reachable only from inside GNET). Any cloner following getting-started or deployment will get DNS failure or a firewall block. | DRIFT + CLONER_UX | Cheap (global replace) | **CRITICAL — cannot clone at all** from public following these guides |
| 2 | **Protocol spec `docs/protocol/bastion-protocol-v0.5.0.md` is pre-BastionGuardian, pre-Track-A-crypto, pre-auth-refactor.** Declares "81 message types", "15 categories" (actual: 102 types, 20+ categories); documents mTLS + username/TOTP admin auth (now: session JWT only, per today's admin audit §1.3); omits Guardian category entirely (9XXX error codes, `guardian_*` message types); crypto section describes advance-before-verify semantics (now fixed — peek/commit API). | STALE | Expensive (full rewrite planned for v0.9.0 per parked note) | **HIGH — the only documented protocol is effectively fictional** |
| 3 | **Test counts are stale everywhere.** README badge: "3,897 passing"; README §Status: 3,897; README §Run Tests: 3,897; `docs/guides/getting-started.md:71-84`: a per-file table ending at "3,862 tests"; CLAUDE.md line 143: "3,862+". Actual: 4,453 across 14 files. All three numbers appear in the same repo. | STALE | Cheap (5 edits) | MEDIUM — cloner won't fail, but signals doc-decay and shakes trust |
| 4 | **Admin architecture drift in SECURITY.md §"Admin Dashboard Access Model" (lines 100-108).** Claims (a) "GET endpoints are unauthenticated", (b) "Admin UI uses SvelteKit adapter-node", (c) the production UI proxies `/api/*` with `rejectUnauthorized: false`. All three contradict Option A (today's admin audit §1.1, §1.4): all endpoints require session JWT after setup; adapter is `@sveltejs/adapter-static`; there is no proxy — AdminServer serves both SPA and API from port 9444. | DRIFT | Cheap (rewrite one section) | **HIGH — misleads security reviewer about live access model** |
| 5 | **README claims "8 packages" (badge line 5); actual is 10 directories in `packages/`** (`adapter-template, client-ai, client-human, client-human-mobile, crypto, infrastructure, protocol, relay, relay-admin-ui, tests`). `CONTRIBUTING.md:30-40` lists 9. README text at line 136 lists 8 in a table and adds an adapter-template 9th row inline. Triple inconsistency. | STALE | Cheap | LOW — confuses mental model |
| 6 | **Message-type count drift across all "overview" docs.** README (×4 mentions) and CLAUDE.md (×2) say "95 message types". Actual count in `packages/protocol/src/constants/message-types.ts`: **102**. The file's own header comment (line 5) correctly says "102 message types" — so the source file is honest, but every consuming doc is stale. | STALE | Cheap | LOW |
| 7 | **Error-code count drift.** CLAUDE.md §"Error Codes" and README both say "48 codes across 8 categories". Actual: **57 codes across 9 categories** (9XXX = Guardian Errors, 9 codes). Guardian isn't mentioned in either file's summary. | STALE + MISSING | Cheap (3 lines) | LOW but telling — shows the 7th Sole Authority isn't fully integrated into the philosophical docs |
| 8 | **"Six Sole Authorities" / "7th Sole Authority" contradiction.** CLAUDE.md §"Six Sole Authorities" (line 111) and README §"Six Sole Authorities" (line 95) both list six. But `packages/protocol/src/constants/message-types.ts:155` comments the Guardian block as "BastionGuardian (7th Sole Authority)", `packages/relay/src/guardian/bastion-guardian.ts` exists, and `packages/client-ai/src/provider/bastion-guardian.ts` exists. The code has seven; the docs have six. | DRIFT | Cheap | MEDIUM — defining architectural vocabulary for the project |
| 9 | **Three parked known-issues have no documentation at all:** (a) WebSocket rate-limiter debouncing (parent audit §9.2), (b) audit event registration drift (parent audit §10.1), (c) Track B crypto unification (parent audit §3.2 — `@bastion/crypto` package is not used in production; runtime crypto is hand-rolled in `start-*.mjs`). A cloner opening a "Track B" ticket would have no paper trail. | MISSING | Medium (need SECURITY.md Known Limitations updates) | MEDIUM |
| 10 | **No documentation of UDP 123 / NTP anywhere.** `docs/guides/deployment.md` firewall section (lines 451-467) blocks VLAN 50 broadly, only punches DNS (UDP 53), HTTPS (WAN 443), and relay (9443). If the AI VM can't reach an NTP server, TOTP clock skew + TLS cert validation start failing in confusing ways. This is the exact gotcha Harry hit today. | MISSING + CLONER_UX | Cheap (one rule + note) | **HIGH — this gotcha has already cost Harry time; will cost every cloner** |

---

## Method

1. Ran `pnpm test` to establish 4,453/4,453 baseline.
2. Enumerated every `.md` file under the repo with `find docs -type f`, `ls *.md`, `find packages -maxdepth 2 -name "*.md"`.
3. Read each doc end-to-end in sequence. Cross-referenced claims against source of truth:
   - Test count: `pnpm test` summary
   - Message-type count: `packages/protocol/src/constants/message-types.ts`
   - Error-code count/categories: `packages/protocol/src/constants/error-codes.ts`
   - Version: `VERSION` file + `packages/protocol/src/constants/version.ts`
   - Admin architecture: today's `docs/audits/admin-server-audit-2026-04-17.md` §1.1–1.4 (verified)
   - Crypto behaviour: today's `docs/audits/e2e-crypto-audit-2026-04-17.md` + addendum; recent commits `f652a9b`, `68fc517`, `52c91ee`, `e647b9d`, `19973e0`
   - Deploy artefacts: `ls deploy/systemd/`, `ls scripts/`, `ls packages/infrastructure/`
4. Classified each finding per the scheme (DRIFT / STALE / MISSING / CLONER_UX / CROSS_REF_GAP / WORKING).
5. Estimated fix cost: **Cheap** = one or two line edits; **Medium** = section rewrite; **Expensive** = full replacement or new doc.

---

## Section 1 — `README.md`

Most-read doc by a cloner. Shapes first impressions.

### 1.1 Findings table

| Line | Finding | Class | Cost |
|---|---|---|---|
| 4 | Badge "Tests-3,897_passing" — actual 4,453 | STALE | Cheap |
| 5 | Badge "Packages-8" — actual 10 directories (9 if excluding `tests`+`infrastructure`) | STALE | Cheap |
| 6 | Badge "Protocol-95_message_types" — actual 102 | STALE | Cheap |
| 95–106 | §"Six Sole Authorities" — actual code has seven (BastionGuardian) | DRIFT | Cheap |
| 146 | Row `@bastion/relay-admin-ui ... 5-tab config` — admin UI shipped today has 6 tabs per admin audit §1.4; "5-tab" is pre-setup-wizard framing | STALE | Cheap |
| 174, 195 | `git clone https://github.com/Glorktelligence/Bastion.git` — contradicts CONTRIBUTING/getting-started/deployment which use `git.glorktelligence.co.uk` | DRIFT | Cheap |
| 227 | "All 3,897 tests" — actual 4,453 | STALE | Cheap |
| 233 | "defines 95 message types" — actual 102 | STALE | Cheap |
| 258 | "48 error codes across 8 categories" — actual 57 across 9 (Guardian added) | STALE | Cheap |
| 262 | Crypto section — describes "forward secrecy" and "KDF ratchet chain" but does not surface the Track-A fixes that landed in the last five commits (peek/commit, PLAINTEXT_TYPES gate, stale-cipher reset, encrypted-message queue). A cloner reading about the crypto today gets a pre-fix description. | MISSING | Medium |
| 273 | `[Systemd Templates](deploy/systemd/) — Service files for relay, admin UI, AI client` — actual `deploy/systemd/` contains only two files: `bastion-ai-client.service` and `bastion-relay.service`. No admin-ui service exists (removed in Phase 2a). | STALE | Cheap |
| 280 | Links to `docs/protocol/bastion-protocol-v0.5.0.md` with "All 95 message types" — spec file is itself stale; see Section 7 | STALE + CROSS_REF_GAP | (tracked under #2) |
| 298 | "Two example skills ship with the repo: `security-review` and `git-workflow`" — confirmed present | WORKING | — |
| 304 | `E2E encrypted messaging (X25519 + XSalsa20-Poly1305 Double Ratchet)` — this says **Double Ratchet** but CLAUDE.md line 150 correctly says "Symmetric KDF chain only (no per-message DH ratchet)"; SECURITY.md line 159 confirms no DH ratchet; the protocol spec line 183 says KDF chain only. README is the outlier claiming "Double Ratchet" which is the Signal term for KDF + per-message DH. Technically incorrect. | DRIFT | Cheap |
| 346 | "3,897 passing tests in 14 test files" — actual 4,453 | STALE | Cheap |
| 348 | "95 message types with 48 error codes across 8 categories" — all three numbers wrong | STALE | Cheap |
| 348 | "Opus 4.6" model claim — matches code (`start-ai-client.mjs:173`, default `claude-opus-4-6`). | WORKING | — |
| 350 | Mobile client note — accurate flag that mobile is behind | WORKING | — |

### 1.2 Cloner-path analysis

Following README Quick Start on a fresh Ubuntu box:

1. `sudo mkdir -p /opt/bastion; sudo chown $(whoami) /opt/bastion` — works.
2. `git clone https://github.com/Glorktelligence/Bastion.git /opt/bastion` — **this URL works** (public GitHub mirror). ✓
3. `sudo bash scripts/bastion-cli.sh install --vm relay` — `scripts/bastion-cli.sh` exists and has an `install)` branch (confirmed). ✓
4. `cp .env.example .env` — `.env.example` exists per CHANGELOG 0.8.1 entry. ✓
5. `bastion doctor` — confirmed as a CLI command (`bastion-cli.sh` has a `doctor)` branch). ✓

**README Quick Start is viable for a cloner IF they follow the README exclusively** and don't follow any doc that links to `git.glorktelligence.co.uk`. The failure mode is: a cloner who picks getting-started.md or deployment.md first (both linked from README §Documentation) hits the Gitea URL and gets "could not resolve host" or a firewall drop.

---

## Section 2 — `CLAUDE.md`

Project rules file. Read by every Claude Code session.

### 2.1 Findings table

| Line | Finding | Class | Cost |
|---|---|---|---|
| 31 | "95 message types, 48 error codes" — actual 102 / 57 | STALE | Cheap |
| 87 | "(95 message types, schemas, constants — FOUNDATION)" — actual 102 | STALE | Cheap |
| 111–119 | §"Six Sole Authorities" — Guardian missing (7th per code + message-types.ts header) | DRIFT | Cheap |
| 143 | "(testing, 3,862+ tests)" — actual 4,453 | STALE | Cheap |
| 60–78 | §"Error Handling Philosophy: Fail Loud, Never Fake" — this section is a strong statement but has no links to concrete evidence. Today's e2e-crypto audit §4.1 + the addendum show the _converse_ pattern in production (silent early return in `tryDecrypt`, silent ratchet advance on MAC failure). After the Track-A fix landed in commits `e647b9d` and `52c91ee`, this section now has shipping evidence that could be cross-linked. Not technically wrong, but opportunity to anchor the philosophy to a fix. | CROSS_REF_GAP | Cheap |
| 150 | `Symmetric KDF chain only (no per-message DH ratchet)` — accurate, and contradicts README line 304's "Double Ratchet" claim (see §1.1) | WORKING | — |
| 126–128 | Adapter table: `claude-sonnet-4-6 / claude-haiku-4-5-20251001 / claude-opus-4-6` — matches `start-ai-client.mjs:161,167,173` defaults | WORKING | — |
| 155 | Error code total "48 codes across 8 categories" — actual 57 across 9 | STALE | Cheap |

### 2.2 Skills bookshelf reference

CLAUDE.md line 152 tells every new session to "Read the skills in `.claude/skills/` before starting work — especially `project-context`, `safety-engine`, and `protocol-design`." Confirmed all three exist: `.claude/skills/project-context/skill.md`, `safety-engine/skill.md` (not checked here but listed in the skill index), `protocol-design` (likewise). There's also `audit`, `checkpoint`, `implementation`, `plan-mode`, `security-patterns`, `testing`. CLAUDE.md doesn't mention that the audit skill now exists — not a DRIFT per se, but a CROSS_REF_GAP for anyone navigating.

---

## Section 3 — `CONTRIBUTING.md`

### 3.1 Findings table

| Line | Finding | Class | Cost |
|---|---|---|---|
| 7 | Links cloner to `docs/spec/bastion-supplementary-spec.md` as essential reading. That doc's front-matter says "Version: 0.5.0-supplement-1" — the whole document predates Phases 2-5. New contributors are steered to a stale decision record. | STALE (pointer) | Expensive (rewrite supp spec) / Cheap (add warning header) |
| 21 | `git clone https://git.glorktelligence.co.uk/glorktelligence/bastion.git` — self-hosted Gitea; see global finding #1 | DRIFT | Cheap |
| 30–40 | Lists 9 packages (includes `adapter-template`). README lists 8 in the badge. Pick one count. | STALE | Cheap |
| 89 | Recommends co-author trailer `Co-authored-by: Claude <noreply@anthropic.com>` — recent commits on `main` use `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (note the model-specific line in `f652a9b` etc.). Either update the CONTRIBUTING guidance to match practice, or conform practice to guidance. | DRIFT | Cheap |
| 171 | `contribute@glorktelligence.co.uk` — not verified, but consistent with SECURITY.md pattern | WORKING | — |

### 3.2 Content otherwise accurate

Security-sensitive change cooling-off process (line 138–147), Protocol change process requiring ADR (line 150–158) — both match current code structure (`docs/architecture/decisions/` exists but is empty — see §8).

---

## Section 4 — `SECURITY.md`

This is the **most important security-reviewer doc** after README. Two significant DRIFT findings.

### 4.1 Findings table

| Line | Finding | Class | Cost |
|---|---|---|---|
| 22 | Supported Versions table shows only `0.1.x`. Current repo is `0.8.1`. A security researcher seeing this will assume the project is abandoned or that 0.8.1 is unsupported. | STALE | Cheap |
| 74 | "E2E encrypted with XSalsa20-Poly1305 via KDF ratchet chain" — correct. | WORKING | — |
| 87 | "Admin panel locality: The admin server binds to localhost only. Public binding attempts are logged as security violations and refused." — confirmed by admin audit §1.1. | WORKING | — |
| 100–108 | §"Admin Dashboard Access Model" — **DRIFT from Option A architecture**. Three specific claims now wrong: (a) "GET endpoints are unauthenticated" (b) "Admin UI binding... SvelteKit adapter-node" (c) "The production admin UI proxies /api/* requests... with rejectUnauthorized: false". Actual per admin-server audit §1.1,1.3,1.4: all admin endpoints go through the session-JWT gate, adapter is `@sveltejs/adapter-static`, there is no proxy — static SPA and API share port 9444 from `AdminServer`. | DRIFT | Medium (section rewrite) |
| 159 | "No per-message DH ratchet" — accurate limitation, matches CLAUDE.md | WORKING | — |
| 161 | "Read-only admin is unauthenticated" — **wrong** per §4.1 line 100 finding above. Session JWT is required. | DRIFT | Cheap |
| 162 | "File content visible to relay" limitation — still applies (no E2E file encryption) per current code. | WORKING | — |
| — | **No mention of security headers** (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, etc.) added today per Phase 2b. | MISSING | Cheap |
| — | **No mention of per-endpoint rate limiting** (`docs/design/admin-rate-limiting.md` implemented today). | MISSING | Cheap |
| — | **No mention of the `limit_reached` audit event.** | MISSING | Cheap |
| — | **Threat model does not surface the stale-cipher race** (today's crypto audit addendum §3). Now mitigated by peer_status=active reset (commit `68fc517`), but the threat model should document the class of issue. | MISSING | Medium |
| — | **No link to today's three audit reports** from SECURITY.md. A security researcher doing a review would not discover them. | CROSS_REF_GAP | Cheap |

### 4.2 Cloner-path analysis

A security researcher reading SECURITY.md today gets a picture of the system that is **two steps behind** the codebase on admin access model and one step behind on crypto. That researcher would file findings against the _documented_ behaviour, not the actual behaviour, and waste everyone's time. This is the highest-priority fix for the next session.

---

## Section 5 — `CODE_OF_CONDUCT.md`

Contributor Covenant v2.1 with security-specific extensions (no safety bypass, no surveillance code, MaliClaw respect per CHANGELOG 5.3 entry).

| Finding | Class |
|---|---|
| No drift detected. Content is policy, not implementation-dependent. | WORKING |

No findings.

---

## Section 6 — `CHANGELOG.md`

### 6.1 Findings table

| Line | Finding | Class | Cost |
|---|---|---|---|
| 5 | `## [0.8.1] - 2026-04-03` is the latest entry. Phases 2a (Option A / Docker removal), 2b (security headers / rate limiting), and Track A (E2E crypto fixes) all landed after this date — none are in the changelog. | STALE | Medium (new 0.8.2 or 0.9.0 entry) |
| 22 | "Admin UI switched from adapter-static to adapter-node" — contradicted by today's admin audit §1.4 which shows current state is `adapter-static`. Either CHANGELOG 0.8.1 is describing a reversed direction, or there was a revert that wasn't logged. | DRIFT | Cheap |
| 25 | "Docker Compose JWT secret now requires .env (no hardcoded dev secret)" — Docker infrastructure was fully removed in Phase 2a, per commits on `main`. This line describes deprecated code. | STALE | Cheap |

---

## Section 7 — `docs/protocol/bastion-protocol-v0.5.0.md`

This is the _only_ standalone protocol spec. README §Documentation points here. Cloners wanting to implement a client read this.

### 7.1 Global drift

Per the file header (line 1): "v0.5.0 / March 2026 / Stable (Phase 1–5 complete, self-update system)". The file describes the protocol as of v0.5.0. Actual protocol version is 0.8.1. The doc itself is frozen in time.

### 7.2 Findings

| Line | Finding | Class |
|---|---|---|
| 104 | Envelope `version: string; // Protocol version ("0.5.0")` — current is 0.8.1 | STALE |
| 166 | "Password hashing (admin) | scrypt (N=16384, r=8, p=1)" — confirmed accurate per CLAUDE.md line 156 | WORKING |
| 221 | §5.1 JWT expiry 15 minutes — actual admin session JWT is **30 minutes** (admin audit §1.1). The _session_ JWT (human/AI) is still 15 min per getting-started.md line 119, but the spec doesn't distinguish them. | DRIFT |
| 261–267 | §5.3 "Admin Authentication — Primary: Client certificate (mTLS)" — current admin-auth (admin audit §1.3) uses scrypt + TOTP + session-JWT as primary; mTLS is optional (not the primary mode). | DRIFT |
| 347 | "defines 81 message types across fifteen categories" — actual 102 types, ~20 categories | STALE |
| 183–195 | KDF ratchet description — **does NOT mention the peek/commit fix** (commit `e647b9d`). A reference implementer reading this spec would rebuild the advance-before-verify bug that Track A fixed. | MISSING |
| — | **No Guardian message types documented** (guardian_alert, guardian_shutdown, guardian_status, guardian_status_request, guardian_clear). | STALE |
| — | **No Dream Cycle messages documented** (dream_cycle_request, dream_cycle_complete). | STALE |
| — | **No PLAINTEXT_TYPES set documented.** Critical for reference implementers — without this, they'd encrypt messages the relay expects in plaintext. | MISSING |

### 7.3 Action

Harry's plan: replace with v0.9.0 versioned spec sheet in Phase 4. **Do not patch v0.5.0**; mark it with a deprecation header pointing at either (a) the source of truth until v0.9.0 lands (message-types.ts + error-codes.ts), or (b) explicitly state "this spec is frozen at the v0.5.0 milestone and may not match runtime for v0.8.1+". Cheap bridge fix.

---

## Section 8 — `docs/architecture/decisions/`

### 8.1 Findings table

| File | Finding | Class | Cost |
|---|---|---|---|
| `README.md` | "No decisions recorded yet — directory created for future use." | WORKING (honest) + CROSS_REF_GAP |
| — | CONTRIBUTING.md §"Protocol Changes" line 153 requires an ADR for protocol changes. Protocol went from 0.5.0 → 0.8.1 without any ADR landing. The rule exists but was never exercised. Either the rule isn't real, or ADRs are missing. | MISSING | Expensive (retroactive ADRs) or Cheap (drop the rule) |

This is a governance gap, not a doc-against-code drift. Worth Harry's attention.

---

## Section 9 — `docs/guides/getting-started.md`

Known stale findings (§3.7 audit) plus full pass.

### 9.1 Findings table

| Line | Finding | Class | Cost |
|---|---|---|---|
| 37 | `git.glorktelligence.co.uk` URL — see global finding #1 | DRIFT | Cheap |
| 47 | "The build compiles TypeScript across all 8 packages" — actual 10 | STALE | Cheap |
| 71–82 | Per-file test-count table: `@bastion/protocol: 190 checks`, `@bastion/crypto: 134 checks`, `@bastion/relay: 288 checks`, `@bastion/relay (admin): 185 checks`, `@bastion/client-ai: 239 checks`, `@bastion/client-ai (files): 155 checks`, `@bastion/client-human: 272 checks`, `@bastion/client-human-mobile: 123 checks`, `@bastion/relay-admin-ui: 192 checks`, `Integration: 82 checks`, `File Transfer Integration: 105 checks`. Total claimed: these numbers sum to roughly 2,065 — way off the claimed 3,862 at line 84. And actual full run today shows different groupings (e.g. relay: 526, relay admin: 526, client-ai: many sub-files). This table is triple-stale. | STALE | Medium |
| 84 | "All 3,862 tests should pass" — actual 4,453 | STALE | Cheap |
| 160–164 | `BASTION_RELAY_PORT=9443; BASTION_RELAY_HOST=0.0.0.0` contradicts deployment.md which enforces localhost-only binding for admin, and contradicts the private-host guard in BastionRelay (see admin audit §1.1 for admin, and the relay's own private binding enforcement). Getting-started has the cloner running the relay with `host: '127.0.0.1'` — fine for dev — but `0.0.0.0` elsewhere. Minor inconsistency. | CLONER_UX | Cheap |
| 343–371 | §"Step 7: Explore the Admin Panel" — The `new AdminServer({...})` / `new AdminAuth({ accounts: [{ username, passwordHash: 'dev-hash', totpSecret: undefined }] })` constructor example likely won't run: `passwordHash: 'dev-hash'` is not a valid scrypt hash and will fail `verifyCredentials` (admin audit §1.3 shows scrypt N=16384 validation). A cloner trying this example gets a confusing login failure. | DRIFT | Medium (rewrite with setup-wizard flow, which is now the canonical path per deployment.md §6) |
| 394 | Project tree lists `tests/` as a package but doesn't list `adapter-template/` or `infrastructure/` | STALE | Cheap |
| 422–428 | "Port already in use — The relay defaults to port 9443. If it's occupied: `port: 9444`". Port 9444 is the admin port (getting-started line 363, deployment.md line 181, admin audit §1.1). Suggesting it as the relay alternative guarantees a collision if the admin is also configured. | CLONER_UX + DRIFT | Cheap |
| 444 | Link "[Protocol Specification](../protocol/bastion-protocol-v0.5.0.md) — Complete protocol reference with all 95 message types" — both the message count and the spec itself are stale (§7). | STALE + CROSS_REF_GAP | Cheap |

### 9.2 Cloner-path analysis

A cloner attempting to run Bastion locally via this guide:

- Clone step fails if they use the URL at line 37 (Gitea unreachable).
- Build succeeds.
- Tests pass — they see 4,453 not 3,862 and get confused about whether the table's per-file numbers are a goal or a lie.
- Relay startup works.
- AI client startup works.
- Admin Panel step (7) **fails** — `passwordHash: 'dev-hash'` doesn't pass scrypt verification.
- Troubleshooting step "use port 9444" collides with admin.

Verdict: cloners will hit at least 2-3 blockers following this guide. Not a total failure, but papercuts everywhere.

---

## Section 10 — `docs/guides/deployment.md`

Rewritten today for Option A (single-port admin). Overall much better than getting-started.md.

### 10.1 Findings table

| Line | Finding | Class | Cost |
|---|---|---|---|
| 157, 285 | `git.glorktelligence.co.uk` URL — global finding #1 | DRIFT | Cheap |
| 169 | `BASTION_RELAY_HOST=0.0.0.0` — relay binds publicly (intentional for production; VLAN firewall is the control). Correct for production, but inconsistent with getting-started §9.1 finding line 164. | WORKING in context | — |
| 360 | `BASTION_OPUS_MODEL=claude-opus-4-6` — matches code ✓ | WORKING | — |
| 458–465 | Firewall rules for VLAN 50 allow DNS (UDP 53) and HTTPS (443) but **do not mention NTP (UDP 123)**. This is the gotcha Harry hit today. Anything that does TLS validation or TOTP against external time will eventually fail. | MISSING | **Cheap — one line added to firewall rules + a troubleshooting entry.** HIGH impact on cloner sanity. |
| 531–568 | §6 Admin Dashboard — rewritten today for Option A (single port 9444, static SPA, no separate admin-ui process). Internally consistent. | WORKING | — |
| 666–681 | §CLI Management Tool — matches actual `bastion-cli.sh` command set (`status|update|restart|audit|migrate|doctor|install`) per my grep | WORKING | — |
| 683 | `deploy/systemd/` — confirmed only 2 files (no admin-ui). This section is post-Phase-2a-correct. | WORKING | — |
| 685 | Migration paragraph references "old multi-user architecture (bastion-ai, bastion-updater users)" — this is historical context, correct per CHANGELOG 0.8.1. | WORKING | — |
| 703–714 | §Troubleshooting — good coverage for common issues (EACCES bind, TLS unable to verify, firewall, SQLite locked). **No NTP/time-sync entry**. | MISSING | Cheap |
| — | **No link to admin-rate-limiting.md design doc** from §6. A deployment admin wondering what limits exist has no pointer. | CROSS_REF_GAP | Cheap |

---

## Section 11 — `docs/design/admin-rate-limiting.md`

Design doc for today's per-endpoint rate limiter. Well-scoped, clear goals/non-goals.

| Finding | Class |
|---|---|
| Content is internally consistent. | WORKING |
| **Not linked from SECURITY.md, deployment.md §6, or the admin audit's cross-references section.** A cloner or reviewer would find this only via `ls docs/design/`. | CROSS_REF_GAP |

No content findings. Recommend adding a "See also" entry in SECURITY.md §Admin Dashboard Access Model and deployment.md §6.

---

## Section 12 — `docs/audits/` (cross-reference check, not content audit)

Three audits from today: `admin-server-audit-2026-04-17.md`, `e2e-crypto-audit-2026-04-17.md`, `e2e-crypto-audit-2026-04-17-addendum.md`. Plus a pre-existing `AUDIT-FIXES-2026-04-05.md`.

| Finding | Class | Cost |
|---|---|---|
| Today's three audit reports are not linked from README, SECURITY.md, CLAUDE.md, or any guide. | CROSS_REF_GAP | Cheap |
| A cloner wanting the current state of crypto or admin would not discover these. A security researcher would file redundant reports. | CLONER_UX | Cheap |
| Suggest: SECURITY.md gets a §"Recent Audits" section linking these; CLAUDE.md "Fail Loud" section gets a "concrete evidence" link to the e2e-crypto addendum §3. | — | Cheap |

`AUDIT-FIXES-2026-04-05.md` also not linked anywhere.

---

## Section 13 — `docs/spec/bastion-supplementary-spec.md`

### 13.1 Global note

Front-matter: "Version: 0.5.0-supplement-1 / March 2026 / Stable". The doc documents decisions from the initial design review. Many decisions have evolved in later phases (Phase 2–5). CONTRIBUTING.md line 7 tells every new contributor to read this first.

### 13.2 Spot-check findings (not a full rewrite pass)

- Not audited line-by-line due to scope (631 lines) and the fact that it's flagged for replacement alongside the protocol spec.
- Recommend: add a deprecation banner at the top: "This document captures architectural decisions as of the v0.5.0 supplement. Decisions recorded here are binding unless superseded by an ADR in `docs/architecture/decisions/`. For current behaviour, see CLAUDE.md and the source of truth in `@bastion/protocol`."
- Classification: overall STALE; individual sections likely still accurate. Cheap bridge fix (one banner).

---

## Section 14 — `docs/spec/bastion-project-structure.md`

Similar vintage to supplementary-spec. Contains the original Phase 1–5 task breakdown.

### 14.1 Findings

| Line | Finding | Class | Cost |
|---|---|---|---|
| Header | "Protocol Version: 0.5.0" — actual 0.8.1 | STALE | Cheap |
| 312–314 | Lists `packages/infrastructure/docker/` with `docker-compose.yml` and `docker-compose.prod.yml` — both removed Phase 2a | STALE | Cheap |
| 276 | `relay-admin-ui` labeled "SvelteKit" — correct but predates adapter-static decision | WORKING | — |
| 475–482 | Phase 3 task table lists Phase 3.5-3.11 `relay-admin-ui` tasks — all complete per memory index, but status column here isn't updated. | STALE | Cheap |
| Header remote origin | `git.glorktelligence.co.uk` (Gitea) mentioned — Gitea is the internal primary; GitHub is a mirror. This doc is from before the GitHub mirror became the public face. | STALE | Cheap |

Overall this file is a historical development map, not a reference doc. Classify as reference-only; not worth line-by-line fixes, but the Docker listing at 312–314 is actively misleading.

---

## Section 15 — `docs/gui-concepts/*.jsx`

Two JSX concept files (`bastion-gui-concept.jsx`, `bastion-relay-admin-concept.jsx`). Design artefacts from the initial mockup phase. Not referenced from any production doc I grep'd. Safe to keep as archival material. No audit warranted.

---

## Section 16 — `docs/soul/Bastion — Soul Document v1.0.md`

Not part of this audit (referenced by CLAUDE.md as "three-layer soul document" at line 135). Covered by `packages/client-ai/src/provider/conversation-manager.ts` per CLAUDE.md. Not audited.

---

## Section 17 — `packages/**/*.md`

| File | Finding | Class |
|---|---|---|
| `packages/adapter-template/README.md` | Not opened — treat as package-local docs. Cloner discovers via directory navigation. | Not audited |
| `packages/tests/AUDIT-REPORT-2026-04-04.md` | Historical audit from April 4th. Not cross-linked from current docs. | CROSS_REF_GAP (minor) |
| `packages/tests/EXTENSION-AUDIT-2026-04-04.md` | Same. | CROSS_REF_GAP (minor) |
| `packages/{client-ai,client-human,protocol,relay,relay-admin-ui}/PIXEL-AUDIT.md` | All 5 from a previous `/audit pixel` run (untracked per git status). Not linked from anywhere. | CROSS_REF_GAP (minor) — these are working notes, not release docs; fine untracked |

---

## Cloner-Experience-Specific Recommendations

These are separate from the DRIFT/STALE/MISSING findings above. They are about whether someone git-cloning today can succeed.

### Question A — Can someone clone and deploy using only the README?

**Yes, if they follow the Quick Start to the letter** (lines 170–207). Failure modes:

- They click through to `docs/guides/getting-started.md` line 37 or `docs/guides/deployment.md` line 157 and use the `git.glorktelligence.co.uk` URL — **fail**.
- They run the admin example in getting-started §3.7 — **fail** (passwordHash: 'dev-hash').
- They follow troubleshooting advice to change the relay port to 9444 — **fail** (admin collision).
- They bring up an AI VM with no NTP — works for a while, then **fails silently** when TLS/TOTP clock skew kicks in.

**Recommendation:** Make README the unambiguously-canonical path. Add a banner to getting-started.md and deployment.md: "For the supported deployment path, use the `bastion-cli.sh` install flow from the README. This guide is for understanding the architecture."

### Question B — When things go wrong, do docs point somewhere?

Partial. Deployment.md §Troubleshooting is good but missing NTP. SECURITY.md has no "when to reach out" for non-vuln support questions. No runbook for "relay won't start" beyond the bind-port issue. Cloner falls back to reading audit reports (undiscoverable) or source code.

### Question C — Are the gotchas Harry hit today documented?

- **UDP 123 / NTP**: NO. Still lurking. High priority.
- **Stale cipher on reconnect**: NO in user docs; YES in today's crypto audit addendum (undiscoverable to a cloner). Now mitigated in code.
- **Admin setup wizard vs. hardcoded password hash**: PARTIAL. deployment.md §6 line 564 mentions the wizard; getting-started.md line 343 still shows the hardcoded-password example.

### Question D — Does crypto documentation reflect post-Track-A reality?

**No.** SECURITY.md §E2E Encryption Implementation (line 146–154) describes the crypto stack at a level that is still correct, but says nothing about:

- The peek/commit `SessionCipher` API (commit `e647b9d`, `52c91ee`)
- PLAINTEXT_TYPES gate in `tryDecrypt` (commit `e647b9d`, `19973e0`)
- Fail-loud behaviour on decrypt failure (commit `e647b9d`)
- Stale cipher reset on `peer_status=active` and `disconnected` (commit `68fc517`)
- Human-side encrypted-message queue (commit `f652a9b`, Fix B from addendum)

**README §E2E Encryption** (line 260–262) is the worst offender — still calls it a "Double Ratchet", which is the Signal term for per-message DH, which Bastion _explicitly doesn't have_ (SECURITY.md line 159 known limitation).

**Protocol spec v0.5.0 §4** — most stale; see §7 above.

### Question E — Are today's audit reports discoverable?

**No.** Zero inbound links from any doc. The only way a cloner or security reviewer finds them is `ls docs/audits/` or directory browsing on GitHub. Recommend: add a "Recent Audits" section to SECURITY.md with one line per report + date + link. Cheap.

---

## Priority Ranking for the Next Fix Pass

**Cheap wins (under 30 minutes total):**

1. Global find/replace `git.glorktelligence.co.uk` → `github.com/Glorktelligence` (or clarify which is primary)
2. Global find/replace stale test counts (3,897, 3,862) → `<current>` or link to `README#run-tests`
3. Global find/replace "95 message types" → 102
4. Global find/replace "48 error codes across 8 categories" → 57 / 9
5. README line 304 "Double Ratchet" → "KDF ratchet chain" (align with CLAUDE.md/SECURITY.md)
6. README line 273 — strike "admin UI" from systemd templates sentence
7. SECURITY.md Supported Versions table — add 0.8.x
8. Add NTP (UDP 123) to deployment.md VLAN 50 firewall rules + troubleshooting
9. Add "Recent Audits" section to SECURITY.md with 3 new audit links
10. Add deprecation banners to `bastion-protocol-v0.5.0.md` and `bastion-supplementary-spec.md`
11. getting-started.md port-9444 troubleshooting — change the example to 9445

**Medium fixes (this session or next):**

12. Rewrite SECURITY.md §"Admin Dashboard Access Model" (lines 100–108) against Option A + session JWT reality
13. Rewrite README §E2E Encryption (line 260–262) to include Track A fixes
14. Update CLAUDE.md §"Six Sole Authorities" → Seven (add BastionGuardian)
15. Rewrite getting-started.md §3.7 Admin Panel step against setup-wizard flow
16. Add CHANGELOG entry for Phase 2a + Phase 2b + Track A
17. CLAUDE.md §"Fail Loud" — cross-link to e2e-crypto audit addendum §3 for evidence

**Expensive (Phase 4):**

18. Replace `bastion-protocol-v0.5.0.md` with `bastion-protocol-v0.9.0.md` — Harry's stated plan
19. Retroactive ADRs for Phases 2–5, or delete the ADR requirement from CONTRIBUTING
20. Rewrite `bastion-supplementary-spec.md` or retire it

---

## What's Working

For completeness, doc surfaces that are accurate today:

- README §Six Sole Authorities (lines 99–106) — content accurate (modulo Guardian count)
- README §Current Capabilities table — spot-checked a dozen rows against CHANGELOG and code; all deployed as claimed
- CLAUDE.md Apache header requirement — matches every source file spot-checked
- CONTRIBUTING.md security-sensitive cooling-off process — policy, not code-dependent
- SECURITY.md §Streaming Security — accurate
- SECURITY.md §Provider Registration Attack Surface — accurate
- SECURITY.md §5 Immutable Boundaries — names and summaries match hardcoded constants
- deployment.md §6 post-rewrite — internally consistent with Option A
- deployment.md §Cryptography Notes — accurate (modulo not mentioning Track A)
- CODE_OF_CONDUCT.md — no drift
- admin-rate-limiting.md — internally consistent
- Today's three audits themselves — their own internal consistency was not re-verified in this audit; the admin audit reports 4,225 as its baseline, mine reports 4,453 (test count grew after more commits landed today; not a doc drift, just a timeline artefact)

---

**End of audit.** 4,453/4,453 tests remain passing. No code or docs were modified.

<!-- buddy: *scratches chin* forty-plus findings and not one emoji slipped into the docs — small mercies -->
