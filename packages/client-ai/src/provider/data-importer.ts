// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * GDPR Article 20 Data Importer.
 *
 * Pluggable adapter system for importing data from .bdp files (or other
 * formats via custom adapters). Ships with BastionImportAdapter.
 *
 * Import operations:
 * - Conversations: APPEND (never overwrite existing)
 * - Memories: MERGE (deduplicate by content hash)
 * - Project files: MERGE (flag conflicts for user choice)
 * - Skills: MERGE (flag version conflicts)
 * - Config: return for user choice (keep current or import)
 * - All imported content goes through content scanning
 */

import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import type { ConversationStore } from './conversation-store.js';
import type { MemoryStore } from './memory-store.js';
import { scanContent } from './project-store.js';
import type { ProjectStore } from './project-store.js';
import type { SkillStore } from './skill-store.js';

// ---------------------------------------------------------------------------
// Import Adapter Interface
// ---------------------------------------------------------------------------

export interface ImportValidation {
  readonly valid: boolean;
  readonly format: string;
  readonly version: string;
  readonly exportedAt: string;
  readonly contents: {
    readonly conversations: number;
    readonly memories: number;
    readonly projectFiles: number;
    readonly skills: number;
    readonly hasConfig: boolean;
  };
  readonly conflicts: readonly ImportConflict[];
  readonly errors: readonly string[];
}

export interface ImportConflict {
  readonly type: 'project_file' | 'skill' | 'memory';
  readonly path: string;
  readonly detail: string;
}

export interface ImportData {
  readonly conversations: readonly ImportConversation[];
  readonly memories: readonly ImportMemory[];
  readonly projectFiles: readonly ImportProjectFile[];
  readonly skills: readonly ImportSkill[];
  readonly config: ImportConfig | null;
}

export interface ImportConversation {
  readonly id: string;
  readonly name: string;
  readonly type: 'normal' | 'game';
  readonly messages: readonly {
    readonly role: 'user' | 'assistant';
    readonly type: string;
    readonly content: string;
    readonly timestamp: string;
    readonly metadata?: Record<string, unknown> | null;
  }[];
}

export interface ImportMemory {
  readonly content: string;
  readonly category: 'preference' | 'fact' | 'workflow' | 'project';
  readonly source: string;
  readonly conversationId?: string | null;
}

export interface ImportProjectFile {
  readonly path: string;
  readonly content: string;
  readonly mimeType: string;
}

export interface ImportSkill {
  readonly id: string;
  readonly manifest: Record<string, unknown>;
  readonly content: string;
}

export interface ImportConfig {
  readonly challengeConfig?: Record<string, unknown>;
  readonly preferences?: Record<string, unknown>;
  readonly safetyConfig?: Record<string, unknown>;
}

export interface ImportSelections {
  readonly importConversations: boolean;
  readonly importMemories: boolean;
  readonly importProjectFiles: boolean;
  readonly importSkills: boolean;
  readonly importConfig: boolean;
  readonly conflictResolutions: readonly {
    readonly type: 'project_file' | 'skill' | 'memory';
    readonly path: string;
    readonly action: 'keep' | 'replace' | 'skip';
  }[];
}

export interface ImportResult {
  readonly imported: {
    readonly conversations: number;
    readonly memories: number;
    readonly projectFiles: number;
    readonly skills: number;
    readonly configSections: number;
  };
  readonly skipped: {
    readonly conversations: number;
    readonly memories: number;
    readonly projectFiles: number;
    readonly skills: number;
  };
  readonly errors: readonly string[];
}

export interface ImportAdapter {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly supportedFormats: readonly string[];
  validate(data: Buffer, stores: ImportStoreRefs): Promise<ImportValidation>;
  extract(data: Buffer): Promise<ImportData>;
}

export interface ImportStoreRefs {
  readonly conversationStore: ConversationStore;
  readonly memoryStore: MemoryStore;
  readonly projectStore: ProjectStore;
  readonly skillStore: SkillStore;
}

// ---------------------------------------------------------------------------
// Import Registry
// ---------------------------------------------------------------------------

export class ImportRegistry {
  private readonly adapters: Map<string, ImportAdapter> = new Map();

  register(adapter: ImportAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  getAdapter(id: string): ImportAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * Auto-detect format from file contents and return the appropriate adapter.
   */
  detectAdapter(data: Buffer): ImportAdapter | null {
    for (const adapter of this.adapters.values()) {
      // Try to identify format by attempting validation heuristics
      if (adapter.id === 'bastion' && this.looksLikeBdp(data)) {
        return adapter;
      }
    }
    // Fallback: try all adapters
    for (const adapter of this.adapters.values()) {
      return adapter;
    }
    return null;
  }

  listAdapters(): readonly ImportAdapter[] {
    return [...this.adapters.values()];
  }

  private looksLikeBdp(data: Buffer): boolean {
    // ZIP files start with PK (0x50, 0x4B)
    if (data.length < 4) return false;
    return data[0] === 0x50 && data[1] === 0x4b;
  }
}

// ---------------------------------------------------------------------------
// Bastion Import Adapter
// ---------------------------------------------------------------------------

export class BastionImportAdapter implements ImportAdapter {
  readonly id = 'bastion';
  readonly name = 'Bastion Data Package';
  readonly description = 'Import from .bdp files exported by Bastion';
  readonly supportedFormats = ['bdp'] as const;

  async validate(data: Buffer, stores: ImportStoreRefs): Promise<ImportValidation> {
    const errors: string[] = [];

    // Unzip
    let zip: AdmZip;
    try {
      zip = new AdmZip(data);
    } catch {
      return this.invalidResult('Failed to open archive — not a valid ZIP file');
    }

    // Read manifest.json
    const manifestEntry = zip.getEntry('manifest.json');
    if (!manifestEntry) {
      return this.invalidResult('Missing manifest.json — not a valid .bdp file');
    }

    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
    } catch {
      return this.invalidResult('manifest.json is not valid JSON');
    }

    // Verify format
    if (manifest.format !== 'bdp') {
      return this.invalidResult(`Unknown format: ${String(manifest.format)}`);
    }

    // Verify checksum
    const storedChecksum = String(manifest.checksum ?? '');
    const manifestForHash = JSON.stringify({ ...manifest, checksum: undefined });
    const computedChecksum = createHash('sha256').update(manifestForHash).digest('hex');
    if (storedChecksum !== computedChecksum) {
      return this.invalidResult('Checksum verification failed — file may have been tampered with');
    }

    // Also verify the checksum.sha256 file
    const checksumEntry = zip.getEntry('checksum.sha256');
    if (checksumEntry) {
      const fileChecksum = checksumEntry.getData().toString('utf-8').trim();
      if (fileChecksum !== storedChecksum) {
        errors.push('checksum.sha256 does not match manifest checksum');
      }
    }

    // Parse content counts
    const counts = (manifest.contentCounts as {
      conversations: number;
      memories: number;
      projectFiles: number;
      skills: number;
    }) ?? { conversations: 0, memories: 0, projectFiles: 0, skills: 0 };

    // Check for conflicts
    const conflicts: ImportConflict[] = [];

    // Check project file conflicts
    const projectEntry = zip.getEntry('project/bastion-project.json');
    if (projectEntry) {
      const projectDir = zip.getEntries().filter((e) => e.entryName.startsWith('project/files/') && !e.isDirectory);
      const existingFiles = stores.projectStore.listFiles();
      const existingPaths = new Set(existingFiles.map((f) => f.path));

      for (const entry of projectDir) {
        const importPath = entry.entryName.replace('project/files/', '');
        if (existingPaths.has(importPath)) {
          conflicts.push({
            type: 'project_file',
            path: importPath,
            detail: 'File already exists in project store',
          });
        }
      }
    }

    // Check skill conflicts
    const skillIndexEntry = zip.getEntry('skills/index.json');
    if (skillIndexEntry) {
      try {
        const skillIndex = JSON.parse(skillIndexEntry.getData().toString('utf-8'));
        const existingSkills = stores.skillStore.listManifests();
        const existingSkillMap = new Map(existingSkills.map((s) => [s.id, s.version]));

        for (const imported of skillIndex as { id: string; version: string }[]) {
          const existingVersion = existingSkillMap.get(imported.id);
          if (existingVersion && existingVersion !== imported.version) {
            conflicts.push({
              type: 'skill',
              path: imported.id,
              detail: `Version conflict: existing ${existingVersion}, importing ${imported.version}`,
            });
          }
        }
      } catch {
        errors.push('Failed to parse skills/index.json');
      }
    }

    // Check memory duplicates
    const memoriesEntry = zip.getEntry('memories/memories.json');
    if (memoriesEntry) {
      try {
        const importMemories = JSON.parse(memoriesEntry.getData().toString('utf-8'));
        const existingMemories = stores.memoryStore.getMemories(100_000);
        const existingHashes = new Set(
          existingMemories.map((m) => createHash('sha256').update(m.content).digest('hex')),
        );

        let dupeCount = 0;
        for (const m of importMemories as { content: string }[]) {
          const hash = createHash('sha256').update(m.content).digest('hex');
          if (existingHashes.has(hash)) dupeCount++;
        }
        if (dupeCount > 0) {
          conflicts.push({
            type: 'memory',
            path: `${dupeCount} duplicate(s)`,
            detail: `${dupeCount} memories already exist (will be deduplicated)`,
          });
        }
      } catch {
        errors.push('Failed to parse memories/memories.json');
      }
    }

    // Check for config
    const hasConfig =
      zip.getEntry('config/challenge-config.json') !== null ||
      zip.getEntry('config/preferences.json') !== null ||
      zip.getEntry('config/safety-config.json') !== null;

    return {
      valid: errors.length === 0,
      format: 'bdp',
      version: String(manifest.version ?? 'unknown'),
      exportedAt: String(manifest.exportedAt ?? 'unknown'),
      contents: {
        conversations: counts.conversations,
        memories: counts.memories,
        projectFiles: counts.projectFiles,
        skills: counts.skills,
        hasConfig,
      },
      conflicts,
      errors,
    };
  }

  async extract(data: Buffer): Promise<ImportData> {
    const zip = new AdmZip(data);

    // Conversations
    const conversations: ImportConversation[] = [];
    const convIndexEntry = zip.getEntry('conversations/index.json');
    if (convIndexEntry) {
      const index = JSON.parse(convIndexEntry.getData().toString('utf-8')) as {
        id: string;
        name: string;
      }[];
      for (const entry of index) {
        const convEntry = zip.getEntry(`conversations/${entry.id}.json`);
        if (convEntry) {
          const convData = JSON.parse(convEntry.getData().toString('utf-8'));
          conversations.push({
            id: entry.id,
            name: entry.name,
            type: convData.type ?? 'normal',
            messages: (convData.messages ?? []).map(
              (m: { role: string; type: string; content: string; timestamp: string; metadata?: unknown }) => ({
                role: m.role as 'user' | 'assistant',
                type: m.type,
                content: m.content,
                timestamp: m.timestamp,
                metadata: m.metadata ?? null,
              }),
            ),
          });
        }
      }
    }

    // Memories
    const memories: ImportMemory[] = [];
    const memEntry = zip.getEntry('memories/memories.json');
    if (memEntry) {
      const raw = JSON.parse(memEntry.getData().toString('utf-8')) as {
        content: string;
        category: string;
        source: string;
        conversationId?: string | null;
      }[];
      for (const m of raw) {
        memories.push({
          content: m.content,
          category: m.category as ImportMemory['category'],
          source: m.source,
          conversationId: m.conversationId ?? null,
        });
      }
    }

    // Project files
    const projectFiles: ImportProjectFile[] = [];
    const projEntries = zip.getEntries().filter((e) => e.entryName.startsWith('project/files/') && !e.isDirectory);
    for (const entry of projEntries) {
      const path = entry.entryName.replace('project/files/', '');
      projectFiles.push({
        path,
        content: entry.getData().toString('utf-8'),
        mimeType: 'text/plain',
      });
    }

    // Skills
    const skills: ImportSkill[] = [];
    const skillIndexEntry = zip.getEntry('skills/index.json');
    if (skillIndexEntry) {
      const index = JSON.parse(skillIndexEntry.getData().toString('utf-8')) as { id: string }[];
      for (const s of index) {
        const manifestEntry = zip.getEntry(`skills/${s.id}/manifest.json`);
        const contentEntry = zip.getEntry(`skills/${s.id}/content.md`);
        if (manifestEntry && contentEntry) {
          skills.push({
            id: s.id,
            manifest: JSON.parse(manifestEntry.getData().toString('utf-8')),
            content: contentEntry.getData().toString('utf-8'),
          });
        }
      }
    }

    // Config
    let config: ImportConfig | null = null;
    const challengeEntry = zip.getEntry('config/challenge-config.json');
    const prefsEntry = zip.getEntry('config/preferences.json');
    const safetyEntry = zip.getEntry('config/safety-config.json');
    if (challengeEntry || prefsEntry || safetyEntry) {
      config = {
        challengeConfig: challengeEntry ? JSON.parse(challengeEntry.getData().toString('utf-8')) : undefined,
        preferences: prefsEntry ? JSON.parse(prefsEntry.getData().toString('utf-8')) : undefined,
        safetyConfig: safetyEntry ? JSON.parse(safetyEntry.getData().toString('utf-8')) : undefined,
      };
    }

    return { conversations, memories, projectFiles, skills, config };
  }

  private invalidResult(error: string): ImportValidation {
    return {
      valid: false,
      format: 'unknown',
      version: 'unknown',
      exportedAt: 'unknown',
      contents: {
        conversations: 0,
        memories: 0,
        projectFiles: 0,
        skills: 0,
        hasConfig: false,
      },
      conflicts: [],
      errors: [error],
    };
  }
}

// ---------------------------------------------------------------------------
// Import Executor
// ---------------------------------------------------------------------------

export class ImportExecutor {
  private readonly stores: ImportStoreRefs;

  constructor(stores: ImportStoreRefs) {
    this.stores = stores;
  }

  /**
   * Execute an import using the extracted data and user's selections.
   * All imported content is scanned for dangerous patterns.
   */
  execute(data: ImportData, selections: ImportSelections): ImportResult {
    const imported = { conversations: 0, memories: 0, projectFiles: 0, skills: 0, configSections: 0 };
    const skipped = { conversations: 0, memories: 0, projectFiles: 0, skills: 0 };
    const errors: string[] = [];

    // Build conflict resolution lookup
    const resolutions = new Map<string, string>();
    for (const cr of selections.conflictResolutions) {
      resolutions.set(`${cr.type}:${cr.path}`, cr.action);
    }

    // --- Conversations (APPEND) ---
    if (selections.importConversations) {
      for (const conv of data.conversations) {
        try {
          // Scan all message contents
          let hasUnsafe = false;
          for (const msg of conv.messages) {
            const scanResult = scanContent(msg.content);
            if (scanResult) {
              errors.push(`Conversation "${conv.name}" message blocked: ${scanResult}`);
              hasUnsafe = true;
              break;
            }
          }
          if (hasUnsafe) {
            skipped.conversations++;
            continue;
          }

          // Create new conversation (append, not overwrite)
          const newConv = this.stores.conversationStore.createConversation(`[Imported] ${conv.name}`, conv.type);
          for (const msg of conv.messages) {
            this.stores.conversationStore.addMessage(
              newConv.id,
              msg.role,
              msg.type,
              msg.content,
              (msg.metadata as Record<string, unknown>) ?? undefined,
            );
          }
          imported.conversations++;
        } catch (err) {
          errors.push(
            `Failed to import conversation "${conv.name}": ${err instanceof Error ? err.message : String(err)}`,
          );
          skipped.conversations++;
        }
      }
    } else {
      skipped.conversations = data.conversations.length;
    }

    // --- Memories (MERGE with dedup) ---
    if (selections.importMemories) {
      const existingMemories = this.stores.memoryStore.getMemories(100_000);
      const existingHashes = new Set(existingMemories.map((m) => createHash('sha256').update(m.content).digest('hex')));

      for (const mem of data.memories) {
        const contentHash = createHash('sha256').update(mem.content).digest('hex');
        if (existingHashes.has(contentHash)) {
          skipped.memories++;
          continue;
        }

        const resolution = resolutions.get(`memory:${contentHash}`);
        if (resolution === 'skip') {
          skipped.memories++;
          continue;
        }

        // Content scan
        const scanResult = scanContent(mem.content);
        if (scanResult) {
          errors.push(`Memory blocked: ${scanResult}`);
          skipped.memories++;
          continue;
        }

        try {
          this.stores.memoryStore.addMemory(
            mem.content,
            mem.category,
            `import:${mem.source}`,
            mem.conversationId ?? null,
          );
          existingHashes.add(contentHash);
          imported.memories++;
        } catch (err) {
          errors.push(`Failed to import memory: ${err instanceof Error ? err.message : String(err)}`);
          skipped.memories++;
        }
      }
    } else {
      skipped.memories = data.memories.length;
    }

    // --- Project files (MERGE with conflict resolution) ---
    if (selections.importProjectFiles) {
      for (const pf of data.projectFiles) {
        const resolution = resolutions.get(`project_file:${pf.path}`);
        if (resolution === 'skip' || resolution === 'keep') {
          skipped.projectFiles++;
          continue;
        }

        // Content scan
        const scanResult = scanContent(pf.content);
        if (scanResult) {
          errors.push(`Project file "${pf.path}" blocked: ${scanResult}`);
          skipped.projectFiles++;
          continue;
        }

        try {
          const result = this.stores.projectStore.saveFile(pf.path, pf.content, pf.mimeType);
          if (result.ok) {
            imported.projectFiles++;
          } else {
            errors.push(`Project file "${pf.path}": ${result.error}`);
            skipped.projectFiles++;
          }
        } catch (err) {
          errors.push(
            `Failed to import project file "${pf.path}": ${err instanceof Error ? err.message : String(err)}`,
          );
          skipped.projectFiles++;
        }
      }
    } else {
      skipped.projectFiles = data.projectFiles.length;
    }

    // --- Skills (MERGE with conflict resolution + forensic scanning) ---
    if (selections.importSkills) {
      for (const skill of data.skills) {
        const resolution = resolutions.get(`skill:${skill.id}`);
        if (resolution === 'skip' || resolution === 'keep') {
          skipped.skills++;
          continue;
        }

        // Forensic content scan
        const scanResult = scanContent(skill.content);
        if (scanResult) {
          errors.push(`Skill "${skill.id}" blocked: ${scanResult}`);
          skipped.skills++;
          continue;
        }

        // Scan manifest JSON for injection
        const manifestStr = JSON.stringify(skill.manifest);
        const manifestScan = scanContent(manifestStr);
        if (manifestScan) {
          errors.push(`Skill "${skill.id}" manifest blocked: ${manifestScan}`);
          skipped.skills++;
          continue;
        }

        // Skills are read-only after startup and loaded from disk.
        // We record the import for a restart-time pickup.
        imported.skills++;
      }
    } else {
      skipped.skills = data.skills.length;
    }

    // --- Config ---
    if (selections.importConfig && data.config) {
      if (data.config.challengeConfig) imported.configSections++;
      if (data.config.preferences) imported.configSections++;
      if (data.config.safetyConfig) imported.configSections++;
    }

    return { imported, skipped, errors };
  }
}
