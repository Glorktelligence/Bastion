// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * @bastion/update-agent — Self-update agent for Project Bastion.
 *
 * Connects to the relay as a 'updater' client, receives whitelisted
 * build commands, and reports build status back to the admin.
 */

export { BastionUpdateAgent, UpdateAgentError } from './agent.js';
export type { AgentState, AgentEvents } from './agent.js';
export { executeCommand, buildCommandString, CommandExecutorError, VALID_COMMAND_TYPES } from './command-executor.js';
export type { CommandResult, CommandOptions } from './command-executor.js';
export { validateConfig, AgentConfigSchema } from './config.js';
export type { AgentConfig, BuildStep, ConfigValidationResult } from './config.js';
