// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * JWT issuance, validation, and refresh for the relay.
 *
 * From the supplementary spec Section 2:
 *   - JWTs expire every 15 minutes (non-negotiable)
 *   - Clients must send a `token_refresh` message before expiry
 *   - If a JWT expires without refresh, the session is terminated
 *   - JWT validation occurs on every inbound message
 *
 * Uses HMAC-SHA256 (HS256) since the relay is both issuer and
 * verifier. The secret must be at least 256 bits.
 */

import { randomUUID } from 'node:crypto';
import type { BastionJwtClaims, ClientType } from '@bastion/protocol';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the JWT service. */
export interface JwtConfig {
  /** Relay server identifier (JWT `iss` claim). */
  readonly issuer: string;
  /** Token expiry in milliseconds. Default: 900_000 (15 minutes). */
  readonly expiryMs?: number;
  /** HMAC secret key (must be at least 256 bits / 32 bytes). */
  readonly secret: Uint8Array;
}

/** Claims used when issuing a new token. */
export interface TokenIssuanceClaims {
  /** Subject: unique client identifier. */
  readonly sub: string;
  /** Client type. */
  readonly clientType: ClientType;
  /** Session identifier. */
  readonly sessionId: string;
  /** Capabilities granted to this client. */
  readonly capabilities: readonly string[];
}

/** Successful token issuance result. */
export interface TokenIssuanceResult {
  /** The signed JWT string. */
  readonly jwt: string;
  /** ISO 8601 expiry timestamp. */
  readonly expiresAt: string;
  /** The claims embedded in the token. */
  readonly claims: BastionJwtClaims;
}

/** JWT validation result. */
export type JwtValidationResult =
  | { readonly valid: true; readonly claims: BastionJwtClaims }
  | { readonly valid: false; readonly error: JwtErrorCode; readonly message: string };

/** JWT refresh result. */
export type JwtRefreshResult =
  | { readonly refreshed: true; readonly token: TokenIssuanceResult }
  | { readonly refreshed: false; readonly error: JwtErrorCode; readonly message: string };

/** Error codes for JWT operations. */
export type JwtErrorCode = 'expired' | 'invalid' | 'malformed' | 'secret_too_short' | 'replay';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** 15-minute expiry (spec requirement). */
const DEFAULT_EXPIRY_MS = 15 * 60 * 1000;

/** Minimum secret length in bytes (256 bits). */
const MIN_SECRET_LENGTH = 32;

// ---------------------------------------------------------------------------
// JwtService
// ---------------------------------------------------------------------------

/**
 * JWT service for Bastion relay authentication.
 *
 * Usage:
 *   1. Create: `const jwt = new JwtService(config)`
 *   2. Issue tokens: `const token = await jwt.issueToken(claims)`
 *   3. Validate on each message: `const result = await jwt.validateToken(token)`
 *   4. Refresh before expiry: `const refreshed = await jwt.refreshToken(current)`
 */
export class JwtService {
  private readonly issuer: string;
  private readonly expiryMs: number;
  private readonly secret: Uint8Array;
  /** Seen JTI values — prevents replay within the token's validity window. */
  private readonly seenJtis: Map<string, number> = new Map();
  /** Cleanup interval handle for expired JTI entries. */
  private readonly jtiCleanupTimer: ReturnType<typeof setInterval>;

  constructor(config: JwtConfig) {
    if (config.secret.length < MIN_SECRET_LENGTH) {
      throw new AuthError(
        `JWT secret must be at least ${MIN_SECRET_LENGTH} bytes (256 bits), got ${config.secret.length}`,
      );
    }

    this.issuer = config.issuer;
    this.expiryMs = config.expiryMs ?? DEFAULT_EXPIRY_MS;
    this.secret = config.secret;

    // Clean up expired JTI entries every 5 minutes
    this.jtiCleanupTimer = setInterval(() => this.cleanupExpiredJtis(), 5 * 60 * 1000);
    this.jtiCleanupTimer.unref();
  }

  /**
   * Issue a new JWT for a client.
   *
   * @param claims — the claims to embed in the token
   * @returns signed JWT with expiry information
   */
  async issueToken(claims: TokenIssuanceClaims): Promise<TokenIssuanceResult> {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + Math.floor(this.expiryMs / 1000);

    const bastionClaims: BastionJwtClaims = {
      sub: claims.sub,
      iss: this.issuer,
      iat: now,
      exp,
      clientType: claims.clientType,
      sessionId: claims.sessionId,
      capabilities: [...claims.capabilities],
    };

    const jwt = await new SignJWT({
      clientType: bastionClaims.clientType,
      sessionId: bastionClaims.sessionId,
      capabilities: [...bastionClaims.capabilities],
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(bastionClaims.sub)
      .setIssuer(bastionClaims.iss)
      .setIssuedAt(bastionClaims.iat)
      .setExpirationTime(bastionClaims.exp)
      .setJti(randomUUID())
      .sign(this.secret);

    return {
      jwt,
      expiresAt: new Date(exp * 1000).toISOString(),
      claims: bastionClaims,
    };
  }

  /**
   * Validate a JWT and extract its claims.
   *
   * Checks signature, expiry, and issuer. Returns typed
   * BastionJwtClaims on success.
   *
   * @param token — the JWT string to validate
   * @returns validation result with claims or error
   */
  async validateToken(token: string): Promise<JwtValidationResult> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: this.issuer,
      });

      // Check for JTI replay — reject tokens with previously seen jti values
      const jti = payload.jti as string | undefined;
      if (jti) {
        if (this.seenJtis.has(jti)) {
          return { valid: false, error: 'invalid', message: 'JWT replay detected — jti already used' };
        }
        // Track this jti with its expiry time for cleanup
        const expTime = typeof payload.exp === 'number' ? payload.exp * 1000 : Date.now() + this.expiryMs;
        this.seenJtis.set(jti, expTime);
      }

      const claims: BastionJwtClaims = {
        sub: payload.sub ?? '',
        iss: payload.iss ?? '',
        iat: typeof payload.iat === 'number' ? payload.iat : 0,
        exp: typeof payload.exp === 'number' ? payload.exp : 0,
        clientType: payload.clientType as ClientType,
        sessionId: payload.sessionId as string,
        capabilities: (payload.capabilities as string[]) ?? [],
      };

      return { valid: true, claims };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        return { valid: false, error: 'expired', message: 'JWT has expired' };
      }
      if (err instanceof joseErrors.JWTClaimValidationFailed) {
        return { valid: false, error: 'invalid', message: `JWT claim validation failed: ${err.message}` };
      }
      if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
        return { valid: false, error: 'invalid', message: 'JWT signature verification failed' };
      }
      return { valid: false, error: 'malformed', message: `JWT validation error: ${String(err)}` };
    }
  }

  /**
   * Refresh a JWT: validate the current token, then issue a new one
   * with the same claims but a fresh expiry.
   *
   * The current token must still be valid (not expired). This is
   * called when a client sends a `token_refresh` message.
   *
   * @param currentToken — the current JWT to refresh
   * @returns refresh result with new token or error
   */
  async refreshToken(currentToken: string): Promise<JwtRefreshResult> {
    const validation = await this.validateToken(currentToken);

    if (!validation.valid) {
      return {
        refreshed: false,
        error: validation.error,
        message: validation.message,
      };
    }

    const newToken = await this.issueToken({
      sub: validation.claims.sub,
      clientType: validation.claims.clientType,
      sessionId: validation.claims.sessionId,
      capabilities: validation.claims.capabilities,
    });

    return { refreshed: true, token: newToken };
  }

  /** Remove expired JTI entries from the tracking set. */
  private cleanupExpiredJtis(): void {
    const now = Date.now();
    for (const [jti, expiresAt] of this.seenJtis) {
      if (expiresAt <= now) {
        this.seenJtis.delete(jti);
      }
    }
  }

  /** Stop the cleanup timer (for graceful shutdown). */
  destroy(): void {
    clearInterval(this.jtiCleanupTimer);
    this.seenJtis.clear();
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
