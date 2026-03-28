// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Project files store for the human client.
 *
 * Manages project context files synced to the AI client. Populated by
 * project_list_response messages. The human can upload, delete, and
 * configure which files are always loaded into the AI's context window.
 */

import type { Readable, Writable } from '../store.js';
import { derived, writable } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A project file synced to the AI client. */
export interface ProjectFile {
  readonly path: string;
  readonly size: number;
  readonly mimeType: string;
  readonly lastModified?: string;
}

/** Loading mode for a project file in the AI's context window. */
export type LoadingMode = 'always' | 'available' | 'none';

/** Project loading configuration sent to AI via project_config. */
export interface ProjectConfig {
  readonly alwaysLoaded: readonly string[];
  readonly available: readonly string[];
}

/** Full project store state. */
export interface ProjectStoreState {
  readonly files: readonly ProjectFile[];
  readonly config: ProjectConfig;
  readonly totalSize: number;
  readonly totalCount: number;
  readonly notification: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rough token estimate: ~4 characters per token for English text. */
const CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export interface ProjectsStore {
  readonly store: Writable<ProjectStoreState>;
  /** Derived: estimated tokens for alwaysLoaded files. */
  readonly alwaysLoadedTokens: Readable<number>;
  /** Derived: count of alwaysLoaded files. */
  readonly alwaysLoadedCount: Readable<number>;
  /** Set the full file list from a project_list_response. */
  setFiles(files: readonly ProjectFile[], totalSize: number, totalCount: number): void;
  /** Set the loading configuration. */
  setConfig(config: ProjectConfig): void;
  /** Remove a file from the local list (after project_delete sent). */
  removeFile(path: string): void;
  /** Add or update a file in the local list (after project_sync_ack). */
  upsertFile(path: string, size: number, mimeType?: string): void;
  /** Show a toast notification. */
  setNotification(msg: string): void;
  /** Clear the notification. */
  clearNotification(): void;
  /** Get the loading mode for a file. */
  getLoadingMode(path: string): LoadingMode;
  /** Estimate token count for alwaysLoaded files. */
  estimateTokens(): number;
  /** Clear all state. */
  clear(): void;
}

export function createProjectsStore(): ProjectsStore {
  const store = writable<ProjectStoreState>({
    files: [],
    config: { alwaysLoaded: [], available: [] },
    totalSize: 0,
    totalCount: 0,
    notification: null,
  });

  // -------------------------------------------------------------------------
  // Derived stores
  // -------------------------------------------------------------------------

  const alwaysLoadedTokens = derived([store], ([state]) => {
    let totalBytes = 0;
    for (const f of state.files) {
      if (state.config.alwaysLoaded.includes(f.path)) {
        totalBytes += f.size;
      }
    }
    return Math.round(totalBytes / CHARS_PER_TOKEN);
  });

  const alwaysLoadedCount = derived([store], ([state]) =>
    state.files.filter((f) => state.config.alwaysLoaded.includes(f.path)).length,
  );

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  function setFiles(files: readonly ProjectFile[], totalSize: number, totalCount: number): void {
    store.update((s) => ({ ...s, files, totalSize, totalCount }));
  }

  function setConfig(config: ProjectConfig): void {
    store.update((s) => ({ ...s, config }));
  }

  function removeFile(path: string): void {
    store.update((s) => {
      const remaining = s.files.filter((f) => f.path !== path);
      const removedFile = s.files.find((f) => f.path === path);
      const sizeDelta = removedFile ? removedFile.size : 0;
      return {
        ...s,
        files: remaining,
        totalSize: Math.max(0, s.totalSize - sizeDelta),
        totalCount: remaining.length,
        config: {
          alwaysLoaded: s.config.alwaysLoaded.filter((p) => p !== path),
          available: s.config.available.filter((p) => p !== path),
        },
      };
    });
  }

  function upsertFile(path: string, size: number, mimeType?: string): void {
    store.update((s) => {
      const existing = s.files.findIndex((f) => f.path === path);
      const file: ProjectFile = {
        path,
        size,
        mimeType: mimeType ?? 'text/plain',
        lastModified: new Date().toISOString(),
      };

      let files: ProjectFile[];
      let sizeDelta: number;
      if (existing >= 0) {
        sizeDelta = size - s.files[existing]!.size;
        files = [...s.files];
        files[existing] = file;
      } else {
        sizeDelta = size;
        files = [...s.files, file];
      }

      return {
        ...s,
        files,
        totalSize: s.totalSize + sizeDelta,
        totalCount: files.length,
      };
    });
  }

  function setNotification(msg: string): void {
    store.update((s) => ({ ...s, notification: msg }));
  }

  function clearNotification(): void {
    store.update((s) => ({ ...s, notification: null }));
  }

  function getLoadingMode(path: string): LoadingMode {
    const state = store.get();
    if (state.config.alwaysLoaded.includes(path)) return 'always';
    if (state.config.available.includes(path)) return 'available';
    return 'none';
  }

  function estimateTokens(): number {
    return alwaysLoadedTokens.get();
  }

  function clear(): void {
    store.set({
      files: [],
      config: { alwaysLoaded: [], available: [] },
      totalSize: 0,
      totalCount: 0,
      notification: null,
    });
  }

  return {
    store,
    alwaysLoadedTokens,
    alwaysLoadedCount,
    setFiles,
    setConfig,
    removeFile,
    upsertFile,
    setNotification,
    clearNotification,
    getLoadingMode,
    estimateTokens,
    clear,
  };
}
