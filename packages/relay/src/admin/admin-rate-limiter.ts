// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Per-endpoint rate limiter for the admin HTTPS server.
 *
 * Token bucket per (class, key). Three classes: `read` (observability
 * endpoints), `write` (mutation endpoints), `setup` (pre-auth setup endpoint
 * only). Authenticated classes key on the session JWT's jti; `setup` keys on
 * remote IP since no session exists at setup time.
 *
 * Wired into {@link AdminServer} so every request is classified and checked
 * before the route handler runs. Unknown paths are NOT rate-limited — they
 * fall through to the route handler's normal 404.
 *
 * Design: docs/design/admin-rate-limiting.md
 *
 * This module provides the mechanism only. Audit wiring (emitting
 * `limit_reached` events on denial) is added in the following commit so the
 * two concerns can be tested in isolation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminRateLimitClass = 'read' | 'write' | 'setup';

/** Configuration for {@link AdminRateLimiter}. */
export interface AdminRateLimiterConfig {
  /** Read-class capacity per minute. Default: 120. */
  readonly readPerMin?: number;
  /** Write-class capacity per minute. Default: 20. */
  readonly writePerMin?: number;
  /** Setup-class capacity per minute. Default: 10. */
  readonly setupPerMin?: number;
  /**
   * Maximum number of (class, key) buckets to retain in memory. Prevents
   * unbounded growth if an attacker rotates keys aggressively. Default: 1000.
   */
  readonly maxBuckets?: number;
  /**
   * Injectable clock. Defaults to `Date.now`. Tests use a fake clock for
   * deterministic refill and eviction behaviour.
   */
  readonly now?: () => number;
}

/** Result of a {@link AdminRateLimiter.check} call. */
export interface AdminRateLimitDecision {
  /** True if the request is allowed (a token was debited). */
  readonly allowed: boolean;
  /**
   * Seconds the client should wait before retrying. Zero when `allowed` is
   * true. Integer (ceiled) when `allowed` is false — matches the `Retry-After`
   * HTTP header spec.
   */
  readonly retryAfterSec: number;
  /**
   * True when bucket creation was refused because the store is at `maxBuckets`
   * capacity. Callers can use this to emit a distinct `bucket_store_overflow`
   * audit event (wired in the audit commit).
   */
  readonly overflow: boolean;
}

// ---------------------------------------------------------------------------
// Path classification
// ---------------------------------------------------------------------------

/**
 * Classification table. Each entry is an exact `METHOD path` string.
 *
 * Parameterised paths (e.g. `/api/providers/:id`) are matched by stripping
 * the final segment after `/api/providers/` when the segment looks like a
 * provider id (not one of the keywords `revoke`, `activate`, `capabilities`).
 */
const CLASSIFIED: Record<string, AdminRateLimitClass> = {
  // -- read (GET observability) --
  'GET /api/health': 'read',
  'GET /api/status': 'read',
  'GET /api/connections': 'read',
  'GET /api/audit': 'read',
  'GET /api/audit/integrity': 'read',
  'GET /api/providers': 'read',
  'GET /api/tools': 'read',
  'GET /api/extensions': 'read',
  'GET /api/disclosure': 'read',
  'GET /api/challenge': 'read',

  // -- write (mutations) --
  'POST /api/providers': 'write',
  'PUT /api/disclosure': 'write',
  'PUT /api/challenge': 'write',

  // -- setup (pre-authentication) --
  'POST /api/admin/setup': 'setup',
};

/**
 * Classify a request. Returns the bucket class, or `null` when the path is
 * outside the limiter's allowlist (the route handler returns 404 or the path
 * is intentionally unlimited — e.g. /api/admin/login).
 */
export function classifyAdminRequest(method: string, path: string): AdminRateLimitClass | null {
  const normalisedMethod = method.toUpperCase();
  const key = `${normalisedMethod} ${path}`;
  if (key in CLASSIFIED) return CLASSIFIED[key] ?? null;

  // Parameterised: /api/providers/:id (GET) and /api/providers/:id/{revoke,activate,capabilities} (PUT/GET)
  if (path.startsWith('/api/providers/')) {
    const rest = path.slice('/api/providers/'.length);
    const segments = rest.split('/').filter(Boolean);
    if (segments.length === 1 && normalisedMethod === 'GET') {
      // GET /api/providers/:id
      return 'read';
    }
    if (segments.length === 2) {
      const tail = segments[1];
      if (tail === 'capabilities' && normalisedMethod === 'GET') return 'read';
      if (tail === 'capabilities' && normalisedMethod === 'PUT') return 'write';
      if ((tail === 'revoke' || tail === 'activate') && normalisedMethod === 'PUT') return 'write';
    }
  }

  // /api/extensions/:ns (GET)
  if (normalisedMethod === 'GET' && path.startsWith('/api/extensions/')) {
    const rest = path.slice('/api/extensions/'.length);
    if (rest.length > 0 && !rest.includes('/')) return 'read';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal bucket record
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  lastRefill: number;
}

// ---------------------------------------------------------------------------
// AdminRateLimiter
// ---------------------------------------------------------------------------

const DEFAULT_READ_PER_MIN = 120;
const DEFAULT_WRITE_PER_MIN = 20;
const DEFAULT_SETUP_PER_MIN = 10;
const DEFAULT_MAX_BUCKETS = 1000;
const EVICTION_IDLE_MS = 300_000; // 5 min idle-at-full ⇒ evictable

export class AdminRateLimiter {
  private readonly capacity: Record<AdminRateLimitClass, number>;
  private readonly refillPerSec: Record<AdminRateLimitClass, number>;
  private readonly maxBuckets: number;
  private readonly nowFn: () => number;
  private readonly store: Map<string, Bucket>;

  constructor(config: AdminRateLimiterConfig = {}) {
    const readPerMin = config.readPerMin ?? DEFAULT_READ_PER_MIN;
    const writePerMin = config.writePerMin ?? DEFAULT_WRITE_PER_MIN;
    const setupPerMin = config.setupPerMin ?? DEFAULT_SETUP_PER_MIN;

    this.capacity = { read: readPerMin, write: writePerMin, setup: setupPerMin };
    this.refillPerSec = {
      read: readPerMin / 60,
      write: writePerMin / 60,
      setup: setupPerMin / 60,
    };
    this.maxBuckets = config.maxBuckets ?? DEFAULT_MAX_BUCKETS;
    this.nowFn = config.now ?? Date.now;
    this.store = new Map();
  }

  /**
   * Test / internal classifier exposed on the instance for convenience.
   * Delegates to the pure {@link classifyAdminRequest} function.
   */
  classify(method: string, path: string): AdminRateLimitClass | null {
    return classifyAdminRequest(method, path);
  }

  /**
   * Check whether a request is allowed under its class budget and (if so)
   * debit one token. Lazily creates buckets on first observation of a
   * `(class, key)` pair.
   *
   * @param cls  Endpoint class produced by {@link classify}.
   * @param key  Bucket key — `jti:…` for authed, `ip:…` for setup.
   */
  check(cls: AdminRateLimitClass, key: string): AdminRateLimitDecision {
    const now = this.nowFn();
    const storeKey = `${cls}:${key}`;
    const capacity = this.capacity[cls];
    const refillRate = this.refillPerSec[cls];

    let bucket = this.store.get(storeKey);
    if (!bucket) {
      if (this.store.size >= this.maxBuckets) {
        // Refuse creation — signal overflow without allocating. Callers may
        // audit this as a distinct event in the audit commit.
        return { allowed: false, retryAfterSec: 60, overflow: true };
      }
      bucket = { tokens: capacity, lastRefill: now };
      this.store.set(storeKey, bucket);
    } else {
      // Eviction window: the elapsed time since the last touch. If the bucket
      // was full and this interval exceeds EVICTION_IDLE_MS, the bucket was
      // essentially dormant — reclaim it and treat the current request as
      // bucket creation. This runs BEFORE the refill because refill updates
      // `lastRefill` to `now`, erasing the idle signal.
      const idleMs = now - bucket.lastRefill;
      if (bucket.tokens >= capacity - 1e-9 && idleMs >= EVICTION_IDLE_MS) {
        this.store.delete(storeKey);
        bucket = { tokens: capacity, lastRefill: now };
        this.store.set(storeKey, bucket);
      } else {
        // Continuous refill
        const elapsedSec = Math.max(0, idleMs / 1000);
        bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillRate);
        bucket.lastRefill = now;
      }
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSec: 0, overflow: false };
    }

    // Denied — compute retry time to earn one full token.
    const deficit = 1 - bucket.tokens;
    const retryAfterSec = Math.max(1, Math.ceil(deficit / refillRate));
    return { allowed: false, retryAfterSec, overflow: false };
  }

  // --- Test / debug surface ----------------------------------------------

  /** Current number of live buckets. Test-only. */
  get bucketCount(): number {
    return this.store.size;
  }

  /** Drop all buckets. Test-only. */
  reset(): void {
    this.store.clear();
  }
}
