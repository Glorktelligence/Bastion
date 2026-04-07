// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Generic extension handler loader — scans a directory for handler modules
 * and registers them with the ExtensionDispatcher before lock.
 *
 * Directory layout:
 *   {handlersDir}/
 *     {namespace}/
 *       handlers.js  ← exports registerHandlers(dispatcher, context)
 *     {namespace}/
 *       index.js     ← alternative entry point
 *
 * Each handler module must export a `registerHandlers(dispatcher, context)` function
 * that calls `dispatcher.registerHandler(type, handler)` for each message type it handles.
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExtensionDispatcher } from './extension-dispatcher.js';

/** Context object passed to extension handler modules during registration. */
export interface ExtensionHandlerContext {
  readonly [key: string]: unknown;
}

/**
 * Load extension handlers from a directory.
 *
 * Scans `handlersDir` for subdirectories. Each subdirectory name is treated as
 * a namespace. Within each, looks for `handlers.js` then `index.js`. The module
 * must export `registerHandlers(dispatcher, context)`.
 *
 * @param dispatcher  The ExtensionDispatcher to register handlers on (must not be locked).
 * @param context     Core services passed to each handler module's registerHandlers().
 * @param handlersDir Filesystem path to scan. Created if it doesn't exist.
 * @returns Number of extension namespaces successfully loaded.
 */
export async function loadExtensionHandlers(
  dispatcher: ExtensionDispatcher,
  context: ExtensionHandlerContext,
  handlersDir: string,
): Promise<number> {
  try {
    mkdirSync(handlersDir, { recursive: true });
  } catch {
    // Directory creation failed — fall through to readdir which will also fail
  }

  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(handlersDir, { withFileTypes: true });
  } catch {
    console.log(`[~] Extension handlers directory not accessible: ${handlersDir}`);
    return 0;
  }

  let loaded = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const namespace = entry.name;
    const handlerPath = join(handlersDir, namespace, 'handlers.js');
    const indexPath = join(handlersDir, namespace, 'index.js');

    // Try handlers.js first, then index.js
    let modulePath: string | null = null;
    if (existsSync(handlerPath)) modulePath = handlerPath;
    else if (existsSync(indexPath)) modulePath = indexPath;
    else continue; // No handler module — skip silently

    try {
      const mod = await import(pathToFileURL(modulePath).href);

      if (typeof mod.registerHandlers !== 'function') {
        console.log(`[!] Extension ${namespace}: module missing registerHandlers() export — skipped`);
        continue;
      }

      mod.registerHandlers(dispatcher, context);
      loaded++;
      console.log(`[✓] Extension handlers loaded: ${namespace}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[!] Extension ${namespace}: failed to load handlers — ${message}`);
      // Don't crash — one bad extension shouldn't kill the AI client
    }
  }

  return loaded;
}
