#!/usr/bin/env node
// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Bastion Update Agent — entry point.
 *
 * Reads config, connects to the relay, handles reconnection with
 * exponential backoff, and keeps the process alive via WebSocket.
 *
 * Usage:
 *   node dist/main.js
 *   BASTION_UPDATER_CONFIG=/path/to/config.json node dist/main.js
 */

import { readFileSync } from 'node:fs';
import { BastionUpdateAgent } from './agent.js';
import { validateConfig } from './config.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const configPath = process.env.BASTION_UPDATER_CONFIG || './config.json';

let rawConfig: unknown;
try {
  rawConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[!] Failed to read config at ${configPath}: ${msg}`);
  process.exit(1);
}

const result = validateConfig(rawConfig);
if (!result.valid || !result.config) {
  console.error('[!] Invalid config:');
  for (const e of result.errors ?? []) console.error(`    ${e}`);
  process.exit(1);
}

const config = result.config;
console.log('=== Bastion Update Agent ===');
console.log(`Agent:     ${config.agentName} (${config.agentId})`);
console.log(`Component: ${config.component}`);
console.log(`Relay:     ${config.relayUrl}`);
console.log(`Build:     ${config.buildPath}`);
console.log(`Services:  ${config.services.join(', ')}`);
if (config.tls?.caCertPath) console.log(`TLS CA:    ${config.tls.caCertPath}`);
if (config.tls?.rejectUnauthorized === false) console.log('TLS:       accepting self-signed certificates');
console.log('');

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const agent = new BastionUpdateAgent(config);

agent.on('connected', () => {
  console.log('[✓] Connected to relay');
  agent.sendSessionInit();
  backoff = 1000; // Reset backoff on successful connection
});

agent.on('authenticated', () => {
  console.log('[✓] Authenticated — waiting for update commands');
  // Check if we're reconnecting after an update_restart
  if (agent.sendReconnectedIfPending()) {
    console.log('[✓] Sent update_reconnected after restart (version from VERSION file)');
  }
});

agent.on('disconnected', (code, reason) => {
  console.log(`[-] Disconnected: ${code} ${reason}`);
  scheduleReconnect();
});

agent.on('error', (err) => {
  console.error(`[!] Error: ${err.message}`);
});

agent.on('build-progress', (component, phase, progress) => {
  const pct = progress !== undefined ? ` (${progress}%)` : '';
  console.log(`[~] Build ${component}: ${phase}${pct}`);
});

agent.on('build-complete', (component, duration) => {
  console.log(`[✓] Build ${component}: complete (${Math.round(duration / 1000)}s)`);
});

agent.on('build-failed', (component, error) => {
  console.error(`[!] Build ${component}: FAILED — ${error}`);
});

// ---------------------------------------------------------------------------
// Reconnection with exponential backoff
// ---------------------------------------------------------------------------

let backoff = 1000;
const MAX_BACKOFF = 60_000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReconnect(): void {
  if (reconnectTimer) return; // Already scheduled
  console.log(`[…] Reconnecting in ${backoff / 1000}s`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await agent.connect();
    } catch {
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
      scheduleReconnect();
    }
  }, backoff);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  console.log('[…] Shutting down');
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  await agent.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => {
  shutdown();
});
process.on('SIGINT', () => {
  shutdown();
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

agent.connect().catch((err) => {
  console.error(`[!] Initial connection failed: ${err.message}`);
  scheduleReconnect();
});
