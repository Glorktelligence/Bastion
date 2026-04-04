// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * ProjectStore — Layer 3 project context for the AI client.
 *
 * Stores project files on disk, supports nested directories,
 * and provides prompt context injection for alwaysLoaded files.
 * Text files only. Size limits enforced.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, posix } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectFile {
  readonly path: string;
  readonly size: number;
  readonly mimeType: string;
  readonly lastModified: string;
}

export interface ProjectConfig {
  alwaysLoaded: string[];
  available: string[];
}

export interface ProjectStoreConfig {
  /** Root directory for project files. Default: '/var/lib/bastion/project'. */
  readonly rootDir?: string;
  /** Max file size in bytes. Default: 1MB. */
  readonly maxFileSize?: number;
  /** Max total project size in bytes. Default: 50MB. */
  readonly maxTotalSize?: number;
}

export type ProjectSaveResult =
  | { readonly ok: true; readonly size: number }
  | { readonly ok: false; readonly error: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ROOT = '/var/lib/bastion/project';
const DEFAULT_MAX_FILE = 1024 * 1024; // 1MB
const DEFAULT_MAX_TOTAL = 50 * 1024 * 1024; // 50MB
const ALLOWED_EXTENSIONS = new Set(['.md', '.json', '.yaml', '.yml', '.txt']);
const CONFIG_FILE = 'bastion-project.json';

/**
 * Patterns that indicate potentially malicious content in text files.
 * These files are rendered in client UIs or fed to AI systems, so
 * script injection and deserialization attacks must be blocked.
 */
const DANGEROUS_CONTENT_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  // HTML script injection (markdown files rendered as HTML)
  { pattern: /<script[\s>]/i, reason: 'Embedded <script> tag' },
  { pattern: /javascript\s*:/i, reason: 'JavaScript URI scheme' },
  {
    pattern: /on(?:load|error|click|mouseover|focus|blur|submit|change|input|keydown|keyup)\s*=/i,
    reason: 'HTML event handler attribute',
  },
  { pattern: /<iframe[\s>]/i, reason: 'Embedded <iframe> tag' },
  { pattern: /<object[\s>]/i, reason: 'Embedded <object> tag' },
  { pattern: /<embed[\s>]/i, reason: 'Embedded <embed> tag' },
  { pattern: /<link[^>]+rel\s*=\s*["']?import/i, reason: 'HTML import link' },
  // Data URI with executable content
  { pattern: /data\s*:\s*text\/html/i, reason: 'Data URI with text/html' },
  // YAML deserialization attacks (!!python/object, !!ruby/object, etc.)
  { pattern: /!!(?:python|ruby|java|php|perl)\//i, reason: 'YAML language-specific type tag' },
  // JSON prototype pollution markers
  { pattern: /"__proto__"\s*:/i, reason: 'JSON __proto__ pollution' },
  { pattern: /"constructor"\s*:\s*\{/i, reason: 'JSON constructor pollution' },
  { pattern: /"prototype"\s*:/i, reason: 'JSON prototype pollution' },
];

// ---------------------------------------------------------------------------
// Content security
// ---------------------------------------------------------------------------

/**
 * Scan file content for dangerous patterns.
 * Returns null if safe, or a rejection reason string if dangerous.
 */
export function scanContent(content: string): string | null {
  for (const { pattern, reason } of DANGEROUS_CONTENT_PATTERNS) {
    if (pattern.test(content)) {
      return `Dangerous content detected: ${reason}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Path security
// ---------------------------------------------------------------------------

export function validatePath(path: string): { valid: boolean; error?: string; sanitised?: string } {
  if (!path || path.trim().length === 0) return { valid: false, error: 'Empty path' };

  let p = path.trim().replace(/\\/g, '/');

  if (p.startsWith('/')) return { valid: false, error: 'Absolute paths not allowed' };
  if (p.includes('..')) return { valid: false, error: 'Path traversal (..) not allowed' };
  if (p.includes('//')) return { valid: false, error: 'Double slashes not allowed' };
  if (p.length > 255) return { valid: false, error: 'Path too long (max 255)' };

  // Check for hidden files/directories
  const segments = p.split('/');
  for (const seg of segments) {
    if (seg.startsWith('.')) return { valid: false, error: `Hidden file/directory not allowed: ${seg}` };
  }

  // Check extension
  const ext = posix.extname(p).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File type not allowed: ${ext} (allowed: ${[...ALLOWED_EXTENSIONS].join(', ')})` };
  }

  p = normalize(p).replace(/\\/g, '/');
  return { valid: true, sanitised: p };
}

// ---------------------------------------------------------------------------
// ProjectStore
// ---------------------------------------------------------------------------

export class ProjectStore {
  private readonly rootDir: string;
  private readonly maxFileSize: number;
  private readonly maxTotalSize: number;
  private config: ProjectConfig;

  constructor(cfg?: ProjectStoreConfig) {
    this.rootDir = cfg?.rootDir ?? DEFAULT_ROOT;
    this.maxFileSize = cfg?.maxFileSize ?? DEFAULT_MAX_FILE;
    this.maxTotalSize = cfg?.maxTotalSize ?? DEFAULT_MAX_TOTAL;
    this.config = { alwaysLoaded: [], available: [] };

    mkdirSync(this.rootDir, { recursive: true });
    this.loadConfig();
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  saveFile(path: string, content: string, _mimeType?: string): ProjectSaveResult {
    const v = validatePath(path);
    if (!v.valid) return { ok: false, error: v.error! };

    // Content security scan — reject files with embedded scripts or injection patterns
    const scanResult = scanContent(content);
    if (scanResult !== null) {
      return { ok: false, error: scanResult };
    }

    const size = Buffer.byteLength(content);
    if (size > this.maxFileSize) {
      return { ok: false, error: `File too large: ${size} bytes (max ${this.maxFileSize})` };
    }

    const totalSize = this.getTotalSize();
    if (totalSize + size > this.maxTotalSize) {
      return { ok: false, error: `Project size limit exceeded: ${totalSize + size} bytes (max ${this.maxTotalSize})` };
    }

    const fullPath = join(this.rootDir, v.sanitised!);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
    return { ok: true, size };
  }

  readFile(path: string): string | null {
    const v = validatePath(path);
    if (!v.valid) return null;
    const fullPath = join(this.rootDir, v.sanitised!);
    try {
      return readFileSync(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  deleteFile(path: string): boolean {
    const v = validatePath(path);
    if (!v.valid) return false;
    const fullPath = join(this.rootDir, v.sanitised!);
    try {
      rmSync(fullPath);
      // Remove from config if present
      this.config.alwaysLoaded = this.config.alwaysLoaded.filter((p) => p !== v.sanitised);
      this.config.available = this.config.available.filter((p) => p !== v.sanitised);
      this.saveConfig();
      return true;
    } catch {
      return false;
    }
  }

  listFiles(directory?: string): readonly ProjectFile[] {
    const files: ProjectFile[] = [];
    const scanDir = directory ? join(this.rootDir, directory) : this.rootDir;

    if (!existsSync(scanDir)) return files;

    const scan = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === CONFIG_FILE) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          scan(join(dir, entry.name), rel);
        } else {
          const fullPath = join(dir, entry.name);
          const stat = statSync(fullPath);
          const ext = posix.extname(entry.name).toLowerCase();
          files.push({
            path: rel,
            size: stat.size,
            mimeType: extToMime(ext),
            lastModified: stat.mtime.toISOString(),
          });
        }
      }
    };

    scan(scanDir, directory ?? '');
    return files;
  }

  // -----------------------------------------------------------------------
  // Config
  // -----------------------------------------------------------------------

  getConfig(): ProjectConfig {
    return { ...this.config };
  }

  setConfig(alwaysLoaded: readonly string[], available: readonly string[]): void {
    this.config = { alwaysLoaded: [...alwaysLoaded], available: [...available] };
    this.saveConfig();
  }

  private loadConfig(): void {
    const cfgPath = join(this.rootDir, CONFIG_FILE);
    try {
      const raw = readFileSync(cfgPath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.config = {
        alwaysLoaded: Array.isArray(parsed.alwaysLoaded) ? parsed.alwaysLoaded : [],
        available: Array.isArray(parsed.available) ? parsed.available : [],
      };
    } catch {
      this.config = { alwaysLoaded: [], available: [] };
    }
  }

  private saveConfig(): void {
    const cfgPath = join(this.rootDir, CONFIG_FILE);
    try {
      writeFileSync(cfgPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch {
      // Non-fatal
    }
  }

  // -----------------------------------------------------------------------
  // Prompt context
  // -----------------------------------------------------------------------

  getPromptContext(): string {
    if (this.config.alwaysLoaded.length === 0) return '';

    const parts: string[] = [];
    for (const path of this.config.alwaysLoaded) {
      const content = this.readFile(path);
      if (content !== null) {
        parts.push(`=== ${path} ===\n${content}`);
      }
    }

    if (parts.length === 0) return '';
    return `--- Project Context (${parts.length} files) ---\n${parts.join('\n\n')}`;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  getTotalSize(): number {
    let total = 0;
    for (const f of this.listFiles()) total += f.size;
    return total;
  }

  get fileCount(): number {
    return this.listFiles().length;
  }
}

function extToMime(ext: string): string {
  switch (ext) {
    case '.md':
      return 'text/markdown';
    case '.json':
      return 'application/json';
    case '.yaml':
    case '.yml':
      return 'text/yaml';
    case '.txt':
      return 'text/plain';
    default:
      return 'text/plain';
  }
}
