// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * TLS configuration for the relay server.
 *
 * The relay terminates TLS independently for each client connection.
 * This module handles:
 *   - Loading TLS certificate and private key from disk
 *   - Creating HTTPS server options for the WebSocket server
 *   - Generating self-signed certificates for development/testing
 *
 * Production deployments should use certificates from a trusted CA.
 * The self-signed generator is for local development only.
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import type { ServerOptions as HttpsServerOptions } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** TLS configuration for the relay server. */
export interface TlsConfig {
  /** Path to the PEM-encoded TLS certificate. */
  readonly certPath: string;
  /** Path to the PEM-encoded private key. */
  readonly keyPath: string;
  /**
   * Optional path to a CA certificate for client certificate verification.
   * Used for admin panel mTLS authentication (Section 6.2).
   */
  readonly caPath?: string;
  /**
   * If true, require client certificates (mutual TLS).
   * Used for admin panel connections only.
   */
  readonly requestClientCert?: boolean;
}

/** In-memory TLS material (cert + key as strings). */
export interface TlsMaterial {
  /** PEM-encoded certificate. */
  readonly cert: string;
  /** PEM-encoded private key. */
  readonly key: string;
  /** Optional PEM-encoded CA certificate. */
  readonly ca?: string;
}

/** Result of generating a self-signed certificate. */
export interface SelfSignedResult {
  /** PEM-encoded certificate. */
  readonly cert: string;
  /** PEM-encoded private key. */
  readonly key: string;
  /** Path to the certificate file (in temp directory). */
  readonly certPath: string;
  /** Path to the key file (in temp directory). */
  readonly keyPath: string;
}

// ---------------------------------------------------------------------------
// Load TLS material from disk
// ---------------------------------------------------------------------------

/**
 * Load TLS certificate and key from disk paths.
 *
 * @param config — TLS configuration with file paths
 * @returns TlsMaterial with PEM strings
 * @throws Error if files cannot be read
 */
export function loadTlsMaterial(config: TlsConfig): TlsMaterial {
  try {
    const cert = readFileSync(config.certPath, 'utf-8');
    const key = readFileSync(config.keyPath, 'utf-8');
    const ca = config.caPath ? readFileSync(config.caPath, 'utf-8') : undefined;

    if (!cert.includes('BEGIN CERTIFICATE')) {
      throw new TlsError(`Certificate file does not contain a valid PEM certificate: ${config.certPath}`);
    }
    if (!key.includes('BEGIN') || !key.includes('KEY')) {
      throw new TlsError(`Key file does not contain a valid PEM key: ${config.keyPath}`);
    }

    return { cert, key, ca };
  } catch (err) {
    if (err instanceof TlsError) throw err;
    throw new TlsError(`Failed to load TLS material: ${String(err)}`);
  }
}

/**
 * Build HTTPS server options from TLS material.
 *
 * @param material — PEM-encoded cert, key, and optional CA
 * @param requestClientCert — whether to request client certificates
 * @returns HttpsServerOptions for https.createServer()
 */
export function buildSecureContext(material: TlsMaterial, requestClientCert = false): HttpsServerOptions {
  return {
    cert: material.cert,
    key: material.key,
    ca: material.ca,
    requestCert: requestClientCert,
    rejectUnauthorized: requestClientCert,
  };
}

// ---------------------------------------------------------------------------
// Self-signed certificate generation (development only)
// ---------------------------------------------------------------------------

/**
 * Generate a self-signed TLS certificate for development and testing.
 *
 * Uses the OpenSSL CLI to generate an RSA key pair and
 * self-signed X.509 certificate. Requires OpenSSL in PATH.
 *
 * WARNING: Self-signed certificates are for development only.
 * Production deployments must use certificates from a trusted CA.
 *
 * @param hostname — the hostname for the certificate (default: "localhost")
 * @returns SelfSignedResult with PEM strings and temp file paths
 */
export function generateSelfSigned(hostname = 'localhost'): SelfSignedResult {
  const dir = join(tmpdir(), `bastion-tls-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });

  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');

  // Use OpenSSL to generate a self-signed certificate
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
        `-days 1 -nodes -subj "/CN=${hostname}" -addext "subjectAltName=DNS:${hostname},IP:127.0.0.1"`,
      { stdio: 'pipe' },
    );
  } catch {
    throw new TlsError('Failed to generate self-signed certificate. Ensure OpenSSL is installed.');
  }

  const cert = readFileSync(certPath, 'utf-8');
  const key = readFileSync(keyPath, 'utf-8');

  return { cert, key, certPath, keyPath };
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class TlsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TlsError';
  }
}
