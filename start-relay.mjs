import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  BastionRelay,
  MessageRouter,
  JwtService,
  AuditLogger,
} from './packages/relay/dist/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TLS_CERT = process.env.BASTION_TLS_CERT || './certs/relay-cert.pem';
const TLS_KEY = process.env.BASTION_TLS_KEY || './certs/relay-key.pem';
const PORT = parseInt(process.env.BASTION_RELAY_PORT || '9443');
const AUDIT_DB = process.env.BASTION_AUDIT_DB || '/var/lib/bastion/audit.db';

// JWT secret — use env var or generate a random 256-bit key
const jwtSecretEnv = process.env.BASTION_JWT_SECRET;
const jwtSecret = jwtSecretEnv
  ? new TextEncoder().encode(jwtSecretEnv)
  : randomBytes(32);

console.log('=== Project Bastion — Relay Server ===');
console.log(`Port: ${PORT}`);
console.log(`TLS:  ${TLS_CERT}`);
console.log(`Audit: ${AUDIT_DB}`);
if (!jwtSecretEnv) console.log('JWT:  using randomly generated secret (set BASTION_JWT_SECRET for persistence)');
console.log('');

// ---------------------------------------------------------------------------
// Core services
// ---------------------------------------------------------------------------

const auditLogger = new AuditLogger({ store: { path: AUDIT_DB } });
console.log('[✓] Audit logger initialised with hash chain');

const jwtService = new JwtService({
  secret: jwtSecret,
  issuer: 'bastion-relay',
});
console.log('[✓] JWT service ready');

// TLS
const cert = readFileSync(TLS_CERT, 'utf-8');
const key = readFileSync(TLS_KEY, 'utf-8');

// Relay server
const relay = new BastionRelay({
  port: PORT,
  tls: { cert, key },
});

// Message router — uses relay.send for delivery
const router = new MessageRouter({
  send: (connectionId, data) => relay.send(connectionId, data),
  log: (entry) => {
    const from = entry.senderConnectionId.slice(0, 8);
    const to = entry.recipientConnectionId ? entry.recipientConnectionId.slice(0, 8) : '?';
    console.log(`[route] ${from} → ${to} [${entry.status}] ${entry.messageType}`);
  },
});
console.log('[✓] Message router initialised');
console.log('[✓] MaliClaw Clause active');

// ---------------------------------------------------------------------------
// Session tracking — human ↔ AI pairing
// ---------------------------------------------------------------------------

let humanConnectionId = null;
let aiConnectionId = null;

/** Session IDs keyed by connection ID (for audit logging). */
const sessionIds = new Map();

function tryPairClients() {
  if (!humanConnectionId || !aiConnectionId) return;

  try {
    router.pairClients(humanConnectionId, aiConnectionId);
    console.log(`[★] Clients paired: human=${humanConnectionId.slice(0, 8)} ↔ ai=${aiConnectionId.slice(0, 8)}`);

    // Notify both sides that their peer is active
    const peerActiveMsg = JSON.stringify({
      type: 'peer_status',
      status: 'active',
      timestamp: new Date().toISOString(),
    });
    relay.send(humanConnectionId, peerActiveMsg);
    relay.send(aiConnectionId, peerActiveMsg);
  } catch (err) {
    console.error(`[!] Pairing failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

relay.on('connection', (_ws, info) => {
  console.log(`[+] Client connected: ${info.id.slice(0, 8)} from ${info.remoteAddress}`);
});

relay.on('message', async (data, info) => {
  const connId = info.id;

  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    console.error(`[!] Non-JSON message from ${connId.slice(0, 8)} — dropping`);
    return;
  }

  // ----- session_init: authenticate and register -----
  if (msg.type === 'session_init') {
    const identity = msg.identity;

    if (!identity || !identity.type || !identity.id || !identity.displayName) {
      relay.send(connId, JSON.stringify({
        type: 'error',
        message: 'Invalid identity in session_init — requires type, id, displayName',
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    console.log(`[→] session_init from ${identity.displayName} (${identity.type}:${identity.id})`);

    // Issue JWT
    const sessionId = randomUUID();
    sessionIds.set(connId, sessionId);

    let tokenResult;
    try {
      tokenResult = await jwtService.issueToken({
        sub: identity.id,
        clientType: identity.type,
        sessionId,
        capabilities: ['message', 'file_transfer'],
      });
    } catch (err) {
      console.error(`[!] JWT issuance failed: ${err.message}`);
      relay.send(connId, JSON.stringify({
        type: 'error',
        message: 'Authentication failed — could not issue token',
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    console.log(`[✓] JWT issued for ${identity.displayName} (session: ${sessionId.slice(0, 8)})`);

    // Send session_established
    relay.send(connId, JSON.stringify({
      type: 'session_established',
      jwt: tokenResult.jwt,
      expiresAt: tokenResult.expiresAt,
      sessionId,
      timestamp: new Date().toISOString(),
    }));

    // Register with router
    router.registerClient(connId, identity);

    // Track human/AI connection
    if (identity.type === 'human') {
      humanConnectionId = connId;
      console.log(`[✓] Human client registered: ${identity.displayName}`);
    } else if (identity.type === 'ai') {
      aiConnectionId = connId;
      console.log(`[✓] AI client registered: ${identity.displayName}`);
    }

    // Auto-pair when both sides are connected
    tryPairClients();

    // Audit
    auditLogger.logEvent('auth_success', sessionId, {
      clientId: identity.id,
      clientType: identity.type,
      displayName: identity.displayName,
    });

    return;
  }

  // ----- token_refresh: re-issue JWT -----
  if (msg.type === 'token_refresh') {
    try {
      const refreshResult = await jwtService.refreshToken(msg.jwt);
      if (refreshResult.refreshed) {
        relay.send(connId, JSON.stringify({
          type: 'session_established',
          jwt: refreshResult.token.jwt,
          expiresAt: refreshResult.token.expiresAt,
          timestamp: new Date().toISOString(),
        }));
        console.log(`[✓] Token refreshed for ${connId.slice(0, 8)}`);

        const sid = sessionIds.get(connId);
        if (sid) auditLogger.logEvent('auth_token_refresh', sid, {});
      } else {
        relay.send(connId, JSON.stringify({
          type: 'error',
          message: `Token refresh failed: ${refreshResult.message}`,
          timestamp: new Date().toISOString(),
        }));
      }
    } catch (err) {
      console.error(`[!] Token refresh error: ${err.message}`);
    }
    return;
  }

  // ----- Regular message: forward to paired peer -----
  const peerId = router.getPeer(connId);
  if (!peerId) {
    console.log(`[!] No peer for ${connId.slice(0, 8)} — message dropped (type: ${msg.type})`);
    relay.send(connId, JSON.stringify({
      type: 'error',
      message: 'No paired peer — message cannot be delivered',
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  const sent = relay.send(peerId, data);
  if (sent) {
    const client = router.getClient(connId);
    const peer = router.getClient(peerId);
    console.log(`[→] ${client?.identity.displayName || connId.slice(0, 8)} → ${peer?.identity.displayName || peerId.slice(0, 8)}: ${msg.type}`);

    const sid = sessionIds.get(connId);
    if (sid) {
      auditLogger.logEvent('message_routed', sid, {
        messageId: msg.id || 'unknown',
        messageType: msg.type,
        from: client?.identity.id,
        to: peer?.identity.id,
      });
    }
  } else {
    console.log(`[!] Send to peer ${peerId.slice(0, 8)} failed`);
  }
});

// ---------------------------------------------------------------------------
// Disconnection cleanup
// ---------------------------------------------------------------------------

relay.on('disconnection', (info, code, reason) => {
  const connId = info.id;
  console.log(`[-] Client disconnected: ${connId.slice(0, 8)} (${code}: ${reason})`);

  // Audit
  const sid = sessionIds.get(connId);
  if (sid) {
    auditLogger.logEvent('session_ended', sid, { code, reason });
    sessionIds.delete(connId);
  }

  // Unregister from router (also unpairs)
  router.unregisterClient(connId);

  // Clear tracking and notify remaining peer
  if (connId === humanConnectionId) {
    humanConnectionId = null;
    if (aiConnectionId) {
      relay.send(aiConnectionId, JSON.stringify({
        type: 'peer_status',
        status: 'disconnected',
        timestamp: new Date().toISOString(),
      }));
    }
  } else if (connId === aiConnectionId) {
    aiConnectionId = null;
    if (humanConnectionId) {
      relay.send(humanConnectionId, JSON.stringify({
        type: 'peer_status',
        status: 'disconnected',
        timestamp: new Date().toISOString(),
      }));
    }
  }
});

relay.on('error', (err) => {
  console.error(`[!] Relay error: ${err.message}`);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

relay.on('listening', () => {
  console.log('');
  console.log(`[★] Bastion relay listening on wss://0.0.0.0:${PORT}`);
  console.log('[★] Session lifecycle: session_init → JWT → paired → routing');
  console.log('[★] Zero-knowledge relay — payloads are opaque to the relay');
  console.log('[★] Awaiting connections...');
});

await relay.start();
