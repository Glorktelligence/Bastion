// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * GDPR Article 20 Data Exporter.
 *
 * Exports all user data as a .bdp (Bastion Data Package) ZIP archive
 * containing conversations, memories, project files, skills, config,
 * and audit metadata with integrity verification.
 */

import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { PROTOCOL_VERSION } from '@bastion/protocol';
import archiver from 'archiver';
import type { ChallengeManager } from './challenge-manager.js';
import type { ConversationStore } from './conversation-store.js';
import type { MemoryStore } from './memory-store.js';
import type { ProjectStore } from './project-store.js';
import type { SkillStore } from './skill-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportManifest {
  readonly format: 'bdp';
  readonly version: string;
  readonly exportedAt: string;
  readonly protocolVersion: string;
  readonly contentCounts: {
    readonly conversations: number;
    readonly memories: number;
    readonly projectFiles: number;
    readonly skills: number;
  };
  readonly checksum: string;
}

export interface ExportProgress {
  readonly percentage: number;
  readonly phase: string;
}

export interface DataExporterConfig {
  readonly conversationStore: ConversationStore;
  readonly memoryStore: MemoryStore;
  readonly projectStore: ProjectStore;
  readonly skillStore: SkillStore;
  readonly challengeManager: ChallengeManager;
}

// ---------------------------------------------------------------------------
// DataExporter
// ---------------------------------------------------------------------------

export class DataExporter {
  private readonly conversationStore: ConversationStore;
  private readonly memoryStore: MemoryStore;
  private readonly projectStore: ProjectStore;
  private readonly skillStore: SkillStore;
  private readonly challengeManager: ChallengeManager;

  constructor(config: DataExporterConfig) {
    this.conversationStore = config.conversationStore;
    this.memoryStore = config.memoryStore;
    this.projectStore = config.projectStore;
    this.skillStore = config.skillStore;
    this.challengeManager = config.challengeManager;
  }

  /**
   * Export all user data as a .bdp ZIP archive.
   * Calls onProgress with percentage updates during export.
   */
  async exportAll(onProgress?: (progress: ExportProgress) => void): Promise<Buffer> {
    const report = (percentage: number, phase: string): void => {
      onProgress?.({ percentage, phase });
    };

    report(0, 'Preparing export');

    // --- Gather data ---

    report(5, 'Exporting conversations');
    const conversations = this.conversationStore.listConversations(true);
    const conversationData: Record<string, unknown>[] = [];
    for (const conv of conversations) {
      const messages = this.conversationStore.getMessages(conv.id, 100_000, 0);
      const chain = this.conversationStore.verifyChain(conv.id);
      const compaction = this.conversationStore.getLatestCompaction(conv.id);
      conversationData.push({
        ...conv,
        messages,
        chainVerification: chain,
        latestCompaction: compaction,
      });
    }

    report(25, 'Exporting memories');
    const memories = this.memoryStore.getMemories(100_000);

    report(40, 'Exporting project files');
    const projectFiles = this.projectStore.listFiles();
    const projectConfig = this.projectStore.getConfig();
    const projectFileContents: { path: string; content: string; size: number; mimeType: string }[] = [];
    for (const pf of projectFiles) {
      const content = this.projectStore.readFile(pf.path);
      if (content !== null) {
        projectFileContents.push({
          path: pf.path,
          content,
          size: pf.size,
          mimeType: pf.mimeType,
        });
      }
    }

    report(55, 'Exporting skills');
    const skillManifests = this.skillStore.listManifests();
    const skillsData: { manifest: unknown; content: string }[] = [];
    for (const sm of skillManifests) {
      const skill = this.skillStore.getSkill(sm.id);
      if (skill) {
        skillsData.push({
          manifest: skill.manifest,
          content: skill.content,
        });
      }
    }

    report(70, 'Exporting configuration');
    const challengeConfig = this.challengeManager.getConfig() as unknown as Record<string, unknown>;

    report(75, 'Building archive');

    // --- Build manifest ---
    const contentCounts = {
      conversations: conversations.length,
      memories: memories.length,
      projectFiles: projectFiles.length,
      skills: skillManifests.length,
    };

    const manifestData = {
      format: 'bdp' as const,
      version: PROTOCOL_VERSION,
      exportedAt: new Date().toISOString(),
      protocolVersion: PROTOCOL_VERSION,
      contentCounts,
      checksum: '', // Filled after computing
    };

    // Compute checksum of the manifest content (without checksum field)
    const manifestForHash = JSON.stringify({ ...manifestData, checksum: undefined });
    const checksum = createHash('sha256').update(manifestForHash).digest('hex');
    manifestData.checksum = checksum;

    // --- Build ZIP archive ---
    report(80, 'Compressing archive');

    const zipBuffer = await this.buildZip(
      manifestData,
      conversationData,
      conversations,
      memories,
      projectFileContents,
      projectConfig,
      skillsData,
      challengeConfig,
      checksum,
    );

    report(100, 'Export complete');
    return zipBuffer;
  }

  /**
   * Get content counts without performing full export.
   */
  getContentCounts(): {
    conversations: number;
    memories: number;
    projectFiles: number;
    skills: number;
  } {
    return {
      conversations: this.conversationStore.conversationCount,
      memories: this.memoryStore.count,
      projectFiles: this.projectStore.fileCount,
      skills: this.skillStore.skillCount,
    };
  }

  private async buildZip(
    manifest: Record<string, unknown>,
    conversationData: Record<string, unknown>[],
    conversationRecords: { id: string; name: string }[],
    memories: readonly {
      id: string;
      content: string;
      category: string;
      source: string;
      createdAt: string;
      updatedAt: string;
      conversationId: string | null;
    }[],
    projectFiles: { path: string; content: string; size: number; mimeType: string }[],
    projectConfig: { alwaysLoaded: string[]; available: string[] },
    skills: { manifest: unknown; content: string }[],
    challengeConfig: Record<string, unknown>,
    checksum: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const collector = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk as Buffer);
          callback();
        },
      });

      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('error', reject);
      archive.pipe(collector);

      collector.on('finish', () => {
        resolve(Buffer.concat(chunks));
      });

      // manifest.json
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      // conversations/
      const conversationIndex = conversationRecords.map((c) => ({
        id: c.id,
        name: c.name,
      }));
      archive.append(JSON.stringify(conversationIndex, null, 2), {
        name: 'conversations/index.json',
      });
      for (const conv of conversationData) {
        archive.append(JSON.stringify(conv, null, 2), {
          name: `conversations/${String(conv.id)}.json`,
        });
      }

      // memories/
      archive.append(JSON.stringify(memories, null, 2), {
        name: 'memories/memories.json',
      });

      // project/
      archive.append(JSON.stringify(projectConfig, null, 2), {
        name: 'project/bastion-project.json',
      });
      for (const pf of projectFiles) {
        archive.append(pf.content, {
          name: `project/files/${pf.path}`,
        });
      }

      // skills/
      const skillIndex = skills.map((s) => {
        const m = s.manifest as { id: string; name: string; version: string };
        return { id: m.id, name: m.name, version: m.version };
      });
      archive.append(JSON.stringify(skillIndex, null, 2), {
        name: 'skills/index.json',
      });
      for (const skill of skills) {
        const m = skill.manifest as { id: string };
        archive.append(JSON.stringify(skill.manifest, null, 2), {
          name: `skills/${m.id}/manifest.json`,
        });
        archive.append(skill.content, {
          name: `skills/${m.id}/content.md`,
        });
      }

      // config/
      archive.append(JSON.stringify(challengeConfig, null, 2), {
        name: 'config/challenge-config.json',
      });
      archive.append(JSON.stringify({}, null, 2), {
        name: 'config/preferences.json',
      });
      archive.append(JSON.stringify({}, null, 2), {
        name: 'config/safety-config.json',
      });

      // audit/
      archive.append(
        JSON.stringify(
          {
            note: 'Audit metadata only — message content is not exported for security reasons.',
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        { name: 'audit/audit-metadata.json' },
      );

      // checksum.sha256
      archive.append(checksum, { name: 'checksum.sha256' });

      archive.finalize();
    });
  }
}
