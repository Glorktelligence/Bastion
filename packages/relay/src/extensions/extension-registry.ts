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

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
  /** Adapter selection hint: 'cheapest' | 'fastest' | 'smartest' | 'default' | adapter ID. */
  readonly adapterHint?: string;
  /** Whether this message type can be compacted (summarised). Default: true.
   *  Set to false for structural data (game state, tension updates) that must be preserved verbatim.
   *  When false, messages of this type are stored with pinned=true in the ConversationStore,
   *  which excludes them from compaction via the existing getCompactableMessages() filter. */
  readonly compactable?: boolean;
  readonly audit: {
    readonly logEvent: string;
    readonly logContent: boolean;
  };
}

/** UI component size constraints. */
export interface ExtensionUISize {
  readonly minHeight: string;
  readonly maxHeight: string;
}

/** Audit configuration for a UI component. */
export interface ExtensionUIAudit {
  readonly logRender: boolean;
  readonly logInteractions: boolean;
  readonly logEvent: string;
}

/** A UI component definition within an extension page. */
export interface ExtensionUIComponent {
  readonly id: string;
  readonly name: string;
  readonly file: string;
  readonly description: string;
  readonly function: string;
  readonly messageTypes: readonly string[];
  readonly size: ExtensionUISize;
  readonly placement: 'main' | 'full-page' | 'sidebar' | 'settings-tab';
  readonly dangerous: boolean;
  readonly audit: ExtensionUIAudit;
}

/** A UI page grouping components. */
export interface ExtensionUIPage {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly components: readonly ExtensionUIComponent[];
}

/** UI manifest for an extension. */
export interface ExtensionUI {
  readonly pages: readonly ExtensionUIPage[];
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
  readonly ui?: ExtensionUI;
}

/** Result of loading an extension. */
export type ExtensionLoadResult =
  | { readonly ok: true; readonly extension: ExtensionDefinition }
  | { readonly ok: false; readonly error: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAMESPACE_PATTERN = /^[a-z0-9-]+$/;

const VALID_SAFETY_LEVELS = new Set<string>(['passthrough', 'task', 'admin', 'blocked']);

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
  /** Maps namespace → base directory path (for resolving UI file paths). */
  private readonly extensionPaths: Map<string, string> = new Map();
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
   * Scans top-level JSON files and one level of subdirectories.
   * Call this once at startup, then call lock().
   */
  loadFromDirectory(dirPath: string): { loaded: string[]; errors: string[] } {
    const loaded: string[] = [];
    const errors: string[] = [];

    if (!existsSync(dirPath)) {
      return { loaded, errors };
    }

    // Collect all manifest candidates: top-level JSON + subdirectory JSON files
    const candidates: Array<{ filePath: string; basePath: string; label: string }> = [];

    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && entry.endsWith('.json')) {
          candidates.push({ filePath: fullPath, basePath: dirPath, label: entry });
        } else if (stat.isDirectory()) {
          // Scan one level of subdirectories for JSON manifests
          const subFiles = readdirSync(fullPath).filter((f) => f.endsWith('.json'));
          for (const sf of subFiles) {
            candidates.push({ filePath: join(fullPath, sf), basePath: fullPath, label: `${entry}/${sf}` });
          }
        }
      } catch {
        // Skip unreadable entries
      }
    }

    for (const { filePath, basePath, label } of candidates) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const def = JSON.parse(raw) as Record<string, unknown>;

        // Skip example files
        if (def._example === true) continue;

        const result = this.register(def);
        if (result.ok) {
          this.extensionPaths.set(result.extension.namespace, basePath);
          loaded.push(result.extension.namespace);
        } else {
          errors.push(`${label}: ${result.error}`);
        }
      } catch (err) {
        errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
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
      if (!VALID_SAFETY_LEVELS.has(mt.safety as string)) {
        return {
          ok: false,
          error: `Message type "${mt.name}": safety must be one of: passthrough, task, admin, blocked (got: "${mt.safety}")`,
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
        adapterHint: typeof mt.adapterHint === 'string' ? (mt.adapterHint as string) : undefined,
        compactable: typeof mt.compactable === 'boolean' ? (mt.compactable as boolean) : undefined,
        audit: {
          logEvent: (audit.logEvent as string) ?? (mt.name as string),
          logContent: audit.logContent === true, // Forced false for E2E payloads at routing level
        },
      });
    }

    // Validate UI section if present
    let validatedUI: ExtensionUI | undefined;
    if (def.ui && typeof def.ui === 'object') {
      const uiDef = def.ui as Record<string, unknown>;
      const pages = uiDef.pages as Array<Record<string, unknown>> | undefined;
      if (!pages || !Array.isArray(pages)) {
        return { ok: false, error: `Extension Violation Detected — ui.pages must be an array in ${namespace}` };
      }
      const typeNames = new Set(validatedTypes.map((t) => `${namespace}:${t.name}`));
      const validatedPages: ExtensionUIPage[] = [];
      for (const page of pages) {
        if (!page.id || !page.name || !page.icon || !Array.isArray(page.components)) {
          return {
            ok: false,
            error: `Extension Violation Detected — ui.pages[] missing required fields in ${namespace}`,
          };
        }
        const comps: ExtensionUIComponent[] = [];
        for (const c of page.components as Array<Record<string, unknown>>) {
          const requiredFields = [
            'id',
            'name',
            'file',
            'description',
            'function',
            'messageTypes',
            'size',
            'placement',
            'audit',
          ];
          for (const f of requiredFields) {
            if (c[f] === undefined || c[f] === null) {
              return {
                ok: false,
                error: `Extension Violation Detected — ui component missing [${f}] in ${namespace}:${String(c.id ?? 'unknown')}`,
              };
            }
          }
          // Validate file path (no traversal)
          const filePath = String(c.file);
          if (filePath.includes('..') || filePath.startsWith('/') || filePath.startsWith('\\')) {
            return {
              ok: false,
              error: `Extension Violation Detected — path traversal in ui component file: ${filePath}`,
            };
          }
          // Validate messageTypes are owned by this extension
          const compTypes = c.messageTypes as string[];
          for (const mt of compTypes) {
            if (!typeNames.has(mt)) {
              return {
                ok: false,
                error: `Extension Violation Detected — ui component references unowned message type: ${mt}`,
              };
            }
          }
          const size = c.size as Record<string, string>;
          const audit = c.audit as Record<string, unknown>;
          comps.push({
            id: String(c.id),
            name: String(c.name),
            file: filePath,
            description: String(c.description),
            function: String(c.function),
            messageTypes: compTypes,
            size: { minHeight: size.minHeight ?? '100px', maxHeight: size.maxHeight ?? '600px' },
            placement: String(c.placement) as ExtensionUIComponent['placement'],
            dangerous: Boolean(c.dangerous),
            audit: {
              logRender: Boolean(audit.logRender),
              logInteractions: Boolean(audit.logInteractions),
              logEvent: String(audit.logEvent ?? ''),
            },
          });
        }
        validatedPages.push({
          id: String(page.id),
          name: String(page.name),
          icon: String(page.icon),
          components: comps,
        });
      }
      validatedUI = { pages: validatedPages };
    }

    const extension: ExtensionDefinition = {
      namespace,
      name: def.name as string,
      version: def.version as string,
      description: (def.description as string) ?? '',
      author: (def.author as string) ?? 'unknown',
      messageTypes: validatedTypes,
      dependencies: Array.isArray(def.dependencies) ? (def.dependencies as string[]) : undefined,
      ui: validatedUI,
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

  /**
   * Read a UI file for an extension.
   * The filePath is relative to the extension's base directory (e.g. "ui/turn-submit.html").
   * Returns null if the file doesn't exist, path is invalid, or not an HTML file.
   */
  readUIFile(namespace: string, filePath: string): string | null {
    const basePath = this.extensionPaths.get(namespace);
    if (!basePath) return null;

    // Security: no path traversal, only .html files
    if (filePath.includes('..') || filePath.startsWith('/') || filePath.startsWith('\\')) return null;
    if (!filePath.endsWith('.html')) return null;

    const fullPath = join(basePath, filePath);
    try {
      return readFileSync(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }
}
