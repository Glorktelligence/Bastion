// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * ExtensionRegistry — loads and validates protocol extensions.
 *
 * Extensions are namespaced message type definitions loaded from JSON files
 * at relay startup. The registry LOCKS after startup — no mid-session
 * registration. Extensions can add message types but cannot modify core
 * protocol types or lower safety floors.
 *
 * Schema evolution rule: future extension versions can only ADD optional
 * fields to existing message types — never remove or change required fields.
 *
 * Extension message types use namespace:type format (e.g. "games:chess-move").
 * The colon separator distinguishes extension types from core protocol types.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Safety evaluation level for an extension message type. */
export type ExtensionSafetyLevel = 'passthrough' | 'task' | 'admin' | 'blocked';

/** Extension message type definition. */
export interface ExtensionMessageType {
  readonly name: string;
  readonly description: string;
  readonly fields: Record<string, { type: string; required: boolean; description: string }>;
  readonly safety: ExtensionSafetyLevel;
  readonly audit: {
    readonly logEvent: string;
    readonly logContent: boolean;
  };
}

/** A loaded and validated extension definition. */
export interface ExtensionDefinition {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly messageTypes: readonly ExtensionMessageType[];
  readonly dependencies?: readonly string[];
}

/** Result of loading an extension. */
export type ExtensionLoadResult =
  | { readonly ok: true; readonly extension: ExtensionDefinition }
  | { readonly ok: false; readonly error: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAMESPACE_PATTERN = /^[a-z0-9-]+$/;

const RESERVED_NAMESPACES = new Set([
  'bastion',
  'admin',
  'system',
  'internal',
  'core',
  'protocol',
  'relay',
  'auth',
  'safety',
  'audit',
  'debug',
  'test',
]);

const SOFT_LIMIT_EXTENSIONS = 10;
const SOFT_LIMIT_TYPES = 100;
const HARD_CAP_EXTENSIONS = 25;
const HARD_CAP_TYPES = 250;

// ---------------------------------------------------------------------------
// ExtensionRegistry
// ---------------------------------------------------------------------------

export class ExtensionRegistry {
  private readonly extensions: Map<string, ExtensionDefinition> = new Map();
  private totalMessageTypes = 0;
  private locked = false;

  /** Number of loaded extensions. */
  get extensionCount(): number {
    return this.extensions.size;
  }

  /** Total extension message types across all extensions. */
  get messageTypeCount(): number {
    return this.totalMessageTypes;
  }

  /** Whether the registry is locked (no more registrations). */
  get isLocked(): boolean {
    return this.locked;
  }

  /**
   * Load extensions from a directory of JSON files.
   * Call this once at startup, then call lock().
   */
  loadFromDirectory(dirPath: string): { loaded: string[]; errors: string[] } {
    const loaded: string[] = [];
    const errors: string[] = [];

    if (!existsSync(dirPath)) {
      return { loaded, errors };
    }

    const files = readdirSync(dirPath).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      const filePath = join(dirPath, file);
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const def = JSON.parse(raw) as Record<string, unknown>;

        // Skip example files
        if (def._example === true) continue;

        const result = this.register(def);
        if (result.ok) {
          loaded.push(result.extension.namespace);
        } else {
          errors.push(`${file}: ${result.error}`);
        }
      } catch (err) {
        errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { loaded, errors };
  }

  /**
   * Register a single extension definition.
   * Validates all required sections and constraints.
   */
  register(def: Record<string, unknown>): ExtensionLoadResult {
    if (this.locked) {
      return { ok: false, error: 'Extension Violation Detected — Registry is locked after startup' };
    }

    // Required sections
    if (!def.namespace || typeof def.namespace !== 'string') {
      return { ok: false, error: 'Extension Violation Detected — Missing [namespace]' };
    }
    if (!def.messageTypes || !Array.isArray(def.messageTypes)) {
      return { ok: false, error: 'Extension Violation Detected — Missing [messageTypes]' };
    }
    if (!def.name || typeof def.name !== 'string') {
      return { ok: false, error: 'Extension Violation Detected — Missing [name]' };
    }
    if (!def.version || typeof def.version !== 'string') {
      return { ok: false, error: 'Extension Violation Detected — Missing [version]' };
    }

    const namespace = def.namespace as string;

    // Namespace format
    if (!NAMESPACE_PATTERN.test(namespace)) {
      return { ok: false, error: `Invalid namespace format: "${namespace}" (must match [a-z0-9-]+)` };
    }

    // Reserved namespace check
    if (RESERVED_NAMESPACES.has(namespace)) {
      return { ok: false, error: `Reserved namespace: "${namespace}" cannot be used by extensions` };
    }

    // Duplicate namespace
    if (this.extensions.has(namespace)) {
      return { ok: false, error: `Namespace conflict: "${namespace}" already registered` };
    }

    // Hard caps
    if (this.extensions.size >= HARD_CAP_EXTENSIONS) {
      return { ok: false, error: `Hard cap exceeded: max ${HARD_CAP_EXTENSIONS} extensions` };
    }

    const msgTypes = def.messageTypes as Array<Record<string, unknown>>;

    if (this.totalMessageTypes + msgTypes.length > HARD_CAP_TYPES) {
      return { ok: false, error: `Hard cap exceeded: max ${HARD_CAP_TYPES} total extension message types` };
    }

    // Validate each message type has safety and audit sections
    const validatedTypes: ExtensionMessageType[] = [];
    for (const mt of msgTypes) {
      if (!mt.name || typeof mt.name !== 'string') {
        return { ok: false, error: `Extension Violation Detected — Missing [messageTypes[].name] in ${namespace}` };
      }
      if (!mt.safety || typeof mt.safety !== 'string') {
        return {
          ok: false,
          error: `Extension Violation Detected — Missing [safety] for message type "${mt.name}" in ${namespace}`,
        };
      }
      if (!mt.audit || typeof mt.audit !== 'object') {
        return {
          ok: false,
          error: `Extension Violation Detected — Missing [audit] for message type "${mt.name}" in ${namespace}`,
        };
      }

      const audit = mt.audit as Record<string, unknown>;

      validatedTypes.push({
        name: mt.name as string,
        description: (mt.description as string) ?? '',
        fields: (mt.fields as Record<string, { type: string; required: boolean; description: string }>) ?? {},
        safety: mt.safety as ExtensionSafetyLevel,
        audit: {
          logEvent: (audit.logEvent as string) ?? (mt.name as string),
          logContent: audit.logContent === true, // Forced false for E2E payloads at routing level
        },
      });
    }

    const extension: ExtensionDefinition = {
      namespace,
      name: def.name as string,
      version: def.version as string,
      description: (def.description as string) ?? '',
      author: (def.author as string) ?? 'unknown',
      messageTypes: validatedTypes,
      dependencies: Array.isArray(def.dependencies) ? (def.dependencies as string[]) : undefined,
    };

    this.extensions.set(namespace, extension);
    this.totalMessageTypes += validatedTypes.length;

    // Soft limit warnings (returned in result but don't reject)
    if (this.extensions.size > SOFT_LIMIT_EXTENSIONS) {
      console.warn(
        `[!] Extension soft limit warning: ${this.extensions.size} extensions (recommended max: ${SOFT_LIMIT_EXTENSIONS})`,
      );
    }
    if (this.totalMessageTypes > SOFT_LIMIT_TYPES) {
      console.warn(
        `[!] Extension type soft limit warning: ${this.totalMessageTypes} types (recommended max: ${SOFT_LIMIT_TYPES})`,
      );
    }

    return { ok: true, extension };
  }

  /**
   * Lock the registry. No more extensions can be registered.
   * Validates dependencies before locking.
   */
  lock(): { ok: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate dependencies
    for (const [ns, ext] of this.extensions) {
      if (ext.dependencies) {
        for (const dep of ext.dependencies) {
          if (!this.extensions.has(dep)) {
            errors.push(`${ns}: missing dependency "${dep}"`);
          }
        }
      }
    }

    this.locked = true;
    return { ok: errors.length === 0, errors };
  }

  /** Get an extension by namespace. */
  getExtension(namespace: string): ExtensionDefinition | undefined {
    return this.extensions.get(namespace);
  }

  /** Get all loaded extensions. */
  getAllExtensions(): readonly ExtensionDefinition[] {
    return [...this.extensions.values()];
  }

  /**
   * Resolve a namespaced message type.
   * Returns the extension and message type definition, or null if not found.
   */
  resolveMessageType(fullType: string): { extension: ExtensionDefinition; messageType: ExtensionMessageType } | null {
    const colonIdx = fullType.indexOf(':');
    if (colonIdx === -1) return null;

    const namespace = fullType.slice(0, colonIdx);
    const typeName = fullType.slice(colonIdx + 1);

    const ext = this.extensions.get(namespace);
    if (!ext) return null;

    const mt = ext.messageTypes.find((t) => t.name === typeName);
    if (!mt) return null;

    return { extension: ext, messageType: mt };
  }

  /** Check if a message type string is a namespaced extension type. */
  isExtensionType(messageType: string): boolean {
    return messageType.includes(':');
  }
}
