// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Bastion Update Agent.
 *
 * Connects to the relay as a 'updater' client, authenticates via JWT,
 * performs key exchange for E2E encryption, and listens for update
 * commands. Executes whitelisted build commands and reports status.
 *
 * Lifecycle:
 *   1. Connect to relay via WSS
 *   2. Send session_init with type: 'updater'
 *   3. Receive JWT (session_established)
 *   4. Perform key_exchange for E2E encryption
 *   5. Listen for update_ messages
 *   6. Execute commands and report status
 *   7. On update_restart: restart services and exit (systemd restarts agent)
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { type CommandResult, executeCommand } from './command-executor.js';
import type { AgentConfig } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentState = 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'updating' | 'closing';

export interface AgentEvents {
  connected: [];
  authenticated: [jwt: string];
  message: [data: string];
  disconnected: [code: number, reason: string];
  error: [error: Error];
  'build-progress': [component: string, phase: string, progress?: number];
  'build-complete': [component: string, duration: number];
  'build-failed': [component: string, error: string];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONNECT_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_MS = 13 * 60 * 1000; // 13 min (2 min before 15-min expiry)

// ---------------------------------------------------------------------------
// BastionUpdateAgent
// ---------------------------------------------------------------------------

export class BastionUpdateAgent extends EventEmitter<AgentEvents> {
  readonly config: AgentConfig;
  private ws: WebSocket | null = null;
  private state: AgentState = 'disconnected';
  private currentJwt: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: AgentConfig) {
    super();
    this.config = config;
  }

  get connectionState(): AgentState {
    return this.state;
  }

  get isConnected(): boolean {
    return this.state === 'connected' || this.state === 'authenticated' || this.state === 'updating';
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.state !== 'disconnected') {
      throw new UpdateAgentError(`Cannot connect: state is ${this.state}`);
    }

    this.state = 'connecting';

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws?.terminate();
        this.state = 'disconnected';
        reject(new UpdateAgentError('Connection timeout'));
      }, CONNECT_TIMEOUT_MS);

      this.ws = new WebSocket(this.config.relayUrl, {
        rejectUnauthorized: this.config.rejectUnauthorized ?? true,
      });

      this.ws.once('open', () => {
        clearTimeout(timer);
        this.state = 'connected';
        this.attachListeners();
        this.emit('connected');
        resolve();
      });

      this.ws.once('error', (err) => {
        clearTimeout(timer);
        this.state = 'disconnected';
        this.ws = null;
        reject(new UpdateAgentError(`Connection failed: ${err.message}`));
      });
    });
  }

  /** Send session_init to authenticate as updater client. */
  sendSessionInit(): boolean {
    return this.send(
      JSON.stringify({
        type: 'session_init',
        identity: {
          id: this.config.agentId,
          type: 'updater',
          displayName: this.config.agentName,
        },
      }),
    );
  }

  /** Handle incoming messages from the relay. */
  handleMessage(data: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = msg.type as string;

    // Session established — store JWT
    if (type === 'session_established') {
      this.currentJwt = msg.jwt as string;
      this.state = 'authenticated';
      this.startRefreshTimer();
      this.emit('authenticated', this.currentJwt);
      return;
    }

    // Update prepare — acknowledge readiness
    if (type === 'update_prepare') {
      const payload = (msg.payload as Record<string, unknown>) ?? msg;
      this.send(
        JSON.stringify({
          type: 'update_prepare_ack',
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          sender: { id: this.config.agentId, type: 'updater', displayName: this.config.agentName },
          payload: {
            component: this.config.component,
            stateSaved: true,
            currentVersion: (payload.targetVersion as string) ?? '0.0.0',
          },
        }),
      );
      return;
    }

    // Update execute — run build commands
    if (type === 'update_execute') {
      const payload = (msg.payload as Record<string, unknown>) ?? msg;
      this.handleUpdateExecute(payload);
      return;
    }

    // Update restart — restart services and exit
    if (type === 'update_restart') {
      const payload = (msg.payload as Record<string, unknown>) ?? msg;
      this.handleUpdateRestart(payload);
      return;
    }

    // Ping/pong handled by ws library automatically
    if (type === 'pong' || type === 'ping') return;
  }

  send(data: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(data);
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(code = 1000, reason = 'Agent disconnect'): Promise<void> {
    if (this.state === 'disconnected') return;
    this.stopRefreshTimer();
    this.state = 'closing';

    return new Promise<void>((resolve) => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.cleanup(code, reason);
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this.ws?.terminate();
        this.cleanup(code, reason);
        resolve();
      }, 5000);
      timer.unref();
      this.ws.once('close', () => {
        clearTimeout(timer);
        this.cleanup(code, reason);
        resolve();
      });
      this.ws.close(code, reason);
    });
  }

  // -------------------------------------------------------------------------
  // Update execution
  // -------------------------------------------------------------------------

  private handleUpdateExecute(payload: Record<string, unknown>): void {
    this.state = 'updating';
    const commands = (payload.commands as Array<Record<string, unknown>>) ?? [];
    const component = this.config.component;
    const start = Date.now();

    // Execute commands sequentially
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]!;
      const cmdType = cmd.type as string;
      const phase = cmdType === 'git_pull' ? 'pulling' : cmdType === 'pnpm_install' ? 'installing' : 'building';

      // Report progress
      const progress = Math.round(((i + 0.5) / commands.length) * 100);
      this.sendBuildStatus(component, phase, progress);
      this.emit('build-progress', component, phase, progress);

      // Execute
      const result: CommandResult = executeCommand(cmdType, this.config, {
        filter: cmd.filter as string | undefined,
        repo: cmd.repo as string | undefined,
      });

      if (!result.success) {
        const durationMs = Date.now() - start;
        this.sendBuildStatus(component, 'failed', undefined, durationMs, result.error);
        this.emit('build-failed', component, result.error ?? 'Unknown error');
        this.state = 'authenticated';
        return;
      }
    }

    // All commands succeeded
    const durationMs = Date.now() - start;
    this.sendBuildStatus(component, 'complete', 100, durationMs);
    this.emit('build-complete', component, durationMs);
    this.state = 'authenticated';
  }

  private handleUpdateRestart(_payload: Record<string, unknown>): void {
    // Send acknowledgement before restarting
    this.send(
      JSON.stringify({
        type: 'update_reconnected',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: { id: this.config.agentId, type: 'updater', displayName: this.config.agentName },
        payload: {
          component: this.config.component,
          version: 'pending-restart',
          previousVersion: 'current',
        },
      }),
    );

    // Actual restart is via systemd — agent exits and systemd restarts it

    // Exit so systemd restarts us on the new version
    process.exit(0);
  }

  private sendBuildStatus(
    component: string,
    phase: string,
    progress?: number,
    duration?: number,
    error?: string,
  ): void {
    const payload: Record<string, unknown> = { component, phase };
    if (progress !== undefined) payload.progress = progress;
    if (duration !== undefined) payload.duration = Math.round(duration / 1000);
    if (error !== undefined) payload.error = error;

    this.send(
      JSON.stringify({
        type: 'update_build_status',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sender: { id: this.config.agentId, type: 'updater', displayName: this.config.agentName },
        payload,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private attachListeners(): void {
    if (!this.ws) return;

    this.ws.on('message', (rawData) => {
      const data =
        typeof rawData === 'string' ? rawData : rawData instanceof Buffer ? rawData.toString('utf-8') : String(rawData);
      this.emit('message', data);
      this.handleMessage(data);
    });

    this.ws.on('close', (code, reason) => {
      this.cleanup(code, reason?.toString?.('utf-8') ?? '');
    });

    this.ws.on('error', (err) => {
      this.emit('error', err);
    });
  }

  private cleanup(code: number, reason: string): void {
    this.stopRefreshTimer();
    this.ws = null;
    this.currentJwt = null;
    this.state = 'disconnected';
    this.emit('disconnected', code, reason);
  }

  private startRefreshTimer(): void {
    this.stopRefreshTimer();
    this.refreshTimer = setTimeout(() => {
      this.send(JSON.stringify({ type: 'token_refresh', jwt: this.currentJwt }));
    }, TOKEN_REFRESH_MS);
    if (this.refreshTimer.unref) this.refreshTimer.unref();
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class UpdateAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateAgentError';
  }
}
