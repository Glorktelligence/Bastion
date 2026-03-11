// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Authentication and access control types (Section 8).
 */

import type { Timestamp } from './common.js';

/** JWT claims for an authenticated Bastion session. */
export interface BastionJwtClaims {
  /** Subject: unique client identifier. */
  readonly sub: string;
  /** Issuer: relay server identifier. */
  readonly iss: string;
  /** Issued at (Unix timestamp). */
  readonly iat: number;
  /** Expiration (Unix timestamp). 15-minute expiry. */
  readonly exp: number;
  /** Client type: human, ai, or relay. */
  readonly clientType: 'human' | 'ai' | 'relay';
  /** Session identifier. */
  readonly sessionId: string;
  /** Capabilities granted to this client. */
  readonly capabilities: readonly string[];
}

/** Approved AI provider registration record. */
export interface ApprovedProvider {
  readonly id: string;
  readonly name: string;
  readonly approvedAt: Timestamp;
  readonly approvedBy: string;
  readonly capabilities: readonly string[];
  readonly active: boolean;
}

/** Session establishment handshake initiation message. */
export interface SessionInitiation {
  readonly clientType: 'human' | 'ai';
  readonly clientVersion: string;
  readonly protocolVersion: string;
  /** For AI clients: the provider identifier. */
  readonly providerId?: string;
  /** Public key for the E2E key exchange. */
  readonly publicKey: string;
}

/** Result of a session establishment handshake. */
export interface SessionEstablished {
  readonly sessionId: string;
  readonly jwt: string;
  readonly expiresAt: Timestamp;
  /** Relay's public key for the E2E key exchange. */
  readonly relayPublicKey: string;
}
