// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Update agent configuration.
 *
 * Loaded from a JSON config file at startup. Validated with Zod
 * to catch misconfiguration before connecting to the relay.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const BuildStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('git_pull'), repo: z.string().optional() }),
  z.object({ type: z.literal('pnpm_install') }),
  z.object({ type: z.literal('pnpm_build'), filter: z.string().optional() }),
]);

const TlsConfigSchema = z
  .object({
    /** Accept self-signed TLS certificates (development/homelab only). Default: true. */
    rejectUnauthorized: z.boolean().optional(),
    /** Path to a CA certificate file to trust (e.g. the relay's self-signed cert). */
    caCertPath: z.string().optional(),
  })
  .optional();

export const AgentConfigSchema = z.object({
  /** WSS URL of the relay server. */
  relayUrl: z.string().url(),
  /** Unique identifier for this agent. */
  agentId: z.string().min(1),
  /** Human-readable agent name. */
  agentName: z.string().min(1),
  /** Component this agent manages (e.g. 'relay', 'ai-client'). */
  component: z.string().min(1),
  /** Absolute path to the Bastion project root. */
  buildPath: z.string().min(1),
  /** Systemd service names to restart after build. */
  services: z.array(z.string().min(1)),
  /** Default build steps if update_execute doesn't specify commands. */
  buildSteps: z.array(BuildStepSchema).optional(),
  /** TLS configuration for the relay connection. */
  tls: TlsConfigSchema,
  /** Command execution timeout in milliseconds. Default: 300000 (5 min). */
  commandTimeoutMs: z.number().int().positive().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type BuildStep = z.infer<typeof BuildStepSchema>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ConfigValidationResult {
  readonly valid: boolean;
  readonly config?: AgentConfig;
  readonly errors?: readonly string[];
}

/** Parse and validate an agent configuration object. */
export function validateConfig(raw: unknown): ConfigValidationResult {
  const result = AgentConfigSchema.safeParse(raw);
  if (result.success) {
    return { valid: true, config: result.data };
  }
  return {
    valid: false,
    errors: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  };
}
