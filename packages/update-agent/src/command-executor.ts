// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Whitelisted command executor for the update agent.
 *
 * Maps protocol command types to EXACT shell commands.
 * NO eval(), NO exec(arbitrary), NO template strings with user input.
 *
 * Security model:
 *   - Only three command types are accepted: git_pull, pnpm_install, pnpm_build
 *   - All commands run as the 'bastion' service user via sudo
 *   - PATH is restricted to /usr/bin:/bin
 *   - Execution timeout defaults to 5 minutes
 *   - Unknown command types are rejected with an error
 *   - The filter parameter for pnpm_build is validated against a safe pattern
 */

import { execSync } from 'node:child_process';
import type { AgentConfig } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandResult {
  readonly success: boolean;
  readonly output: string;
  readonly durationMs: number;
  readonly error?: string;
}

export interface CommandOptions {
  readonly filter?: string;
  readonly repo?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Safe pattern for pnpm filter values — only allow @scope/package-name format. */
const SAFE_FILTER_PATTERN = /^@?[\w-]+(?:\/[\w-]+)?$/;

/** Safe pattern for git repo URLs or paths. */
const SAFE_REPO_PATTERN = /^[\w./:@-]+$/;

/** Validate a pnpm filter value. */
function validateFilter(filter: string): boolean {
  return SAFE_FILTER_PATTERN.test(filter);
}

/** Validate a git repo URL/path. */
function validateRepo(repo: string): boolean {
  return SAFE_REPO_PATTERN.test(repo);
}

/** Validate that a path contains no shell metacharacters. */
function validatePath(path: string): boolean {
  // Reject anything that could be used for command injection
  return /^[\w/.:-]+$/.test(path);
}

// ---------------------------------------------------------------------------
// Command Map
// ---------------------------------------------------------------------------

type CommandBuilder = (config: AgentConfig, options?: CommandOptions) => string;

const COMMAND_MAP: Record<string, CommandBuilder> = {
  git_pull: (config, options) => {
    const repo = options?.repo;
    if (repo && !validateRepo(repo)) {
      throw new CommandExecutorError(`Invalid repo value: ${repo}`);
    }
    return `sudo -u bastion git -C ${config.buildPath} pull`;
  },

  pnpm_install: (config) => {
    return `sudo -u bastion pnpm -C ${config.buildPath} install`;
  },

  pnpm_build: (config, options) => {
    const filter = options?.filter;
    if (filter) {
      if (!validateFilter(filter)) {
        throw new CommandExecutorError(`Invalid filter value: ${filter}`);
      }
      return `sudo -u bastion pnpm -C ${config.buildPath} --filter ${filter} run build`;
    }
    return `sudo -u bastion pnpm -C ${config.buildPath} run build`;
  },
};

/** All valid command types (for external validation). */
export const VALID_COMMAND_TYPES = Object.keys(COMMAND_MAP) as ReadonlyArray<string>;

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const RESTRICTED_ENV = { PATH: '/usr/bin:/bin' };

/**
 * Execute a whitelisted command.
 *
 * @param type — command type (must be in COMMAND_MAP)
 * @param config — agent configuration with buildPath
 * @param options — optional parameters (filter, repo)
 * @returns execution result with output and duration
 * @throws CommandExecutorError if command type is unknown or parameters are invalid
 */
export function executeCommand(type: string, config: AgentConfig, options?: CommandOptions): CommandResult {
  if (!COMMAND_MAP[type]) {
    throw new CommandExecutorError(`Unknown command type: ${type}. Valid types: ${VALID_COMMAND_TYPES.join(', ')}`);
  }

  if (!validatePath(config.buildPath)) {
    throw new CommandExecutorError(`Invalid build path: ${config.buildPath}`);
  }

  const cmd = COMMAND_MAP[type]!(config, options);
  const timeoutMs = config.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();

  try {
    const output = execSync(cmd, {
      timeout: timeoutMs,
      env: RESTRICTED_ENV,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });
    return {
      success: true,
      output: output.trim(),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: '',
      durationMs: Date.now() - start,
      error: message,
    };
  }
}

/**
 * Build the shell command string for a command type WITHOUT executing it.
 * Useful for logging and testing.
 */
export function buildCommandString(type: string, config: AgentConfig, options?: CommandOptions): string {
  if (!COMMAND_MAP[type]) {
    throw new CommandExecutorError(`Unknown command type: ${type}`);
  }
  if (!validatePath(config.buildPath)) {
    throw new CommandExecutorError(`Invalid build path: ${config.buildPath}`);
  }
  return COMMAND_MAP[type]!(config, options);
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class CommandExecutorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandExecutorError';
  }
}
