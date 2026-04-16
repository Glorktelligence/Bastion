// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * BastionGuardian — 7th Sole Authority
 *
 * The Guardian brain lives on the relay, co-located with AuditLogger.
 * It performs environment checks, monitors for violations, and can
 * trigger cascade shutdowns across all connected components.
 *
 * Architecture: relay-anchored — one brain (relay), distributed agents
 * (AI client has its Phase 1 agent for identity headers).
 */

import { statSync, writeFileSync } from 'node:fs';
import { platform, userInfo } from 'node:os';
import { join } from 'node:path';
import type {
  GuardianCheckResult,
  GuardianConnectedComponent,
  GuardianRuntimeMonitoring,
  GuardianStatusPayload,
} from '@bastion/protocol';

// ---------------------------------------------------------------------------
// Foreign harness env var list (shared with AI client Phase 1)
// ---------------------------------------------------------------------------

const FOREIGN_HARNESS_VARS: readonly string[] = [
  'CLAUDE_CODE_ENTRY_POINT',
  'CLAUDE_CODE_VERSION',
  'CLAUDE_CODE_PROJECT_DIR',
  'OPENCLAW_HOME',
  'OPENHARNESS_HOME',
  'OH_HOME',
  'OPENHARNESS_API_FORMAT',
  'CURSOR_TRACE_ID',
  'CURSOR_SESSION_ID',
  'AGENT_HARNESS_MODE',
  'CLINE_DIR',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** System session ID for Guardian audit events (Guardian has no session — it IS the system). */
const GUARDIAN_SESSION = 'guardian-system';

/** Filename written to dataDir on cascade shutdown — read by the bastion-cli guardian command. */
export const GUARDIAN_STATE_FILENAME = 'guardian-state.json';

/** Shape persisted to guardian-state.json when a critical trigger fires. */
export interface GuardianShutdownState {
  readonly health: 'COMPROMISED';
  readonly code: string;
  readonly reason: string;
  readonly timestamp: string;
  readonly componentStatus: string;
  readonly suggestedActions: string;
  readonly checks: readonly GuardianCheckResult[];
}

/** Minimal audit logger interface — decoupled from relay AuditLogger. */
export interface GuardianAuditLogger {
  logEvent(type: string, sessionId: string | null, data: Record<string, unknown>): unknown;
}

/** Guardian configuration. */
export interface GuardianConfig {
  readonly version: string;
  readonly dataDir: string;
  readonly bastionUser: string;
  readonly checkIntervalMs: number;
  readonly auditLogger?: GuardianAuditLogger;
}

/** Callback invoked on Guardian trigger events. */
export type GuardianTriggerCallback = (
  code: string,
  reason: string,
  severity: 'critical' | 'severe' | 'warning',
) => void;

/**
 * Runtime monitor handles Phase 3 wires into the Guardian after construction
 * (start-relay.mjs creates Guardian first, then the trackers, then registers them).
 * Only the shapes the Guardian needs for getStatus() are exposed — the Guardian
 * does not drive the monitors; the relay does that through its own callbacks.
 */
export interface GuardianViolationTrackerHandle {
  readonly activeWindowCount: number;
  cleanup(): void;
}

export interface GuardianRateMonitorHandle {
  readonly trackedConnectionCount: number;
  cleanup(): void;
}

// ---------------------------------------------------------------------------
// BastionGuardian
// ---------------------------------------------------------------------------

export class BastionGuardian {
  private status: 'active' | 'alert' | 'shutdown' = 'active';
  private readonly startedAt = Date.now();
  private lastCheckAt = '';
  private lastChecks: GuardianCheckResult[] = [];
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private readonly triggerCallbacks: GuardianTriggerCallback[] = [];
  private readonly connectedComponents: GuardianConnectedComponent[] = [];
  private violationTracker: GuardianViolationTrackerHandle | null = null;
  private rateMonitor: GuardianRateMonitorHandle | null = null;

  constructor(private readonly config: GuardianConfig) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Run all environment checks. Returns true if all pass. */
  runChecks(): { passed: boolean; checks: GuardianCheckResult[] } {
    const checks: GuardianCheckResult[] = [
      this.checkForeignHarness(),
      this.checkProcessIdentity(),
      this.checkDataPermissions(),
    ];

    this.lastChecks = checks;
    this.lastCheckAt = new Date().toISOString();

    const allPassed = checks.every((c) => c.passed);

    // Audit log the check run
    this.config.auditLogger?.logEvent('guardian_check', GUARDIAN_SESSION, {
      passed: allPassed,
      checks: checks.map((c) => ({ name: c.name, passed: c.passed, detail: c.detail })),
    });

    // Auto-trigger on critical failures
    for (const check of checks) {
      if (!check.passed && check.name === 'foreign_harness') {
        this.trigger('BASTION-9002', `Foreign harness detected: ${check.detail}`, 'critical');
      }
    }

    return { passed: allPassed, checks };
  }

  /**
   * Start periodic checking (every config.checkIntervalMs).
   * Also performs housekeeping on registered runtime monitors (Phase 3):
   * expired violation windows and stale rate-monitor connections are pruned.
   */
  startPeriodicChecks(): void {
    this.stopPeriodicChecks();
    const interval = setInterval(() => {
      this.runChecks();
      // Runtime monitor housekeeping — errors swallowed to keep the tick alive.
      if (this.violationTracker) {
        try {
          this.violationTracker.cleanup();
        } catch (err) {
          console.error('[!] Guardian: violationTracker cleanup error:', err);
        }
      }
      if (this.rateMonitor) {
        try {
          this.rateMonitor.cleanup();
        } catch (err) {
          console.error('[!] Guardian: rateMonitor cleanup error:', err);
        }
      }
    }, this.config.checkIntervalMs);
    interval.unref();
    this.checkInterval = interval;
  }

  /** Stop periodic checking. */
  stopPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /** Register a callback for Guardian trigger events. */
  onTrigger(callback: GuardianTriggerCallback): void {
    this.triggerCallbacks.push(callback);
  }

  /**
   * Trigger a Guardian event — severity determines action.
   * - critical: status → shutdown, callbacks called, exit(99) after 500ms
   * - severe: status → alert, callbacks called
   * - warning: status → alert, logged only
   */
  trigger(code: string, reason: string, severity: 'critical' | 'severe' | 'warning'): void {
    console.error(`[✗] GUARDIAN: ${code} — ${reason} (${severity})`);

    this.config.auditLogger?.logEvent('guardian_violation', GUARDIAN_SESSION, { code, reason, severity });

    if (severity === 'critical') {
      this.status = 'shutdown';
      // Persist state BEFORE callbacks fire — if a callback crashes, the CLI
      // still has a record of what tripped Guardian. Callbacks may broadcast
      // guardian_shutdown to clients, which takes time we don't want to lose.
      this.writeShutdownState(code, reason);
      for (const cb of this.triggerCallbacks) {
        try {
          cb(code, reason, severity);
        } catch (err) {
          console.error('[!] Guardian shutdown callback error:', err);
        }
      }
      setTimeout(() => process.exit(99), 500);
    } else if (severity === 'severe') {
      this.status = 'alert';
      for (const cb of this.triggerCallbacks) {
        try {
          cb(code, reason, severity);
        } catch (err) {
          console.error('[!] Guardian trigger callback error:', err);
        }
      }
    } else {
      // Warning — log and audit only, no callbacks
      this.status = 'alert';
    }
  }

  /** Register a connected component (tracked for guardian_status). */
  registerComponent(component: GuardianConnectedComponent): void {
    this.connectedComponents.push(component);
  }

  /** Remove a connected component by ID. */
  removeComponent(id: string): void {
    const idx = this.connectedComponents.findIndex((c) => c.id === id);
    if (idx >= 0) this.connectedComponents.splice(idx, 1);
  }

  /**
   * Register Phase 3 runtime monitors so the Guardian can report on them
   * and periodically drive their cleanup. Called once after construction
   * by start-relay.mjs. Either handle may be passed individually.
   */
  registerRuntimeMonitors(monitors: {
    violationTracker?: GuardianViolationTrackerHandle;
    rateMonitor?: GuardianRateMonitorHandle;
  }): void {
    if (monitors.violationTracker) this.violationTracker = monitors.violationTracker;
    if (monitors.rateMonitor) this.rateMonitor = monitors.rateMonitor;
  }

  /** Get current Guardian status for guardian_status response. */
  getStatus(): GuardianStatusPayload {
    const uptimeSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
    const base: GuardianStatusPayload = {
      status: this.status,
      version: this.config.version,
      uptimeSeconds,
      lastCheckAt: this.lastCheckAt,
      environmentClean: this.lastChecks.length > 0 && this.lastChecks.every((c) => c.passed),
      checks: this.lastChecks,
      connectedComponents: [...this.connectedComponents],
    };

    if (this.violationTracker || this.rateMonitor) {
      const runtimeMonitoring: GuardianRuntimeMonitoring = {
        violationTrackerActive: this.violationTracker !== null,
        rateMonitorActive: this.rateMonitor !== null,
        activeViolationWindows: this.violationTracker?.activeWindowCount ?? 0,
        trackedConnections: this.rateMonitor?.trackedConnectionCount ?? 0,
      };
      return { ...base, runtimeMonitoring };
    }

    return base;
  }

  /** Get the current Guardian operational status. */
  getOperationalStatus(): 'active' | 'alert' | 'shutdown' {
    return this.status;
  }

  /** Whether periodic checks are running. */
  isMonitoring(): boolean {
    return this.checkInterval !== null;
  }

  /**
   * Persist Guardian state to disk immediately before a cascade shutdown.
   *
   * The CLI (`bastion guardian` on the relay) reads this file to show the
   * operator why Guardian tripped and what to do. Writing is best-effort —
   * a failed write must never block the actual shutdown, because that is
   * the whole point of the critical trigger.
   */
  writeShutdownState(code: string, reason: string): GuardianShutdownState {
    const state: GuardianShutdownState = {
      health: 'COMPROMISED',
      code,
      reason,
      timestamp: new Date().toISOString(),
      componentStatus: 'OFFLINE - COMPROMISED',
      suggestedActions: this.getSuggestedActions(code),
      checks: this.lastChecks,
    };

    try {
      const statePath = join(this.config.dataDir, GUARDIAN_STATE_FILENAME);
      writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('[!] Failed to write Guardian state:', err);
    }

    return state;
  }

  /**
   * Human-readable remediation advice for each BASTION-9XXX code.
   * Exposed for the CLI; callers can also format their own advice from this.
   */
  getSuggestedActions(code: string): string {
    switch (code) {
      case 'BASTION-9001':
        return 'Check adapter identity headers. Verify no proxy is stripping/modifying headers.';
      case 'BASTION-9002':
        return 'Remove foreign harness environment variables. Bastion must run independently.';
      case 'BASTION-9003':
        return 'Verify API key in .env matches the key being used. Check for inherited env vars.';
      case 'BASTION-9004':
        return 'Audit chain is corrupted. Back up audit.db and delete it for a fresh chain.';
      case 'BASTION-9005':
        return 'Bastion must not run as root. Check systemd User= directive and file ownership.';
      case 'BASTION-9006':
        return 'Fix data directory permissions: chmod 750 /var/lib/bastion';
      case 'BASTION-9007':
        return 'Safety engine bypass detected. Review recent messages in audit log.';
      case 'BASTION-9008':
        return 'TLS certificate invalid or expired. Renew certificates.';
      case 'BASTION-9009':
        return 'Component identity mismatch. Verify all components are same version.';
      default:
        return 'Review the audit log for details: bastion audit --last 50';
    }
  }

  // -----------------------------------------------------------------------
  // Individual checks
  // -----------------------------------------------------------------------

  /** Check for foreign harness environment variables. */
  private checkForeignHarness(): GuardianCheckResult {
    for (const envVar of FOREIGN_HARNESS_VARS) {
      if (process.env[envVar]) {
        return { name: 'foreign_harness', passed: false, detail: envVar };
      }
    }
    return { name: 'foreign_harness', passed: true, detail: null };
  }

  /** Check if running as expected user (not root). */
  private checkProcessIdentity(): GuardianCheckResult {
    if (platform() === 'win32') {
      return { name: 'process_identity', passed: true, detail: 'skipped on Windows' };
    }

    try {
      // Not root
      if (typeof process.getuid === 'function' && process.getuid() === 0) {
        return { name: 'process_identity', passed: false, detail: 'running as root (uid 0)' };
      }

      // Check username matches expected bastion user
      const currentUser = userInfo().username;
      if (currentUser !== this.config.bastionUser) {
        return {
          name: 'process_identity',
          passed: false,
          detail: `expected user '${this.config.bastionUser}', got '${currentUser}'`,
        };
      }

      return { name: 'process_identity', passed: true, detail: null };
    } catch {
      return { name: 'process_identity', passed: true, detail: 'check unavailable' };
    }
  }

  /** Check data directory permissions (not world-readable). */
  private checkDataPermissions(): GuardianCheckResult {
    if (platform() === 'win32') {
      return { name: 'data_permissions', passed: true, detail: 'skipped on Windows' };
    }

    try {
      const stat = statSync(this.config.dataDir);
      const mode = stat.mode & 0o777;
      // World-readable (o+r) or world-writable (o+w) = violation
      if (mode & 0o006) {
        return {
          name: 'data_permissions',
          passed: false,
          detail: `${this.config.dataDir} is world-accessible (mode: ${mode.toString(8)})`,
        };
      }
      return { name: 'data_permissions', passed: true, detail: null };
    } catch {
      // Directory doesn't exist or can't stat — not a security violation per se
      return { name: 'data_permissions', passed: true, detail: 'directory not found (not a violation)' };
    }
  }
}
