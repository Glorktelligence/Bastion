// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * SkillsManager — sole authority for skill registry edits post-startup.
 *
 * Wraps SkillStore with forensic scanning, quarantine pipeline, admin
 * approval, human-verified hot reload, and violation escalation.
 *
 * New/updated skills go through quarantine → forensic scan → admin review
 * → hot reload. Bypass attempts escalate: warn → alert → shutdown.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { SkillManifest } from './skill-store.js';
import type { SkillStore } from './skill-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillScanCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export interface SkillScanResult {
  readonly passed: boolean;
  readonly skillId: string;
  readonly filePath: string;
  readonly fileSize: number;
  readonly hash: string;
  readonly encoding: 'utf8' | 'unknown';
  readonly checks: readonly SkillScanCheck[];
  readonly scannedAt: string;
}

export interface PendingSkill {
  readonly skillId: string;
  readonly filePath: string;
  readonly originalPath: string;
  readonly scanResult: SkillScanResult;
  readonly detectedAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface SkillsManagerConfig {
  /** Directory for quarantined skill files. */
  readonly quarantineDir: string;
  /** The SkillStore to hot-reload into. */
  readonly skillStore: SkillStore;
  /** Called on each violation with count and detail. */
  readonly onViolation?: (count: number, detail: string) => void;
  /** Called when violation threshold triggers shutdown. */
  readonly onShutdown?: (reason: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SKILL_SIZE = 1024 * 1024; // 1MB per skill file

// Forensic scan patterns
const HIDDEN_UNICODE = /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/;
const SCRIPT_RE = /<script[\s>]/i;
const EXEC_RE = /\[BASTION:EXEC\]/i;
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+(?:a|an)\s+/i,
  /forget\s+(?:all|your|everything)/i,
  /override\s+(?:safety|security|rules)/i,
  /system\s*:\s*you\s+are/i,
  /\[SYSTEM\]/i,
  /jailbreak/i,
  /DAN\s+mode/i,
];
const BASE64_BLOCK_RE = /[A-Za-z0-9+/]{100,}={0,2}/;
const URL_RE = /https?:\/\/[^\s)}\]]+/g;
const ALLOWED_URL_HOSTS = ['github.com', 'anthropic.com', 'glorktelligence'];
const SAFETY_OVERRIDE_RE = /(?:disable|remove|lower|bypass|ignore)\s+(?:safety|security|restriction|limit|floor)/i;

// ---------------------------------------------------------------------------
// SkillsManager
// ---------------------------------------------------------------------------

export class SkillsManager {
  private readonly quarantineDir: string;
  private readonly skillStore: SkillStore;
  private readonly pendingSkills: Map<string, PendingSkill> = new Map();
  private readonly knownHashes: Map<string, string> = new Map(); // filePath → SHA-256
  private violationCount = 0;
  private readonly onViolation?: (count: number, detail: string) => void;
  private readonly onShutdown?: (reason: string) => void;

  constructor(config: SkillsManagerConfig) {
    this.quarantineDir = config.quarantineDir;
    this.skillStore = config.skillStore;
    this.onViolation = config.onViolation;
    this.onShutdown = config.onShutdown;
  }

  /**
   * Run forensic scan on a file. Does NOT require quarantine — can be called
   * directly for testing or pre-checks.
   *
   * 10 checks: file type, size limit, encoding, hidden unicode, script tags,
   * BASTION:EXEC blocks, injection patterns, base64 payloads, suspicious URLs,
   * safety override language.
   */
  scanSkill(filePath: string): SkillScanResult {
    const checks: SkillScanCheck[] = [];
    let content: string;
    let fileSize: number;

    try {
      content = readFileSync(filePath, 'utf-8');
      const stats = statSync(filePath);
      fileSize = stats.size;
    } catch (err) {
      return {
        passed: false,
        skillId: basename(filePath, extname(filePath)),
        filePath,
        fileSize: 0,
        hash: '',
        encoding: 'unknown',
        checks: [
          {
            name: 'file_read',
            passed: false,
            detail: `Cannot read file: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        scannedAt: new Date().toISOString(),
      };
    }

    // 1. File type verification
    const isMd = filePath.endsWith('.md');
    checks.push({
      name: 'file_type',
      passed: isMd,
      detail: isMd ? 'Markdown file' : `Unexpected extension: ${extname(filePath)}`,
    });

    // 2. Size limit (max 1MB per skill file)
    checks.push({
      name: 'size_limit',
      passed: fileSize <= MAX_SKILL_SIZE,
      detail: `${fileSize} bytes (max: ${MAX_SKILL_SIZE})`,
    });

    // 3. UTF-8 encoding validation (no null bytes)
    const hasNullBytes = content.includes('\0');
    checks.push({
      name: 'encoding',
      passed: !hasNullBytes,
      detail: hasNullBytes ? 'Contains null bytes' : 'Clean UTF-8',
    });

    // 4. No hidden unicode tricks
    const hasHiddenUnicode = HIDDEN_UNICODE.test(content);
    checks.push({
      name: 'hidden_unicode',
      passed: !hasHiddenUnicode,
      detail: hasHiddenUnicode
        ? 'Contains hidden unicode characters (zero-width, RTL override, etc.)'
        : 'No hidden unicode',
    });

    // 5. No embedded script tags
    const hasScript = SCRIPT_RE.test(content);
    checks.push({
      name: 'no_script_tags',
      passed: !hasScript,
      detail: hasScript ? 'Contains <script> tags' : 'No script tags',
    });

    // 6. No BASTION:EXEC blocks (skills define, not execute)
    const hasExec = EXEC_RE.test(content);
    checks.push({
      name: 'no_exec_blocks',
      passed: !hasExec,
      detail: hasExec ? 'Contains [BASTION:EXEC] blocks — skills must not execute' : 'No exec blocks',
    });

    // 7. No system prompt injection attempts
    const injectionFound = INJECTION_PATTERNS.some((re) => re.test(content));
    checks.push({
      name: 'no_injection_attempts',
      passed: !injectionFound,
      detail: injectionFound ? 'Contains potential prompt injection patterns' : 'No injection patterns detected',
    });

    // 8. No base64 encoded payloads (suspicious in a markdown skill file)
    const hasBase64 = BASE64_BLOCK_RE.test(content);
    checks.push({
      name: 'no_base64_payloads',
      passed: !hasBase64,
      detail: hasBase64 ? 'Contains large base64-encoded content (suspicious in skill file)' : 'No base64 payloads',
    });

    // 9. No URL patterns to external servers (skills shouldn't phone home)
    const urls = content.match(URL_RE) || [];
    const suspiciousUrls = urls.filter((u) => !ALLOWED_URL_HOSTS.some((host) => u.includes(host)));
    checks.push({
      name: 'no_suspicious_urls',
      passed: suspiciousUrls.length === 0,
      detail:
        suspiciousUrls.length > 0
          ? `Contains external URLs: ${suspiciousUrls.slice(0, 3).join(', ')}`
          : 'No suspicious URLs',
    });

    // 10. No attempts to modify safety floors
    const hasSafetyOverride = SAFETY_OVERRIDE_RE.test(content);
    checks.push({
      name: 'no_safety_overrides',
      passed: !hasSafetyOverride,
      detail: hasSafetyOverride ? 'Contains safety override language' : 'No safety override attempts',
    });

    // Compute hash
    const hash = createHash('sha256').update(content).digest('hex');

    return {
      passed: checks.every((c) => c.passed),
      skillId: basename(filePath, extname(filePath)),
      filePath,
      fileSize,
      hash: `sha256:${hash}`,
      encoding: hasNullBytes ? 'unknown' : 'utf8',
      checks,
      scannedAt: new Date().toISOString(),
    };
  }

  /**
   * Quarantine a new/updated skill file for scanning.
   * Copies the file to quarantine directory and runs forensic scan.
   */
  quarantine(skillId: string, sourcePath: string): SkillScanResult {
    // Copy file to quarantine directory (NOT move — preserve original)
    const quarantinePath = join(this.quarantineDir, `${skillId}.md`);
    mkdirSync(this.quarantineDir, { recursive: true });
    copyFileSync(sourcePath, quarantinePath);

    // Run forensic scan
    const scanResult = this.scanSkill(quarantinePath);

    // Store as pending
    this.pendingSkills.set(skillId, {
      skillId,
      filePath: quarantinePath,
      originalPath: sourcePath,
      scanResult,
      detectedAt: new Date().toISOString(),
      status: 'pending',
    });

    const failCount = scanResult.checks.filter((c) => !c.passed).length;
    console.log(
      `[scan] Skill quarantined: ${skillId} — scan ${scanResult.passed ? 'PASSED' : 'FAILED'} (${failCount} issues)`,
    );

    return scanResult;
  }

  /**
   * Admin approves a pending skill — hot reload into SkillStore.
   * Rejects if the skill failed forensic scan.
   */
  approveSkill(skillId: string, manifest?: Partial<SkillManifest>): { ok: boolean; error?: string } {
    const pending = this.pendingSkills.get(skillId);
    if (!pending) return { ok: false, error: 'Skill not found in pending queue' };
    if (!pending.scanResult.passed) {
      return { ok: false, error: 'Skill failed forensic scan — cannot approve failed skills' };
    }

    // Read the quarantined content
    const content = readFileSync(pending.filePath, 'utf-8');

    // Hot-reload into SkillStore
    const result = this.skillStore.hotReload(skillId, content, 'admin_approved', manifest);

    if (result.ok) {
      pending.status = 'approved';
      this.pendingSkills.delete(skillId);
      // Update known hash so checkForNewSkills won't re-quarantine
      this.knownHashes.set(pending.originalPath, pending.scanResult.hash);
      console.log(`[skill] Skill approved and hot-reloaded: ${skillId}`);
    }

    return result;
  }

  /**
   * Admin rejects a pending skill.
   */
  rejectSkill(skillId: string): void {
    const pending = this.pendingSkills.get(skillId);
    if (pending) {
      pending.status = 'rejected';
      this.pendingSkills.delete(skillId);
      console.log(`[skill] Skill rejected: ${skillId}`);
    }
  }

  /** Get all pending skills awaiting review. */
  getPendingSkills(): readonly PendingSkill[] {
    return [...this.pendingSkills.values()];
  }

  /**
   * Report a registry bypass violation (escalates: warn → alert → shutdown).
   */
  reportViolation(detail: string): void {
    this.violationCount++;
    const level = this.violationCount >= 3 ? 'SHUTDOWN' : this.violationCount >= 2 ? 'ALERT' : 'WARNING';

    console.error(`[!] SKILL REGISTRY VIOLATION #${this.violationCount} (${level}): ${detail}`);

    this.onViolation?.(this.violationCount, detail);

    if (this.violationCount >= 3) {
      console.error('[!!!] SKILL REGISTRY VIOLATION THRESHOLD — INITIATING SHUTDOWN');
      this.onShutdown?.('Skill registry violation threshold exceeded');
    }
  }

  /** Current violation count. */
  get violations(): number {
    return this.violationCount;
  }

  /**
   * Check a directory for new/modified skill files by hash comparison.
   * Returns skill IDs of newly quarantined skills.
   */
  checkForNewSkills(watchDir: string): string[] {
    const newSkillIds: string[] = [];

    if (!existsSync(watchDir)) return newSkillIds;

    let entries: string[];
    try {
      entries = readdirSync(watchDir);
    } catch {
      return newSkillIds;
    }

    for (const entry of entries) {
      const fullPath = join(watchDir, entry);
      try {
        const stat = statSync(fullPath);
        if (!stat.isFile()) continue;
        if (!entry.endsWith('.md')) continue;

        // Compute hash of current file
        const content = readFileSync(fullPath, 'utf-8');
        const hash = `sha256:${createHash('sha256').update(content).digest('hex')}`;

        // Compare against known hash
        const knownHash = this.knownHashes.get(fullPath);
        if (knownHash === hash) continue; // No change

        // Check if already pending
        const skillId = basename(entry, '.md');
        if (this.pendingSkills.has(skillId)) continue;

        // New or modified file — quarantine it
        this.quarantine(skillId, fullPath);
        newSkillIds.push(skillId);
      } catch {
        // Skip files we can't read
      }
    }

    return newSkillIds;
  }

  /**
   * Initialize known hashes from the SkillStore's current state.
   * Call after initial skill loading to establish baseline.
   */
  initializeKnownHashes(skillsDir: string): void {
    if (!existsSync(skillsDir)) return;

    try {
      const entries = readdirSync(skillsDir);
      for (const entry of entries) {
        const fullPath = join(skillsDir, entry);
        try {
          const stat = statSync(fullPath);
          if (!stat.isFile() || !entry.endsWith('.md')) continue;
          const content = readFileSync(fullPath, 'utf-8');
          const hash = `sha256:${createHash('sha256').update(content).digest('hex')}`;
          this.knownHashes.set(fullPath, hash);
        } catch {
          // Skip
        }
      }
    } catch {
      // Directory not readable
    }
  }
}
