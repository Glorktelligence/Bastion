// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Docker entrypoint for the Bastion relay server.
 *
 * Reads configuration from environment variables, generates
 * self-signed TLS certificates if none are mounted, and starts
 * the relay with audit logging.
 */

import { BastionRelay, generateSelfSigned, loadTlsMaterial, AuditLogger } from '@bastion/relay';
import { existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const port = parseInt(process.env.BASTION_RELAY_PORT ?? '9443', 10);
const host = process.env.BASTION_RELAY_HOST ?? '0.0.0.0';

// ---------------------------------------------------------------------------
// TLS setup
// ---------------------------------------------------------------------------

let tls;

const certPath = '/etc/bastion/certs/cert.pem';
const keyPath = '/etc/bastion/certs/key.pem';

if (existsSync(certPath) && existsSync(keyPath)) {
  console.log('[relay] Using mounted TLS certificates');
  tls = loadTlsMaterial({ certPath, keyPath });
} else {
  console.log('[relay] No TLS certificates found — generating self-signed (development only)');
  const selfSigned = generateSelfSigned('relay');
  tls = { cert: selfSigned.cert, key: selfSigned.key };
}

// ---------------------------------------------------------------------------
// Audit logger
// ---------------------------------------------------------------------------

const auditLogger = new AuditLogger({ sessionId: 'relay-docker' });

// ---------------------------------------------------------------------------
// Start relay
// ---------------------------------------------------------------------------

const relay = new BastionRelay({
  port,
  host,
  tls,
  auditLogger,
});

relay.on('listening', (p, h) => {
  console.log(`[relay] Bastion relay listening on wss://${h}:${p}`);
});

relay.on('connection', (_ws, info) => {
  console.log(`[relay] Client connected: ${info.id} from ${info.remoteAddress}`);
});

relay.on('disconnection', (info, code, reason) => {
  console.log(`[relay] Client disconnected: ${info.id} (${code}: ${reason})`);
});

relay.on('error', (err) => {
  console.error(`[relay] Error: ${err.message}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const shutdown = async () => {
  console.log('[relay] Shutting down...');
  await relay.shutdown();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await relay.start();
console.log('[relay] Ready. Waiting for connections...');
