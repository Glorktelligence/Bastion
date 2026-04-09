// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * BastionBash — Governed AI execution environment.
 *
 * Looks like bash, feels like bash, but ISN'T bash — it's Bastion wearing
 * a bash costume. Commands go through a three-tier validator:
 *
 *   Tier 1 — Available: whitelisted, audited, executed in sandbox
 *   Tier 2 — Redirected: explained + governed alternative offered
 *   Tier 3 — Invisible: "command not found" (canary — logged as BASH_INVISIBLE)
 *
 * All execution is scoped to governed filesystem paths. The AI never sees
 * or touches anything outside the allowed workspace.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { normalize, resolve } from 'node:path';
import type { FilePurgeManager } from '../files/purge.js';
import type { DateTimeManager } from './datetime-manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BastionBashConfig {
  readonly workspacePath: string;
  readonly intakePath: string;
  readonly outboundPath: string;
  readonly trashPath: string;
  readonly scratchPath: string;
  readonly maxOutputChars: number;
  readonly maxCommandLength: number;
}

export interface CommandResult {
  readonly command: string;
  readonly tier: 1 | 2 | 3;
  readonly success: boolean;
  readonly output: string;
  readonly exitCode: number;
  readonly executionTimeMs: number;
}

export interface AuditLogger {
  logEvent(type: string, sessionId: string | null, data: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Tier Definitions
// ---------------------------------------------------------------------------

/** Tier 1 — Available: whitelisted, audited, executed. */
const TIER1_COMMANDS = new Set([
  // File reading
  'ls',
  'cat',
  'head',
  'tail',
  'find',
  'grep',
  'wc',
  'diff',
  'tree',
  // File creation/manipulation
  'touch',
  'mkdir',
  'cp',
  'mv',
  'echo',
  // Navigation
  'cd',
  'pwd',
  // Text processing
  'printf',
  'sort',
  'uniq',
  // Dev tools
  'node',
  'pnpm',
  // Git (read-only subcommands checked separately)
  'git',
]);

/** Git subcommands — only read-only operations allowed. */
const GIT_READONLY = new Set(['log', 'diff', 'show', 'status', 'branch', 'tag', 'blame', 'shortlog']);

/** Git subcommands that are Tier 2 redirected. */
const GIT_REDIRECTED = new Map<string, string>([
  ['push', 'Propose changes via bastion submit (human approves before push).'],
  ['commit', 'Propose changes via bastion submit (human reviews before commit).'],
  ['reset', 'Destructive git operations are not available in the managed environment.'],
  ['rebase', 'Destructive git operations are not available in the managed environment.'],
  ['checkout', 'Branch switching is managed via bastion workspace commands.'],
  ['merge', 'Merges require human approval. Propose via bastion submit.'],
  ['stash', 'Use /bastion/scratch/ for temporary work instead.'],
]);

/** Tier 2 — Redirected: explain why + offer governed alternative. */
const TIER2_REDIRECTS = new Map<string, string>([
  [
    'rm',
    'Deletion is managed by PurgeManager. Use: mv <file> /bastion/trash/ (reversible). PurgeManager handles permanent deletion after human approval.',
  ],
  ['rmdir', 'Directory deletion managed by PurgeManager. Use: mv <dir> /bastion/trash/'],
  ['chmod', 'Permissions are managed by Bastion. Request via operator admin panel.'],
  ['chown', 'Ownership is managed by Bastion. Request via operator admin panel.'],
  ['curl', 'Network access uses Bastion MCP tools (audited, scoped). Request via tool registry.'],
  ['wget', 'Network access uses Bastion MCP tools (audited, scoped). Request via tool registry.'],
  ['ssh', 'Remote access uses Bastion connect (audited, approved). Request via operator.'],
  ['pip', 'Package installation requires approval. Use: bastion package request <package>.'],
  ['npm', 'Package installation requires approval. Use: bastion package request <package>.'],
  ['kill', 'Process lifecycle is managed by Bastion.'],
  ['pkill', 'Process lifecycle is managed by Bastion.'],
  ['sudo', 'Privilege escalation is not available in the managed environment.'],
  ['su', 'User switching is not available in the managed environment.'],
]);

/** Tier 3 — Invisible: AI doesn't know these exist. Logged as canary. */
const TIER3_INVISIBLE = new Set([
  'dd',
  'fdisk',
  'mkfs',
  'parted',
  'gdisk',
  'iptables',
  'ufw',
  'nftables',
  'firewall-cmd',
  'systemctl',
  'service',
  'init',
  'telinit',
  'useradd',
  'userdel',
  'usermod',
  'groupadd',
  'passwd',
  'mount',
  'umount',
  'swapon',
  'swapoff',
  'reboot',
  'shutdown',
  'halt',
  'poweroff',
  'crontab',
  'at',
  'nc',
  'netcat',
  'ncat',
]);

/** Paths that are absolutely forbidden — actively blocked. */
const FORBIDDEN_PATH_PATTERNS = [
  '/var/lib/bastion',
  '/opt/bastion',
  '/etc/',
  '/home/',
  '/root/',
  '../',
  '/proc/',
  '/sys/',
  '\\..\\',
  '..\\',
];

// ---------------------------------------------------------------------------
// BastionBash
// ---------------------------------------------------------------------------

export class BastionBash {
  private readonly config: BastionBashConfig;
  private readonly purgeManager: FilePurgeManager;
  private readonly auditLogger: AuditLogger | null;
  private readonly allowedPaths: readonly string[];
  private currentDir: string;

  constructor(
    config: BastionBashConfig,
    purgeManager: FilePurgeManager,
    auditLogger: AuditLogger | null,
    _dateTimeManager?: DateTimeManager,
  ) {
    this.config = config;
    this.purgeManager = purgeManager;
    this.auditLogger = auditLogger;
    this.currentDir = config.workspacePath;

    this.allowedPaths = [
      config.workspacePath,
      config.intakePath,
      config.outboundPath,
      config.trashPath,
      config.scratchPath,
    ];

    // Ensure governed directories exist
    for (const dir of this.allowedPaths) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Execute a command string through the governed environment.
   */
  async execute(commandString: string): Promise<CommandResult> {
    const startMs = Date.now();

    // Validate command length
    if (commandString.length > this.config.maxCommandLength) {
      return {
        command: `${commandString.substring(0, 80)}...`,
        tier: 1,
        success: false,
        output: `bash: command too long (${commandString.length} chars, max ${this.config.maxCommandLength})`,
        exitCode: 1,
        executionTimeMs: Date.now() - startMs,
      };
    }

    const trimmed = commandString.trim();
    if (trimmed.length === 0) {
      return {
        command: '',
        tier: 1,
        success: false,
        output: '',
        exitCode: 0,
        executionTimeMs: Date.now() - startMs,
      };
    }

    // Parse the base command (first token)
    const baseCommand = this.parseBaseCommand(trimmed);

    // Check Tier 3 first (invisible — canary)
    if (TIER3_INVISIBLE.has(baseCommand)) {
      this.auditLogger?.logEvent('BASH_INVISIBLE', null, {
        command: trimmed.substring(0, 200),
        baseCommand,
        tier: 3,
      });
      return {
        command: trimmed,
        tier: 3,
        success: false,
        output: `bash: ${baseCommand}: command not found`,
        exitCode: 127,
        executionTimeMs: Date.now() - startMs,
      };
    }

    // Check Tier 2 (redirected)
    const redirect = TIER2_REDIRECTS.get(baseCommand);
    if (redirect) {
      this.auditLogger?.logEvent('BASH_BLOCKED', null, {
        command: trimmed.substring(0, 200),
        baseCommand,
        tier: 2,
      });
      return {
        command: trimmed,
        tier: 2,
        success: false,
        output: redirect,
        exitCode: 1,
        executionTimeMs: Date.now() - startMs,
      };
    }

    // Check Tier 1 (available)
    if (!TIER1_COMMANDS.has(baseCommand)) {
      // Unknown command — treat as Tier 3 (invisible)
      this.auditLogger?.logEvent('BASH_INVISIBLE', null, {
        command: trimmed.substring(0, 200),
        baseCommand,
        tier: 3,
      });
      return {
        command: trimmed,
        tier: 3,
        success: false,
        output: `bash: ${baseCommand}: command not found`,
        exitCode: 127,
        executionTimeMs: Date.now() - startMs,
      };
    }

    // Git subcommand validation
    if (baseCommand === 'git') {
      const gitResult = this.validateGitCommand(trimmed, startMs);
      if (gitResult) return gitResult;
    }

    // Filesystem scope enforcement — check all path arguments
    const pathViolation = this.checkPathScope(trimmed);
    if (pathViolation) {
      this.auditLogger?.logEvent('BASH_COMMAND', null, {
        command: trimmed.substring(0, 200),
        tier: 1,
        success: false,
        reason: pathViolation,
      });
      return {
        command: trimmed,
        tier: 1,
        success: false,
        output: pathViolation,
        exitCode: 1,
        executionTimeMs: Date.now() - startMs,
      };
    }

    // Special case: cd — update internal working directory
    if (baseCommand === 'cd') {
      return this.handleCd(trimmed, startMs);
    }

    // Special case: mv to trash — route through PurgeManager
    if (baseCommand === 'mv') {
      const trashResult = this.handleMvToTrash(trimmed, startMs);
      if (trashResult) return trashResult;
    }

    // Execute Tier 1 command
    return this.executeTier1(trimmed, startMs);
  }

  /**
   * Format a CommandResult for injection into the system prompt.
   */
  formatForPrompt(result: CommandResult): string {
    if (result.tier === 1) {
      const parts = ['--- Execution Result ---', `$ ${result.command}`, result.output || '(no output)'];
      if (result.exitCode !== 0) {
        parts.push(`Exit code: ${result.exitCode}`);
      }
      parts.push('--- End Result ---');
      return parts.filter(Boolean).join('\n');
    }

    if (result.tier === 2) {
      return ['--- Command Redirected ---', `$ ${result.command}`, result.output, '--- End Redirect ---'].join('\n');
    }

    // Tier 3 — generic, gives nothing away
    const cmdName = result.command.split(/\s+/)[0] || result.command;
    return [
      '--- Execution Result ---',
      `$ ${result.command}`,
      `bash: ${cmdName}: command not found`,
      '--- End Result ---',
    ].join('\n');
  }

  /** Get the current working directory. */
  get workingDirectory(): string {
    return this.currentDir;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private parseBaseCommand(commandString: string): string {
    // Handle pipes — use only the first command in a pipeline
    const firstPipe = commandString.split('|')[0]?.trim() ?? commandString;
    // Handle semicolons
    const firstSemicolon = firstPipe.split(';')[0]?.trim() ?? firstPipe;
    // Handle && chains
    const firstAnd = firstSemicolon.split('&&')[0]?.trim() ?? firstSemicolon;
    // Extract the actual command (first token)
    const tokens = firstAnd.split(/\s+/);
    return tokens[0] ?? '';
  }

  private validateGitCommand(commandString: string, startMs: number): CommandResult | null {
    const tokens = commandString.trim().split(/\s+/);
    const subcommand = tokens[1] ?? '';

    // Check redirected git subcommands
    const gitRedirect = GIT_REDIRECTED.get(subcommand);
    if (gitRedirect) {
      this.auditLogger?.logEvent('BASH_BLOCKED', null, {
        command: commandString.substring(0, 200),
        baseCommand: `git ${subcommand}`,
        tier: 2,
      });
      return {
        command: commandString,
        tier: 2,
        success: false,
        output: gitRedirect,
        exitCode: 1,
        executionTimeMs: Date.now() - startMs,
      };
    }

    // Only allow read-only git subcommands
    if (!GIT_READONLY.has(subcommand)) {
      this.auditLogger?.logEvent('BASH_BLOCKED', null, {
        command: commandString.substring(0, 200),
        baseCommand: `git ${subcommand}`,
        tier: 2,
      });
      return {
        command: commandString,
        tier: 2,
        success: false,
        output: `git ${subcommand}: not available. Only read-only git commands are allowed: ${[...GIT_READONLY].join(', ')}.`,
        exitCode: 1,
        executionTimeMs: Date.now() - startMs,
      };
    }

    return null; // Allowed — proceed to execution
  }

  private checkPathScope(commandString: string): string | null {
    // Check for forbidden path patterns in the raw command
    for (const pattern of FORBIDDEN_PATH_PATTERNS) {
      if (commandString.includes(pattern)) {
        return `bash: access denied — path outside managed workspace (${pattern.replace(/\/$/, '')})`;
      }
    }

    // Check ALL output redirect operators (>, >>, 2>, 2>>, &>, &>>) for out-of-scope targets
    const redirectMatches = commandString.matchAll(/(?:&>>|&>|2>>|2>|>>|>)\s*(\S+)/g);
    for (const match of redirectMatches) {
      const target = match[1] ?? '';
      if (!this.isWithinAllowedPaths(target)) {
        return 'bash: access denied — cannot redirect output outside managed workspace';
      }
    }

    // Resolve symlinks on file path arguments to prevent traversal via
    // symlinks pointing outside the workspace (e.g., workspace/link → /etc).
    // Strip redirects and pipes, then check remaining arguments that look like paths.
    const stripped = commandString.replace(/(?:&>>|&>|2>>|2>|>>|>)\s*\S+/g, '').replace(/\|.*$/, '');
    const tokens = stripped.trim().split(/\s+/).slice(1); // skip the command itself
    for (const token of tokens) {
      // Skip flags/options
      if (token.startsWith('-')) continue;
      // Only check tokens that look like filesystem paths
      if (!token.includes('/') && !token.includes('\\')) continue;
      if (!this.isWithinAllowedPaths(token)) {
        return 'bash: access denied — path outside managed workspace (symlink resolved)';
      }
    }

    return null;
  }

  private isWithinAllowedPaths(rawPath: string): boolean {
    // Relative paths are resolved against current working directory
    const resolved = rawPath.startsWith('/') ? normalize(rawPath) : normalize(resolve(this.currentDir, rawPath));

    // Resolve symlinks to prevent traversal via symlink pointing outside workspace
    let realPath: string;
    try {
      realPath = realpathSync(resolved);
    } catch {
      // Path doesn't exist yet (e.g., new file) — use the resolved path
      realPath = resolved;
    }

    return this.allowedPaths.some((base) => realPath.startsWith(base));
  }

  private handleCd(commandString: string, startMs: number): CommandResult {
    const tokens = commandString.trim().split(/\s+/);
    const target = tokens[1] ?? this.config.workspacePath;

    const resolved = target.startsWith('/') ? normalize(target) : normalize(resolve(this.currentDir, target));

    // Resolve symlinks to prevent traversal via symlink pointing outside workspace
    let realResolved: string;
    try {
      realResolved = realpathSync(resolved);
    } catch {
      realResolved = resolved;
    }

    if (!this.allowedPaths.some((base) => realResolved.startsWith(base))) {
      return {
        command: commandString,
        tier: 1,
        success: false,
        output: `bash: cd: ${target}: access denied — outside managed workspace`,
        exitCode: 1,
        executionTimeMs: Date.now() - startMs,
      };
    }

    if (!existsSync(realResolved)) {
      return {
        command: commandString,
        tier: 1,
        success: false,
        output: `bash: cd: ${target}: No such file or directory`,
        exitCode: 1,
        executionTimeMs: Date.now() - startMs,
      };
    }

    this.currentDir = realResolved;

    this.auditLogger?.logEvent('BASH_COMMAND', null, {
      command: commandString.substring(0, 200),
      tier: 1,
      success: true,
      exitCode: 0,
      executionTimeMs: Date.now() - startMs,
    });

    return {
      command: commandString,
      tier: 1,
      success: true,
      output: realResolved,
      exitCode: 0,
      executionTimeMs: Date.now() - startMs,
    };
  }

  private handleMvToTrash(commandString: string, startMs: number): CommandResult | null {
    const tokens = commandString.trim().split(/\s+/);
    // mv <source> <target> — check if target is in trash path
    if (tokens.length < 3) return null;

    const target = tokens[tokens.length - 1] ?? '';
    const resolvedTarget = target.startsWith('/') ? normalize(target) : normalize(resolve(this.currentDir, target));

    if (!resolvedTarget.startsWith(this.config.trashPath)) {
      return null; // Not a trash move — proceed to normal execution
    }

    // Route through PurgeManager for soft delete
    const sources = tokens.slice(1, -1);
    const results: string[] = [];

    for (const source of sources) {
      const resolvedSource = source.startsWith('/') ? normalize(source) : normalize(resolve(this.currentDir, source));

      if (!this.allowedPaths.some((base) => resolvedSource.startsWith(base))) {
        results.push(`${source}: access denied — outside managed workspace`);
        continue;
      }

      // Move through PurgeManager — sole deletion authority
      this.purgeManager.deleteFile(resolvedSource, 'bastion-bash-trash-move');
      results.push(`Moved to trash: ${source} → ${resolvedTarget}`);
    }

    results.push('Human approval required for permanent deletion.');

    this.auditLogger?.logEvent('BASH_COMMAND', null, {
      command: commandString.substring(0, 200),
      tier: 1,
      success: true,
      action: 'trash-move',
      sources,
      exitCode: 0,
      executionTimeMs: Date.now() - startMs,
    });

    return {
      command: commandString,
      tier: 1,
      success: true,
      output: results.join('\n'),
      exitCode: 0,
      executionTimeMs: Date.now() - startMs,
    };
  }

  private executeTier1(commandString: string, startMs: number): CommandResult {
    try {
      const output = execSync(commandString, {
        cwd: this.currentDir,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf-8',
        env: {
          PATH: '/usr/bin:/bin',
          HOME: this.config.scratchPath,
          TERM: 'dumb',
          LANG: 'en_GB.UTF-8',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const truncatedOutput = output.substring(0, this.config.maxOutputChars);

      this.auditLogger?.logEvent('BASH_COMMAND', null, {
        command: commandString.substring(0, 200),
        tier: 1,
        success: true,
        exitCode: 0,
        executionTimeMs: Date.now() - startMs,
      });

      return {
        command: commandString,
        tier: 1,
        success: true,
        output: truncatedOutput,
        exitCode: 0,
        executionTimeMs: Date.now() - startMs,
      };
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; message?: string; status?: number };
      const errorOutput = (execErr.stderr || execErr.message || 'Unknown error').substring(
        0,
        this.config.maxOutputChars,
      );

      this.auditLogger?.logEvent('BASH_COMMAND', null, {
        command: commandString.substring(0, 200),
        tier: 1,
        success: false,
        exitCode: execErr.status ?? 1,
        executionTimeMs: Date.now() - startMs,
      });

      return {
        command: commandString,
        tier: 1,
        success: false,
        output: errorOutput,
        exitCode: execErr.status ?? 1,
        executionTimeMs: Date.now() - startMs,
      };
    }
  }
}
