// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Docker entrypoint for the Bastion AI client.
 *
 * Reads configuration from environment variables and connects
 * to the relay. In mock mode, responds to messages with
 * simulated safety evaluation and echo responses.
 */

import { BastionAiClient } from '@bastion/client-ai';

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const relayUrl = process.env.BASTION_RELAY_URL ?? 'wss://relay:9443';
const clientId = process.env.BASTION_AI_CLIENT_ID ?? 'ai-client-dev-001';
const displayName = process.env.BASTION_AI_DISPLAY_NAME ?? 'Claude (Development)';
const providerId = process.env.BASTION_PROVIDER_ID ?? 'anthropic-dev';
const isMock = process.env.BASTION_MOCK_PROVIDER === 'true';

// ---------------------------------------------------------------------------
// Create AI client
// ---------------------------------------------------------------------------

const client = new BastionAiClient({
  relayUrl,
  identity: {
    id: clientId,
    type: 'ai',
    displayName,
  },
  providerId,
  rejectUnauthorized: false, // Accept self-signed certs in Docker dev
});

client.on('connected', () => {
  console.log(`[ai-client] Connected to relay at ${relayUrl}`);
});

client.on('authenticated', (jwt, expiresAt) => {
  console.log(`[ai-client] Authenticated. Token expires at ${expiresAt}`);
});

client.on('message', (data) => {
  console.log(`[ai-client] Received message: ${data.substring(0, 200)}`);

  if (isMock) {
    // In mock mode, echo the message back as a conversation response
    try {
      const envelope = JSON.parse(data);
      if (envelope.type === 'task' || envelope.type === 'conversation') {
        console.log(`[ai-client] Mock: processing ${envelope.type} message`);
      }
    } catch {
      // Not valid JSON — ignore
    }
  }
});

client.on('error', (err) => {
  console.error(`[ai-client] Error: ${err.message}`);
});

client.on('disconnected', (code, reason) => {
  console.log(`[ai-client] Disconnected: ${code} ${reason}`);
});

// ---------------------------------------------------------------------------
// Connect with retry
// ---------------------------------------------------------------------------

const connectWithRetry = async (maxAttempts = 10) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await client.connect();
      console.log('[ai-client] Ready.');
      return;
    } catch (err) {
      const delay = Math.min(attempt * 2000, 30000);
      console.log(`[ai-client] Connection attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
      console.log(`[ai-client] Retrying in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  console.error('[ai-client] Failed to connect after all attempts. Exiting.');
  process.exit(1);
};

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const shutdown = async () => {
  console.log('[ai-client] Shutting down...');
  await client.disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await connectWithRetry();
