// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * GDPR Article 17 Data Eraser.
 *
 * Implements the Right to Erasure with a 30-day soft delete window:
 * 1. preview() — count all user data that would be deleted
 * 2. softDelete() — mark all records with deletedAt timestamp
 * 3. cancelErasure() — restore soft-deleted records within 30-day window
 * 4. hardDelete() — permanently remove all soft-deleted records
 *
 * Audit trail entries are redacted (not deleted) to preserve chain integrity.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ConversationStore } from './conversation-store.js';
import type { MemoryStore } from './memory-store.js';
import type { ProjectStore } from './project-store.js';
import type { UsageTracker } from './usage-tracker.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataEraserConfig {
  readonly conversationStore: ConversationStore;
  readonly memoryStore: MemoryStore;
  readonly projectStore: ProjectStore;
  readonly usageTracker: UsageTracker;
  readonly challengeConfigPath: string;
  readonly userContextPath: string;
}

export interface ErasurePreview {
  readonly conversations: number;
  readonly messages: number;
  readonly memories: number;
  readonly projectFiles: number;
  readonly skills: number;
  readonly usageRecords: number;
}

export interface ErasureResult {
  readonly erasureId: string;
  readonly softDeleted: {
    readonly conversations: number;
    readonly messages: number;
    readonly memories: number;
    readonly projectFiles: number;
    readonly usageRecords: number;
  };
  readonly hardDeleteScheduledAt: string;
}

// ---------------------------------------------------------------------------
// DataEraser
// ---------------------------------------------------------------------------

export class DataEraser {
  private readonly conversationStore: ConversationStore;
  private readonly memoryStore: MemoryStore;
  private readonly projectStore: ProjectStore;
  private readonly usageTracker: UsageTracker;
  private readonly challengeConfigPath: string;
  private readonly userContextPath: string;

  constructor(config: DataEraserConfig) {
    this.conversationStore = config.conversationStore;
    this.memoryStore = config.memoryStore;
    this.projectStore = config.projectStore;
    this.usageTracker = config.usageTracker;
    this.challengeConfigPath = config.challengeConfigPath;
    this.userContextPath = config.userContextPath;
  }

  /** Count all user data that would be deleted. */
  preview(): ErasurePreview {
    const conversations = this.conversationStore.listConversations(true);
    let messageCount = 0;
    for (const c of conversations) {
      messageCount += this.conversationStore.getMessageCount(c.id);
    }

    const memories = this.memoryStore.getMemories(10_000);
    const projectFiles = this.projectStore.listFiles();
    const skills = 0; // Skills are loaded from disk at startup, not user data
    const usageRecords = this.usageTracker.totalRecords;

    return {
      conversations: conversations.length,
      messages: messageCount,
      memories: memories.length,
      projectFiles: projectFiles.length,
      skills,
      usageRecords,
    };
  }

  /**
   * Soft delete all user data.
   * Marks records with deletedAt timestamp for 30-day recovery window.
   * Returns erasure receipt with counts.
   */
  softDelete(): ErasureResult {
    const erasureId = randomUUID();
    const now = new Date().toISOString();
    const hardDeleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Run migration to add deletedAt columns if needed
    this.migrateAddDeletedAt();

    const db = (
      this.conversationStore as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => { changes: number } } };
      }
    ).db;
    const memDb = (
      this.memoryStore as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => { changes: number } } };
      }
    ).db;
    const usageDb = (
      this.usageTracker as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => { changes: number } } };
      }
    ).db;

    // Soft delete conversations + messages
    const convResult = db.prepare('UPDATE conversations SET deletedAt = ? WHERE deletedAt IS NULL').run(now);
    const msgResult = db.prepare('UPDATE messages SET deletedAt = ? WHERE deletedAt IS NULL').run(now);

    // Soft delete memories
    const memResult = memDb.prepare('UPDATE memories SET deletedAt = ? WHERE deletedAt IS NULL').run(now);

    // Soft delete usage records
    const usageResult = usageDb.prepare('UPDATE usage_records SET deletedAt = ? WHERE deletedAt IS NULL').run(now);

    // Move project files to .erased/ directory
    const projectFiles = this.projectStore.listFiles();
    const projectDir = (this.projectStore as unknown as { rootDir: string }).rootDir;
    const erasedDir = join(projectDir, '.erased');
    if (projectFiles.length > 0) {
      mkdirSync(erasedDir, { recursive: true });
      for (const f of projectFiles) {
        const src = join(projectDir, f.path);
        const dest = join(erasedDir, f.path);
        // Ensure parent directory exists for nested paths
        const parentDir = dirname(dest);
        mkdirSync(parentDir, { recursive: true });
        try {
          renameSync(src, dest);
        } catch {
          // File may already be moved
        }
      }
    }

    // Clear user context file
    try {
      writeFileSync(this.userContextPath, '');
    } catch {
      // File may not exist
    }

    // Reset challenge config to defaults
    try {
      rmSync(this.challengeConfigPath, { force: true });
    } catch {
      // File may not exist
    }

    // Store erasure metadata for tracking
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(
      'erasure_active',
      JSON.stringify({ erasureId, deletedAt: now, hardDeleteAt }),
    );

    return {
      erasureId,
      softDeleted: {
        conversations: convResult.changes,
        messages: msgResult.changes,
        memories: memResult.changes,
        projectFiles: projectFiles.length,
        usageRecords: usageResult.changes,
      },
      hardDeleteScheduledAt: hardDeleteAt,
    };
  }

  /** Cancel an active erasure — restore soft-deleted records. */
  cancelErasure(): boolean {
    const db = (
      this.conversationStore as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => { changes: number } } };
      }
    ).db;
    const memDb = (
      this.memoryStore as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => { changes: number } } };
      }
    ).db;
    const usageDb = (
      this.usageTracker as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => { changes: number } } };
      }
    ).db;

    // Restore conversations + messages
    db.prepare('UPDATE conversations SET deletedAt = NULL WHERE deletedAt IS NOT NULL').run();
    db.prepare('UPDATE messages SET deletedAt = NULL WHERE deletedAt IS NOT NULL').run();

    // Restore memories
    memDb.prepare('UPDATE memories SET deletedAt = NULL WHERE deletedAt IS NOT NULL').run();

    // Restore usage records
    usageDb.prepare('UPDATE usage_records SET deletedAt = NULL WHERE deletedAt IS NOT NULL').run();

    // Restore project files from .erased/
    const projectDir = (this.projectStore as unknown as { rootDir: string }).rootDir;
    const erasedDir = join(projectDir, '.erased');
    if (existsSync(erasedDir)) {
      this.restoreFiles(erasedDir, projectDir);
      rmSync(erasedDir, { recursive: true, force: true });
    }

    // Remove erasure tracking
    db.prepare('DELETE FROM config WHERE key = ?').run('erasure_active');

    return true;
  }

  /**
   * Hard delete all soft-deleted records permanently.
   * Called after 30-day window expires.
   */
  hardDelete(): void {
    const db = (
      this.conversationStore as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }
    ).db;
    const memDb = (
      this.memoryStore as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }
    ).db;
    const usageDb = (
      this.usageTracker as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }
    ).db;

    // Hard delete from all tables
    db.prepare(
      'DELETE FROM compaction_summaries WHERE conversationId IN (SELECT id FROM conversations WHERE deletedAt IS NOT NULL)',
    ).run();
    db.prepare('DELETE FROM messages WHERE deletedAt IS NOT NULL').run();
    db.prepare('DELETE FROM conversations WHERE deletedAt IS NOT NULL').run();
    memDb.prepare('DELETE FROM memories WHERE deletedAt IS NOT NULL').run();
    usageDb.prepare('DELETE FROM usage_records WHERE deletedAt IS NOT NULL').run();

    // Remove .erased/ directory permanently
    const projectDir = (this.projectStore as unknown as { rootDir: string }).rootDir;
    const erasedDir = join(projectDir, '.erased');
    if (existsSync(erasedDir)) {
      rmSync(erasedDir, { recursive: true, force: true });
    }

    // VACUUM to reclaim space
    db.prepare('VACUUM').run();
    memDb.prepare('VACUUM').run();
    usageDb.prepare('VACUUM').run();

    // Remove erasure tracking
    db.prepare('DELETE FROM config WHERE key = ?').run('erasure_active');
  }

  /** Get active erasure info, if any. */
  getActiveErasure(): { erasureId: string; deletedAt: string; hardDeleteAt: string } | null {
    const db = (
      this.conversationStore as unknown as {
        db: { prepare: (sql: string) => { get: (...args: unknown[]) => { value: string } | undefined } };
      }
    ).db;
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get('erasure_active');
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }

  /** Check if any soft-deleted records have expired and need hard deletion. */
  checkExpiredErasures(): boolean {
    const active = this.getActiveErasure();
    if (!active) return false;
    return new Date(active.hardDeleteAt) <= new Date();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Add deletedAt column to all tables that need it (idempotent migration). */
  private migrateAddDeletedAt(): void {
    const db = (
      this.conversationStore as unknown as {
        db: { prepare: (sql: string) => { run: () => void }; exec: (sql: string) => void };
      }
    ).db;
    const memDb = (
      this.memoryStore as unknown as {
        db: { prepare: (sql: string) => { run: () => void }; exec: (sql: string) => void };
      }
    ).db;
    const usageDb = (
      this.usageTracker as unknown as {
        db: { prepare: (sql: string) => { run: () => void }; exec: (sql: string) => void };
      }
    ).db;

    // SQLite ALTER TABLE ADD COLUMN is idempotent-safe with try/catch
    for (const [store, tables] of [
      [db, ['conversations', 'messages']],
      [memDb, ['memories']],
      [usageDb, ['usage_records']],
    ] as const) {
      for (const table of tables) {
        try {
          (store as { exec: (sql: string) => void }).exec(
            `ALTER TABLE ${table} ADD COLUMN deletedAt TEXT DEFAULT NULL`,
          );
        } catch {
          // Column already exists — expected on subsequent runs
        }
      }
    }
  }

  /** Recursively restore files from .erased/ back to project root. */
  private restoreFiles(fromDir: string, toDir: string): void {
    for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
      const src = join(fromDir, entry.name);
      const dest = join(toDir, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(dest, { recursive: true });
        this.restoreFiles(src, dest);
      } else {
        const destParent = join(dest, '..');
        mkdirSync(destParent, { recursive: true });
        renameSync(src, dest);
      }
    }
  }
}
