// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * BudgetGuard — immutable budget enforcement for web search usage.
 *
 * Same enforcement tier as MaliClaw Clause and safety floors.
 * When the monthly cap is hit, web search is disabled. Period.
 * No override. No "just one more." The code path for budget
 * exhaustion is as absolute as MaliClaw rejection.
 *
 * Tracks: searchesThisSession (resets on disconnect),
 *         searchesThisDay (resets at midnight server time),
 *         searchesThisMonth (resets 1st of month),
 *         costThisMonth (USD).
 *
 * Uses SQLite for persistence (node:sqlite DatabaseSync).
 * Config persisted to JSON with pending-next-month support.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { DateTimeManager } from './datetime-manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetLimits {
  monthlyCapUsd: number;
  maxPerMonth: number;
  maxPerDay: number;
  maxPerSession: number;
  maxPerCall: number;
  alertAtPercent: number;
}

export interface BudgetGuardConfig {
  limits: BudgetLimits;
  pendingNextMonth: Partial<BudgetLimits> | null;
  lastBudgetChange: string | null;
  cooldownDays: number;
}

export type BudgetCheckResult =
  | { readonly allowed: true; readonly alertLevel: 'none' | 'warning' | 'urgent' }
  | { readonly blocked: true; readonly reason: string; readonly errorCode: string };

export type BudgetAlertLevel = 'none' | 'warning' | 'urgent' | 'exhausted';

export interface BudgetStatus {
  searchesThisSession: number;
  searchesThisDay: number;
  searchesThisMonth: number;
  costThisMonth: number;
  budgetRemaining: number;
  percentUsed: number;
  monthlyCapUsd: number;
  alertLevel: BudgetAlertLevel;
}

export interface BudgetGuardOptions {
  /** Path to SQLite database. Default: /var/lib/bastion/budget.db */
  readonly dbPath?: string;
  /** Path to config JSON. Default: /var/lib/bastion/budget-config.json */
  readonly configPath?: string;
  /** System timezone (from ChallengeManager). */
  readonly timezone?: string;
  /** Optional DateTimeManager — sole DateTime authority. */
  readonly dateTimeManager?: DateTimeManager;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMITS: BudgetLimits = {
  monthlyCapUsd: 10.0,
  maxPerMonth: 500,
  maxPerDay: 50,
  maxPerSession: 20,
  maxPerCall: 5,
  alertAtPercent: 50,
};

const DEFAULT_CONFIG: BudgetGuardConfig = {
  limits: { ...DEFAULT_LIMITS },
  pendingNextMonth: null,
  lastBudgetChange: null,
  cooldownDays: 7,
};

// Cost per web search request (Anthropic pricing estimate)
const WEB_SEARCH_COST_USD = 0.01;

// ---------------------------------------------------------------------------
// BudgetGuard
// ---------------------------------------------------------------------------

export class BudgetGuard {
  private readonly db: DatabaseSync;
  private readonly configPath: string;
  private readonly timezone: string;
  private readonly dateTimeManager: DateTimeManager | null;
  private config: BudgetGuardConfig;
  private searchesThisSession: number;

  constructor(options: BudgetGuardOptions = {}) {
    const dbPath = options.dbPath ?? '/var/lib/bastion/budget.db';
    this.configPath = options.configPath ?? '/var/lib/bastion/budget-config.json';
    this.timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.dateTimeManager = options.dateTimeManager ?? null;
    this.searchesThisSession = 0;
    this.config = { ...DEFAULT_CONFIG, limits: { ...DEFAULT_LIMITS } };

    // Initialise SQLite database
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS budget_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        month TEXT NOT NULL,
        search_count INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0.0,
        recorded_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_budget_date ON budget_usage(date);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_budget_month ON budget_usage(month);
    `);

    this.loadConfig();
    this.checkMonthRollover();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Check if a web search is allowed right now.
   * Returns allowed (with current alert level) or blocked (with reason).
   *
   * This is the HARD STOP — same enforcement as MaliClaw rejection.
   */
  checkBudget(searchCount = 1): BudgetCheckResult {
    const limits = this.config.limits;
    const today = this.getToday();
    const month = this.getMonth();

    const dayCount = this.getSearchesForDate(today);
    const monthCount = this.getSearchesForMonth(month);
    const monthCost = this.getCostForMonth(month);

    // Monthly cost cap — ABSOLUTE HARD STOP
    if (monthCost >= limits.monthlyCapUsd) {
      return {
        blocked: true,
        reason: `Monthly budget exhausted: $${monthCost.toFixed(2)} / $${limits.monthlyCapUsd.toFixed(2)}`,
        errorCode: 'BASTION-8001',
      };
    }

    // Monthly search limit
    if (monthCount + searchCount > limits.maxPerMonth) {
      return {
        blocked: true,
        reason: `Monthly search limit reached: ${monthCount} / ${limits.maxPerMonth}`,
        errorCode: 'BASTION-8001',
      };
    }

    // Daily search limit
    if (dayCount + searchCount > limits.maxPerDay) {
      return {
        blocked: true,
        reason: `Daily search limit reached: ${dayCount} / ${limits.maxPerDay}`,
        errorCode: 'BASTION-8002',
      };
    }

    // Session search limit
    if (this.searchesThisSession + searchCount > limits.maxPerSession) {
      return {
        blocked: true,
        reason: `Session search limit reached: ${this.searchesThisSession} / ${limits.maxPerSession}`,
        errorCode: 'BASTION-8003',
      };
    }

    // Per-call limit
    if (searchCount > limits.maxPerCall) {
      return {
        blocked: true,
        reason: `Per-call search limit exceeded: ${searchCount} / ${limits.maxPerCall}`,
        errorCode: 'BASTION-8003',
      };
    }

    // Calculate alert level
    const percentUsed = limits.monthlyCapUsd > 0 ? (monthCost / limits.monthlyCapUsd) * 100 : 0;
    let alertLevel: 'none' | 'warning' | 'urgent' = 'none';
    if (percentUsed >= 80) {
      alertLevel = 'urgent';
    } else if (percentUsed >= limits.alertAtPercent) {
      alertLevel = 'warning';
    }

    return { allowed: true, alertLevel };
  }

  /**
   * Record web search usage after an API call.
   * Returns the new alert level (for sending budget_alert if threshold crossed).
   */
  recordUsage(
    searchCount: number,
    costUsd?: number,
  ): {
    alertLevel: BudgetAlertLevel;
    thresholdCrossed: string | null;
  } {
    const today = this.getToday();
    const month = this.getMonth();
    const cost = costUsd ?? searchCount * WEB_SEARCH_COST_USD;

    // Get pre-record state for threshold detection
    const preCost = this.getCostForMonth(month);
    const prePct = this.config.limits.monthlyCapUsd > 0 ? (preCost / this.config.limits.monthlyCapUsd) * 100 : 0;

    // Record to SQLite
    const stmt = this.db.prepare(
      'INSERT INTO budget_usage (date, month, search_count, cost_usd, recorded_at) VALUES (?, ?, ?, ?, ?)',
    );
    stmt.run(today, month, searchCount, cost, this.nowIso());

    // Increment session counter
    this.searchesThisSession += searchCount;

    // Check post-record thresholds
    const postCost = preCost + cost;
    const postPct = this.config.limits.monthlyCapUsd > 0 ? (postCost / this.config.limits.monthlyCapUsd) * 100 : 0;

    let thresholdCrossed: string | null = null;
    let alertLevel: BudgetAlertLevel = 'none';

    if (postPct >= 100) {
      alertLevel = 'exhausted';
      if (prePct < 100) thresholdCrossed = 'monthly_exhausted';
    } else if (postPct >= 80) {
      alertLevel = 'urgent';
      if (prePct < 80) thresholdCrossed = 'urgent_80';
    } else if (postPct >= this.config.limits.alertAtPercent) {
      alertLevel = 'warning';
      if (prePct < this.config.limits.alertAtPercent) thresholdCrossed = 'warning_50';
    }

    // Check session limit threshold
    if (this.searchesThisSession >= this.config.limits.maxPerSession && thresholdCrossed === null) {
      thresholdCrossed = 'session_limit';
    }

    // Check daily limit threshold
    const postDay = this.getSearchesForDate(today);
    if (postDay >= this.config.limits.maxPerDay && thresholdCrossed === null) {
      thresholdCrossed = 'daily_limit';
    }

    return { alertLevel, thresholdCrossed };
  }

  /**
   * Get full budget status for sending via budget_status message.
   */
  getStatus(): BudgetStatus {
    const today = this.getToday();
    const month = this.getMonth();
    const limits = this.config.limits;

    const monthCost = this.getCostForMonth(month);
    const percentUsed = limits.monthlyCapUsd > 0 ? (monthCost / limits.monthlyCapUsd) * 100 : 0;
    const remaining = Math.max(0, limits.monthlyCapUsd - monthCost);

    let alertLevel: BudgetAlertLevel = 'none';
    if (percentUsed >= 100) alertLevel = 'exhausted';
    else if (percentUsed >= 80) alertLevel = 'urgent';
    else if (percentUsed >= limits.alertAtPercent) alertLevel = 'warning';

    return {
      searchesThisSession: this.searchesThisSession,
      searchesThisDay: this.getSearchesForDate(today),
      searchesThisMonth: this.getSearchesForMonth(month),
      costThisMonth: Math.round(monthCost * 100) / 100,
      budgetRemaining: Math.round(remaining * 100) / 100,
      percentUsed: Math.round(percentUsed * 100) / 100,
      monthlyCapUsd: limits.monthlyCapUsd,
      alertLevel,
    };
  }

  /**
   * Get current limits and pending changes.
   */
  getLimits(): BudgetLimits {
    return { ...this.config.limits };
  }

  /**
   * Get pending next-month changes (if any).
   */
  getPendingNextMonth(): Partial<BudgetLimits> | null {
    return this.config.pendingNextMonth ? { ...this.config.pendingNextMonth } : null;
  }

  /**
   * Update budget limits. Enforces tighten-only for current month:
   * - Decreases (tightening) take effect immediately
   * - Increases take effect NEXT month only (stored as pending)
   *
   * Returns success/failure with reason.
   */
  updateLimits(newLimits: Partial<BudgetLimits>): { accepted: boolean; reason: string; pendingNextMonth: boolean } {
    const current = this.config.limits;
    let anyPending = false;
    let anyImmediate = false;
    const immediateChanges: Partial<BudgetLimits> = {};
    const pendingChanges: Partial<BudgetLimits> = {};

    for (const [key, value] of Object.entries(newLimits) as [keyof BudgetLimits, number][]) {
      if (value === undefined || value === current[key]) continue;

      if (key === 'alertAtPercent') {
        // alertAtPercent: lower = more alerts = tighter → immediate
        if (value <= current[key]) {
          immediateChanges[key] = value;
          anyImmediate = true;
        } else {
          pendingChanges[key] = value;
          anyPending = true;
        }
      } else if (key === 'monthlyCapUsd') {
        // monthlyCapUsd: lower = less budget = tighter → immediate
        if (value <= current[key]) {
          immediateChanges[key] = value;
          anyImmediate = true;
        } else {
          pendingChanges[key] = value;
          anyPending = true;
        }
      } else {
        // maxPerMonth/Day/Session/Call: lower = fewer searches = tighter → immediate
        if (value <= current[key]) {
          immediateChanges[key] = value;
          anyImmediate = true;
        } else {
          pendingChanges[key] = value;
          anyPending = true;
        }
      }
    }

    // Apply immediate changes
    if (anyImmediate) {
      Object.assign(this.config.limits, immediateChanges);
    }

    // Store pending increases for next month
    if (anyPending) {
      this.config.pendingNextMonth = {
        ...(this.config.pendingNextMonth ?? {}),
        ...pendingChanges,
      };
    }

    // Record change timestamp for cooldown
    this.config.lastBudgetChange = this.nowIso();
    this.saveConfig();

    if (anyPending && !anyImmediate) {
      return {
        accepted: true,
        reason: 'All changes are increases — will take effect next month',
        pendingNextMonth: true,
      };
    }
    if (anyPending && anyImmediate) {
      return {
        accepted: true,
        reason: 'Decreases applied immediately. Increases pending next month.',
        pendingNextMonth: true,
      };
    }
    return { accepted: true, reason: 'Limits updated', pendingNextMonth: false };
  }

  /**
   * Check if a budget config change is within cooldown period.
   */
  checkCooldown(): { allowed: boolean; reason?: string; availableAt?: string } {
    if (!this.config.lastBudgetChange) return { allowed: true };

    const last = new Date(this.config.lastBudgetChange);
    const expires = new Date(last.getTime() + this.config.cooldownDays * 86400000);
    if (this.nowMs() < expires.getTime()) {
      return {
        allowed: false,
        reason: `Budget adjustment locked. Last change: ${this.config.lastBudgetChange}`,
        availableAt: expires.toISOString(),
      };
    }
    return { allowed: true };
  }

  /**
   * Reset session counter (call on disconnect/reconnect).
   */
  resetSession(): void {
    this.searchesThisSession = 0;
  }

  /**
   * Get total search count for this session.
   */
  get sessionSearches(): number {
    return this.searchesThisSession;
  }

  // -----------------------------------------------------------------------
  // DateTime helpers (using DateTimeManager when available)
  // -----------------------------------------------------------------------

  /** Current time as ISO string, using DateTimeManager if available. */
  private nowIso(): string {
    return this.dateTimeManager?.now().iso ?? new Date().toISOString();
  }

  /** Current time as epoch ms, using DateTimeManager if available. */
  private nowMs(): number {
    return this.dateTimeManager?.now().unix ?? Date.now();
  }

  /** Current Date object, using DateTimeManager if available. */
  private nowDate(): Date {
    return this.dateTimeManager ? new Date(this.dateTimeManager.now().unix) : new Date();
  }

  // -----------------------------------------------------------------------
  // Date helpers (using server timezone)
  // -----------------------------------------------------------------------

  private getToday(): string {
    return this.formatDate(this.nowDate(), 'date');
  }

  private getMonth(): string {
    return this.formatDate(this.nowDate(), 'month');
  }

  private formatDate(date: Date, mode: 'date' | 'month'): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      ...(mode === 'date' ? { day: '2-digit' } : {}),
    });
    return formatter.format(date);
  }

  // -----------------------------------------------------------------------
  // SQLite queries
  // -----------------------------------------------------------------------

  private getSearchesForDate(date: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(search_count), 0) as total FROM budget_usage WHERE date = ?')
      .get(date) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  private getSearchesForMonth(month: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(search_count), 0) as total FROM budget_usage WHERE month = ?')
      .get(month) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  private getCostForMonth(month: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM budget_usage WHERE month = ?')
      .get(month) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  // -----------------------------------------------------------------------
  // Month rollover
  // -----------------------------------------------------------------------

  private checkMonthRollover(): void {
    if (!this.config.pendingNextMonth) return;

    // Check if we're in a new month compared to last change
    const lastChange = this.config.lastBudgetChange;
    if (!lastChange) return;

    const lastMonth = lastChange.slice(0, 7); // YYYY-MM
    const currentMonth = this.getMonth();

    if (currentMonth > lastMonth) {
      // Apply pending changes
      Object.assign(this.config.limits, this.config.pendingNextMonth);
      this.config.pendingNextMonth = null;
      this.saveConfig();
    }
  }

  // -----------------------------------------------------------------------
  // Config persistence
  // -----------------------------------------------------------------------

  private loadConfig(): void {
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.limits) {
        this.config.limits = { ...DEFAULT_LIMITS, ...parsed.limits };
      }
      if (parsed.pendingNextMonth) {
        this.config.pendingNextMonth = parsed.pendingNextMonth;
      }
      if (parsed.lastBudgetChange) {
        this.config.lastBudgetChange = parsed.lastBudgetChange;
      }
      if (typeof parsed.cooldownDays === 'number') {
        // Safety floor: cooldownDays cannot be set below MIN_COOLDOWN_DAYS (1)
        if (parsed.cooldownDays < 1) {
          console.warn(`[!] Budget Guard: cooldownDays ${parsed.cooldownDays} below floor — clamped to 1`);
          this.config.cooldownDays = 1;
        } else {
          this.config.cooldownDays = parsed.cooldownDays;
        }
      }
    } catch {
      // File doesn't exist — use defaults
    }
  }

  private saveConfig(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch {
      // Non-fatal
    }
  }
}
