// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Admin authentication for the relay admin panel.
 *
 * Separate from the protocol JWT authentication used by clients.
 * Two authentication mechanisms (supplementary spec Section 6):
 *
 *   1. Client certificate (primary) — self-signed CA, CRL revocation
 *   2. Username + TOTP (fallback) — scrypt password hash, mandatory TOTP
 *
 * Rate limiting: 5 attempts per 15 minutes, then 1-hour lockout.
 * Maps to BASTION-2006 (AUTH_ADMIN_LOCKOUT) on lockout.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Base32 encoding/decoding for TOTP secrets
// ---------------------------------------------------------------------------

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/, '').toUpperCase();
  let bits = '';
  for (const c of cleaned) {
    const val = BASE32_CHARS.indexOf(c);
    if (val === -1) throw new AdminAuthError(`Invalid base32 character: ${c}`);
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
  }
  return bytes;
}

function base32Encode(data: Uint8Array): string {
  let bits = '';
  for (const byte of data) {
    bits += byte.toString(2).padStart(8, '0');
  }
  while (bits.length % 5 !== 0) bits += '0';
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = Number.parseInt(bits.slice(i, i + 5), 2);
    result += BASE32_CHARS[chunk];
  }
  while (result.length % 8 !== 0) result += '=';
  return result;
}

// ---------------------------------------------------------------------------
// TOTP implementation (RFC 6238)
// ---------------------------------------------------------------------------

function generateTotp(secret: Uint8Array, timeStep: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(timeStep));

  const hmac = createHmac('sha1', Buffer.from(secret));
  hmac.update(buffer);
  const digest = hmac.digest();

  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    (((digest[offset]! & 0x7f) << 24) |
      ((digest[offset + 1]! & 0xff) << 16) |
      ((digest[offset + 2]! & 0xff) << 8) |
      (digest[offset + 3]! & 0xff)) %
    1000000;

  return code.toString().padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An admin account record. */
export interface AdminAccount {
  readonly username: string;
  /** Password hash in format: scrypt:<base64-salt>:<base64-hash> */
  readonly passwordHash: string;
  /** TOTP secret (Base32 encoded, 20 bytes). */
  readonly totpSecret: string;
  readonly active: boolean;
}

/** Configuration for admin authentication. */
export interface AdminAuthConfig {
  readonly accounts: readonly AdminAccount[];
  /** SHA-256 fingerprints of trusted client certificates. */
  readonly trustedCertFingerprints?: readonly string[];
  /** Max failed login attempts before lockout. Default: 5. */
  readonly maxLoginAttempts?: number;
  /** Time window for counting attempts. Default: 900_000 (15 min). */
  readonly lockoutWindowMs?: number;
  /** Duration of lockout after exceeding max attempts. Default: 3_600_000 (1 hour). */
  readonly lockoutDurationMs?: number;
}

/** Successful authentication result. */
export interface AdminAuthSuccess {
  readonly authenticated: true;
  readonly method: 'cert' | 'totp';
  readonly username: string;
}

/** Failed authentication result. */
export interface AdminAuthFailure {
  readonly authenticated: false;
  readonly reason: AdminAuthFailureReason;
}

export type AdminAuthResult = AdminAuthSuccess | AdminAuthFailure;

export type AdminAuthFailureReason =
  | 'invalid_cert'
  | 'untrusted_cert'
  | 'invalid_credentials'
  | 'invalid_totp'
  | 'account_inactive'
  | 'account_locked'
  | 'missing_credentials';

// ---------------------------------------------------------------------------
// Internal: Login attempt tracking
// ---------------------------------------------------------------------------

interface LoginAttemptRecord {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number | null;
}

// ---------------------------------------------------------------------------
// AdminAuth
// ---------------------------------------------------------------------------

/**
 * Admin authentication handler.
 *
 * Usage:
 *   1. Create: `const auth = new AdminAuth(config)`
 *   2. Try cert: `auth.verifyClientCert(fingerprint)`
 *   3. Or TOTP: `auth.verifyCredentials(username, password, totpCode)`
 *   4. Check lockout: `auth.isLockedOut(username)`
 */
export class AdminAuth {
  private readonly accounts: Map<string, AdminAccount>;
  private readonly trustedFingerprints: ReadonlySet<string>;
  private readonly maxLoginAttempts: number;
  private readonly lockoutWindowMs: number;
  private readonly lockoutDurationMs: number;
  private readonly loginAttempts: Map<string, LoginAttemptRecord>;

  constructor(config: AdminAuthConfig) {
    this.accounts = new Map();
    for (const account of config.accounts) {
      this.accounts.set(account.username, account);
    }
    this.trustedFingerprints = new Set(config.trustedCertFingerprints ?? []);
    this.maxLoginAttempts = config.maxLoginAttempts ?? 5;
    this.lockoutWindowMs = config.lockoutWindowMs ?? 900_000;
    this.lockoutDurationMs = config.lockoutDurationMs ?? 3_600_000;
    this.loginAttempts = new Map();
  }

  /** Number of configured accounts. */
  get accountCount(): number {
    return this.accounts.size;
  }

  /** Number of trusted certificate fingerprints. */
  get trustedCertCount(): number {
    return this.trustedFingerprints.size;
  }

  /**
   * Verify a client certificate by its SHA-256 fingerprint.
   *
   * @param certFingerprint — SHA-256 fingerprint of the client cert
   * @returns authentication result
   */
  verifyClientCert(certFingerprint: string | undefined): AdminAuthResult {
    if (!certFingerprint) {
      return { authenticated: false, reason: 'invalid_cert' };
    }
    if (this.trustedFingerprints.size === 0) {
      return { authenticated: false, reason: 'untrusted_cert' };
    }
    if (!this.trustedFingerprints.has(certFingerprint)) {
      return { authenticated: false, reason: 'untrusted_cert' };
    }
    return { authenticated: true, method: 'cert', username: 'cert-auth' };
  }

  /**
   * Verify username + password + TOTP code.
   *
   * Rate-limited: 5 attempts per 15 min, then 1-hour lockout.
   *
   * @param username — admin account username
   * @param password — plaintext password
   * @param totpCode — 6-digit TOTP code
   * @returns authentication result
   */
  verifyCredentials(username: string, password: string, totpCode: string): AdminAuthResult {
    if (this.isLockedOut(username)) {
      return { authenticated: false, reason: 'account_locked' };
    }

    const account = this.accounts.get(username);
    if (!account) {
      this.recordFailedAttempt(username);
      return { authenticated: false, reason: 'invalid_credentials' };
    }

    if (!account.active) {
      return { authenticated: false, reason: 'account_inactive' };
    }

    if (!AdminAuth.verifyPassword(password, account.passwordHash)) {
      this.recordFailedAttempt(username);
      return { authenticated: false, reason: 'invalid_credentials' };
    }

    if (!AdminAuth.verifyTotp(account.totpSecret, totpCode)) {
      this.recordFailedAttempt(username);
      return { authenticated: false, reason: 'invalid_totp' };
    }

    // Success — clear attempts
    this.loginAttempts.delete(username);
    return { authenticated: true, method: 'totp', username };
  }

  /**
   * Check whether an account is currently locked out.
   *
   * @param username — admin account username
   * @returns true if locked out
   */
  isLockedOut(username: string): boolean {
    const record = this.loginAttempts.get(username);
    if (!record || record.lockedUntil === null) return false;

    if (Date.now() < record.lockedUntil) return true;

    // Lockout expired — reset
    this.loginAttempts.delete(username);
    return false;
  }

  /**
   * Get the lockout expiry timestamp for an account.
   *
   * @param username — admin account username
   * @returns Unix timestamp of lockout expiry, or null if not locked
   */
  getLockoutExpiry(username: string): number | null {
    const record = this.loginAttempts.get(username);
    if (!record || record.lockedUntil === null) return null;
    if (Date.now() >= record.lockedUntil) {
      this.loginAttempts.delete(username);
      return null;
    }
    return record.lockedUntil;
  }

  /**
   * Get the number of failed attempts in the current window.
   *
   * @param username — admin account username
   * @returns number of failed attempts
   */
  getFailedAttempts(username: string): number {
    const record = this.loginAttempts.get(username);
    if (!record) return 0;
    const now = Date.now();
    if (now - record.firstAttemptAt > this.lockoutWindowMs) return 0;
    return record.attempts;
  }

  private recordFailedAttempt(username: string): void {
    const now = Date.now();
    let record = this.loginAttempts.get(username);

    if (!record || now - record.firstAttemptAt > this.lockoutWindowMs) {
      record = { attempts: 1, firstAttemptAt: now, lockedUntil: null };
    } else {
      record = { ...record, attempts: record.attempts + 1 };
    }

    if (record.attempts >= this.maxLoginAttempts) {
      record = { ...record, lockedUntil: now + this.lockoutDurationMs };
    }

    this.loginAttempts.set(username, record);
  }

  // -------------------------------------------------------------------------
  // Static utility methods
  // -------------------------------------------------------------------------

  /**
   * Hash a password using scrypt.
   *
   * @param password — plaintext password
   * @returns hash in format: scrypt:<base64-salt>:<base64-hash>
   */
  static hashPassword(password: string): string {
    const salt = randomBytes(32);
    const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    return `scrypt:${salt.toString('base64')}:${hash.toString('base64')}`;
  }

  /**
   * Verify a password against a stored hash.
   *
   * Uses timing-safe comparison to prevent timing attacks.
   *
   * @param password — plaintext password to verify
   * @param stored — stored hash from hashPassword()
   * @returns true if the password matches
   */
  static verifyPassword(password: string, stored: string): boolean {
    const parts = stored.split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    try {
      const salt = Buffer.from(parts[1]!, 'base64');
      const expected = Buffer.from(parts[2]!, 'base64');
      const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
      return timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  /**
   * Generate a new TOTP secret.
   *
   * @returns Base32-encoded 20-byte secret
   */
  static generateTotpSecret(): string {
    return base32Encode(randomBytes(20));
  }

  /**
   * Verify a TOTP code against a secret.
   *
   * Allows a window of +/- 1 time step (30 seconds each) to
   * accommodate clock drift.
   *
   * @param secretBase32 — Base32-encoded TOTP secret
   * @param code — 6-digit TOTP code to verify
   * @param windowSize — number of steps before/after to check (default: 1)
   * @returns true if the code is valid
   */
  static verifyTotp(secretBase32: string, code: string, windowSize = 1): boolean {
    const secret = base32Decode(secretBase32);
    const timeStep = Math.floor(Date.now() / 1000 / 30);

    for (let i = -windowSize; i <= windowSize; i++) {
      if (generateTotp(secret, timeStep + i) === code) return true;
    }
    return false;
  }

  /**
   * Generate the current TOTP code for a secret.
   * Primarily for testing.
   *
   * @param secretBase32 — Base32-encoded TOTP secret
   * @returns 6-digit TOTP code
   */
  static generateTotpCode(secretBase32: string): string {
    const secret = base32Decode(secretBase32);
    const timeStep = Math.floor(Date.now() / 1000 / 30);
    return generateTotp(secret, timeStep);
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class AdminAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminAuthError';
  }
}
