// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * SkillStore — Layer 5 skills system for the AI client.
 *
 * Skills are behaviour-informing documents loaded on demand into the
 * system prompt. They follow the same pattern as Extensions (loaded on
 * start, registered in catalogue, locked after startup) and ProjectStore
 * (markdown files injected into context).
 *
 * Skills ARE MCPs for behaviour: MCPs execute actions, Skills inform
 * behaviour. Both registered in a catalogue, scoped by mode, loaded on
 * demand, logged in audit trail.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanContent } from './project-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillMode = 'conversation' | 'task' | 'game' | 'compaction';

export interface SkillManifest {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
  /** Trigger words/patterns — if message content matches, skill is loaded. */
  readonly triggers: readonly string[];
  /** Regex triggers for more complex matching. */
  readonly triggerPatterns?: readonly string[];
  /** Modes this skill applies to. */
  readonly modes: readonly SkillMode[];
  /** Whether to always load this skill (no trigger needed). */
  readonly alwaysLoad?: boolean;
  /** Estimated token cost when loaded. */
  readonly estimatedTokens: number;
  /** The skill content file path (relative to skill directory). */
  readonly contentFile: string;
}

export interface LoadedSkill {
  readonly manifest: SkillManifest;
  readonly content: string;
  readonly loadedAt: string;
  readonly trigger: string | null;
}

export interface SkillStoreConfig {
  /** Root directory for skills. Default: './skills'. */
  readonly skillsDir?: string;
  /** Max content size per skill in bytes. Default: 8192 (~2000 tokens). */
  readonly maxContentSize?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SKILLS_DIR = './skills';
const DEFAULT_MAX_CONTENT_SIZE = 8192; // ~2000 tokens
const MANIFEST_FILE = 'manifest.json';

// ---------------------------------------------------------------------------
// SkillStore
// ---------------------------------------------------------------------------

export class SkillStore {
  private readonly skillsDir: string;
  private readonly maxContentSize: number;
  private readonly skills: Map<string, { manifest: SkillManifest; content: string; basePath: string }> = new Map();
  private readonly compiledPatterns: Map<string, readonly RegExp[]> = new Map();
  private locked = false;

  constructor(config?: SkillStoreConfig) {
    this.skillsDir = config?.skillsDir ?? DEFAULT_SKILLS_DIR;
    this.maxContentSize = config?.maxContentSize ?? DEFAULT_MAX_CONTENT_SIZE;
  }

  /** Number of loaded skills. */
  get skillCount(): number {
    return this.skills.size;
  }

  /** Total number of triggers across all skills. */
  get triggerCount(): number {
    let count = 0;
    for (const { manifest } of this.skills.values()) {
      count += manifest.triggers.length + (manifest.triggerPatterns?.length ?? 0);
    }
    return count;
  }

  /** Whether the store is locked. */
  get isLocked(): boolean {
    return this.locked;
  }

  /**
   * Load skills from the skills directory.
   * Each subdirectory containing a manifest.json is treated as a skill.
   */
  loadFromDirectory(dirPath?: string): { loaded: string[]; errors: string[] } {
    const dir = dirPath ?? this.skillsDir;
    const loaded: string[] = [];
    const errors: string[] = [];

    if (!existsSync(dir)) {
      return { loaded, errors };
    }

    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (!stat.isDirectory()) continue;

        const manifestPath = join(fullPath, MANIFEST_FILE);
        if (!existsSync(manifestPath)) continue;

        const raw = readFileSync(manifestPath, 'utf-8');
        const def = JSON.parse(raw) as Record<string, unknown>;

        // Skip example skills
        if (def._example === true) continue;

        const result = this.register(def, fullPath);
        if (result.ok) {
          loaded.push(result.id);
        } else {
          errors.push(`${entry}: ${result.error}`);
        }
      } catch (err) {
        errors.push(`${entry}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { loaded, errors };
  }

  /**
   * Register a single skill from a manifest and base directory.
   */
  private register(
    def: Record<string, unknown>,
    basePath: string,
  ): { ok: true; id: string } | { ok: false; error: string } {
    if (this.locked) {
      return { ok: false, error: 'SkillStore is locked — cannot register after startup' };
    }

    // Validate required fields
    if (!def.id || typeof def.id !== 'string') return { ok: false, error: 'Missing [id]' };
    if (!def.name || typeof def.name !== 'string') return { ok: false, error: 'Missing [name]' };
    if (!def.contentFile || typeof def.contentFile !== 'string') return { ok: false, error: 'Missing [contentFile]' };
    if (!def.modes || !Array.isArray(def.modes) || def.modes.length === 0)
      return { ok: false, error: 'Missing or empty [modes]' };
    if (!def.triggers || !Array.isArray(def.triggers)) return { ok: false, error: 'Missing [triggers]' };

    const id = def.id as string;
    if (this.skills.has(id)) return { ok: false, error: `Duplicate skill id: "${id}"` };

    // Validate content file path (no traversal)
    const contentFile = def.contentFile as string;
    if (contentFile.includes('..') || contentFile.startsWith('/') || contentFile.startsWith('\\')) {
      return { ok: false, error: `Path traversal in contentFile: ${contentFile}` };
    }

    // Read content file
    const contentPath = join(basePath, contentFile);
    if (!existsSync(contentPath)) {
      return { ok: false, error: `Content file not found: ${contentFile}` };
    }

    const content = readFileSync(contentPath, 'utf-8');

    // Size limit
    if (content.length > this.maxContentSize) {
      return { ok: false, error: `Content too large: ${content.length} bytes (max ${this.maxContentSize})` };
    }

    // Content security scanning
    const scanResult = scanContent(content);
    if (scanResult) {
      return { ok: false, error: `Content scanning failed: ${scanResult}` };
    }

    const manifest: SkillManifest = {
      id,
      name: def.name as string,
      description: (def.description as string) ?? '',
      version: (def.version as string) ?? '0.0.0',
      author: (def.author as string) ?? 'unknown',
      triggers: (def.triggers as string[]).map((t) => t.toLowerCase()),
      triggerPatterns: Array.isArray(def.triggerPatterns) ? (def.triggerPatterns as string[]) : undefined,
      modes: def.modes as SkillMode[],
      alwaysLoad: def.alwaysLoad === true,
      estimatedTokens:
        typeof def.estimatedTokens === 'number' ? (def.estimatedTokens as number) : Math.ceil(content.length / 4),
      contentFile,
    };

    // Compile regex patterns
    const patterns: RegExp[] = [];
    if (manifest.triggerPatterns) {
      for (const pat of manifest.triggerPatterns) {
        try {
          patterns.push(new RegExp(pat, 'i'));
        } catch {
          return { ok: false, error: `Invalid trigger pattern: ${pat}` };
        }
      }
    }
    this.compiledPatterns.set(id, patterns);

    this.skills.set(id, { manifest, content, basePath });
    return { ok: true, id };
  }

  /** Lock the store — no more registrations. */
  lock(): void {
    this.locked = true;
  }

  /**
   * Get a compact index of all available skills (~50 tokens).
   * Always included in the system prompt so the AI knows what skills exist.
   */
  getSkillIndex(): string | null {
    if (this.skills.size === 0) return null;

    const lines: string[] = ['--- Available Skills ---'];
    for (const { manifest } of this.skills.values()) {
      const triggerList = manifest.triggers.slice(0, 5).join(', ');
      const modeList = manifest.modes.join('/');
      lines.push(`- ${manifest.name} (${modeList}): ${manifest.description} [triggers: ${triggerList}]`);
    }
    return lines.join('\n');
  }

  /**
   * Get skills triggered by a message for a given mode.
   * Matches against trigger words (case-insensitive, word boundaries) and regex patterns.
   */
  getTriggeredSkills(message: string, mode: string): readonly LoadedSkill[] {
    const lowerMessage = message.toLowerCase();
    const results: LoadedSkill[] = [];

    for (const [id, { manifest, content }] of this.skills) {
      // Skip if mode doesn't match
      if (!manifest.modes.includes(mode as SkillMode)) continue;
      // Skip alwaysLoad skills (handled separately)
      if (manifest.alwaysLoad) continue;

      // Check trigger words (case-insensitive, word boundary)
      let matchedTrigger: string | null = null;
      for (const trigger of manifest.triggers) {
        // Word boundary check — trigger must appear as a word
        const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\b${escaped}\\b`, 'i').test(lowerMessage)) {
          matchedTrigger = trigger;
          break;
        }
      }

      // Check regex patterns if no word trigger matched
      if (!matchedTrigger) {
        const patterns = this.compiledPatterns.get(id) ?? [];
        for (const pat of patterns) {
          if (pat.test(message)) {
            matchedTrigger = pat.source;
            break;
          }
        }
      }

      if (matchedTrigger) {
        results.push({
          manifest,
          content,
          loadedAt: new Date().toISOString(),
          trigger: matchedTrigger,
        });
      }
    }

    return results;
  }

  /**
   * Get skills marked as alwaysLoad for a given mode.
   */
  getAlwaysLoadedSkills(mode: string): readonly LoadedSkill[] {
    const results: LoadedSkill[] = [];
    for (const { manifest, content } of this.skills.values()) {
      if (!manifest.alwaysLoad) continue;
      if (!manifest.modes.includes(mode as SkillMode)) continue;
      results.push({
        manifest,
        content,
        loadedAt: new Date().toISOString(),
        trigger: null,
      });
    }
    return results;
  }

  /** Get a skill by ID. */
  getSkill(id: string): { manifest: SkillManifest; content: string } | undefined {
    const entry = this.skills.get(id);
    if (!entry) return undefined;
    return { manifest: entry.manifest, content: entry.content };
  }

  /** List all registered skill manifests. */
  listManifests(): readonly SkillManifest[] {
    return [...this.skills.values()].map((e) => e.manifest);
  }

  /** Get estimated total tokens for all skills if loaded simultaneously. */
  get totalEstimatedTokens(): number {
    let total = 0;
    for (const { manifest } of this.skills.values()) {
      total += manifest.estimatedTokens;
    }
    return total;
  }
}
