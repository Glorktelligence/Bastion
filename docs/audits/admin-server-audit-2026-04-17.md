# Admin Server Stack — End-to-End Audit (2026-04-17)

**Auditor:** Claude Opus 4.7 (via /audit skill, audit-only pass)
**Scope:** Admin API server, admin UI, startup scripts, proxy residue, single-port (Option A) architecture alignment
**Baseline:** `pnpm test` → **4,225 / 4,225 passing** across 14 test files (admin-trace-test.mjs: 402 passing, relay-admin-ui trace-test.mjs: 340 passing)
**Git state at audit:** branch `main`, HEAD `d3b62fd`, 5 untracked PIXEL-AUDIT.md files (unrelated), `.claude/settings.local.json` modified.

---

## Executive Summary

Bastion has **two overlapping admin-server architectures in the tree simultaneously**:

- **Option A — ACTIVE & PRIMARY.** `AdminServer` (packages/relay/src/admin/admin-server.ts) serves both the REST API *and* the static admin UI from port **9444** when a `staticDir` is supplied. `start-relay.mjs` resolves `packages/relay-admin-ui/build/` and wires it as `staticDir`. `svelte.config.js` uses `@sveltejs/adapter-static` (SPA build with `fallback: 'index.html'`, `ssr = false`, `prerender = true`). This is fully functional, covered by 402 admin tests, and is the architecture the codebase has converged on.

- **Proxy approach — DEPRECATED RESIDUE.** A parallel stack still exists that assumes the UI is served by a separate Node HTTP server on port **9445** which proxies `/api/*` to 9444. Artefacts: `start-admin-ui.mjs`, two divergent `bastion-admin-ui.service` systemd units (one of them **broken** — it points at `build/index.js`, which adapter-static never produces), the corresponding systemd generator/installer logic in `scripts/bastion-cli.sh`, the doctor port-9445 check, the Docker admin-ui service running `pnpm dev` on port 5174, and the deployment guide describing the two-tunnel setup.

**Recommendation (Harry to confirm):** remove the proxy-era residue wholesale; keep the Vite dev-server config (`vite.config.ts` proxy) because it is a legitimate developer-workflow tool, distinct from the deprecated production-time UI server.

No code has been modified. No tests were broken. This is a read-only audit.

---

## Method

1. Ran full test suite for baseline (4,225/4,225 passing).
2. Enumerated all admin-server artefacts (grep for `9444`, `9445`, `admin-ui`, `start-admin`, `adapter-node`, `staticDir`).
3. Read `admin-server.ts`, `admin-routes.ts`, `admin-auth.ts`, `start-admin-ui.mjs`, `svelte.config.js`, `vite.config.ts`, `start-relay.mjs` (admin block), both systemd unit copies, `bastion-cli.sh` service-install sections, `docker-compose.yml`, `admin-ui.Dockerfile`, and all doc references.
4. Cross-referenced every artefact against the Option A single-port architecture.

---

## Section 1 — WORKING (keep as-is)

### 1.1 Admin API server — `packages/relay/src/admin/admin-server.ts`

| Concern | State | Evidence |
|---|---|---|
| Single-port API + static UI (Option A) | IMPLEMENTED | admin-server.ts:549–566 — `/api/*` paths route to handlers; non-API paths served as static when `staticAvailable` |
| Binding enforcement (127.0.0.1 / private only) | ENFORCED (twice) | admin-server.ts:164–175 (constructor guard with `security_violation` audit + throw), and admin-server.ts:231–249 (post-listen address re-verification with audit + shutdown) |
| Wildcard rejection set | CORRECT | admin-server.ts:38 — `0.0.0.0`, `::`, `0:0:0:0:0:0:0:0`, `*` |
| Private-host allowlist | RFC1918 + loopback + link-local | admin-server.ts:46–59 |
| TLS via HTTPS | REQUIRED | admin-server.ts:26, 210–217 — `createHttpsServer`; optional client-cert request via `requestCert: !!tls.ca` |
| SPA fallback for client-side routing | WORKING | admin-server.ts:510–513 — extensionless paths, missing files, and directories all resolve to `index.html` |
| Directory-traversal guard (static) | WORKING | admin-server.ts:500–508 — `normalize` + absolute-path containment check |
| Static cache policy | CORRECT | admin-server.ts:527 — `no-cache` for `.html`, `public, max-age=31536000, immutable` for hashed assets |
| Session JWT (HS256) | WORKING | admin-server.ts:285–315 — 30-min default, jti tracking, revocation set on logout/refresh |
| Per-account lockout (rate limiting at auth) | WORKING | admin-auth.ts:98–103, 231–326 — 5 attempts / 15 min → 1 h lockout; maps to BASTION-2006 |
| Setup wizard / first-time flow | WORKING | admin-server.ts:360–407 — checks configured state, enforces TOTP + password strength (≥12, upper/lower/digit) |
| CORS localhost-only | WORKING | admin-server.ts:538–547 — echoes origin only when it matches localhost/127.0.0.1 |
| Audit events on auth outcome | WIRED | admin-server.ts:430–438, 471–475 — `auth_success`, `auth_token_refresh`, `logAuthFailure`, `admin_setup`, `security_violation` |

### 1.2 Admin routes — `packages/relay/src/admin/admin-routes.ts`

All endpoints route through authenticated `handleRequest` (admin-routes.ts:718). Covered surface:

- `GET /api/health`, `/api/status`, `/api/connections`
- `GET|POST /api/providers`, `GET|PUT /api/providers/:id/{revoke,activate,capabilities}`
- `GET /api/audit`, `/api/audit/integrity`
- `GET /api/tools`, `/api/extensions`, `/api/extensions/:ns`
- `GET|PUT /api/disclosure`
- `GET|PUT /api/challenge` (with active-hours guard at admin-routes.ts:849 — Challenge Me More temporal lock enforced server-side)

### 1.3 Admin auth — `packages/relay/src/admin/admin-auth.ts`

scrypt N=16384, TOTP (RFC 6238 ±1 step window), lockout ledger. All behaviour covered by `admin-trace-test.mjs`.

### 1.4 Relay-admin-ui build — `packages/relay-admin-ui/`

| Artefact | State | Evidence |
|---|---|---|
| Adapter | `@sveltejs/adapter-static` | svelte.config.js:1,6; package.json:30 |
| SPA shell | emitted | build/index.html + build/_app/{env.js,version.json,immutable/} |
| SSR disabled on root layout | YES | src/routes/+layout.ts:4 — `export const ssr = false` |
| Prerender for SPA shell | YES | src/routes/+layout.ts:5 — `export const prerender = true` |
| Server-side Svelte endpoints | NONE FOUND | grep for `+page.server`, `+server.`, `+layout.server` → 0 matches |
| adapter-node / adapter-auto residue | NONE | grep for `adapter-node|@sveltejs/adapter-node` → 0 matches |
| Runtime deps | `@bastion/protocol` only (type-only) | package.json:27 |

### 1.5 Vite dev server — `packages/relay-admin-ui/vite.config.ts`

Kept as a developer-workflow tool: `pnpm --filter @bastion/relay-admin-ui dev` runs Vite on 9445 with `/api → https://127.0.0.1:9444` proxy. This is **distinct** from the deprecated production UI server; it is the standard SvelteKit dev loop and only runs when a developer explicitly launches it. The port collision with the old production UI server is a naming artefact but causes no runtime conflict.

### 1.6 Startup wiring — `start-relay.mjs`

| Line(s) | Role |
|---|---|
| 10 | imports `AdminServer` |
| 106 | `ADMIN_PORT = BASTION_ADMIN_PORT || 9444` |
| 453–475 | credential load / env-var fallback / empty-auth setup-wizard path |
| 664–675 | `BASTION_ADMIN_HOST` defaulted to `127.0.0.1`, private-host guard, audit + `process.exit(1)` on public |
| 677–685 | `ADMIN_UI_BUILD_DIR` resolution — checks both `build/` and `build/client/` |
| 687–705 | `new AdminServer({ staticDir: ADMIN_UI_BUILD_DIR, … })` + log line reporting served/API-only mode |
| 2040 | `await adminServer.start()` |

This is the Option A wiring and it is complete.

### 1.7 Infrastructure artefacts that align with Option A

- `packages/infrastructure/systemd/bastion-relay.service:38–39` — `BASTION_ADMIN_PORT=9444`, `BASTION_ADMIN_HOST=127.0.0.1`.
- `packages/infrastructure/setup/setup-bastion.sh:806–807` — matching env defaults in generated `.env`.
- `packages/infrastructure/proxmox/firewall-rules.conf:38–46` — only port 9444 is exposed for admin; no 9445 rule.
- `packages/infrastructure/docker/docker-compose.yml:24–25` — only `9444` is forwarded from the relay container.

---

## Section 2 — DEPRECATED (recommend removal)

> **No files have been touched.** Each item below is flagged for Harry's review with exact paths and the reason it no longer fits Option A.

### 2.1 Standalone UI server — `start-admin-ui.mjs` (repo root)

A 204-line Node HTTP server that serves `packages/relay-admin-ui/build/` on `127.0.0.1:9445` and proxies `/api/*` to `https://127.0.0.1:9444`. Functionally subsumed by `AdminServer.serveStaticFile` (admin-server.ts:493). Not referenced by `start-relay.mjs` or any test. Only live references are in the deprecated systemd unit (2.2) and deployment docs (2.5).

### 2.2 Systemd unit — `deploy/systemd/bastion-admin-ui.service`

**BROKEN.** `ExecStart=/usr/bin/node /opt/bastion/packages/relay-admin-ui/build/index.js` (line 18) targets an adapter-node artefact that adapter-static does not produce. If any operator followed the install comments at the top of this file, the service would fail to start. Also sets `PORT=9445` / `ORIGIN=http://127.0.0.1:9445` which are adapter-node env knobs — adapter-static has no runtime and no environment.

### 2.3 Systemd unit — `packages/infrastructure/systemd/bastion-admin-ui.service`

Divergent copy of 2.2. Runs `start-admin-ui.mjs` (2.1) rather than the broken `build/index.js`. Would actually *work* if installed — but serves port 9445 redundantly when `AdminServer` already serves the UI on 9444. Requires a second SSH tunnel.

### 2.4 CLI systemd installer — `scripts/bastion-cli.sh`

| Lines | Issue |
|---|---|
| 394–422 | `install_systemd_relay()` writes a `bastion-admin-ui.service` with `ExecStart=/usr/bin/node /opt/bastion/packages/relay-admin-ui/build/index.js` — same broken path as 2.2 |
| 429 | `systemctl enable bastion-relay bastion-admin-ui` — enables the (broken) unit on every fresh install |
| 532–562 | `generate_service_template bastion-admin-ui` — emits the same broken template for the drift-detection updater |
| 1196 | doctor-loop iterates `bastion-admin-ui` → reports "not active" on every install, because the unit is broken |
| 1240–1252 | doctor check for port 9445 (admin UI) — no longer a port Bastion should bind |
| 786–789, 1398–1401, 1504–1507 | build-admin-ui commands — still valid (we do need to build the SPA), **keep the build step**, drop only the systemd wiring |
| 41 | `SVC_ADMIN="bastion-admin-ui"` — no longer needed if the unit goes away |

### 2.5 Deployment documentation — `docs/guides/deployment.md`

Lines 539–609: the entire "Admin UI" section describes building the SPA, installing `bastion-admin-ui.service`, `ExecStart=/usr/bin/node /opt/bastion/start-admin-ui.mjs`, `BASTION_ADMIN_UI_PORT=9445`, two-port SSH tunnel (`-L 9445:127.0.0.1:9445 -L 9444:127.0.0.1:9444`), and the commentary that the admin UI server proxies self-signed certs. All of this is the deprecated two-port model. Under Option A the only user-facing tunnel is `ssh -L 9444:127.0.0.1:9444`.

### 2.6 Getting-started documentation — `docs/guides/getting-started.md`

Lines 363–371 describe running a separate admin panel at `port: 9444` with `console.log('Admin panel at https://localhost:9444')`. The port is correct, but the "separate server" framing is a holdover — worth rewriting to reflect that the admin UI is served by the relay's admin server, not a separate process. Low priority; content, not code.

### 2.7 Docker admin-ui service — `packages/infrastructure/docker/admin-ui.Dockerfile` + `docker-compose.yml:78–93`

The `admin-ui` service runs `pnpm dev --host 0.0.0.0 --port 5174` (Dockerfile line 61) — i.e. Vite's **dev server**, inside a container. This is not a production admin-UI delivery; it is arguably useful for a local dev stack, but it is not consistent with Option A and it duplicates what the relay container already serves on 9444 once the SPA is built. Recommend deletion; dev stacks that want a live-reloading UI can run `pnpm --filter @bastion/relay-admin-ui dev` on the host.

### 2.8 Docker relay environment — `packages/infrastructure/docker/docker-compose.yml:33`

`BASTION_ADMIN_HOST: "0.0.0.0"` with the comment *"Accessible within Docker network"*. The constructor-time private-host guard (admin-server.ts:47–59) actually allows `0.0.0.0`? **No** — `WILDCARD_BIND_ADDRESSES.has('0.0.0.0')` returns true, so `isPrivateHost('0.0.0.0') === false` and `AdminServer` will *throw* `AdminServerError` at startup. The docker-compose stack in its current shape will fail to start the admin server. This is either a latent bug or a sign this compose file has not been exercised since the binding guard was added. Flagging as **deprecated + broken**; easiest fix is `127.0.0.1` and drop the port mapping, since the admin UI is only for operators and should be reached via `docker exec` / SSH tunnel, not the Docker bridge.

---

## Section 3 — UNCERTAIN (Harry to decide)

### 3.1 Keep `vite.config.ts` proxy to `:9444`?

`packages/relay-admin-ui/vite.config.ts:21–32` configures `pnpm dev` to proxy `/api → https://127.0.0.1:9444`. This is a **developer convenience** and does not participate in any production path. Recommended: **keep**. Only reason to drop it is if the developer workflow changes to using the already-served SPA at `https://127.0.0.1:9444` (which requires a production build on every change — not viable for UI iteration).

### 3.2 Missing HTTP response hardening headers on the admin server

The deprecated `start-admin-ui.mjs` explicitly set `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` (start-admin-ui.mjs:160–164). `AdminServer.serveStaticFile` (admin-server.ts:524–529) does not. No CSP anywhere. Given the admin panel is localhost + bearer-token authenticated, the blast radius is small, but these are one-line adds that cost nothing. **Decision needed:** add them to `AdminServer` as part of the cleanup, or leave out of scope.

### 3.3 Per-endpoint request rate limiting

Lockout exists on `POST /api/admin/login` (via `AdminAuth`). There is **no rate limiting on other endpoints** — a privileged-token holder could hammer `/api/audit`, `/api/providers`, etc. The relay's `MessageRouter` has rate limiting (message-router.ts:124–163) but that is for WebSocket traffic, not the admin HTTP path. Low likelihood of abuse (authenticated admin, localhost) but not zero. **Decision needed:** introduce lightweight per-token rate limiting, or accept the current posture and document it.

### 3.4 CSRF tokens

None. `packages/relay/PIXEL-AUDIT.md:495` already records this as a low-severity item ("Mitigated by token-based auth (not cookie-based) and localhost binding"). The `Authorization: Bearer <jwt>` model means a cross-site request cannot carry the credential. **Decision needed:** none — the existing mitigation holds. Flagged only so the trail is visible in this audit.

### 3.5 `scripts/bastion-cli.sh` line 41 `SVC_ADMIN`

If the `bastion-admin-ui` unit is removed, this variable and every branch that enumerates over `$SVC_ADMIN` should go. That cascade is non-trivial (doctor loop, status command, restart command, update command). **Decision needed:** accept the CLI-wide touch when the removal lands, or keep `SVC_ADMIN` temporarily as a no-op.

### 3.6 Docker compose — repurpose or delete?

If 2.7 + 2.8 are both removed, there is no admin-UI-specific service left in the compose file. That is the correct end state for Option A (the relay container already serves the UI on 9444). **Decision needed:** delete the `admin-ui` service cleanly, or keep a stub for developer convenience on the Docker bridge.

### 3.7 `docs/guides/getting-started.md:79` test-count line

`@bastion/relay-admin-ui: 192 checks passed` — stale baseline vs. current 340. Not an admin-server issue per se but worth refreshing in the same pass if docs are touched.

---

## Appendix A — Full file inventory

**Option A implementation (keep):**
- packages/relay/src/admin/admin-server.ts
- packages/relay/src/admin/admin-routes.ts
- packages/relay/src/admin/admin-auth.ts
- packages/relay/admin-trace-test.mjs
- packages/relay-admin-ui/svelte.config.js
- packages/relay-admin-ui/vite.config.ts (dev workflow only)
- packages/relay-admin-ui/src/**
- packages/relay-admin-ui/build/**
- packages/relay-admin-ui/trace-test.mjs
- packages/infrastructure/systemd/bastion-relay.service (sets ADMIN_PORT/ADMIN_HOST)
- packages/infrastructure/setup/setup-bastion.sh (emits ADMIN_PORT/ADMIN_HOST)
- packages/infrastructure/proxmox/firewall-rules.conf
- start-relay.mjs (admin wiring block)

**Proxy-era residue (recommend remove):**
- start-admin-ui.mjs
- deploy/systemd/bastion-admin-ui.service
- packages/infrastructure/systemd/bastion-admin-ui.service
- scripts/bastion-cli.sh — admin-ui systemd install / template / enable / doctor-9445 blocks (lines 41, 394–422, 429, 532–562, 1196, 1240–1252)
- docs/guides/deployment.md — admin-UI section (lines 539–609)
- packages/infrastructure/docker/admin-ui.Dockerfile
- packages/infrastructure/docker/docker-compose.yml — `admin-ui:` service (lines 78–93) + `BASTION_ADMIN_HOST: "0.0.0.0"` on relay (line 33)

**Documentation polish (low priority):**
- docs/guides/getting-started.md — lines 79, 363–371, 426

---

## Appendix B — Test baseline (for post-cleanup diff)

```
Total: 4225 tests — 4225 passed, 0 failed
Files: 14 discovered, 0 failed
```

Relevant test files:
- `packages/relay/admin-trace-test.mjs` — 402 passed (covers static-dir serving, hasStaticUi, missing-dir fallback)
- `packages/relay-admin-ui/trace-test.mjs` — 340 passed
- `packages/relay/trace-test.mjs` — 526 passed

Any removal of the items in Section 2 should leave this baseline unchanged.

---

*Audit complete. No files modified. Awaiting decision on the UNCERTAIN section before any removal work begins.*
