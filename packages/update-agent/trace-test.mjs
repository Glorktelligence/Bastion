// Trace test: Update agent — command executor, config validation, orchestrator state machine
// Run with: node packages/update-agent/trace-test.mjs

import {
  executeCommand,
  buildCommandString,
  CommandExecutorError,
  VALID_COMMAND_TYPES,
  validateConfig,
  AgentConfigSchema,
  BastionUpdateAgent,
  UpdateAgentError,
} from './dist/index.js';

import {
  UpdateOrchestrator,
} from '../relay/dist/index.js';

import { randomUUID } from 'node:crypto';

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides = {}) {
  return {
    relayUrl: 'wss://10.0.30.10:9443',
    agentId: 'updater-test-01',
    agentName: 'Test Update Agent',
    component: 'relay',
    buildPath: '/opt/bastion',
    services: ['bastion-relay'],
    buildSteps: [{ type: 'pnpm_build', filter: '@bastion/relay' }],
    ...overrides,
  };
}

/** Stub audit logger for orchestrator tests. */
function makeAuditLogger() {
  const events = [];
  return {
    logEvent(type, session, detail) { events.push({ type, session, detail }); },
    logConfigChange(session, detail) { events.push({ type: 'config_change', session, detail }); },
    getChain() { return []; },
    query() { return []; },
    events,
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function run() {
  console.log('=== Update Agent Tests ===');
  console.log();

  // =========================================================================
  // Test 1: Command executor — valid command types
  // =========================================================================
  console.log('--- Test 1: Command executor — valid types ---');
  {
    check('VALID_COMMAND_TYPES has 3 entries', VALID_COMMAND_TYPES.length === 3);
    check('includes git_pull', VALID_COMMAND_TYPES.includes('git_pull'));
    check('includes pnpm_install', VALID_COMMAND_TYPES.includes('pnpm_install'));
    check('includes pnpm_build', VALID_COMMAND_TYPES.includes('pnpm_build'));
  }
  console.log();

  // =========================================================================
  // Test 2: Command executor — buildCommandString
  // =========================================================================
  console.log('--- Test 2: Command executor — buildCommandString ---');
  {
    const config = makeConfig();

    const gitCmd = buildCommandString('git_pull', config);
    check('git_pull command', gitCmd === 'sudo -u bastion git -C /opt/bastion pull');

    const installCmd = buildCommandString('pnpm_install', config);
    check('pnpm_install command', installCmd === 'sudo -u bastion pnpm -C /opt/bastion install');

    const buildCmd = buildCommandString('pnpm_build', config);
    check('pnpm_build command (no filter)', buildCmd === 'sudo -u bastion pnpm -C /opt/bastion run build');

    const filteredCmd = buildCommandString('pnpm_build', config, { filter: '@bastion/relay' });
    check('pnpm_build command (with filter)', filteredCmd === 'sudo -u bastion pnpm -C /opt/bastion --filter @bastion/relay run build');
  }
  console.log();

  // =========================================================================
  // Test 3: Command executor — whitelist rejection
  // =========================================================================
  console.log('--- Test 3: Command executor — whitelist rejection ---');
  {
    const config = makeConfig();

    // Unknown command types MUST throw
    const rejectTypes = ['shell_exec', 'eval', 'sudo', 'rm', 'exec', 'arbitrary', ''];
    for (const type of rejectTypes) {
      let threw = false;
      try { buildCommandString(type, config); } catch (e) {
        threw = e instanceof CommandExecutorError;
      }
      check(`rejects command type: ${JSON.stringify(type)}`, threw);
    }

    // Invalid filter values (shell injection attempts)
    const badFilters = ['$(rm -rf /)', '; echo pwned', '| cat /etc/passwd', '`id`'];
    for (const filter of badFilters) {
      let threw = false;
      try { buildCommandString('pnpm_build', config, { filter }); } catch (e) {
        threw = e instanceof CommandExecutorError;
      }
      check(`rejects filter: ${JSON.stringify(filter)}`, threw);
    }

    // Valid filter values
    const goodFilters = ['@bastion/relay', '@bastion/client-ai', 'protocol', 'my-package'];
    for (const filter of goodFilters) {
      let threw = false;
      try { buildCommandString('pnpm_build', config, { filter }); } catch {
        threw = true;
      }
      check(`accepts filter: ${filter}`, !threw);
    }
  }
  console.log();

  // =========================================================================
  // Test 4: Command executor — path validation
  // =========================================================================
  console.log('--- Test 4: Command executor — path validation ---');
  {
    // Invalid build paths (shell metacharacters)
    const badPaths = ['/opt/bastion; rm -rf /', '/opt/$(id)', '/opt/`whoami`', '/opt/bastion && echo pwned'];
    for (const path of badPaths) {
      let threw = false;
      try { buildCommandString('git_pull', makeConfig({ buildPath: path })); } catch (e) {
        threw = e instanceof CommandExecutorError;
      }
      check(`rejects path: ${JSON.stringify(path)}`, threw);
    }

    // Valid paths
    const goodPaths = ['/opt/bastion', '/home/bastion/project', '/var/lib/bastion'];
    for (const path of goodPaths) {
      let threw = false;
      try { buildCommandString('git_pull', makeConfig({ buildPath: path })); } catch {
        threw = true;
      }
      check(`accepts path: ${path}`, !threw);
    }
  }
  console.log();

  // =========================================================================
  // Test 5: Agent config validation
  // =========================================================================
  console.log('--- Test 5: Agent config validation ---');
  {
    // Valid config
    const valid = validateConfig(makeConfig());
    check('valid config passes', valid.valid);
    check('valid config has config object', !!valid.config);

    // Missing fields
    const noUrl = validateConfig({ ...makeConfig(), relayUrl: '' });
    check('empty relayUrl fails', !noUrl.valid);

    const noId = validateConfig({ ...makeConfig(), agentId: '' });
    check('empty agentId fails', !noId.valid);

    const noComponent = validateConfig({ ...makeConfig(), component: '' });
    check('empty component fails', !noComponent.valid);

    // Invalid relayUrl
    const badUrl = validateConfig({ ...makeConfig(), relayUrl: 'not-a-url' });
    check('invalid relayUrl fails', !badUrl.valid);

    // Invalid buildSteps
    const badStep = validateConfig({ ...makeConfig(), buildSteps: [{ type: 'shell_exec' }] });
    check('invalid buildStep type fails', !badStep.valid);

    // Valid buildSteps
    const goodSteps = validateConfig({
      ...makeConfig(),
      buildSteps: [
        { type: 'git_pull' },
        { type: 'pnpm_install' },
        { type: 'pnpm_build', filter: '@bastion/relay' },
      ],
    });
    check('valid buildSteps pass', goodSteps.valid);

    // Extra fields stripped (not failed)
    const extra = validateConfig({ ...makeConfig(), extraField: 'bonus' });
    check('extra fields do not fail', extra.valid);

    // TLS config — both options
    const tlsReject = validateConfig({ ...makeConfig(), tls: { rejectUnauthorized: false } });
    check('tls.rejectUnauthorized=false passes', tlsReject.valid);

    const tlsCa = validateConfig({ ...makeConfig(), tls: { caCertPath: '/opt/bastion/certs/relay-cert.pem' } });
    check('tls.caCertPath passes', tlsCa.valid);

    const tlsBoth = validateConfig({ ...makeConfig(), tls: { rejectUnauthorized: false, caCertPath: '/certs/ca.pem' } });
    check('tls with both options passes', tlsBoth.valid);

    const noTls = validateConfig(makeConfig());
    check('config without tls passes (optional)', noTls.valid);
  }
  console.log();

  // =========================================================================
  // Test 6: BastionUpdateAgent construction
  // =========================================================================
  console.log('--- Test 6: BastionUpdateAgent construction ---');
  {
    const agent = new BastionUpdateAgent(makeConfig());
    check('agent created', !!agent);
    check('initial state is disconnected', agent.connectionState === 'disconnected');
    check('isConnected is false', !agent.isConnected);
    check('config accessible', agent.config.component === 'relay');

    // Cannot connect without a real relay (just test state guard)
    let threw = false;
    try {
      // This will fail because there's no server, but should throw UpdateAgentError
      await agent.connect();
    } catch (e) {
      threw = e instanceof UpdateAgentError || e.message.includes('connect');
    }
    check('connect fails without server', threw);
  }
  console.log();

  // =========================================================================
  // Test 7: UpdateOrchestrator state machine
  // =========================================================================
  console.log('--- Test 7: UpdateOrchestrator state machine ---');
  {
    const audit = makeAuditLogger();
    const sent = [];
    const orch = new UpdateOrchestrator({
      auditLogger: audit,
      send: (connId, data) => { sent.push({ connId, data: JSON.parse(data) }); return true; },
    });

    check('initial phase is idle', orch.currentPhase === 'idle');
    check('no agents connected', orch.connectedAgentCount === 0);

    // Register agents
    orch.registerAgent('conn-1', 'updater-relay', 'relay');
    orch.registerAgent('conn-2', 'updater-ai', 'ai-client');
    check('2 agents registered', orch.connectedAgentCount === 2);
    check('getAgents returns 2', orch.getAgents().length === 2);
    check('findAgentByComponent works', orch.findAgentByComponent('relay')?.agentId === 'updater-relay');

    // Phase 0: Check
    const checkResult = orch.checkForUpdates('Glorktelligence/Bastion', '0.1.0');
    check('check transitions to checking', checkResult && orch.currentPhase === 'checking');
    check('check sent update_check to agent', sent.length === 1 && sent[0].data.type === 'update_check');

    // Handle available response
    orch.handleUpdateAvailable('0.2.0', 'abc123');
    check('still in checking after available', orch.currentPhase === 'checking');
    check('status has targetVersion', orch.getStatus().targetVersion === '0.2.0');

    // Phase 1: Prepare
    sent.length = 0;
    const prepResult = orch.prepareAll('0.2.0', 'abc123', 'Scheduled update');
    check('prepare transitions to preparing', prepResult && orch.currentPhase === 'preparing');
    check('prepare sent to both agents', sent.length === 2);
    check('prepare messages are update_prepare', sent.every(s => s.data.type === 'update_prepare'));

    // Handle prepare acks
    orch.handlePrepareAck('relay');
    check('still preparing after 1 ack', orch.currentPhase === 'preparing');
    orch.handlePrepareAck('ai-client');
    check('status has both acks', orch.getStatus().prepareAcks.length === 2);

    // Phase 2: Build
    sent.length = 0;
    const buildCommands = [{ type: 'git_pull' }, { type: 'pnpm_install' }, { type: 'pnpm_build' }];
    const buildResult = orch.executeBuild(buildCommands, '0.2.0', 'abc123');
    check('build transitions to building', buildResult && orch.currentPhase === 'building');
    check('build sent to both agents', sent.length === 2);

    // Handle build status
    orch.handleBuildStatus('relay', 'building');
    check('still building after progress', orch.currentPhase === 'building');
    orch.handleBuildStatus('relay', 'complete', 60);
    check('relay build complete', orch.getStatus().buildResults['relay']?.status === 'complete');
    orch.handleBuildStatus('ai-client', 'complete', 90);
    check('all builds complete', Object.values(orch.getStatus().buildResults).every(r => r.status === 'complete'));

    // Phase 3: Restart
    sent.length = 0;
    const restartResult = orch.executeRestart({ relay: 'bastion-relay', 'ai-client': 'bastion-ai-client' });
    check('restart transitions to restarting', restartResult && orch.currentPhase === 'restarting');

    // Handle reconnection
    orch.handleReconnected('relay', '0.2.0');
    check('reconnection tracked', orch.getStatus().reconnections.includes('relay'));

    // Phase 4: Verify
    const verifyResult = orch.verifyAll();
    check('verify transitions to complete (has reconnections)', verifyResult && orch.currentPhase === 'complete');

    // Audit events logged
    check('audit events logged', audit.events.length > 0);
  }
  console.log();

  // =========================================================================
  // Test 8: Orchestrator state guards
  // =========================================================================
  console.log('--- Test 8: Orchestrator state guards ---');
  {
    const audit = makeAuditLogger();
    const orch = new UpdateOrchestrator({
      auditLogger: audit,
      send: () => true,
    });
    orch.registerAgent('conn-1', 'updater-1', 'relay');

    // Cannot build from idle
    check('cannot build from idle', !orch.executeBuild([], '0.1.0', 'abc'));

    // Cannot restart from idle
    check('cannot restart from idle', !orch.executeRestart({}));

    // Cannot verify from idle
    check('cannot verify from idle', !orch.verifyAll());

    // Can check from idle
    check('can check from idle', orch.checkForUpdates('repo', '0.1.0'));

    // Cannot check while checking
    check('cannot check while checking', !orch.checkForUpdates('repo', '0.1.0'));

    // Cancel
    orch.cancel();
    check('cancel resets to idle', orch.currentPhase === 'idle');

    // Can check again after cancel
    check('can check after cancel', orch.checkForUpdates('repo', '0.1.0'));
  }
  console.log();

  // =========================================================================
  // Test 9: Orchestrator failure handling
  // =========================================================================
  console.log('--- Test 9: Orchestrator failure handling ---');
  {
    const audit = makeAuditLogger();
    const orch = new UpdateOrchestrator({
      auditLogger: audit,
      send: () => true,
      phaseTimeoutMs: 50, // 50ms for test
    });
    orch.registerAgent('conn-1', 'updater-1', 'relay');

    // Start check then prepare then build
    orch.checkForUpdates('repo', '0.1.0');
    orch.handleUpdateAvailable('0.2.0', 'abc');
    orch.prepareAll('0.2.0', 'abc', 'test');
    orch.handlePrepareAck('relay');
    orch.executeBuild([{ type: 'git_pull' }], '0.2.0', 'abc');

    // Simulate build failure
    orch.handleBuildStatus('relay', 'failed', undefined, 'tsc compilation error');
    check('build failure transitions to failed', orch.currentPhase === 'failed');
    check('error captured', orch.getStatus().error?.includes('tsc compilation error'));

    // Can start fresh after failure
    check('can check after failure', orch.checkForUpdates('repo', '0.1.0'));
  }
  console.log();

  // =========================================================================
  // Test 10: Orchestrator timeout
  // =========================================================================
  console.log('--- Test 10: Orchestrator timeout ---');
  {
    const audit = makeAuditLogger();
    const orch = new UpdateOrchestrator({
      auditLogger: audit,
      send: () => true,
      phaseTimeoutMs: 50,
    });
    orch.registerAgent('conn-1', 'updater-1', 'relay');
    orch.checkForUpdates('repo', '0.1.0');
    orch.handleUpdateAvailable('0.2.0', 'abc');
    orch.prepareAll('0.2.0', 'abc', 'test');

    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 100));
    check('phase times out to failed', orch.currentPhase === 'failed');
    check('timeout error message', orch.getStatus().error?.includes('timed out'));
  }
  console.log();

  // =========================================================================
  // Test 11: Orchestrator status format
  // =========================================================================
  console.log('--- Test 11: Orchestrator status format ---');
  {
    const orch = new UpdateOrchestrator({
      auditLogger: makeAuditLogger(),
      send: () => true,
    });
    const status = orch.getStatus();
    check('status has phase', 'phase' in status);
    check('status has targetVersion', 'targetVersion' in status);
    check('status has startedAt', 'startedAt' in status);
    check('status has agents', Array.isArray(status.agents));
    check('status has prepareAcks', Array.isArray(status.prepareAcks));
    check('status has buildResults', typeof status.buildResults === 'object');
    check('status has reconnections', Array.isArray(status.reconnections));
    check('status has error', 'error' in status);
  }
  console.log();

  // =========================================================================
  // Test 12: Agent unregistration
  // =========================================================================
  console.log('--- Test 12: Agent unregistration ---');
  {
    const orch = new UpdateOrchestrator({
      auditLogger: makeAuditLogger(),
      send: () => true,
    });
    orch.registerAgent('conn-1', 'agent-1', 'relay');
    orch.registerAgent('conn-2', 'agent-2', 'ai-client');
    check('2 agents before unregister', orch.connectedAgentCount === 2);

    orch.unregisterAgent('conn-1');
    check('1 agent after unregister', orch.connectedAgentCount === 1);
    check('relay agent removed', !orch.findAgentByComponent('relay'));
    check('ai-client agent remains', !!orch.findAgentByComponent('ai-client'));

    // Reconnection deduplication — same agentId, new connectionId
    orch.registerAgent('conn-3', 'agent-2', 'ai-client');
    check('reconnection replaces not duplicates', orch.connectedAgentCount === 1);
    check('connectionId updated', orch.findAgentByComponent('ai-client')?.connectionId === 'conn-3');

    // Multiple reconnections
    orch.registerAgent('conn-10', 'agent-2', 'ai-client');
    orch.registerAgent('conn-11', 'agent-2', 'ai-client');
    orch.registerAgent('conn-12', 'agent-2', 'ai-client');
    check('still 1 agent after 3 reconnections', orch.connectedAgentCount === 1);
  }
  console.log();

  // =========================================================================
  // Test 13: State file persistence (restart recovery)
  // =========================================================================
  console.log('--- Test 13: State file persistence ---');
  {
    const tmpFile = './test-pending-update-' + Date.now() + '.json';
    const audit = makeAuditLogger();
    const orch = new UpdateOrchestrator({
      auditLogger: audit,
      send: () => true,
      stateFilePath: tmpFile,
    });

    // No state file yet
    check('loadPendingState returns false when no file', !orch.loadPendingState());

    // Drive through phases to restart
    orch.registerAgent('conn-1', 'updater-1', 'relay');
    orch.checkForUpdates('repo', '0.1.0');
    orch.handleUpdateAvailable('0.2.0', 'abc');
    orch.prepareAll('0.2.0', 'abc', 'test');
    orch.handlePrepareAck('relay');
    orch.executeBuild([{ type: 'git_pull' }], '0.2.0', 'abc');
    orch.handleBuildStatus('relay', 'complete', 30);
    orch.executeRestart({ relay: 'bastion-relay' }, ['relay']);
    check('restart wrote state file', orch.currentPhase === 'restarting');

    // Simulate relay restart — new orchestrator loads state
    const { readFileSync } = await import('node:fs');
    let stateExists = false;
    try {
      readFileSync(tmpFile, 'utf-8');
      stateExists = true;
    } catch { /* */ }
    check('state file exists on disk', stateExists);

    const orch2 = new UpdateOrchestrator({
      auditLogger: audit,
      send: () => true,
      stateFilePath: tmpFile,
    });
    const loaded = orch2.loadPendingState();
    check('new orchestrator loads state', loaded);
    check('resumed in restarting phase', orch2.currentPhase === 'restarting');
    check('resumed with target version', orch2.getStatus().targetVersion === '0.2.0');
    check('resumed with expected components', orch2.getStatus().expectedComponents.includes('relay'));

    // Handle reconnection → complete
    orch2.handleReconnected('relay', '0.2.0');
    check('completes after reconnection', orch2.currentPhase === 'complete');

    // State file should be deleted after completion
    let stateDeleted = false;
    try {
      readFileSync(tmpFile, 'utf-8');
    } catch {
      stateDeleted = true;
    }
    check('state file deleted after completion', stateDeleted);
  }
  console.log();

  // =========================================================================
  // Test 14: Reconnection with correct vs wrong version
  // =========================================================================
  console.log('--- Test 14: Reconnection version verification ---');
  {
    const tmpFile = './test-pending-update-' + Date.now() + '.json';
    const audit = makeAuditLogger();
    const orch = new UpdateOrchestrator({
      auditLogger: audit,
      send: () => true,
      stateFilePath: tmpFile,
      reconnectTimeoutMs: 500,
    });

    orch.registerAgent('conn-1', 'updater-1', 'relay');
    orch.checkForUpdates('repo', '0.1.0');
    orch.handleUpdateAvailable('0.2.0', 'abc');
    orch.prepareAll('0.2.0', 'abc', 'test');
    orch.handlePrepareAck('relay');
    orch.executeBuild([{ type: 'git_pull' }], '0.2.0', 'abc');
    orch.handleBuildStatus('relay', 'complete', 30);
    orch.executeRestart({ relay: 'bastion-relay' }, ['relay']);

    // Reconnect with OLD version → warning but doesn't block
    orch.handleReconnected('relay', '0.1.0');
    check('old version reconnection adds warning', orch.getStatus().warnings.length > 0);
    check('old version warning mentions version', orch.getStatus().warnings[0].includes('0.1.0'));
    check('completes despite old version (reconnection tracked)', orch.currentPhase === 'complete');

    // Cleanup
    try { const { unlinkSync } = await import('node:fs'); unlinkSync(tmpFile); } catch { /* */ }
  }
  console.log();

  // =========================================================================
  // Test 15: Reconnection timeout
  // =========================================================================
  console.log('--- Test 15: Reconnection timeout ---');
  {
    const tmpFile = './test-pending-update-' + Date.now() + '.json';
    const audit = makeAuditLogger();
    const orch = new UpdateOrchestrator({
      auditLogger: audit,
      send: () => true,
      stateFilePath: tmpFile,
      reconnectTimeoutMs: 50,
    });

    orch.registerAgent('conn-1', 'updater-1', 'relay');
    orch.checkForUpdates('repo', '0.1.0');
    orch.handleUpdateAvailable('0.2.0', 'abc');
    orch.prepareAll('0.2.0', 'abc', 'test');
    orch.handlePrepareAck('relay');
    orch.executeBuild([{ type: 'git_pull' }], '0.2.0', 'abc');
    orch.handleBuildStatus('relay', 'complete', 30);
    orch.executeRestart({ relay: 'bastion-relay' }, ['relay']);

    // Don't reconnect — wait for timeout
    await new Promise(resolve => setTimeout(resolve, 100));
    check('reconnection timeout → failed', orch.currentPhase === 'failed');
    check('timeout error mentions component', orch.getStatus().error?.includes('relay'));

    // Cleanup
    try { const { unlinkSync } = await import('node:fs'); unlinkSync(tmpFile); } catch { /* */ }
  }
  console.log();

  // =========================================================================
  // Test 16: Cancel during restart
  // =========================================================================
  console.log('--- Test 16: Cancel during restart ---');
  {
    const tmpFile = './test-pending-update-' + Date.now() + '.json';
    const audit = makeAuditLogger();
    const orch = new UpdateOrchestrator({
      auditLogger: audit,
      send: () => true,
      stateFilePath: tmpFile,
    });

    orch.registerAgent('conn-1', 'updater-1', 'relay');
    orch.registerAgent('conn-2', 'updater-2', 'ai-client');
    orch.checkForUpdates('repo', '0.1.0');
    orch.handleUpdateAvailable('0.2.0', 'abc');
    orch.prepareAll('0.2.0', 'abc', 'test');
    orch.handlePrepareAck('relay');
    orch.handlePrepareAck('ai-client');
    orch.executeBuild([{ type: 'git_pull' }], '0.2.0', 'abc');
    orch.handleBuildStatus('relay', 'complete', 30);
    orch.handleBuildStatus('ai-client', 'complete', 60);
    orch.executeRestart({ relay: 'bastion-relay', 'ai-client': 'bastion-ai-client' }, ['relay', 'ai-client']);

    // Cancel mid-restart
    orch.cancel();
    check('cancel resets to idle', orch.currentPhase === 'idle');

    // Audit should log the cancellation
    const cancelEvent = audit.events.find(e => e.detail?.reason === 'cancelled');
    check('audit logs cancellation', !!cancelEvent);
    check('audit logs previous phase', cancelEvent?.detail?.previousPhase === 'restarting');

    // State file deleted
    let stateDeleted = false;
    try { const { readFileSync } = await import('node:fs'); readFileSync(tmpFile, 'utf-8'); } catch { stateDeleted = true; }
    check('state file deleted on cancel', stateDeleted);
  }
  console.log();

  // =========================================================================
  // Test 17: Human client reconnection (optional)
  // =========================================================================
  console.log('--- Test 17: Human client reconnection ---');
  {
    const tmpFile = './test-pending-update-' + Date.now() + '.json';
    const orch = new UpdateOrchestrator({
      auditLogger: makeAuditLogger(),
      send: () => true,
      stateFilePath: tmpFile,
      reconnectTimeoutMs: 500,
    });

    // Only relay agent — human is optional
    orch.registerAgent('conn-1', 'updater-1', 'relay');
    orch.checkForUpdates('repo', '0.1.0');
    orch.handleUpdateAvailable('0.2.0', 'abc');
    orch.prepareAll('0.2.0', 'abc', 'test');
    orch.handlePrepareAck('relay');
    orch.executeBuild([{ type: 'git_pull' }], '0.2.0', 'abc');
    orch.handleBuildStatus('relay', 'complete', 30);
    orch.executeRestart({ relay: 'bastion-relay' }, ['relay']);

    // Relay reconnects, human never does — should complete
    orch.handleReconnected('relay', '0.2.0');
    check('completes without human reconnection', orch.currentPhase === 'complete');

    try { const { unlinkSync } = await import('node:fs'); unlinkSync(tmpFile); } catch { /* */ }
  }
  console.log();

  // =========================================================================
  // Test 18: State file cleanup on failure
  // =========================================================================
  console.log('--- Test 18: State file cleanup on failure ---');
  {
    const tmpFile = './test-pending-update-' + Date.now() + '.json';
    const orch = new UpdateOrchestrator({
      auditLogger: makeAuditLogger(),
      send: () => true,
      stateFilePath: tmpFile,
      reconnectTimeoutMs: 50,
    });

    orch.registerAgent('conn-1', 'updater-1', 'relay');
    orch.checkForUpdates('repo', '0.1.0');
    orch.handleUpdateAvailable('0.2.0', 'abc');
    orch.prepareAll('0.2.0', 'abc', 'test');
    orch.handlePrepareAck('relay');
    orch.executeBuild([{ type: 'git_pull' }], '0.2.0', 'abc');
    orch.handleBuildStatus('relay', 'complete', 30);
    orch.executeRestart({ relay: 'bastion-relay' }, ['relay']);

    // Wait for timeout → failure
    await new Promise(resolve => setTimeout(resolve, 100));
    check('failure after timeout', orch.currentPhase === 'failed');

    // State file should be cleaned up on failure
    let cleaned = false;
    try { const { readFileSync } = await import('node:fs'); readFileSync(tmpFile, 'utf-8'); } catch { cleaned = true; }
    check('state file cleaned up on failure', cleaned);
  }
  console.log();

  // =========================================================================
  // Test 19: Agent disconnect during build
  // =========================================================================
  console.log('--- Test 19: Agent disconnect during build ---');
  {
    const orch = new UpdateOrchestrator({
      auditLogger: makeAuditLogger(),
      send: () => true,
      stateFilePath: './test-no-write-' + Date.now() + '.json',
    });

    orch.registerAgent('conn-1', 'updater-1', 'relay');
    orch.checkForUpdates('repo', '0.1.0');
    orch.handleUpdateAvailable('0.2.0', 'abc');
    orch.prepareAll('0.2.0', 'abc', 'test');
    orch.handlePrepareAck('relay');
    orch.executeBuild([{ type: 'git_pull' }], '0.2.0', 'abc');

    // Agent disconnects mid-build
    orch.unregisterAgent('conn-1');
    check('agent disconnect during build → failed', orch.currentPhase === 'failed');
    check('error mentions disconnect', orch.getStatus().error?.includes('disconnected'));
  }
  console.log();

  // =========================================================================
  // Test 20: Remote component gets longer timeout
  // =========================================================================
  console.log('--- Test 20: Remote component timeout ---');
  {
    const tmpFile = './test-pending-update-' + Date.now() + '.json';
    const orch = new UpdateOrchestrator({
      auditLogger: makeAuditLogger(),
      send: () => true,
      stateFilePath: tmpFile,
      reconnectTimeoutMs: 50,
      remoteReconnectTimeoutMs: 200,
    });

    orch.registerAgent('conn-1', 'updater-1', 'relay');
    orch.registerAgent('conn-2', 'updater-2', 'ai-client');
    orch.checkForUpdates('repo', '0.1.0');
    orch.handleUpdateAvailable('0.2.0', 'abc');
    orch.prepareAll('0.2.0', 'abc', 'test');
    orch.handlePrepareAck('relay');
    orch.handlePrepareAck('ai-client');
    orch.executeBuild([{ type: 'git_pull' }], '0.2.0', 'abc');
    orch.handleBuildStatus('relay', 'complete', 30);
    orch.handleBuildStatus('ai-client', 'complete', 60);
    orch.executeRestart(
      { relay: 'bastion-relay', 'ai-client': 'bastion-ai-client' },
      ['relay', 'ai-client'],
    );

    // At 80ms, local timeout (50ms) would have fired, but remote timeout (200ms) applies
    await new Promise(resolve => setTimeout(resolve, 80));
    check('not timed out at 80ms (remote timeout is 200ms)', orch.currentPhase === 'restarting');

    // Reconnect both before remote timeout
    orch.handleReconnected('relay', '0.2.0');
    orch.handleReconnected('ai-client', '0.2.0');
    check('completes after both reconnect', orch.currentPhase === 'complete');

    try { const { unlinkSync } = await import('node:fs'); unlinkSync(tmpFile); } catch { /* */ }
  }
  console.log();

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('=================================================');
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log('=================================================');
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
