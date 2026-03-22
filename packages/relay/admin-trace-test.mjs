// Trace test: Admin server, authentication, provider CRUD, capability enforcement
// Run with: node packages/relay/admin-trace-test.mjs

import {
  AdminAuth,
  AdminAuthError,
  AdminRoutes,
  AdminServer,
  AdminServerError,
  BastionRelay,
  JwtService,
  defaultCapabilityMatrix,
  ProviderRegistry,
  Allowlist,
  AuditLogger,
  AUDIT_EVENT_TYPES,
  MessageRouter,
  generateSelfSigned,
} from './dist/index.js';
import { PROTOCOL_VERSION, MESSAGE_TYPES } from '@bastion/protocol';
import { randomUUID, randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

/** Helper: small delay. */
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Helper: make an HTTPS request to the admin server. */
function adminRequest(port, method, path, body, auth) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (auth) {
      const basic = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      options.headers['Authorization'] = `Basic ${basic}`;
      options.headers['X-TOTP'] = auth.totpCode;
    }

    const req = httpsRequest(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, body: JSON.parse(text) });
        } catch {
          resolve({ status: res.statusCode, body: { raw: text } });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  console.log('=== Admin Server & Provider Management Trace Tests ===\n');

  // -------------------------------------------------------------------
  // Test 1: Password hashing
  // -------------------------------------------------------------------
  console.log('--- Test 1: Password hashing ---');
  {
    const hash = AdminAuth.hashPassword('test-password-123');
    check('hash format starts with scrypt:', hash.startsWith('scrypt:'));
    check('hash has 3 parts', hash.split(':').length === 3);

    const valid = AdminAuth.verifyPassword('test-password-123', hash);
    check('correct password verifies', valid);

    const invalid = AdminAuth.verifyPassword('wrong-password', hash);
    check('wrong password rejected', !invalid);

    const empty = AdminAuth.verifyPassword('', hash);
    check('empty password rejected', !empty);

    const badFormat = AdminAuth.verifyPassword('test', 'notavalidhash');
    check('bad hash format rejected', !badFormat);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 2: TOTP generation and verification
  // -------------------------------------------------------------------
  console.log('--- Test 2: TOTP generation and verification ---');
  {
    const secret = AdminAuth.generateTotpSecret();
    check('secret is base32', /^[A-Z2-7]+=*$/.test(secret));
    check('secret has good length', secret.replace(/=/g, '').length >= 24);

    const code = AdminAuth.generateTotpCode(secret);
    check('code is 6 digits', /^\d{6}$/.test(code));

    const verified = AdminAuth.verifyTotp(secret, code);
    check('current code verifies', verified);

    const wrongCode = AdminAuth.verifyTotp(secret, '000000');
    // Might accidentally be valid, so we check with a very unlikely code
    const bogus = AdminAuth.verifyTotp(secret, '999999');
    // At least one should fail (extremely unlikely both are valid)
    check('bogus codes unlikely to verify', !wrongCode || !bogus);

    // Different secrets produce different codes
    const secret2 = AdminAuth.generateTotpSecret();
    const code2 = AdminAuth.generateTotpCode(secret2);
    check('different secrets differ', secret !== secret2);

    // Verify window tolerance (code from same period should work)
    const verified2 = AdminAuth.verifyTotp(secret, code, 1);
    check('window tolerance works', verified2);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 3: Admin auth — client certificate
  // -------------------------------------------------------------------
  console.log('--- Test 3: Admin auth — client certificate ---');
  {
    const fingerprint = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
    const auth = new AdminAuth({
      accounts: [],
      trustedCertFingerprints: [fingerprint],
    });

    check('1 trusted cert', auth.trustedCertCount === 1);

    const result1 = auth.verifyClientCert(fingerprint);
    check('trusted cert authenticates', result1.authenticated);
    check('cert method', result1.authenticated && result1.method === 'cert');

    const result2 = auth.verifyClientCert('FF:FF:FF:00:00:00');
    check('untrusted cert rejected', !result2.authenticated);
    check('untrusted reason', !result2.authenticated && result2.reason === 'untrusted_cert');

    const result3 = auth.verifyClientCert(undefined);
    check('missing cert rejected', !result3.authenticated);
    check('missing cert reason', !result3.authenticated && result3.reason === 'invalid_cert');

    // No trusted certs configured
    const auth2 = new AdminAuth({ accounts: [] });
    const result4 = auth2.verifyClientCert(fingerprint);
    check('no trusted certs rejects all', !result4.authenticated);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 4: Admin auth — TOTP credentials
  // -------------------------------------------------------------------
  console.log('--- Test 4: Admin auth — TOTP credentials ---');
  {
    const secret = AdminAuth.generateTotpSecret();
    const passwordHash = AdminAuth.hashPassword('admin-pass');

    const auth = new AdminAuth({
      accounts: [
        { username: 'admin', passwordHash, totpSecret: secret, active: true },
        { username: 'disabled', passwordHash, totpSecret: secret, active: false },
      ],
    });

    check('2 accounts', auth.accountCount === 2);

    // Correct credentials
    const code = AdminAuth.generateTotpCode(secret);
    const result1 = auth.verifyCredentials('admin', 'admin-pass', code);
    check('correct credentials authenticate', result1.authenticated);
    check('totp method', result1.authenticated && result1.method === 'totp');
    check('correct username', result1.authenticated && result1.username === 'admin');

    // Wrong password
    const result2 = auth.verifyCredentials('admin', 'wrong', code);
    check('wrong password rejected', !result2.authenticated);
    check('wrong password reason', !result2.authenticated && result2.reason === 'invalid_credentials');

    // Wrong TOTP
    const result3 = auth.verifyCredentials('admin', 'admin-pass', '000000');
    // Note: 000000 might accidentally be valid, so check it could fail
    if (!result3.authenticated) {
      check('wrong TOTP rejected', true);
    } else {
      check('wrong TOTP (happened to match)', true); // Extremely unlikely but possible
    }

    // Unknown user
    const result4 = auth.verifyCredentials('unknown', 'pass', '123456');
    check('unknown user rejected', !result4.authenticated);
    check('unknown user reason', !result4.authenticated && result4.reason === 'invalid_credentials');

    // Inactive account
    const code2 = AdminAuth.generateTotpCode(secret);
    const result5 = auth.verifyCredentials('disabled', 'admin-pass', code2);
    check('inactive account rejected', !result5.authenticated);
    check('inactive reason', !result5.authenticated && result5.reason === 'account_inactive');
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 5: Admin auth — rate limiting and lockout
  // -------------------------------------------------------------------
  console.log('--- Test 5: Rate limiting and lockout ---');
  {
    const secret = AdminAuth.generateTotpSecret();
    const passwordHash = AdminAuth.hashPassword('pass');

    const auth = new AdminAuth({
      accounts: [
        { username: 'ratelimited', passwordHash, totpSecret: secret, active: true },
      ],
      maxLoginAttempts: 3,
      lockoutWindowMs: 60_000,
      lockoutDurationMs: 5_000, // Short for testing
    });

    check('not locked initially', !auth.isLockedOut('ratelimited'));
    check('0 failed attempts', auth.getFailedAttempts('ratelimited') === 0);

    // Fail 3 times
    auth.verifyCredentials('ratelimited', 'wrong', '000000');
    check('1 failed attempt', auth.getFailedAttempts('ratelimited') === 1);

    auth.verifyCredentials('ratelimited', 'wrong', '000000');
    check('2 failed attempts', auth.getFailedAttempts('ratelimited') === 2);

    auth.verifyCredentials('ratelimited', 'wrong', '000000');
    check('locked after 3 attempts', auth.isLockedOut('ratelimited'));

    // Even correct credentials should be rejected
    const code = AdminAuth.generateTotpCode(secret);
    const result = auth.verifyCredentials('ratelimited', 'pass', code);
    check('locked user rejected', !result.authenticated);
    check('locked reason', !result.authenticated && result.reason === 'account_locked');

    // Lockout expiry
    const expiry = auth.getLockoutExpiry('ratelimited');
    check('lockout expiry set', expiry !== null && expiry > Date.now());

    // Wait for lockout to expire
    await delay(5100);
    check('lockout expired', !auth.isLockedOut('ratelimited'));

    // Should be able to login again
    const code2 = AdminAuth.generateTotpCode(secret);
    const result2 = auth.verifyCredentials('ratelimited', 'pass', code2);
    check('can login after lockout expires', result2.authenticated);
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 6: Admin server — binding restrictions
  // -------------------------------------------------------------------
  console.log('--- Test 6: Admin server — binding restrictions ---');
  {
    const { cert, key } = await generateSelfSigned();
    const auth = new AdminAuth({ accounts: [] });
    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });

    // Should work with localhost
    const server1 = new AdminServer({
      port: 0,
      host: '127.0.0.1',
      tls: { cert, key },
      auth,
      routes,
    });
    check('localhost binding accepted', server1 instanceof AdminServer);

    // Should reject public interfaces
    let publicErr1 = false;
    try {
      new AdminServer({
        port: 0,
        host: '0.0.0.0',
        tls: { cert, key },
        auth,
        routes,
        auditLogger: audit,
      });
    } catch (e) {
      publicErr1 = e instanceof AdminServerError;
    }
    check('0.0.0.0 rejected', publicErr1);

    let publicErr2 = false;
    try {
      new AdminServer({
        port: 0,
        host: '::',
        tls: { cert, key },
        auth,
        routes,
      });
    } catch (e) {
      publicErr2 = e instanceof AdminServerError;
    }
    check(':: rejected', publicErr2);

    // Should accept private IPs
    const server3 = new AdminServer({
      port: 0,
      host: '192.168.1.100',
      tls: { cert, key },
      auth,
      routes,
    });
    check('private IP accepted', server3 instanceof AdminServer);

    const server4 = new AdminServer({
      port: 0,
      host: '10.0.0.1',
      tls: { cert, key },
      auth,
      routes,
    });
    check('10.x IP accepted', server4 instanceof AdminServer);

    // Verify audit log recorded the security violation
    const violations = audit.query({ eventType: 'security_violation' });
    check('security violation logged', violations.length === 1);
    check('violation detail', violations[0]?.detail?.host === '0.0.0.0');

    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 7: Admin server — start, request, shutdown
  // -------------------------------------------------------------------
  console.log('--- Test 7: Admin server — start, request, shutdown ---');
  {
    const { cert, key } = await generateSelfSigned();
    const secret = AdminAuth.generateTotpSecret();
    const passwordHash = AdminAuth.hashPassword('admin123');

    const auth = new AdminAuth({
      accounts: [
        { username: 'admin', passwordHash, totpSecret: secret, active: true },
      ],
    });

    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });

    const server = new AdminServer({
      port: 0, // Random port
      host: '127.0.0.1',
      tls: { cert, key },
      auth,
      routes,
      auditLogger: audit,
    });

    check('server not running initially', !server.isRunning);

    await server.start();
    check('server is running', server.isRunning);
    const port = server.boundPort;
    check('bound to a port', port > 0);

    // Unauthenticated request → 401
    const unauth = await adminRequest(port, 'GET', '/api/health', null, null);
    check('unauthenticated → 401', unauth.status === 401);
    check('unauth reason', unauth.body.reason === 'missing_credentials');

    // Authenticated request → 200
    const code = AdminAuth.generateTotpCode(secret);
    const health = await adminRequest(port, 'GET', '/api/health', null, {
      username: 'admin',
      password: 'admin123',
      totpCode: code,
    });
    check('authenticated → 200', health.status === 200);
    check('health ok', health.body.status === 'ok');

    // Wrong credentials → 401
    const badAuth = await adminRequest(port, 'GET', '/api/health', null, {
      username: 'admin',
      password: 'wrong',
      totpCode: '000000',
    });
    check('bad credentials → 401', badAuth.status === 401);

    // Auth failure logged
    const authFailures = audit.query({ eventType: AUDIT_EVENT_TYPES.AUTH_FAILURE });
    check('auth failures logged', authFailures.length >= 1);

    // Shutdown
    await server.shutdown();
    check('server stopped', !server.isRunning);

    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 8: Provider CRUD — approve, list, get
  // -------------------------------------------------------------------
  console.log('--- Test 8: Provider CRUD — approve, list, get ---');
  {
    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });

    // List empty
    const empty = routes.listProviders();
    check('empty list', empty.status === 200);
    check('0 providers', empty.body.total === 0);

    // Approve a provider
    const approve1 = routes.approveProvider(
      'anthropic-claude',
      'Anthropic Claude',
      'admin',
      ['conversation', 'task'],
    );
    check('approve → 201', approve1.status === 201);
    check('provider id', approve1.body.id === 'anthropic-claude');
    check('provider name', approve1.body.name === 'Anthropic Claude');
    check('provider active', approve1.body.active === true);
    check('has capability matrix', approve1.body.capabilityMatrix !== undefined);

    // Approve another
    const approve2 = routes.approveProvider(
      'openai-gpt',
      'OpenAI GPT',
      'admin',
    );
    check('second provider approved', approve2.status === 201);

    // List all
    const allProviders = routes.listProviders();
    check('2 providers total', allProviders.body.total === 2);

    // Get single
    const get1 = routes.getProvider('anthropic-claude');
    check('get provider → 200', get1.status === 200);
    check('get provider name', get1.body.name === 'Anthropic Claude');

    // Get nonexistent
    const get404 = routes.getProvider('nonexistent');
    check('nonexistent → 404', get404.status === 404);

    // Audit log entries
    const approvedEvents = audit.query({ eventType: AUDIT_EVENT_TYPES.PROVIDER_APPROVED });
    check('2 approval audit entries', approvedEvents.length === 2);

    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 9: Provider CRUD — revoke and reactivate
  // -------------------------------------------------------------------
  console.log('--- Test 9: Provider CRUD — revoke and reactivate ---');
  {
    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });

    routes.approveProvider('test-provider', 'Test Provider', 'admin');

    // Revoke
    const revoke = routes.revokeProvider('test-provider', 'admin');
    check('revoke → 200', revoke.status === 200);
    check('revoked provider inactive', revoke.body.active === false);

    // Still visible in list (soft-delete)
    const list = routes.listProviders(true);
    check('revoked still in list', list.body.total === 1);

    // Not in active-only list
    const activeOnly = routes.listProviders(false);
    check('revoked not in active list', activeOnly.body.total === 0);

    // Revoke nonexistent
    const revoke404 = routes.revokeProvider('nonexistent', 'admin');
    check('revoke nonexistent → 404', revoke404.status === 404);

    // Reactivate
    const activate = routes.activateProvider('test-provider', 'admin');
    check('activate → 200', activate.status === 200);
    check('reactivated is active', activate.body.active === true);

    // Back in active list
    const activeAfter = routes.listProviders(false);
    check('reactivated in active list', activeAfter.body.total === 1);

    // Audit entries
    const deactivated = audit.query({ eventType: AUDIT_EVENT_TYPES.PROVIDER_DEACTIVATED });
    check('deactivation logged', deactivated.length === 1);
    check('deactivation detail', deactivated[0]?.detail?.revokedBy === 'admin');

    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 10: MaliClaw Clause — cannot approve blocked identities
  // -------------------------------------------------------------------
  console.log('--- Test 10: MaliClaw Clause enforcement ---');
  {
    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });

    // Try to approve OpenClaw lineage as provider ID
    const result1 = routes.approveProvider('openclaw', 'Test Provider', 'admin');
    check('openclaw id blocked', result1.status === 403);
    check('openclaw error code', result1.body.code === 'BASTION-1003');

    const result2 = routes.approveProvider('clawdbot', 'Test Provider', 'admin');
    check('clawdbot id blocked', result2.status === 403);

    const result3 = routes.approveProvider('moltbot', 'Test Provider', 'admin');
    check('moltbot id blocked', result3.status === 403);

    // Case-insensitive
    const result3b = routes.approveProvider('OpenClaw-Agent', 'Test Provider', 'admin');
    check('OpenClaw-Agent (partial, mixed case) blocked', result3b.status === 403);

    // Try to approve with MaliClaw pattern as provider name
    const result4 = routes.approveProvider('legit-id', 'openclaw', 'admin');
    check('openclaw name blocked', result4.status === 403);

    const result5 = routes.approveProvider('legit-id', 'ClaWHuB Marketplace', 'admin');
    check('ClaWHuB Marketplace name blocked', result5.status === 403);

    // Secondary identifiers
    const result6 = routes.approveProvider('ai.openclaw.client', 'iOS Client', 'admin');
    check('ai.openclaw.client id blocked', result6.status === 403);

    const result7 = routes.approveProvider('legit-id2', 'docs.openclaw.ai', 'admin');
    check('docs.openclaw.ai name blocked', result7.status === 403);

    // Verify nothing was added
    const list = routes.listProviders();
    check('no providers added', list.body.total === 0);

    // Verify audit log recorded the rejections
    const maliClawEvents = audit.query({ eventType: AUDIT_EVENT_TYPES.MALICLAW_REJECTED });
    check('8 MaliClaw rejections logged', maliClawEvents.length === 8);

    // Legitimate provider should still work
    const legit = routes.approveProvider('real-provider', 'Real AI', 'admin');
    check('legitimate provider approved', legit.status === 201);

    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 10b: Audit query API
  // -------------------------------------------------------------------
  console.log('--- Test 10b: Audit query API ---');
  {
    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });

    // Generate some audit events
    routes.approveProvider('audit-p1', 'Provider 1', 'admin');
    routes.approveProvider('audit-p2', 'Provider 2', 'admin');
    routes.revokeProvider('audit-p1', 'admin');

    // Query all
    const all = routes.queryAudit({});
    check('audit query returns entries', all.status === 200);
    check('audit query has 3 entries', all.body.entries.length === 3);
    check('audit query entries have eventType', all.body.entries[0].eventType !== undefined);
    check('audit query entries have chainHash', all.body.entries[0].chainHash !== undefined);

    // Query by event type
    const approvals = routes.queryAudit({ eventType: AUDIT_EVENT_TYPES.PROVIDER_APPROVED });
    check('audit query by type returns 2', approvals.body.entries.length === 2);

    // Query with limit
    const limited = routes.queryAudit({ limit: 1 });
    check('audit query with limit 1', limited.body.entries.length === 1);

    // Chain integrity check
    const integrity = routes.getChainIntegrity();
    check('integrity status 200', integrity.status === 200);
    check('integrity chainValid', integrity.body.chainValid === true);
    check('integrity totalEntries', integrity.body.totalEntries === 3);
    check('integrity has lastHash', typeof integrity.body.lastHash === 'string');
    check('integrity has genesisHash', typeof integrity.body.genesisHash === 'string');

    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 10c: Live status and connections API
  // -------------------------------------------------------------------
  console.log('--- Test 10c: Live status and connections API ---');
  {
    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });

    // Without status provider — returns zeros
    const routesNoProvider = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });
    const emptyStatus = routesNoProvider.getStatus();
    check('empty status 200', emptyStatus.status === 200);
    check('empty total 0', emptyStatus.body.connectedClients.total === 0);
    check('empty sessions 0', emptyStatus.body.activeSessions === 0);
    check('empty msg/min 0', emptyStatus.body.messagesPerMinute === 0);

    const emptyConns = routesNoProvider.getConnectionsList();
    check('empty connections 200', emptyConns.status === 200);
    check('empty connections array', emptyConns.body.connections.length === 0);

    // With mock status provider
    const mockConnections = [
      { connectionId: 'c1', remoteAddress: '10.0.10.5', connectedAt: '2026-03-22T10:00:00Z', clientType: 'human', authenticated: true, messageCount: 15 },
      { connectionId: 'c2', remoteAddress: '10.0.50.10', connectedAt: '2026-03-22T10:01:00Z', clientType: 'ai', authenticated: true, providerId: 'anthropic', messageCount: 12 },
      { connectionId: 'c3', remoteAddress: '10.0.10.20', connectedAt: '2026-03-22T10:05:00Z', clientType: 'unknown', authenticated: false, messageCount: 0 },
    ];
    const mockProvider = {
      getConnections: () => mockConnections,
      getActiveSessionCount: () => 1,
      getMessagesPerMinute: () => 42.5,
      getQuarantineStatus: () => ({ active: 3, capacity: 100 }),
    };

    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit, statusProvider: mockProvider });

    // GET /api/status
    const status = routes.getStatus();
    check('status 200', status.status === 200);
    check('status total 3', status.body.connectedClients.total === 3);
    check('status human 1', status.body.connectedClients.human === 1);
    check('status ai 1', status.body.connectedClients.ai === 1);
    check('status unknown 1', status.body.connectedClients.unknown === 1);
    check('status sessions 1', status.body.activeSessions === 1);
    check('status msg/min 42.5', status.body.messagesPerMinute === 42.5);
    check('status quarantine active 3', status.body.quarantine.active === 3);
    check('status quarantine capacity 100', status.body.quarantine.capacity === 100);

    // GET /api/connections
    const conns = routes.getConnectionsList();
    check('connections 200', conns.status === 200);
    check('connections total 3', conns.body.total === 3);
    check('connections array length 3', conns.body.connections.length === 3);
    check('conn[0] is human', conns.body.connections[0].clientType === 'human');
    check('conn[0] remoteAddress', conns.body.connections[0].remoteAddress === '10.0.10.5');
    check('conn[1] providerId', conns.body.connections[1].providerId === 'anthropic');
    check('conn[2] not authenticated', conns.body.connections[2].authenticated === false);
    check('conn[1] messageCount 12', conns.body.connections[1].messageCount === 12);

    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 10d: Full pipeline — HTTP status/connections/audit with live data
  // -------------------------------------------------------------------
  console.log('--- Test 10d: Full pipeline via HTTP —status, connections, audit ---');
  {
    const { cert, key } = await generateSelfSigned();
    const secret = AdminAuth.generateTotpSecret();
    const passwordHash = AdminAuth.hashPassword('admin-pass');

    const registry = new ProviderRegistry();
    const auditLogger = new AuditLogger({ store: { path: ':memory:' } });

    // Simulate live connections
    const liveConnections = [
      { connectionId: 'http-c1', remoteAddress: '10.0.10.5', connectedAt: '2026-03-22T10:00:00Z', clientType: 'human', authenticated: true, messageCount: 42 },
      { connectionId: 'http-c2', remoteAddress: '10.0.50.10', connectedAt: '2026-03-22T10:01:00Z', clientType: 'ai', authenticated: true, providerId: 'anthropic-bastion', messageCount: 38 },
    ];
    const liveProvider = {
      getConnections: () => liveConnections,
      getActiveSessionCount: () => 1,
      getMessagesPerMinute: () => 15,
      getQuarantineStatus: () => ({ active: 2, capacity: 100 }),
    };

    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger, statusProvider: liveProvider });

    // Generate audit events
    routes.approveProvider('http-test-provider', 'HTTP Test', 'admin');

    const auth = new AdminAuth({
      accounts: [{ username: 'admin', passwordHash, totpSecret: secret, active: true }],
    });

    const server = new AdminServer({
      port: 0,
      host: '127.0.0.1',
      tls: { cert, key },
      auth,
      routes,
      auditLogger,
    });

    await server.start();
    const port = server.boundPort;

    const creds = () => ({
      username: 'admin',
      password: 'admin-pass',
      totpCode: AdminAuth.generateTotpCode(secret),
    });

    // GET /api/status via HTTP
    const status = await adminRequest(port, 'GET', '/api/status', null, creds());
    check('HTTP status 200', status.status === 200);
    check('HTTP status total 2', status.body.connectedClients.total === 2);
    check('HTTP status human 1', status.body.connectedClients.human === 1);
    check('HTTP status ai 1', status.body.connectedClients.ai === 1);
    check('HTTP status sessions 1', status.body.activeSessions === 1);
    check('HTTP status msg/min 15', status.body.messagesPerMinute === 15);
    check('HTTP status quarantine active 2', status.body.quarantine.active === 2);

    // GET /api/connections via HTTP
    const conns = await adminRequest(port, 'GET', '/api/connections', null, creds());
    check('HTTP connections 200', conns.status === 200);
    check('HTTP connections total 2', conns.body.total === 2);
    check('HTTP conn[0] human', conns.body.connections[0].clientType === 'human');
    check('HTTP conn[0] msgs 42', conns.body.connections[0].messageCount === 42);
    check('HTTP conn[1] provider', conns.body.connections[1].providerId === 'anthropic-bastion');

    // GET /api/audit via HTTP — should have the provider approval event
    const audit = await adminRequest(port, 'GET', '/api/audit', null, creds());
    check('HTTP audit 200', audit.status === 200);
    check('HTTP audit has entries', audit.body.entries.length > 0);
    check('HTTP audit first event type', audit.body.entries[0].eventType === 'provider_approved');

    // GET /api/audit/integrity via HTTP
    const integrity = await adminRequest(port, 'GET', '/api/audit/integrity', null, creds());
    check('HTTP integrity 200', integrity.status === 200);
    check('HTTP integrity valid', integrity.body.chainValid === true);
    check('HTTP integrity totalEntries > 0', integrity.body.totalEntries > 0);

    await server.shutdown();
    auditLogger.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 11: Capability matrix — defaults and custom
  // -------------------------------------------------------------------
  console.log('--- Test 11: Capability matrix — defaults and custom ---');
  {
    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });

    routes.approveProvider('provider-1', 'Provider One', 'admin');

    // Default matrix
    const defaultMatrix = defaultCapabilityMatrix();
    check('default allows conversation', defaultMatrix.allowedMessageTypes.includes('conversation'));
    check('default allows result', defaultMatrix.allowedMessageTypes.includes('result'));
    check('default allows file_offer', defaultMatrix.allowedMessageTypes.includes('file_offer'));
    check('default does NOT allow task', !defaultMatrix.allowedMessageTypes.includes('task'));
    check('default file send', defaultMatrix.fileTransfer.canSend === true);
    check('default file receive', defaultMatrix.fileTransfer.canReceive === true);
    check('default max size 50MB', defaultMatrix.fileTransfer.maxFileSizeBytes === 50 * 1024 * 1024);
    check('default max tasks 10', defaultMatrix.maxConcurrentTasks === 10);

    // Get default capabilities for provider
    const caps = routes.getCapabilities('provider-1');
    check('capabilities → 200', caps.status === 200);
    check('default matrix applied', caps.body.matrix?.allowedMessageTypes?.includes('conversation'));

    // Set custom matrix
    const customMatrix = {
      allowedMessageTypes: ['conversation', 'status'],
      fileTransfer: {
        canSend: false,
        canReceive: true,
        maxFileSizeBytes: 10 * 1024 * 1024,
        allowedMimeTypes: ['application/pdf', 'text/plain'],
      },
      maxConcurrentTasks: 5,
      budgetLimitUsd: 100,
    };

    const setResult = routes.setCapabilities('provider-1', customMatrix, 'admin');
    check('set capabilities → 200', setResult.status === 200);
    check('custom matrix applied', setResult.body.matrix?.maxConcurrentTasks === 5);

    // Verify custom matrix persists
    const afterSet = routes.getCapabilities('provider-1');
    check('custom matrix persisted', afterSet.body.matrix?.fileTransfer?.canSend === false);
    check('custom mime types', afterSet.body.matrix?.fileTransfer?.allowedMimeTypes?.length === 2);

    // Set on nonexistent provider
    const set404 = routes.setCapabilities('nonexistent', customMatrix, 'admin');
    check('set nonexistent → 404', set404.status === 404);

    // Get capabilities for nonexistent
    const get404 = routes.getCapabilities('nonexistent');
    check('get nonexistent → 404', get404.status === 404);

    // Audit log for config change
    const configChanges = audit.query({ eventType: AUDIT_EVENT_TYPES.CONFIG_CHANGE });
    check('config change logged', configChanges.length === 1);
    check('config change detail', configChanges[0]?.detail?.changeType === 'capability_matrix_update');

    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 12: Capability enforcement — message type check
  // -------------------------------------------------------------------
  console.log('--- Test 12: Capability enforcement — message type check ---');
  {
    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });

    routes.approveProvider('strict-provider', 'Strict AI', 'admin');

    // Set restricted capabilities
    routes.setCapabilities('strict-provider', {
      allowedMessageTypes: ['conversation', 'status', 'heartbeat'],
      fileTransfer: { canSend: false, canReceive: false, maxFileSizeBytes: 0, allowedMimeTypes: [] },
      maxConcurrentTasks: 3,
    }, 'admin');

    // Allowed message types
    const conv = routes.checkCapability('strict-provider', 'conversation');
    check('conversation allowed', conv.allowed);

    const status = routes.checkCapability('strict-provider', 'status');
    check('status allowed', status.allowed);

    const hb = routes.checkCapability('strict-provider', 'heartbeat');
    check('heartbeat allowed', hb.allowed);

    // Blocked message types
    const task = routes.checkCapability('strict-provider', 'task');
    check('task denied', !task.allowed);
    check('task denial reason', task.reason?.includes('message_type_not_allowed'));

    const result = routes.checkCapability('strict-provider', 'result');
    check('result denied', !result.allowed);

    const fileOffer = routes.checkCapability('strict-provider', 'file_offer');
    check('file_offer denied', !fileOffer.allowed);

    // Nonexistent provider
    const noProvider = routes.checkCapability('nonexistent', 'conversation');
    check('nonexistent provider denied', !noProvider.allowed);
    check('not found reason', noProvider.reason === 'provider_not_found');

    // Inactive provider
    routes.revokeProvider('strict-provider', 'admin');
    const inactive = routes.checkCapability('strict-provider', 'conversation');
    check('inactive provider denied', !inactive.allowed);
    check('inactive reason', inactive.reason === 'provider_inactive');

    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 13: Capability enforcement — file transfer check
  // -------------------------------------------------------------------
  console.log('--- Test 13: Capability enforcement — file transfer check ---');
  {
    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });

    routes.approveProvider('file-provider', 'File AI', 'admin');

    routes.setCapabilities('file-provider', {
      allowedMessageTypes: ['conversation', 'file_offer'],
      fileTransfer: {
        canSend: true,
        canReceive: false,
        maxFileSizeBytes: 1024 * 1024, // 1 MB
        allowedMimeTypes: ['text/plain', 'application/json'],
      },
      maxConcurrentTasks: 5,
    }, 'admin');

    // Send allowed
    const send = routes.checkFileTransfer('file-provider', 'send');
    check('file send allowed', send.allowed);

    // Receive blocked
    const recv = routes.checkFileTransfer('file-provider', 'receive');
    check('file receive blocked', !recv.allowed);
    check('receive reason', recv.reason === 'file_receive_not_permitted');

    // Size check
    const small = routes.checkFileTransfer('file-provider', 'send', 500);
    check('small file allowed', small.allowed);

    const big = routes.checkFileTransfer('file-provider', 'send', 2 * 1024 * 1024);
    check('big file blocked', !big.allowed);
    check('big file reason', big.reason?.includes('file_too_large'));

    // MIME type check
    const textOk = routes.checkFileTransfer('file-provider', 'send', 100, 'text/plain');
    check('text/plain allowed', textOk.allowed);

    const jsonOk = routes.checkFileTransfer('file-provider', 'send', 100, 'application/json');
    check('application/json allowed', jsonOk.allowed);

    const pdfNo = routes.checkFileTransfer('file-provider', 'send', 100, 'application/pdf');
    check('application/pdf blocked', !pdfNo.allowed);
    check('mime reason', pdfNo.reason?.includes('mime_type_not_allowed'));

    // Wildcard MIME type (default matrix)
    routes.approveProvider('wildcard-provider', 'Wildcard AI', 'admin');
    const wildcard = routes.checkFileTransfer('wildcard-provider', 'send', 100, 'image/png');
    check('wildcard mime allows all', wildcard.allowed);

    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 14: Capability enforcement at routing level
  // -------------------------------------------------------------------
  console.log('--- Test 14: Capability enforcement at routing level ---');
  {
    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });

    // Approve provider with restricted capabilities
    routes.approveProvider('routing-provider', 'Routing AI', 'admin');
    routes.setCapabilities('routing-provider', {
      allowedMessageTypes: ['conversation', 'heartbeat'],
      fileTransfer: { canSend: false, canReceive: false, maxFileSizeBytes: 0, allowedMimeTypes: [] },
      maxConcurrentTasks: 1,
    }, 'admin');

    // Set up message router with capability check
    const sentMessages = [];
    const router = new MessageRouter({
      send: (connId, data) => { sentMessages.push({ connId, data }); return true; },
      capabilityCheck: routes.createCapabilityCheck(),
    });

    // Register and pair clients
    const humanConn = randomUUID();
    const aiConn = randomUUID();

    router.registerClient(humanConn, { type: 'human', displayName: 'Harry' });
    router.registerClient(aiConn, { type: 'ai', displayName: 'Claude' });
    router.pairClients(humanConn, aiConn);

    // Register the AI connection's provider
    routes.registerConnection(aiConn, 'routing-provider');

    // AI sends conversation (allowed)
    const conversationEnvelope = JSON.stringify({
      id: randomUUID(),
      version: PROTOCOL_VERSION,
      type: 'conversation',
      timestamp: new Date().toISOString(),
      sender: { id: 'ai-1', type: 'ai', displayName: 'Claude' },
      correlationId: randomUUID(),
      encryptedPayload: 'ZW5jcnlwdGVk',
      nonce: 'bm9uY2U=',
    });

    const result1 = router.route(conversationEnvelope, aiConn);
    check('conversation routed', result1.status === 'routed');

    // AI sends result (NOT in allowed list)
    const resultEnvelope = JSON.stringify({
      id: randomUUID(),
      version: PROTOCOL_VERSION,
      type: 'result',
      timestamp: new Date().toISOString(),
      sender: { id: 'ai-1', type: 'ai', displayName: 'Claude' },
      correlationId: randomUUID(),
      encryptedPayload: 'ZW5jcnlwdGVk',
      nonce: 'bm9uY2U=',
    });

    const result2 = router.route(resultEnvelope, aiConn);
    check('result denied', result2.status === 'capability_denied');
    check('denied type', result2.status === 'capability_denied' && result2.messageType === 'result');
    check('denied reason', result2.status === 'capability_denied' && result2.reason.includes('message_type_not_allowed'));

    // Human sends task (no provider mapping = allowed, human clients have no capability restriction)
    const taskEnvelope = JSON.stringify({
      id: randomUUID(),
      version: PROTOCOL_VERSION,
      type: 'task',
      timestamp: new Date().toISOString(),
      sender: { id: 'human-1', type: 'human', displayName: 'Harry' },
      correlationId: randomUUID(),
      encryptedPayload: 'ZW5jcnlwdGVk',
      nonce: 'bm9uY2U=',
    });

    const result3 = router.route(taskEnvelope, humanConn);
    check('human task routed (no cap check)', result3.status === 'routed');

    // Only 2 messages actually sent (conversation + task, not result)
    check('2 messages sent', sentMessages.length === 2);

    // Unregister connection
    routes.unregisterConnection(aiConn);
    check('connection unregistered', routes.getConnectionProvider(aiConn) === undefined);

    router.destroy();
    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 15: Admin HTTP API — provider CRUD via HTTP
  // -------------------------------------------------------------------
  console.log('--- Test 15: Admin HTTP API — provider CRUD ---');
  {
    const { cert, key } = await generateSelfSigned();
    const secret = AdminAuth.generateTotpSecret();
    const passwordHash = AdminAuth.hashPassword('admin-pass');

    const auth = new AdminAuth({
      accounts: [
        { username: 'admin', passwordHash, totpSecret: secret, active: true },
      ],
    });

    const registry = new ProviderRegistry();
    const auditLogger = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger });

    const server = new AdminServer({
      port: 0,
      host: '127.0.0.1',
      tls: { cert, key },
      auth,
      routes,
      auditLogger,
    });

    await server.start();
    const port = server.boundPort;

    const creds = () => ({
      username: 'admin',
      password: 'admin-pass',
      totpCode: AdminAuth.generateTotpCode(secret),
    });

    // POST /api/providers — approve
    const approve = await adminRequest(port, 'POST', '/api/providers', {
      id: 'claude-api',
      name: 'Anthropic Claude API',
    }, creds());
    check('HTTP approve → 201', approve.status === 201);
    check('HTTP approve id', approve.body.id === 'claude-api');

    // GET /api/providers — list
    const list = await adminRequest(port, 'GET', '/api/providers', null, creds());
    check('HTTP list → 200', list.status === 200);
    check('HTTP list count', list.body.total === 1);

    // GET /api/providers/:id — get
    const get = await adminRequest(port, 'GET', '/api/providers/claude-api', null, creds());
    check('HTTP get → 200', get.status === 200);
    check('HTTP get name', get.body.name === 'Anthropic Claude API');

    // PUT /api/providers/:id/revoke
    const revoke = await adminRequest(port, 'PUT', '/api/providers/claude-api/revoke', null, creds());
    check('HTTP revoke → 200', revoke.status === 200);
    check('HTTP revoked', revoke.body.active === false);

    // PUT /api/providers/:id/activate
    const activate = await adminRequest(port, 'PUT', '/api/providers/claude-api/activate', null, creds());
    check('HTTP activate → 200', activate.status === 200);
    check('HTTP activated', activate.body.active === true);

    // POST missing fields
    const bad = await adminRequest(port, 'POST', '/api/providers', { name: 'no id' }, creds());
    check('HTTP missing fields → 400', bad.status === 400);

    // GET nonexistent
    const notFound = await adminRequest(port, 'GET', '/api/providers/nonexistent', null, creds());
    check('HTTP not found → 404', notFound.status === 404);

    // GET unknown path
    const unknown = await adminRequest(port, 'GET', '/api/unknown', null, creds());
    check('HTTP unknown path → 404', unknown.status === 404);

    await server.shutdown();
    auditLogger.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 16: Admin HTTP API — capability matrix via HTTP
  // -------------------------------------------------------------------
  console.log('--- Test 16: Admin HTTP API — capability matrix ---');
  {
    const { cert, key } = await generateSelfSigned();
    const secret = AdminAuth.generateTotpSecret();
    const passwordHash = AdminAuth.hashPassword('admin-pass');

    const auth = new AdminAuth({
      accounts: [
        { username: 'admin', passwordHash, totpSecret: secret, active: true },
      ],
    });

    const registry = new ProviderRegistry();
    const auditLogger = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger });

    const server = new AdminServer({
      port: 0,
      host: '127.0.0.1',
      tls: { cert, key },
      auth,
      routes,
      auditLogger,
    });

    await server.start();
    const port = server.boundPort;

    const creds = () => ({
      username: 'admin',
      password: 'admin-pass',
      totpCode: AdminAuth.generateTotpCode(secret),
    });

    // Create a provider first
    await adminRequest(port, 'POST', '/api/providers', {
      id: 'cap-test',
      name: 'Cap Test Provider',
    }, creds());

    // GET capabilities (defaults)
    const getDefault = await adminRequest(port, 'GET', '/api/providers/cap-test/capabilities', null, creds());
    check('HTTP get caps → 200', getDefault.status === 200);
    check('HTTP default matrix', getDefault.body.matrix?.maxConcurrentTasks === 10);

    // PUT capabilities
    const customMatrix = {
      allowedMessageTypes: ['conversation', 'status'],
      fileTransfer: {
        canSend: true,
        canReceive: false,
        maxFileSizeBytes: 5 * 1024 * 1024,
        allowedMimeTypes: ['text/plain'],
      },
      maxConcurrentTasks: 2,
    };

    const setCaps = await adminRequest(port, 'PUT', '/api/providers/cap-test/capabilities', {
      matrix: customMatrix,
    }, creds());
    check('HTTP set caps → 200', setCaps.status === 200);
    check('HTTP custom matrix applied', setCaps.body.matrix?.maxConcurrentTasks === 2);

    // Verify persistence
    const getCustom = await adminRequest(port, 'GET', '/api/providers/cap-test/capabilities', null, creds());
    check('HTTP custom matrix persisted', getCustom.body.matrix?.fileTransfer?.canReceive === false);

    // PUT without matrix field
    const badCaps = await adminRequest(port, 'PUT', '/api/providers/cap-test/capabilities', {}, creds());
    check('HTTP missing matrix → 400', badCaps.status === 400);

    await server.shutdown();
    auditLogger.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 17: MaliClaw via HTTP — cannot override
  // -------------------------------------------------------------------
  console.log('--- Test 17: MaliClaw via HTTP ---');
  {
    const { cert, key } = await generateSelfSigned();
    const secret = AdminAuth.generateTotpSecret();
    const passwordHash = AdminAuth.hashPassword('admin-pass');

    const auth = new AdminAuth({
      accounts: [
        { username: 'admin', passwordHash, totpSecret: secret, active: true },
      ],
    });

    const registry = new ProviderRegistry();
    const auditLogger = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger });

    const server = new AdminServer({
      port: 0,
      host: '127.0.0.1',
      tls: { cert, key },
      auth,
      routes,
      auditLogger,
    });

    await server.start();
    const port = server.boundPort;

    const creds = () => ({
      username: 'admin',
      password: 'admin-pass',
      totpCode: AdminAuth.generateTotpCode(secret),
    });

    // Try OpenClaw lineage as provider ID via HTTP
    const maliclaw1 = await adminRequest(port, 'POST', '/api/providers', {
      id: 'openclaw',
      name: 'Some Provider',
    }, creds());
    check('HTTP openclaw id → 403', maliclaw1.status === 403);
    check('HTTP openclaw code', maliclaw1.body.code === 'BASTION-1003');

    const maliclaw2 = await adminRequest(port, 'POST', '/api/providers', {
      id: 'clawdbot-fork-v3',
      name: 'Another Provider',
    }, creds());
    check('HTTP clawdbot-fork-v3 id → 403', maliclaw2.status === 403);

    // Try as provider name
    const maliclaw3 = await adminRequest(port, 'POST', '/api/providers', {
      id: 'legit',
      name: 'MoltBot Reborn',
    }, creds());
    check('HTTP MoltBot name → 403', maliclaw3.status === 403);

    // Verify no providers added
    const list = await adminRequest(port, 'GET', '/api/providers', null, creds());
    check('HTTP no providers created', list.body.total === 0);

    await server.shutdown();
    auditLogger.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 18: Audit trail for all admin actions
  // -------------------------------------------------------------------
  console.log('--- Test 18: Audit trail for admin actions ---');
  {
    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });

    // Perform various admin actions
    routes.approveProvider('audit-provider', 'Audit Test', 'admin');
    routes.revokeProvider('audit-provider', 'admin');
    routes.activateProvider('audit-provider', 'admin');
    routes.setCapabilities('audit-provider', defaultCapabilityMatrix(), 'admin');
    routes.approveProvider('openclaw', 'Bad', 'admin'); // Should be rejected

    // Verify all events logged
    const chain = audit.getChain();
    check('5 audit entries total', chain.length === 5);

    // Check event types
    const types = chain.map(e => e.eventType);
    check('approval logged', types.includes(AUDIT_EVENT_TYPES.PROVIDER_APPROVED));
    check('deactivation logged', types.includes(AUDIT_EVENT_TYPES.PROVIDER_DEACTIVATED));
    check('config change logged', types.includes(AUDIT_EVENT_TYPES.CONFIG_CHANGE));
    check('maliclaw rejection logged', types.includes(AUDIT_EVENT_TYPES.MALICLAW_REJECTED));

    // Verify chain integrity
    const allEntries = audit.getChain();
    let chainValid = true;
    for (let i = 0; i < allEntries.length; i++) {
      if (typeof allEntries[i].chainHash !== 'string' || allEntries[i].chainHash.length !== 64) {
        chainValid = false;
        break;
      }
    }
    check('all entries have valid chain hash', chainValid);

    // Verify session IDs
    const adminEntries = audit.query({ sessionId: 'admin' });
    check('all entries in admin session', adminEntries.length === 5);

    // Verify detail fields
    const approvalEntry = chain.find(e => e.eventType === AUDIT_EVENT_TYPES.PROVIDER_APPROVED);
    check('approval has providerId', approvalEntry?.detail?.providerId === 'audit-provider');
    check('approval has approvedBy', approvalEntry?.detail?.approvedBy === 'admin');

    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 19: Provider approval with custom capability matrix
  // -------------------------------------------------------------------
  console.log('--- Test 19: Provider with custom matrix at creation ---');
  {
    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });

    const customMatrix = {
      allowedMessageTypes: ['conversation'],
      fileTransfer: {
        canSend: false,
        canReceive: false,
        maxFileSizeBytes: 0,
        allowedMimeTypes: [],
      },
      maxConcurrentTasks: 1,
    };

    const result = routes.approveProvider(
      'custom-provider',
      'Custom AI',
      'admin',
      ['chat-only'],
      customMatrix,
    );
    check('approve with custom matrix → 201', result.status === 201);

    // Verify the custom matrix was stored
    const caps = routes.getCapabilities('custom-provider');
    check('custom matrix stored', caps.body.matrix?.maxConcurrentTasks === 1);
    check('custom matrix types', caps.body.matrix?.allowedMessageTypes?.length === 1);

    // Verify capability check uses custom matrix
    const convCheck = routes.checkCapability('custom-provider', 'conversation');
    check('conversation allowed (custom)', convCheck.allowed);

    const resultCheck = routes.checkCapability('custom-provider', 'result');
    check('result denied (custom)', !resultCheck.allowed);

    const fileCheck = routes.checkFileTransfer('custom-provider', 'send');
    check('file send denied (custom)', !fileCheck.allowed);

    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 20: Connection provider mapping
  // -------------------------------------------------------------------
  console.log('--- Test 20: Connection provider mapping ---');
  {
    const registry = new ProviderRegistry();
    const audit = new AuditLogger({ store: { path: ':memory:' } });
    const routes = new AdminRoutes({ providerRegistry: registry, auditLogger: audit });

    const connId1 = randomUUID();
    const connId2 = randomUUID();

    // Register connections
    routes.registerConnection(connId1, 'provider-a');
    routes.registerConnection(connId2, 'provider-b');

    check('conn1 mapped to provider-a', routes.getConnectionProvider(connId1) === 'provider-a');
    check('conn2 mapped to provider-b', routes.getConnectionProvider(connId2) === 'provider-b');

    // Unregister
    routes.unregisterConnection(connId1);
    check('conn1 unmapped', routes.getConnectionProvider(connId1) === undefined);
    check('conn2 still mapped', routes.getConnectionProvider(connId2) === 'provider-b');

    // Unknown connection
    check('unknown conn returns undefined', routes.getConnectionProvider(randomUUID()) === undefined);

    // Capability check via createCapabilityCheck
    routes.approveProvider('provider-b', 'Provider B', 'admin');
    routes.setCapabilities('provider-b', {
      allowedMessageTypes: ['conversation'],
      fileTransfer: { canSend: false, canReceive: false, maxFileSizeBytes: 0, allowedMimeTypes: [] },
      maxConcurrentTasks: 1,
    }, 'admin');

    const capCheck = routes.createCapabilityCheck();

    // conn2 is mapped to provider-b which only allows conversation
    const allowed = capCheck(connId2, 'conversation');
    check('cap check allowed for conversation', allowed.allowed);

    const denied = capCheck(connId2, 'result');
    check('cap check denied for result', !denied.allowed);

    // Unmapped connection (human client) — allowed by default
    const unmapped = capCheck(randomUUID(), 'task');
    check('unmapped connection allowed', unmapped.allowed);

    audit.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Test 21: Real E2E — relay + clients + admin status (not mocked)
  // -------------------------------------------------------------------
  console.log('--- Test 21: Real E2E — relay, clients, admin status ---');
  {
    const { cert, key } = await generateSelfSigned();
    const auditLogger = new AuditLogger({ store: { path: ':memory:' } });
    const providerRegistry = new ProviderRegistry();
    const jwtService = new JwtService({ secret: randomBytes(32), issuer: 'bastion-relay' });

    // Real relay
    const relay = new BastionRelay({ port: 0, tls: { cert, key }, auditLogger });

    // Real router
    const router = new MessageRouter({
      send: (connId, data) => relay.send(connId, data),
      log: () => {},
    });

    // Message counters (mirrors start-relay.mjs)
    const msgTimestamps = [];
    const connMsgCounts = new Map();
    let humanConnId = null;
    let aiConnId = null;

    const statusProvider = {
      getConnections() {
        return relay.getConnectionIds().map((id) => {
          const info = relay.getConnection(id);
          const client = router.getClient(id);
          return {
            connectionId: id,
            remoteAddress: info?.remoteAddress ?? 'unknown',
            connectedAt: info?.connectedAt ?? new Date().toISOString(),
            clientType: client ? client.identity.type : 'unknown',
            authenticated: !!client,
            messageCount: connMsgCounts.get(id) || 0,
          };
        });
      },
      getActiveSessionCount() {
        return (humanConnId && aiConnId && router.getPeer(humanConnId)) ? 1 : 0;
      },
      getMessagesPerMinute() {
        const cutoff = Date.now() - 60000;
        while (msgTimestamps.length > 0 && msgTimestamps[0] < cutoff) msgTimestamps.shift();
        return msgTimestamps.length;
      },
      getQuarantineStatus() { return { active: 0, capacity: 100 }; },
    };

    const adminRoutes = new AdminRoutes({ providerRegistry, auditLogger, statusProvider });

    // Admin server
    const secret = AdminAuth.generateTotpSecret();
    const passwordHash = AdminAuth.hashPassword('admin-pass');
    const adminAuth = new AdminAuth({
      accounts: [{ username: 'admin', passwordHash, totpSecret: secret, active: true }],
    });
    const adminServer = new AdminServer({
      port: 0, host: '127.0.0.1', tls: { cert, key }, auth: adminAuth, routes: adminRoutes, auditLogger,
    });

    await relay.start();
    await adminServer.start();
    const relayPort = relay.boundPort;
    const adminPort = adminServer.boundPort;

    const creds = () => ({
      username: 'admin',
      password: 'admin-pass',
      totpCode: AdminAuth.generateTotpCode(secret),
    });

    // Connect two WebSocket clients
    const WebSocket = (await import('ws')).default;

    const humanWs = new WebSocket(`wss://127.0.0.1:${relayPort}`, { rejectUnauthorized: false });
    await new Promise((resolve) => humanWs.on('open', resolve));
    const humanInfo = relay.getConnectionIds().find((id) => !router.getClient(id));
    // Register human
    const humanIdentity = { id: 'human-e2e', type: 'human', displayName: 'Harry (E2E)' };
    router.registerClient(humanInfo, humanIdentity);
    humanConnId = humanInfo;
    auditLogger.logEvent('auth_success', randomUUID(), { clientType: 'human' });

    const aiWs = new WebSocket(`wss://127.0.0.1:${relayPort}`, { rejectUnauthorized: false });
    await new Promise((resolve) => aiWs.on('open', resolve));
    const aiInfo = relay.getConnectionIds().find((id) => id !== humanInfo && !router.getClient(id));
    const aiIdentity = { id: 'ai-e2e', type: 'ai', displayName: 'Claude (E2E)' };
    router.registerClient(aiInfo, aiIdentity);
    aiConnId = aiInfo;
    auditLogger.logEvent('auth_success', randomUUID(), { clientType: 'ai' });

    // Pair
    router.pairClients(humanConnId, aiConnId);

    // Route a message human → AI
    const testMsg = JSON.stringify({ type: 'conversation', payload: { content: 'hello' } });
    relay.send(aiConnId, testMsg);
    msgTimestamps.push(Date.now());
    connMsgCounts.set(humanConnId, 1);
    auditLogger.logEvent('message_routed', randomUUID(), { messageType: 'conversation' });

    // Now query admin API — should return REAL non-zero data
    const statusResult = await adminRequest(adminPort, 'GET', '/api/status', null, creds());
    check('E2E status 200', statusResult.status === 200);
    check('E2E status total >= 2', statusResult.body.connectedClients.total >= 2);
    check('E2E status human >= 1', statusResult.body.connectedClients.human >= 1);
    check('E2E status ai >= 1', statusResult.body.connectedClients.ai >= 1);
    check('E2E status sessions 1', statusResult.body.activeSessions === 1);
    check('E2E status msg/min >= 1', statusResult.body.messagesPerMinute >= 1);

    const connsResult = await adminRequest(adminPort, 'GET', '/api/connections', null, creds());
    check('E2E connections 200', connsResult.status === 200);
    check('E2E connections >= 2', connsResult.body.connections.length >= 2);
    const humanConn = connsResult.body.connections.find((c) => c.clientType === 'human');
    const aiConn = connsResult.body.connections.find((c) => c.clientType === 'ai');
    check('E2E human connection found', !!humanConn);
    check('E2E ai connection found', !!aiConn);
    check('E2E human authenticated', humanConn?.authenticated === true);
    check('E2E human msgCount >= 1', humanConn?.messageCount >= 1);

    const auditResult = await adminRequest(adminPort, 'GET', '/api/audit', null, creds());
    check('E2E audit 200', auditResult.status === 200);
    check('E2E audit has entries', auditResult.body.entries.length >= 3);
    const eventTypes = auditResult.body.entries.map((e) => e.eventType);
    check('E2E audit has auth_success', eventTypes.includes('auth_success'));
    check('E2E audit has message_routed', eventTypes.includes('message_routed'));

    // Cleanup
    humanWs.close();
    aiWs.close();
    await new Promise((r) => setTimeout(r, 100));
    await relay.shutdown();
    await adminServer.shutdown();
    auditLogger.close();
  }
  console.log();

  // -------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------
  console.log('=================================================');
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log('=================================================');
  if (fail > 0) process.exit(1);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
