# Admin Server — Per-Endpoint Rate Limiting

**Status:** APPROVED 2026-04-17 — implementation proceeding in three commits (headers → limiter → audit wiring)
**Author:** Claude Opus 4.7 (with Harry)
**Scope:** `packages/relay/src/admin/*` only. The WebSocket relay already has per-client rate limiting in `packages/relay/src/routing/rate-limiter.ts` — this is distinct and targets the HTTPS admin API.
**Context:** Admin-server audit 2026-04-17 Section 3.3 flagged that `AdminAuth` rate-limits `/api/admin/login` only. Every other endpoint is unthrottled once a session JWT exists. This design closes that gap.
**Related:** `docs/audits/admin-server-audit-2026-04-17.md`

---

## Goals

1. Prevent a privileged session token from hammering any single endpoint (deliberate abuse, client bug, compromised tunnel endpoint).
2. Prevent pre-authentication `/api/admin/setup` spray before any account exists.
3. Leave `/api/admin/login` and `/api/admin/refresh` to `AdminAuth`'s existing per-account lockout — it is tighter (5 attempts / 15 min → 1 h lock) and duplicating adds noise without new protection.
4. Emit a generic `limit_reached` audit event so detection tooling does not learn its name from event traffic.
5. Stay in-memory, bounded, and testable with an injected clock.

---

## Non-Goals

- Distributed rate limiting across multiple relay instances — Bastion runs one relay per deployment.
- Rate limiting by user-agent, geo, or any signal outside session identity / remote address.
- Dynamic limit tuning from the admin UI. Limits are compile-time constants in this iteration.
- Protection against a session that exhausts, refreshes, then exhausts again — `AdminAuth.verifyCredentials` already gates the refresh with account lockout, and a compromised session cannot refresh without also presenting valid TOTP.

---

## Mechanism — Token Bucket

Continuous refill. Per key per class.

```
capacity  = classLimitPerMin             // e.g. 120 for read
refillRate = classLimitPerMin / 60       // tokens per second
```

On each authenticated request:

1. Classify the endpoint (see table below). If unclassified (shouldn't happen for admin routes), deny-by-default — do **not** silently bypass the limiter.
2. Resolve the key (jti for authed routes, remote IP for `/api/admin/setup`).
3. Look up (or lazily create) the `(class, key)` bucket.
4. `refill(now - bucket.lastRefill)` — add `elapsed * refillRate` tokens, capped at `capacity`. Set `lastRefill = now`.
5. If `tokens >= 1`: decrement, return `allowed`.
6. Else: compute `retryAfterSec = ceil((1 - tokens) / refillRate)`, return `{ denied, retryAfterSec }`.

**Why token bucket over the existing sliding-window log in `routing/rate-limiter.ts`:**

- Sliding-window log stores every timestamp (O(N) per window). A compromised session making ~120 req/min costs 120 array entries per minute; manageable but wasteful when all we need is "am I over budget right now".
- Token bucket is O(1) per check, two numbers per bucket (`tokens`, `lastRefill`), and naturally yields `retryAfterSec` for the `Retry-After` header.
- Burst behaviour is also better for the admin UI: the dashboard may poll `/api/status` rapidly on load then idle — token bucket allows that naturally; sliding-window log rejects the second half of the burst.

---

## Endpoint Classes

Three classes. Every classifiable path maps to exactly one class — the default-deny posture here means we do not create a silent bypass class "accidentally classified but unregistered." An unclassified path is **not** rate-limited; it falls through to the route handler, which returns 404 as normal (the route table is the authority on what endpoints exist). The limiter's responsibility is bounded: if we know the path, we cap it; if we do not, we stay out of the way.

### `read` — **120 req/min**

Read-only observability. Dashboard polling dominates. Generous limit because the admin UI polls some of these on a tight interval.

| Method | Path |
|---|---|
| GET | `/api/health` |
| GET | `/api/status` |
| GET | `/api/connections` |
| GET | `/api/audit` |
| GET | `/api/audit/integrity` |
| GET | `/api/providers` |
| GET | `/api/providers/:id` |
| GET | `/api/providers/:id/capabilities` |
| GET | `/api/tools` |
| GET | `/api/extensions` |
| GET | `/api/extensions/:ns` |
| GET | `/api/disclosure` |
| GET | `/api/challenge` |

### `write` — **20 req/min**

State-changing operations. A human operator clicking buttons does not come close to 20/min; the ceiling is there to contain automation gone wrong.

| Method | Path |
|---|---|
| POST | `/api/providers` |
| PUT | `/api/providers/:id/revoke` |
| PUT | `/api/providers/:id/activate` |
| PUT | `/api/providers/:id/capabilities` |
| PUT | `/api/disclosure` |
| PUT | `/api/challenge` |

### `setup` — **10 req/min**

Pre-authentication. Only one endpoint in this class; keyed by remote IP, not jti (no session exists yet).

| Method | Path |
|---|---|
| POST | `/api/admin/setup` |

---

## Unrestricted Endpoints (deliberately)

| Path | Why no limiter |
|---|---|
| `POST /api/admin/login` | `AdminAuth` already enforces 5 attempts / 15 min → 1 h account lockout — strictly tighter than 10/min. |
| `POST /api/admin/refresh` | Requires a valid session JWT; issuing a new one revokes the old. Not an attack surface. |
| `POST /api/admin/logout` | Idempotent, session-ending, zero-load. |
| `GET /api/admin/status` | Returns only `{ configured, requiresSetup }` — public by design (the SPA needs to know whether to show the setup wizard before any login). Exposing this to polling is fine. |
| `OPTIONS /*` | CORS preflight — browser-generated, must always succeed. |

If Harry later wants `GET /api/admin/status` throttled, add it to `read` — trivial one-liner.

---

## Key Derivation

```typescript
function resolveKey(class: 'read' | 'write' | 'setup', req, session): string {
  if (class === 'setup') return `ip:${req.socket.remoteAddress ?? 'unknown'}`;
  return `jti:${session.jti}`;
}
```

- Authenticated classes key on `jti`. A refresh issues a new jti (and revokes the old), so the new token starts with a full bucket — but the old jti is revoked, so it cannot be used to bypass. Net effect: refresh *does* reset the budget, but a compromised token cannot refresh without TOTP, so this is not a bypass. **Known behaviour**, documented here rather than fixed, because the current admin model has a single account per deployment. When auth v1.0 introduces multiple admin users, re-key on `sub` (username) so refreshes stop resetting the budget — see `Future Work` below.
- `setup` keys on remote address. On the relay VM this will usually be `127.0.0.1` (SSH tunnel) — so in practice a single shared bucket across all tunnel clients, which is the correct behaviour for a localhost-only setup endpoint.
- If `remoteAddress` is missing (degraded socket), key becomes `ip:unknown` — still bucketed, still bounded.

---

## Memory Management

```
type Bucket = { tokens: number; lastRefill: number; class: Class; key: string }
type Store  = Map<string, Bucket>       // key format: "class:key"
```

**Eviction:** on each `check()`, after refill, if `bucket.tokens >= capacity` AND `now - bucket.lastRefill > 300_000` (5 minutes idle-at-full), delete the bucket. Lazily collected — no background timer.

**Cap:** if `store.size > 1_000`, refuse new bucket creation and log a single `limit_reached` audit event with `scope: 'bucket_store_overflow'`. A localhost admin panel has one operator and at most a handful of concurrent sessions; 1k is already three orders of magnitude more than realistic. Lower cap = earlier signal if something is rotating keys.

---

## 429 Response

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 5

{
  "error": "Too many requests",
  "reason": "quota_exhausted",
  "retryAfterSec": 5
}
```

- `Retry-After` in seconds (integer, RFC 7231 compliant).
- Body `retryAfterSec` mirrors the header for client convenience.
- The word "rate" does not appear in the response body or audit event on purpose.

---

## Audit Event — `limit_reached`

**New audit event type, registered in `AUDIT_EVENT_TYPES`:**

```typescript
LIMIT_REACHED: 'limit_reached',
```

Severity: `warning`. Description: `"Request exceeded a configured limit"`.

**Payload schema:**

```typescript
{
  key: string,              // "jti:…" or "ip:…" — no username, no token content
  scope: string,            // "read" | "write" | "setup" | "bucket_store_overflow"
  path: string,             // exact URL path (of the request that fired the event)
  method: string,           // "GET" / "POST" / "PUT" / "DELETE"
  denialCount: number,      // denials in this aggregation window (≥1)
  retryAfterSec?: number,   // retryAfterSec of the request that fired the event; omitted for bucket_store_overflow
}
```

**Emission policy — first-denial-immediate + 1/min debounce per bucket:**

Sustained breaches would otherwise flood the audit chain: a session pinned at 121 req/min against a 120/min cap produces ~60 denials/min, and an attacker-driven loop could push 7,200+ low-signal events/hour. That noise risks masking other activity and bloating the SQLite audit store.

Rules:

1. Each `(class, key)` bucket holds a `lastEmittedAt` timestamp and a `pendingDenials` counter.
2. On a denial:
   - If `lastEmittedAt === null` (first denial ever, or first after a quiet window) — emit immediately with `denialCount: 1`, set `lastEmittedAt = now`, reset `pendingDenials = 0`.
   - Otherwise if `now - lastEmittedAt >= 60_000` — emit with `denialCount: pendingDenials + 1`, set `lastEmittedAt = now`, reset `pendingDenials = 0`.
   - Otherwise — increment `pendingDenials`, emit nothing.
3. When a bucket is evicted (idle-at-full for 5 min, per Memory Management above), drop any `pendingDenials` — the storm is over, no final flush. This is deliberate: a flush on eviction re-creates the flooding we are trying to avoid if the eviction sweeps many buckets together.
4. `bucket_store_overflow` uses a separate global cooldown (same 60 s debounce on a single synthetic bucket) so an attacker rotating thousands of keys does not flood on overflow either.

Net effect: every distinct attack or runaway client produces one audit event within <1 s of the first denial, plus one event per minute thereafter summarising the aggregate. Generic event-type name (`limit_reached`) plus generic payload fields (`key`, `scope`, not `client`, `class`) remain deliberate — the event stream does not tell a reader what was limited; downstream tooling that cares correlates by `path` and `scope`.

---

## API Surface

New file: `packages/relay/src/admin/admin-rate-limiter.ts`

```typescript
export type AdminRateLimitClass = 'read' | 'write' | 'setup';

export interface AdminRateLimiterConfig {
  readonly readPerMin?: number;      // default 120
  readonly writePerMin?: number;     // default 20
  readonly setupPerMin?: number;     // default 10
  readonly now?: () => number;       // injectable for tests; defaults to Date.now
  readonly maxBuckets?: number;      // default 1_000
  readonly auditLogger?: AuditLogger;
}

export interface AdminRateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSec: number;    // 0 when allowed
}

export class AdminRateLimiter {
  constructor(config?: AdminRateLimiterConfig);
  classify(method: string, path: string): AdminRateLimitClass | null;
  check(cls: AdminRateLimitClass, key: string, path: string, method: string): AdminRateLimitDecision;
  reset(): void;                      // tests only
  get bucketCount(): number;          // tests only
}
```

**Wiring in `AdminServer.handleRequest`:**

```
CORS headers   → security headers   → preflight short-circuit  →
classify       → resolveKey         → limiter.check            →
  allowed? continue  :  emit 429 + audit(limit_reached)        →
auth           → route              → response
```

Classification happens **before** authentication for `setup` (IP-keyed), but **after** session verification for `read` / `write` (jti-keyed). Implementation detail: do a first pass for `setup` paths, then authenticate, then a second pass for `read` / `write`.

---

## Tests — `packages/relay/admin-trace-test.mjs`

Six distinct test groups under a new `--- Admin Rate Limiter ---` heading. All use injected clock (`now: () => fakeClock`) for determinism.

1. **Under-limit passes.** 119 GETs on `/api/status` in one session all return 200. 120th still returns 200. 121st returns 429.
2. **Retry-After is accurate.** At `tokens = 0`, advance `fakeClock` by `retryAfterSec - 1` → still 429. Advance to `retryAfterSec` → 200.
3. **Buckets do not leak across classes.** Exhaust `read` (121 GETs) → 429. Same session immediately does a `PUT /api/disclosure` → 200 (write bucket untouched). Reverse also holds.
4. **Buckets do not leak across sessions.** Session A exhausts `read`. Session B (different jti) immediately does a GET → 200.
5. **`setup` keyed by IP.** Two different jtis from the same IP hitting `POST /api/admin/setup` share a bucket. (In practice the setup endpoint rejects the second request with `409 Already configured`, so the test uses a reset `AdminAuth` per request and counts pre-auth 429s.)
6. **`limit_reached` audit fires.** Exhaust any class, check that the next request produces exactly one audit event with `scope` matching the class and the correct `path`/`method`. Verify the event is registered in `AUDIT_EVENT_TYPES` and does not appear in the audit chain before the breach.

Plus integration-level checks via existing `admin-trace-test.mjs` patterns:

7. **Unclassified paths are not rate-limited.** A `DELETE /api/admin/arbitrary` request (hypothetical unknown path) returns 404 from the route handler. Assert two things: (a) status is 404, not 429; (b) `limit_reached` **does not** fire for that request. Confirms the limiter stays out of the way on unknown paths and only acts on its registered allowlist.
8. **`bucket_store_overflow` fires once then debounces.** With `maxBuckets: 2`, create three distinct sessions in quick succession → third creation attempt fires one `limit_reached` audit event with `scope: 'bucket_store_overflow'` and `denialCount: 1`. Immediately create a fourth session → no new audit event (inside 60 s cooldown). Advance clock 61 s, create a fifth session → one more audit event with `denialCount: 2` (aggregating the fourth).
9. **Debounce under sustained denial.** Exhaust a `read` bucket, then fire 10 more requests inside a 60-s window → one `limit_reached` audit event with `denialCount: 1` at t=0, one request at t=60s → second audit event with `denialCount: 10` (the 10 blocked in the interim, plus the current one — wait, actually: nine blocked inside the window produce `pendingDenials = 9`; the request at t=60s is the 10th denial and triggers emit with `denialCount: 10`). Confirms aggregation math.
10. **Eviction does not flush pending denials.** Exhaust a bucket, fire 5 more blocked requests (all inside first minute → `pendingDenials = 5`, no new audit after the immediate first). Wait until bucket would be evicted (token-refill takes it past capacity-full + 5 min idle). Confirm the bucket is gone AND no tail audit event was emitted for those 5 pending denials.

Console-suppression rules (per `.claude/skills/testing/SKILL.md`) apply wherever we deliberately trip 429 or audit warnings.

---

## Future Work

- **Re-key authenticated classes on `sub` (username) once auth v1.0 lands.** With multiple admin users, refresh-resets-budget per jti becomes a real (though minor) weakness: a user could automate refresh to pretend their quota was higher. Keying on username closes that loop without impacting the single-admin model we have today. Deferred because it requires coordination with how `AdminAuth` exposes account identity post-v1.0.
- **Persistent buckets across relay restart.** Currently a relay restart wipes all buckets — a compromised session loses its history. Acceptable for today; revisit if admin-side usage patterns ever make restart-driven reset exploitable.

---

## Open risks / known limitations

- **Single-relay assumption.** A multi-relay deployment would see each instance with its own buckets; 3x relays → 3x effective limit. Not a concern today; revisit when horizontal scaling is on the roadmap.
- **IP-keying on `setup` is weak behind a tunnel.** The tunnel collapses all client IPs to `127.0.0.1`, so an attacker who has already compromised the operator's workstation and their SSH tunnel can reach the relay without IP diversity. Acceptable: that attacker has already won — a rate limit won't help. The `setup` class is really about bot-style spray before any account exists, not defence-in-depth against a compromised operator workstation.
- **Clock dependence.** Uses `Date.now()` via the injected `now` callable. A system clock skew >30 s could cause `tokens` to over- or under-refill on first use. Within normal operational bounds this is a non-issue; Guardian's environment check already flags clocks >5 min off.

---

## Implementation order (post-sign-off)

Per Harry's instruction:

1. **Headers commit.** `svelte.config.js` CSP + `AdminServer` security headers via `res.setHeader` early in `handleRequest`. Tests: verify headers on static, JSON success, 401, 500, preflight responses.
2. **Rate limiter commit.** `admin-rate-limiter.ts` + wiring in `handleRequest`. Tests: groups 1–5, 7 above. No audit wiring yet — breach returns 429 silently.
3. **Audit event wiring commit.** Register `LIMIT_REACHED` in `AUDIT_EVENT_TYPES`, thread `AuditLogger` into limiter, emit `limit_reached` on every denial. Tests: groups 6 and 8 above.

Each commit runs the full suite (`pnpm test`). Baseline 4225/4225 + new tests. No commit lands if the baseline regresses.

---

## Sign-off

- [x] Harry — 2026-04-17. Limits, class split, IP-vs-jti keying, audit event name, build order confirmed. Five pre-approval amendments folded in: unknown-path posture clarified (not default-denied — 404), jti-refresh reset documented as known behaviour with future-work note for auth v1.0, maxBuckets dropped to 1 000, audit emission switched to first-denial-immediate + 1/min debounce with denialCount, test groups 7–10 revised accordingly.
