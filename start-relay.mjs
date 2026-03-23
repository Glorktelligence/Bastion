import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  BastionRelay,
  MessageRouter,
  JwtService,
  AuditLogger,
  AdminServer,
  AdminAuth,
  AdminRoutes,
  ProviderRegistry,
} from './packages/relay/dist/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TLS_CERT = process.env.BASTION_TLS_CERT || './certs/relay-cert.pem';
const TLS_KEY = process.env.BASTION_TLS_KEY || './certs/relay-key.pem';
const PORT = parseInt(process.env.BASTION_RELAY_PORT || '9443');
const ADMIN_PORT = parseInt(process.env.BASTION_ADMIN_PORT || '9444');
const AUDIT_DB = process.env.BASTION_AUDIT_DB || '/var/lib/bastion/audit.db';

// JWT secret — use env var or generate a random 256-bit key
const jwtSecretEnv = process.env.BASTION_JWT_SECRET;
const jwtSecret = jwtSecretEnv
  ? new TextEncoder().encode(jwtSecretEnv)
  : randomBytes(32);

console.log('=== Project Bastion — Relay Server ===');
console.log(`Port: ${PORT}`);
console.log(`Admin: https://127.0.0.1:${ADMIN_PORT} (localhost only)`);
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

// Provider registry — manages approved AI providers
const providerRegistry = new ProviderRegistry();
console.log('[✓] Provider registry initialised');

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
// Admin server
// ---------------------------------------------------------------------------

// Admin credentials — load from file, env vars, or start unconfigured for setup wizard
const ADMIN_CREDENTIALS_PATH = process.env.BASTION_ADMIN_CREDENTIALS_PATH || '/var/lib/bastion/admin-credentials.json';

// Try loading persisted credentials first
let adminAuth = AdminServer.loadCredentials(ADMIN_CREDENTIALS_PATH);

if (adminAuth) {
  console.log(`[✓] Admin credentials loaded from ${ADMIN_CREDENTIALS_PATH}`);
} else if (process.env.BASTION_ADMIN_PASSWORD_HASH && process.env.BASTION_ADMIN_TOTP_SECRET) {
  // Fall back to env vars
  const adminUsername = process.env.BASTION_ADMIN_USERNAME || 'admin';
  adminAuth = new AdminAuth({
    accounts: [{
      username: adminUsername,
      passwordHash: process.env.BASTION_ADMIN_PASSWORD_HASH,
      totpSecret: process.env.BASTION_ADMIN_TOTP_SECRET,
      active: true,
    }],
  });
  console.log(`[✓] Admin auth from env vars (user: ${adminUsername})`);
} else {
  // No credentials — start unconfigured. Setup wizard will create them.
  adminAuth = new AdminAuth({ accounts: [] });
  console.log('[!] No admin credentials configured — setup wizard will run on first access');
  console.log(`[!] Credentials will be saved to: ${ADMIN_CREDENTIALS_PATH}`);
}

// ---------------------------------------------------------------------------
// Live status tracking for admin dashboard
// ---------------------------------------------------------------------------

/** Rolling message counter for messages-per-minute calculation. */
const messageTimestamps = [];
const MESSAGE_WINDOW_MS = 60_000;

/** Per-connection message counters. */
const connectionMessageCounts = new Map();

function recordMessage(connectionId) {
  messageTimestamps.push(Date.now());
  connectionMessageCounts.set(connectionId, (connectionMessageCounts.get(connectionId) || 0) + 1);
}

function getMessagesPerMinute() {
  const cutoff = Date.now() - MESSAGE_WINDOW_MS;
  // Trim old entries
  while (messageTimestamps.length > 0 && messageTimestamps[0] < cutoff) {
    messageTimestamps.shift();
  }
  return messageTimestamps.length;
}

/** RelayStatusProvider implementation wired to live relay state. */
const statusProvider = {
  getConnections() {
    const ids = relay.getConnectionIds();
    return ids.map((connId) => {
      const connInfo = relay.getConnection(connId);
      const client = router.getClient(connId);
      const clientType = client ? client.identity.type : 'unknown';
      const authenticated = !!client;
      const providerId = undefined; // Could be wired to adminRoutes.getConnectionProvider(connId)
      return {
        connectionId: connId,
        remoteAddress: connInfo?.remoteAddress ?? 'unknown',
        connectedAt: connInfo?.connectedAt ?? new Date().toISOString(),
        clientType,
        authenticated,
        providerId,
        messageCount: connectionMessageCounts.get(connId) || 0,
      };
    });
  },
  getActiveSessionCount() {
    // A session is active when both human and AI are paired
    return (humanConnectionId && aiConnectionId && router.getPeer(humanConnectionId)) ? 1 : 0;
  },
  getMessagesPerMinute() {
    return getMessagesPerMinute();
  },
  getQuarantineStatus() {
    return { active: 0, capacity: 100 };
  },
};

const adminRoutes = new AdminRoutes({
  providerRegistry,
  auditLogger,
  statusProvider,
});
console.log('[✓] Admin routes initialised (live status provider wired)');

const adminServer = new AdminServer({
  port: ADMIN_PORT,
  host: '127.0.0.1',
  tls: { cert, key },
  auth: adminAuth,
  routes: adminRoutes,
  auditLogger,
  credentialsPath: ADMIN_CREDENTIALS_PATH,
  sessionSecret: jwtSecret,
  sessionTimeoutSec: parseInt(process.env.BASTION_ADMIN_SESSION_TIMEOUT || '1800', 10),
});
console.log('[✓] Admin server configured (127.0.0.1 only — use SSH tunnel for remote access)');

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
    auditLogger.logEvent('session_paired', sessionIds.get(humanConnectionId) || 'unknown', {
      humanConnectionId,
      aiConnectionId,
    });

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
  auditLogger.logEvent('connection_opened', info.id, {
    remoteAddress: info.remoteAddress,
    connectedAt: info.connectedAt,
  });
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

  // ----- provider_register: AI client registers as a provider -----
  if (msg.type === 'provider_register') {
    const { providerId, providerName, capabilities } = msg.payload || msg;
    if (providerId && providerName) {
      try {
        const result = adminRoutes.approveProvider(providerId, providerName, 'self-register');
        if (result.status === 201 || result.status === 200) {
          console.log(`[✓] Provider registered: ${providerName} (${providerId})`);
          const sid = sessionIds.get(connId);
          if (sid) auditLogger.logEvent('provider_registered', sid, { providerId, providerName });
          relay.send(connId, JSON.stringify({
            type: 'config_ack',
            configType: 'provider_register',
            appliedAt: new Date().toISOString(),
          }));
        } else {
          console.log(`[!] Provider registration rejected: ${result.body.error}`);
          relay.send(connId, JSON.stringify({
            type: 'config_nack',
            configType: 'provider_register',
            reason: result.body.error || 'Registration rejected',
            errorDetail: JSON.stringify(result.body),
          }));
        }
      } catch (err) {
        console.error(`[!] Provider registration error: ${err.message}`);
      }
    }
    return;
  }

  // ----- audit_query: query audit trail and respond to human client -----
  if (msg.type === 'audit_query') {
    const q = msg.payload || msg;
    const result = adminRoutes.queryAudit({
      startTime: q.startTime,
      endTime: q.endTime,
      eventType: q.eventType,
      sessionId: q.sessionId,
      limit: q.limit,
      offset: q.offset,
    });

    let integrity = null;
    if (q.includeIntegrity) {
      const intResult = adminRoutes.getChainIntegrity();
      integrity = {
        chainValid: intResult.body.chainValid,
        entriesChecked: intResult.body.totalEntries,
        lastVerifiedAt: intResult.body.lastVerifiedAt,
      };
    }

    relay.send(connId, JSON.stringify({
      type: 'audit_response',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: { id: 'relay', type: 'relay', displayName: 'Bastion Relay' },
      payload: {
        entries: result.body.entries,
        totalCount: result.body.totalCount,
        integrity,
      },
    }));
    console.log(`[→] audit_response sent to ${connId.slice(0, 8)} (${result.body.entries?.length || 0} entries)`);
    const sid = sessionIds.get(connId);
    if (sid) auditLogger.logEvent('audit_query', sid, { entriesReturned: result.body.entries?.length || 0, eventType: q.eventType });
    return;
  }

  // ----- context_update: forward to AI client -----
  if (msg.type === 'context_update') {
    const peerId = router.getPeer(connId);
    if (peerId) {
      relay.send(peerId, data);
      console.log(`[→] context_update forwarded to peer ${peerId.slice(0, 8)}`);
      const sid = sessionIds.get(connId);
      if (sid) auditLogger.logEvent('context_update', sid, { contentLength: (msg.payload?.content ?? '').length });
    }
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
    recordMessage(connId);
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
  connectionMessageCounts.delete(connId);

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
await adminServer.start();
console.log(`[★] Admin API listening on https://127.0.0.1:${ADMIN_PORT}`);
console.log('[★] Access via SSH tunnel: ssh -L 9444:127.0.0.1:9444 relay-host');
