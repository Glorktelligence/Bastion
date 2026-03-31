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
  ExtensionRegistry,
  FileQuarantine,
  HashVerifier,
  PurgeScheduler,
  FileTransferRouter,
  UpdateOrchestrator,
  Allowlist,
} from './packages/relay/dist/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TLS_CERT = process.env.BASTION_TLS_CERT || './certs/relay-cert.pem';
const TLS_KEY = process.env.BASTION_TLS_KEY || './certs/relay-key.pem';
const PORT = parseInt(process.env.BASTION_RELAY_PORT || '9443');
const ADMIN_PORT = parseInt(process.env.BASTION_ADMIN_PORT || '9444');
const AUDIT_DB = process.env.BASTION_AUDIT_DB || '/var/lib/bastion/audit.db';

// Read current version from VERSION file (single source of truth)
let CURRENT_VERSION = 'unknown';
try {
  CURRENT_VERSION = readFileSync(new URL('./VERSION', import.meta.url), 'utf-8').trim();
} catch {
  console.warn('[!] Could not read VERSION file — version will show as "unknown"');
}

// JWT secret — use env var or generate a random 256-bit key
const jwtSecretEnv = process.env.BASTION_JWT_SECRET;
const jwtSecret = jwtSecretEnv
  ? new TextEncoder().encode(jwtSecretEnv)
  : randomBytes(32);

// ---------------------------------------------------------------------------
// Project sync validation — relay-side content inspection
// ---------------------------------------------------------------------------

const PROJECT_SYNC_MAX_CONTENT = 1024 * 1024; // 1MB — matches AI client limit
const ALLOWED_EXTENSIONS = new Set(['.md', '.json', '.yaml', '.yml', '.txt']);
const DANGEROUS_CONTENT_PATTERNS = [
  { pattern: /<script[\s>]/i, reason: 'Embedded <script> tag' },
  { pattern: /javascript\s*:/i, reason: 'JavaScript URI scheme' },
  { pattern: /on(?:load|error|click|mouseover|focus|blur|submit|change|input|keydown|keyup)\s*=/i, reason: 'HTML event handler attribute' },
  { pattern: /<iframe[\s>]/i, reason: 'Embedded <iframe> tag' },
  { pattern: /<object[\s>]/i, reason: 'Embedded <object> tag' },
  { pattern: /<embed[\s>]/i, reason: 'Embedded <embed> tag' },
  { pattern: /<link[^>]+rel\s*=\s*["']?import/i, reason: 'HTML import link' },
  { pattern: /data\s*:\s*text\/html/i, reason: 'Data URI with text/html' },
  { pattern: /!!(?:python|ruby|java|php|perl)\//i, reason: 'YAML language-specific type tag' },
  { pattern: /"__proto__"\s*:/i, reason: 'JSON __proto__ pollution' },
  { pattern: /"constructor"\s*:\s*\{/i, reason: 'JSON constructor pollution' },
  { pattern: /"prototype"\s*:/i, reason: 'JSON prototype pollution' },
];

/** Validate a project_sync payload. Returns null if valid, or a rejection reason. */
function validateProjectSync(payload) {
  const path = payload?.path;
  const content = payload?.content;

  // Path validation
  if (!path || typeof path !== 'string' || path.trim().length === 0) return 'Empty path';
  const p = path.trim().replace(/\\/g, '/');
  if (p.startsWith('/')) return 'Absolute paths not allowed';
  if (p.includes('..')) return 'Path traversal (..) not allowed';
  if (p.includes('//')) return 'Double slashes not allowed';
  if (p.length > 255) return 'Path too long (max 255)';
  const segments = p.split('/');
  for (const seg of segments) {
    if (seg.startsWith('.')) return `Hidden file/directory not allowed: ${seg}`;
  }
  const ext = (p.lastIndexOf('.') >= 0 ? p.slice(p.lastIndexOf('.')) : '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return `File type not allowed: ${ext}`;

  // Content validation
  if (content === undefined || content === null || typeof content !== 'string') return 'Missing content';
  if (Buffer.byteLength(content) > PROJECT_SYNC_MAX_CONTENT) return `Content too large (max ${PROJECT_SYNC_MAX_CONTENT} bytes)`;

  // Content security scan
  for (const { pattern, reason } of DANGEROUS_CONTENT_PATTERNS) {
    if (pattern.test(content)) return `Dangerous content: ${reason}`;
  }

  return null;
}

console.log('=== Project Bastion — Relay Server ===');
console.log(`Version: ${CURRENT_VERSION}`);
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

// Extension registry — loads protocol extensions from extensions/ directory
const EXTENSIONS_DIR = process.env.BASTION_EXTENSIONS_DIR || './extensions';
const extensionRegistry = new ExtensionRegistry();
const extResult = extensionRegistry.loadFromDirectory(EXTENSIONS_DIR);
if (extResult.loaded.length > 0) {
  console.log(`[✓] Extensions loaded: ${extResult.loaded.join(', ')}`);
}
if (extResult.errors.length > 0) {
  for (const err of extResult.errors) console.error(`[!] Extension error: ${err}`);
}
const lockResult = extensionRegistry.lock();
if (lockResult.errors.length > 0) {
  for (const err of lockResult.errors) console.error(`[!] Extension dependency error: ${err}`);
}
console.log(`[✓] Extension registry locked (${extensionRegistry.extensionCount} extensions, ${extensionRegistry.messageTypeCount} types)`);

// ---------------------------------------------------------------------------
// File quarantine system
// ---------------------------------------------------------------------------

const fileQuarantine = new FileQuarantine({
  maxEntries: parseInt(process.env.BASTION_QUARANTINE_MAX_ENTRIES || '100'),
  defaultTimeoutMs: parseInt(process.env.BASTION_QUARANTINE_TIMEOUT_MS || '3600000'), // 1 hour
  auditLogger,
});
console.log('[✓] File quarantine initialised (capacity: ' + (process.env.BASTION_QUARANTINE_MAX_ENTRIES || '100') + ')');

const hashVerifier = new HashVerifier({ quarantine: fileQuarantine, auditLogger });
console.log('[✓] Hash verifier initialised (3-stage: submission → quarantine → delivery)');

const purgeScheduler = new PurgeScheduler({
  quarantine: fileQuarantine,
  intervalMs: parseInt(process.env.BASTION_PURGE_INTERVAL_MS || '60000'), // 60s
  onPurge: (result) => {
    if (result.purged.length > 0) {
      console.log(`[~] Quarantine purge: ${result.purged.length} expired, ${result.remaining} remaining`);
    }
  },
});
purgeScheduler.start();
console.log('[✓] Purge scheduler started (interval: ' + (process.env.BASTION_PURGE_INTERVAL_MS || '60000') + 'ms)');

// File transfer router — orchestrates manifest/offer/request workflow with 3-stage custody chain
const fileTransferRouter = new FileTransferRouter({
  quarantine: fileQuarantine,
  hashVerifier,
  send: (connectionId, data) => relay.send(connectionId, data),
  auditLogger,
});
console.log('[✓] File transfer router initialised (3-stage custody chain)');

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

// MaliClaw Clause — instantiate Allowlist for connection-time enforcement
const allowlist = new Allowlist();
console.log(`[✓] MaliClaw Clause active (${Allowlist.getMaliClawEntries().length} blocked patterns + /claw/i catch-all)`);

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
    return { active: fileQuarantine.getAll().length, capacity: parseInt(process.env.BASTION_QUARANTINE_MAX_ENTRIES || '100') };
  },
};

// Update orchestrator — manages multi-phase update lifecycle
const UPDATE_STATE_FILE = process.env.BASTION_UPDATE_STATE_FILE || '/var/lib/bastion/pending-update.json';
const updateOrchestrator = new UpdateOrchestrator({
  auditLogger,
  send: (connectionId, data) => relay.send(connectionId, data),
  stateFilePath: UPDATE_STATE_FILE,
});
const resumedUpdate = updateOrchestrator.loadPendingState();
if (resumedUpdate) {
  console.log('[!] Resumed pending update from state file — waiting for reconnections');
} else {
  console.log('[✓] Update orchestrator initialised (no pending update)');
}

const adminRoutes = new AdminRoutes({
  providerRegistry,
  auditLogger,
  statusProvider,
  extensionRegistry,
  updateOrchestrator,
  currentVersion: CURRENT_VERSION,
  onDisclosureUpdate: (cfg) => updateDisclosureConfig(cfg),
  onUpdateMessage: (type, payload) => {
    if (!updaterConnectionId) {
      console.log(`[!] No updater client connected — cannot send ${type}`);
      return;
    }
    relay.send(updaterConnectionId, JSON.stringify({
      type,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: { id: 'relay', type: 'relay', displayName: 'Bastion Relay' },
      payload,
    }));
    console.log(`[→] ${type} sent to updater ${updaterConnectionId.slice(0, 8)}`);
  },
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
let updaterConnectionId = null;

/** Session IDs keyed by connection ID (for audit logging). */
const sessionIds = new Map();

/** Last registered provider info — sent to human client on pairing and registration. */
let registeredProvider = null;

/** Send provider_status to a connection. */
function sendProviderStatus(targetConnectionId) {
  if (!registeredProvider) return;
  relay.send(targetConnectionId, JSON.stringify({
    type: 'provider_status',
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sender: { id: 'relay', type: 'relay', displayName: 'Bastion Relay' },
    payload: registeredProvider,
  }));
}

// ---------------------------------------------------------------------------
// AI Disclosure — relay-configurable transparency banner (default: OFF)
// ---------------------------------------------------------------------------

/** @type {{ enabled: boolean; text: string; style: string; position: string; dismissible: boolean; link?: string; linkText?: string; jurisdiction?: string }} */
let disclosureConfig = {
  enabled: process.env.BASTION_DISCLOSURE_ENABLED === 'true',
  text: process.env.BASTION_DISCLOSURE_TEXT || 'You are interacting with an AI system powered by {provider} ({model}).',
  style: process.env.BASTION_DISCLOSURE_STYLE || 'info',
  position: process.env.BASTION_DISCLOSURE_POSITION || 'banner',
  dismissible: process.env.BASTION_DISCLOSURE_DISMISSIBLE !== 'false',
  link: process.env.BASTION_DISCLOSURE_LINK || undefined,
  linkText: process.env.BASTION_DISCLOSURE_LINK_TEXT || undefined,
  jurisdiction: process.env.BASTION_DISCLOSURE_JURISDICTION || undefined,
};

/** Substitute {provider} and {model} template vars with current values. */
function resolveDisclosureText(text) {
  const providerName = registeredProvider?.providerName ?? 'AI';
  const model = registeredProvider?.model ?? 'unknown';
  return text.replace(/\{provider\}/g, providerName).replace(/\{model\}/g, model);
}

/** Send ai_disclosure to a human client if disclosure is enabled. */
function sendAiDisclosure(targetConnectionId) {
  if (!disclosureConfig.enabled) return;
  const payload = {
    text: resolveDisclosureText(disclosureConfig.text),
    style: disclosureConfig.style,
    position: disclosureConfig.position,
    dismissible: disclosureConfig.dismissible,
  };
  if (disclosureConfig.link) payload.link = disclosureConfig.link;
  if (disclosureConfig.linkText) payload.linkText = disclosureConfig.linkText;
  if (disclosureConfig.jurisdiction) payload.jurisdiction = disclosureConfig.jurisdiction;

  relay.send(targetConnectionId, JSON.stringify({
    type: 'ai_disclosure',
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sender: { id: 'relay', type: 'relay', displayName: 'Bastion Relay' },
    payload,
  }));

  auditLogger.logEvent('ai_disclosure_sent', sessionIds.get(targetConnectionId) || 'unknown', {
    text: payload.text,
    jurisdiction: disclosureConfig.jurisdiction || null,
    targetConnectionId,
  });
}

/** Update disclosure config and broadcast to all connected human clients. */
function updateDisclosureConfig(newConfig) {
  disclosureConfig = { ...disclosureConfig, ...newConfig };
  if (disclosureConfig.enabled && humanConnectionId) {
    sendAiDisclosure(humanConnectionId);
  }
}

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

    // Send provider info to human client (if AI already registered)
    if (registeredProvider) {
      sendProviderStatus(humanConnectionId);
      console.log(`[→] provider_status sent to human: ${registeredProvider.providerName}`);
    }

    // Send AI disclosure banner if configured (regulatory transparency)
    sendAiDisclosure(humanConnectionId);
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

// ---------------------------------------------------------------------------
// Sender-type validation — directional message enforcement
// ---------------------------------------------------------------------------

/** Messages that can only originate from a specific client type. */
const SENDER_TYPE_RESTRICTIONS = {
  // Human-only messages (human → AI)
  task: 'human', confirmation: 'human', config_update: 'human',
  context_update: 'human', tool_approved: 'human', tool_denied: 'human',
  tool_revoke: 'human', challenge_config: 'human', budget_config: 'human',
  memory_proposal: 'human', memory_list: 'human', memory_update: 'human',
  memory_delete: 'human', project_sync: 'human', project_list: 'human',
  project_delete: 'human', project_config: 'human',
  // AI-only messages (AI → human)
  denial: 'ai', challenge: 'ai', result: 'ai', status: 'ai',
  provider_status: 'ai', budget_alert: 'ai', budget_status: 'ai',
  challenge_status: 'ai', challenge_config_ack: 'ai',
  memory_decision: 'ai', memory_list_response: 'ai',
  project_sync_ack: 'ai', project_list_response: 'ai', project_config_ack: 'ai',
  tool_registry_sync: 'ai', tool_request: 'ai', tool_result: 'ai', tool_alert: 'ai',
};

/** Check if a message's sender type matches the expected type for that message. */
function validateSenderType(connId, msgType) {
  const expectedType = SENDER_TYPE_RESTRICTIONS[msgType];
  if (!expectedType) return true; // No restriction for this message type
  const client = router.getClient(connId);
  if (!client) return false; // Not registered
  return client.identity.type === expectedType;
}

relay.on('message', async (data, info) => {
  const connId = info.id;

  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    console.error(`[!] Non-JSON message from ${connId.slice(0, 8)} — dropping`);
    return;
  }

  // ----- ping: application-level keep-alive -----
  if (msg.type === 'ping') {
    relay.send(connId, '{"type":"pong"}');
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

    // MaliClaw Clause — check BEFORE issuing JWT (hardcoded, non-negotiable)
    if (Allowlist.isMaliClawMatch(identity.id) || Allowlist.isMaliClawMatch(identity.displayName)) {
      const matchDetail = Allowlist.getMaliClawMatchDetail(identity.id) || Allowlist.getMaliClawMatchDetail(identity.displayName);
      console.log(`[✗] MALICLAW REJECTED: ${identity.id} (pattern: ${matchDetail.pattern || 'claw catch-all'})`);
      relay.send(connId, JSON.stringify({
        type: 'error',
        code: 'BASTION-1003',
        message: 'Connection rejected — blocked by MaliClaw Clause',
        timestamp: new Date().toISOString(),
      }));
      auditLogger.logEvent('security_violation', 'pre-auth', {
        reason: 'maliclaw_rejected',
        clientId: identity.id,
        displayName: identity.displayName,
        pattern: matchDetail.pattern,
      });
      relay.close(connId);
      return;
    }

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

    // Track human/AI/updater connection
    if (identity.type === 'human') {
      humanConnectionId = connId;
      console.log(`[✓] Human client registered: ${identity.displayName}`);
    } else if (identity.type === 'ai') {
      aiConnectionId = connId;
      console.log(`[✓] AI client registered: ${identity.displayName}`);
    } else if (identity.type === 'updater') {
      updaterConnectionId = connId;
      // Register with orchestrator: agentId=identity.id, component=identity.id
      // The component name matches the agentId (e.g. "updater-relay", "updater-ai")
      updateOrchestrator.registerAgent(connId, identity.id, identity.id);
      console.log(`[✓] Updater client registered: ${identity.displayName} (${identity.id})`);
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

          // Track provider info (including model + adapters) and notify the paired human client
          const payload = msg.payload || msg;
          registeredProvider = {
            providerId,
            providerName,
            model: payload.model || null,
            status: 'active',
            capabilities: capabilities || { conversation: true, taskExecution: true, fileTransfer: false },
            adapters: payload.adapters || null,
          };
          if (humanConnectionId && router.getPeer(humanConnectionId)) {
            sendProviderStatus(humanConnectionId);
            console.log(`[→] provider_status sent to human: ${providerName}`);
          }
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

  // ----- extension_query: return loaded extensions -----
  if (msg.type === 'extension_query') {
    const exts = extensionRegistry.getAllExtensions();
    relay.send(connId, JSON.stringify({
      type: 'extension_list_response',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender: { id: 'relay', type: 'relay', displayName: 'Bastion Relay' },
      payload: {
        extensions: exts.map(e => ({
          namespace: e.namespace,
          name: e.name,
          version: e.version,
          messageTypes: e.messageTypes.map(mt => mt.name),
          ui: e.ui || null,
        })),
        totalCount: exts.length,
      },
    }));
    console.log(`[→] extension_list_response sent to ${connId.slice(0, 8)} (${exts.length} extensions)`);
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

  // ----- Sender-type validation — directional message enforcement -----
  if (!validateSenderType(connId, msg.type)) {
    const client = router.getClient(connId);
    const actualType = client?.identity?.type || 'unknown';
    const expectedType = SENDER_TYPE_RESTRICTIONS[msg.type];
    console.log(`[!] SENDER TYPE MISMATCH: ${msg.type} from ${actualType} (expected: ${expectedType}) — REJECTED`);
    relay.send(connId, JSON.stringify({
      type: 'error',
      code: 'BASTION-3003',
      message: `Message type "${msg.type}" not allowed from ${actualType} client`,
      timestamp: new Date().toISOString(),
    }));
    const sid = sessionIds.get(connId);
    if (sid) auditLogger.logEvent('security_violation', sid, {
      reason: 'sender_type_mismatch',
      messageType: msg.type,
      actualSenderType: actualType,
      expectedSenderType: expectedType,
    });
    return;
  }

  // ----- memory_proposal / memory_decision: forward between paired clients -----
  // ----- challenge_* messages: forward between paired clients -----
  if (msg.type === 'challenge_status' || msg.type === 'challenge_config' || msg.type === 'challenge_config_ack') {
    const peerId = router.getPeer(connId);
    if (peerId) {
      relay.send(peerId, data);
      console.log(`[→] ${msg.type} forwarded to peer ${peerId.slice(0, 8)}`);
      const sid = sessionIds.get(connId);
      if (sid) auditLogger.logEvent(msg.type, sid, { active: msg.payload?.active, accepted: msg.payload?.accepted });
    }
    return;
  }

  // ----- key_exchange: forward between paired clients (relay is zero-knowledge) -----
  if (msg.type === 'key_exchange') {
    if (connId === updaterConnectionId) {
      // Updater → human only
      if (humanConnectionId) {
        relay.send(humanConnectionId, data);
        console.log(`[→] key_exchange forwarded from updater to human ${humanConnectionId.slice(0, 8)}`);
      }
    } else {
      // Human or AI → forward to paired peer (standard key exchange)
      const peerId = router.getPeer(connId);
      if (peerId) {
        relay.send(peerId, data);
        console.log(`[→] key_exchange forwarded to peer ${peerId.slice(0, 8)} (relay sees public key only)`);
      }
      // Human → ALSO forward to updater (if connected, for update channel E2E)
      if (connId === humanConnectionId && updaterConnectionId) {
        relay.send(updaterConnectionId, data);
        console.log(`[→] key_exchange also forwarded from human to updater ${updaterConnectionId.slice(0, 8)}`);
      }
    }
    const sid = sessionIds.get(connId);
    if (sid) auditLogger.logEvent('key_exchange', sid, {
      // Log only that exchange happened — NOT the key itself (metadata only)
      messageType: 'key_exchange',
    });
    return;
  }

  // ----- budget_* messages: forward between paired clients with audit -----
  if (msg.type === 'budget_status' || msg.type === 'budget_alert' || msg.type === 'budget_config') {
    const peerId = router.getPeer(connId);
    if (peerId) {
      relay.send(peerId, data);
      console.log(`[→] ${msg.type} forwarded to peer ${peerId.slice(0, 8)}`);
      const sid = sessionIds.get(connId);
      if (sid) {
        if (msg.type === 'budget_alert') {
          auditLogger.logEvent('budget_alert', sid, {
            alertLevel: msg.payload?.alertLevel,
            budgetRemaining: msg.payload?.budgetRemaining,
            message: msg.payload?.message,
          });
        } else if (msg.type === 'budget_config') {
          auditLogger.logEvent('budget_config_changed', sid, {
            monthlyCapUsd: msg.payload?.monthlyCapUsd,
            maxPerMonth: msg.payload?.maxPerMonth,
            maxPerDay: msg.payload?.maxPerDay,
          });
        } else {
          auditLogger.logEvent('budget_status', sid, {
            percentUsed: msg.payload?.percentUsed,
            alertLevel: msg.payload?.alertLevel,
          });
        }
      }
    }
    return;
  }

  // ----- tool_* messages: forward between paired clients -----
  if (msg.type === 'tool_registry_sync' || msg.type === 'tool_registry_ack' || msg.type === 'tool_request' || msg.type === 'tool_approved' || msg.type === 'tool_denied' || msg.type === 'tool_result' || msg.type === 'tool_revoke' || msg.type === 'tool_alert' || msg.type === 'tool_alert_response') {
    const peerId = router.getPeer(connId);
    if (peerId) {
      relay.send(peerId, data);
      console.log(`[→] ${msg.type} forwarded to peer ${peerId.slice(0, 8)}`);
      const sid = sessionIds.get(connId);
      if (sid) {
        auditLogger.logEvent(msg.type, sid, {
          toolId: msg.payload?.toolId || msg.payload?.requestId,
          messageType: msg.type,
          // NOT parameters or results — metadata only
        });
      }
    }
    return;
  }

  // ----- project_* messages: validate and forward between paired clients -----
  if (msg.type === 'project_sync' || msg.type === 'project_sync_ack' || msg.type === 'project_list' || msg.type === 'project_list_response' || msg.type === 'project_delete' || msg.type === 'project_config' || msg.type === 'project_config_ack') {
    // Validate project_sync content at the relay before forwarding
    if (msg.type === 'project_sync') {
      const p = msg.payload || msg;
      const rejection = validateProjectSync(p);
      if (rejection) {
        console.log(`[!] project_sync REJECTED: ${rejection} (path: ${p.path})`);
        relay.send(connId, JSON.stringify({
          type: 'error',
          message: `Project sync rejected: ${rejection}`,
          timestamp: new Date().toISOString(),
        }));
        const sid = sessionIds.get(connId);
        if (sid) auditLogger.logEvent('security_violation', sid, {
          reason: rejection,
          path: p.path,
          contentLength: (p.content || '').length,
          messageType: 'project_sync',
        });
        return;
      }
    }

    const peerId = router.getPeer(connId);
    if (peerId) {
      relay.send(peerId, data);
      console.log(`[→] ${msg.type} forwarded to peer ${peerId.slice(0, 8)}`);
      const sid = sessionIds.get(connId);
      if (sid) {
        auditLogger.logEvent(msg.type, sid, {
          path: msg.payload?.path,
          messageType: msg.type,
        });
      }
    }
    return;
  }

  if (msg.type === 'memory_proposal' || msg.type === 'memory_decision' || msg.type === 'memory_list' || msg.type === 'memory_list_response' || msg.type === 'memory_update' || msg.type === 'memory_delete') {
    const peerId = router.getPeer(connId);
    if (peerId) {
      relay.send(peerId, data);
      console.log(`[→] ${msg.type} forwarded to peer ${peerId.slice(0, 8)}`);
      const sid = sessionIds.get(connId);
      if (sid) {
        auditLogger.logEvent(msg.type === 'memory_proposal' ? 'memory_proposed' : 'memory_decided', sid, {
          proposalId: msg.payload?.proposalId || 'unknown',
          decision: msg.payload?.decision,
          category: msg.payload?.category,
          // Content is private — only metadata in audit trail
        });
      }
    }
    return;
  }

  // ----- conversation_* messages: forward between paired clients with audit -----
  // ----- conversation_stream: forward streaming chunks (low-overhead, no per-chunk audit) -----
  if (msg.type === 'conversation_stream') {
    const peerId = router.getPeer(connId);
    if (peerId) {
      relay.send(peerId, data);
      // Only audit stream start/end — not every chunk (too noisy)
      const p = msg.payload || msg;
      if (p.index === 0) {
        const sid = sessionIds.get(connId);
        if (sid) auditLogger.logEvent('stream_started', sid, { conversationId: p.conversationId });
      } else if (p.final) {
        const sid = sessionIds.get(connId);
        if (sid) auditLogger.logEvent('stream_completed', sid, { conversationId: p.conversationId, chunks: p.index });
      }
    }
    return;
  }

  if (msg.type === 'conversation_list' || msg.type === 'conversation_list_response' || msg.type === 'conversation_create' || msg.type === 'conversation_create_ack' || msg.type === 'conversation_switch' || msg.type === 'conversation_switch_ack' || msg.type === 'conversation_history' || msg.type === 'conversation_history_response' || msg.type === 'conversation_archive' || msg.type === 'conversation_delete' || msg.type === 'conversation_compact' || msg.type === 'conversation_compact_ack') {
    const peerId = router.getPeer(connId);
    if (peerId) {
      relay.send(peerId, data);
      console.log(`[→] ${msg.type} forwarded to peer ${peerId.slice(0, 8)}`);
      const sid = sessionIds.get(connId);
      if (sid) {
        // Audit metadata only — not message content
        const auditType = msg.type === 'conversation_create' ? 'conversation_created'
          : msg.type === 'conversation_switch' ? 'conversation_switched'
          : msg.type === 'conversation_archive' ? 'conversation_archived'
          : msg.type === 'conversation_delete' ? 'conversation_deleted'
          : msg.type === 'conversation_compact' ? 'compaction_triggered'
          : msg.type === 'conversation_compact_ack' ? 'compaction_completed'
          : msg.type;
        auditLogger.logEvent(auditType, sid, {
          conversationId: msg.payload?.conversationId,
          messageType: msg.type,
        });
      }
    }
    return;
  }

  // ----- update_* messages: route between updater client and admin with audit -----
  if (msg.type === 'update_check' || msg.type === 'update_available' || msg.type === 'update_prepare' || msg.type === 'update_prepare_ack' || msg.type === 'update_execute' || msg.type === 'update_build_status' || msg.type === 'update_restart' || msg.type === 'update_reconnected' || msg.type === 'update_complete' || msg.type === 'update_failed') {
    const sid = sessionIds.get(connId);

    // Map update messages to orchestrator + admin status tracking
    const p = msg.payload || {};
    if (msg.type === 'update_available') {
      updateOrchestrator.handleUpdateAvailable(p.availableVersion, p.commitHash);
      adminRoutes.setUpdateStatus('checking', { targetVersion: p.availableVersion });
    } else if (msg.type === 'update_prepare_ack') {
      updateOrchestrator.handlePrepareAck(p.component);
    } else if (msg.type === 'update_build_status') {
      updateOrchestrator.handleBuildStatus(p.component, p.phase, p.duration, p.error);
      if (p.phase === 'complete') adminRoutes.setUpdateStatus('complete', { component: p.component });
      else if (p.phase === 'failed') adminRoutes.setUpdateStatus('failed', { component: p.component, error: p.error });
      else adminRoutes.setUpdateStatus('building', { component: p.component });
    } else if (msg.type === 'update_reconnected') {
      updateOrchestrator.handleReconnected(p.component, p.version);
    } else if (msg.type === 'update_complete') {
      adminRoutes.setUpdateStatus('complete', { targetVersion: p.toVersion });
    } else if (msg.type === 'update_failed') {
      adminRoutes.setUpdateStatus('failed', { component: p.component, error: p.error });
    } else if (msg.type === 'update_restart') {
      adminRoutes.setUpdateStatus('restarting', { component: p.targetComponent });
    } else if (msg.type === 'update_prepare') {
      adminRoutes.setUpdateStatus('preparing', { targetVersion: p.targetVersion });
    }

    // Forward to updater or admin depending on sender
    // Relay cannot read encrypted payloads — it only routes and audits metadata
    if (connId === updaterConnectionId) {
      // From updater → admin panel can poll /api/update/status
      console.log(`[→] ${msg.type} from updater (admin will see status via API)`);
    } else if (updaterConnectionId) {
      // From admin-initiated → forward to updater
      relay.send(updaterConnectionId, data);
      console.log(`[→] ${msg.type} forwarded to updater ${updaterConnectionId.slice(0, 8)}`);
    }

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

  // ----- file_manifest: intercept file upload, quarantine, notify peer -----
  if (msg.type === 'file_manifest') {
    const p = msg.payload || msg;
    const senderClient = router.getClient(connId);
    const peerId = router.getPeer(connId);

    if (!senderClient || !peerId) {
      relay.send(connId, JSON.stringify({
        type: 'error',
        code: 'BASTION-3001',
        message: 'No paired peer — file transfer cannot proceed',
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    // Determine direction from sender type
    const direction = senderClient.identity.type === 'human' ? 'human_to_ai' : 'ai_to_human';

    // Extract file data — client embeds base64-encoded file bytes in payload
    const fileDataB64 = p.fileData;
    if (!fileDataB64) {
      relay.send(connId, JSON.stringify({
        type: 'error',
        code: 'BASTION-5001',
        message: 'file_manifest missing fileData — file content required for quarantine',
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    const fileData = new Uint8Array(Buffer.from(fileDataB64, 'base64'));
    const transferId = p.transferId || randomUUID();

    // Submit to FileTransferRouter — quarantines, verifies hash, notifies peer
    const result = fileTransferRouter.submitFile({
      transferId,
      direction,
      sender: senderClient.identity,
      filename: p.filename,
      sizeBytes: p.sizeBytes || fileData.length,
      mimeType: p.mimeType,
      declaredHash: p.hash,
      data: fileData,
      purpose: p.purpose || '',
      projectContext: p.projectContext,
      taskId: p.taskId,
      recipientConnectionId: peerId,
    });

    if (result.status === 'submitted') {
      console.log(`[✓] File quarantined: ${p.filename} (${transferId.slice(0, 8)}) ${direction}`);
      recordMessage(connId);
      const sid = sessionIds.get(connId);
      if (sid) auditLogger.logEvent('file_submitted', sid, {
        transferId,
        filename: p.filename,
        direction,
        sizeBytes: fileData.length,
        sender_hash: p.hash,
        stage: 'submitted',
        actor: senderClient.identity.id,
      });
    } else if (result.status === 'hash_mismatch') {
      console.log(`[!] BASTION-5001: File hash mismatch at submission: ${p.filename}`);
      relay.send(connId, JSON.stringify({
        type: 'error',
        code: 'BASTION-5001',
        message: `Hash verification failed at submission: expected ${result.expected}, got ${result.actual}`,
        timestamp: new Date().toISOString(),
      }));
      const sid = sessionIds.get(connId);
      if (sid) auditLogger.logEvent('file_hash_mismatch', sid, {
        transferId, filename: p.filename, stage: 'submission',
        expected: result.expected, actual: result.actual,
      });
    } else if (result.status === 'quarantine_full') {
      console.log(`[!] BASTION-5004: Quarantine full — rejecting ${p.filename}`);
      relay.send(connId, JSON.stringify({
        type: 'error',
        code: 'BASTION-5004',
        message: 'File quarantine is full — try again later',
        timestamp: new Date().toISOString(),
      }));
    } else {
      relay.send(connId, JSON.stringify({
        type: 'error',
        message: `File submission failed: ${result.status}`,
        timestamp: new Date().toISOString(),
      }));
    }
    return;
  }

  // ----- file_request: recipient accepts — authorise and deliver file data -----
  if (msg.type === 'file_request') {
    const p = msg.payload || msg;
    const transferId = p.transferId;

    if (!transferId) {
      relay.send(connId, JSON.stringify({
        type: 'error',
        code: 'BASTION-5005',
        message: 'file_request missing transferId',
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    // Verify the requester is the intended recipient (not the sender)
    const transfer = fileTransferRouter.getTransfer(transferId);
    if (!transfer) {
      relay.send(connId, JSON.stringify({
        type: 'error',
        code: 'BASTION-5005',
        message: `File transfer not found: ${transferId}`,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (transfer.recipientConnectionId !== connId) {
      console.log(`[!] Unauthorised file_request from ${connId.slice(0, 8)} — expected recipient ${transfer.recipientConnectionId.slice(0, 8)}`);
      relay.send(connId, JSON.stringify({
        type: 'error',
        code: 'BASTION-5005',
        message: 'Not authorised to request this file',
        timestamp: new Date().toISOString(),
      }));
      const sid = sessionIds.get(connId);
      if (sid) auditLogger.logEvent('security_violation', sid, {
        reason: 'Unauthorised file_request',
        transferId,
        requester: connId,
        expectedRecipient: transfer.recipientConnectionId,
      });
      return;
    }

    // Deliver: FTR verifies hash at delivery, releases from quarantine, sends file_data
    const result = fileTransferRouter.handleFileRequest(transferId, connId);

    if (result.status === 'delivered') {
      console.log(`[✓] File delivered: ${transferId.slice(0, 8)} (${result.sizeBytes} bytes) — 3-stage hash verified`);
      recordMessage(connId);
      const sid = sessionIds.get(connId);
      if (sid) auditLogger.logEvent('file_delivered', sid, {
        transferId,
        sizeBytes: result.sizeBytes,
        recipient_hash: 'verified',
        stage: 'delivered',
        actor: router.getClient(connId)?.identity.id || 'unknown',
      });
    } else if (result.status === 'hash_mismatch_at_delivery') {
      console.log(`[!] BASTION-5001: Hash mismatch at delivery stage — transfer ${transferId.slice(0, 8)} aborted`);
      relay.send(connId, JSON.stringify({
        type: 'error',
        code: 'BASTION-5001',
        message: 'Hash verification failed at delivery — transfer aborted',
        timestamp: new Date().toISOString(),
      }));
      const sid = sessionIds.get(connId);
      if (sid) auditLogger.logEvent('file_hash_mismatch', sid, { transferId, stage: 'delivery' });
    } else {
      relay.send(connId, JSON.stringify({
        type: 'error',
        code: 'BASTION-5005',
        message: `File delivery failed: ${result.status}`,
        timestamp: new Date().toISOString(),
      }));
    }
    return;
  }

  // ----- file_offer: relay-generated only — clients should not send this -----
  if (msg.type === 'file_offer') {
    console.log(`[!] Unexpected file_offer from client ${connId.slice(0, 8)} — file_offer is relay-generated`);
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
  } else if (connId === updaterConnectionId) {
    updaterConnectionId = null;
    updateOrchestrator.unregisterAgent(connId);
    console.log('[-] Updater client disconnected');
  } else if (connId === aiConnectionId) {
    aiConnectionId = null;
    registeredProvider = null;
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
  console.log('[★] File transfer pipeline active — quarantine + 3-stage hash verification');
  console.log('[★] Custody chain: [submission] → [quarantine] → [delivery]');
  console.log('[★] Awaiting connections...');
});

await relay.start();
await adminServer.start();
console.log(`[★] Admin API listening on https://127.0.0.1:${ADMIN_PORT}`);
console.log('[★] Access via SSH tunnel: ssh -L 9444:127.0.0.1:9444 relay-host');
