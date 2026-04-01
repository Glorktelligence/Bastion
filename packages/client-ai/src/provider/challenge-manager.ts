// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * ChallengeManager — temporal governance for Bastion.
 *
 * Restricts impulsive actions during user-configured vulnerable hours.
 * Uses SYSTEM TIMEZONE from the AI VM — the client cannot override this.
 *
 * Tighten-only immediate: enabling challenge hours takes effect immediately.
 * Loosening has cooldown + delay: disabling/reducing requires a 7-day cooldown
 * and takes effect after the current challenge period ends.
 */

import { readFileSync, writeFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChallengeSchedule {
  weekdays: { start: string; end: string };
  weekends: { start: string; end: string };
}

export interface ChallengeCooldowns {
  budgetChangeDays: number;
  scheduleChangeDays: number;
  toolRegistrationDays: number;
}

export interface ChallengeConfig {
  enabled: boolean;
  timezone: string;
  schedule: ChallengeSchedule;
  cooldowns: ChallengeCooldowns;
  lastChanges: Record<string, string>; // actionType → ISO timestamp
}

export type ChallengeResult =
  | { readonly allowed: true }
  | { readonly blocked: true; readonly reason: string; readonly availableAt: string }
  | { readonly confirm: true; readonly waitSeconds: number; readonly message: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ChallengeConfig = {
  enabled: true,
  timezone: '',
  schedule: {
    weekdays: { start: '22:00', end: '06:00' },
    weekends: { start: '23:00', end: '08:00' },
  },
  cooldowns: {
    budgetChangeDays: 7,
    scheduleChangeDays: 7,
    toolRegistrationDays: 1,
  },
  lastChanges: {},
};

/** Safety floor: minimum challenge window in hours. */
const MIN_CHALLENGE_WINDOW_HOURS = 6;

const BLOCKED_ACTIONS = ['budget_change', 'new_mcp_registration', 'challenge_schedule_change'];
const CONFIRM_ACTIONS: Record<string, { waitSeconds: number; message: string }> = {
  dangerous_tool_approval: {
    waitSeconds: 30,
    message: 'This action involves a dangerous tool. Take a moment to consider.',
  },
  memory_deletion: { waitSeconds: 10, message: 'Deleting a memory is permanent. Are you sure?' },
  project_file_deletion: { waitSeconds: 10, message: 'Deleting a project file is permanent.' },
  trust_elevation_above_7: {
    waitSeconds: 15,
    message: 'Elevating trust above 7 gives significant autonomy to this tool.',
  },
};

// ---------------------------------------------------------------------------
// ChallengeManager
// ---------------------------------------------------------------------------

export class ChallengeManager {
  private config: ChallengeConfig;
  private readonly configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? '/var/lib/bastion-ai/challenge-config.json';
    this.config = { ...DEFAULT_CONFIG };
    this.config.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.loadConfig();
  }

  /** Whether challenge hours are currently active. */
  isActive(): boolean {
    if (!this.config.enabled) return false;
    return this.isWithinSchedule(new Date());
  }

  /** Get the current challenge status (includes full config for admin API caching). */
  getStatus(): {
    active: boolean;
    timezone: string;
    currentTime: string;
    periodEnd: string | null;
    restrictions: string[];
    schedule: ChallengeSchedule;
    cooldowns: ChallengeCooldowns;
    lastChanges: Record<string, string>;
  } {
    const now = new Date();
    const active = this.isActive();
    return {
      active,
      timezone: this.config.timezone,
      currentTime: now.toISOString(),
      periodEnd: active ? this.getPeriodEnd(now) : null,
      restrictions: active ? [...BLOCKED_ACTIONS, ...Object.keys(CONFIRM_ACTIONS)] : [],
      schedule: { ...this.config.schedule },
      cooldowns: { ...this.config.cooldowns },
      lastChanges: { ...this.config.lastChanges },
    };
  }

  /**
   * Check if an action is allowed right now.
   * Returns allowed, blocked (with reason), or confirm (with wait timer).
   */
  checkAction(actionType: string): ChallengeResult {
    if (!this.isActive()) return { allowed: true };

    // Blocked actions — completely prevented during challenge hours
    if (BLOCKED_ACTIONS.includes(actionType)) {
      return {
        blocked: true,
        reason: `"${actionType}" is blocked during challenge hours. This protects you from impulsive decisions.`,
        availableAt: this.getPeriodEnd(new Date()) ?? 'unknown',
      };
    }

    // Confirm actions — allowed with mandatory wait timer
    const confirmDef = CONFIRM_ACTIONS[actionType];
    if (confirmDef) {
      return {
        confirm: true,
        waitSeconds: confirmDef.waitSeconds,
        message: confirmDef.message,
      };
    }

    // Check cooldowns for governance changes
    const cooldownKey = this.getCooldownKey(actionType);
    if (cooldownKey) {
      const lastChange = this.config.lastChanges[cooldownKey];
      if (lastChange) {
        const cooldownDays = this.getCooldownDays(cooldownKey);
        const expiresAt = new Date(new Date(lastChange).getTime() + cooldownDays * 86400000);
        if (new Date() < expiresAt) {
          return {
            blocked: true,
            reason: `Cooldown active: "${cooldownKey}" was last changed ${lastChange}. Available after ${expiresAt.toISOString()}.`,
            availableAt: expiresAt.toISOString(),
          };
        }
      }
    }

    return { allowed: true };
  }

  /** Get the current config. */
  getConfig(): ChallengeConfig {
    return { ...this.config };
  }

  /**
   * Update the schedule. Validates tighten-only rules:
   * - Tightening (expanding hours) = immediate
   * - Loosening (shrinking hours or disabling) = cooldown check
   */
  updateConfig(
    schedule: ChallengeSchedule,
    cooldowns: ChallengeCooldowns,
  ): { accepted: boolean; reason: string; cooldownExpires: string | null } {
    // Check cooldown for schedule changes
    const lastScheduleChange = this.config.lastChanges.schedule_change;
    if (lastScheduleChange) {
      const expires = new Date(
        new Date(lastScheduleChange).getTime() + this.config.cooldowns.scheduleChangeDays * 86400000,
      );
      if (new Date() < expires) {
        return {
          accepted: false,
          reason: `Schedule change cooldown active until ${expires.toISOString()}`,
          cooldownExpires: expires.toISOString(),
        };
      }
    }

    // Cannot change schedule during active challenge hours (except tightening)
    if (this.isActive()) {
      return {
        accepted: false,
        reason: 'Cannot modify challenge schedule during active challenge hours',
        cooldownExpires: null,
      };
    }

    // Safety floor: minimum 6-hour challenge window
    const weekdayWindow = this.computeWindowHours(schedule.weekdays.start, schedule.weekdays.end);
    const weekendWindow = this.computeWindowHours(schedule.weekends.start, schedule.weekends.end);
    if (weekdayWindow < MIN_CHALLENGE_WINDOW_HOURS) {
      return {
        accepted: false,
        reason: `Weekday challenge window too short: ${weekdayWindow}h (minimum ${MIN_CHALLENGE_WINDOW_HOURS}h)`,
        cooldownExpires: null,
      };
    }
    if (weekendWindow < MIN_CHALLENGE_WINDOW_HOURS) {
      return {
        accepted: false,
        reason: `Weekend challenge window too short: ${weekendWindow}h (minimum ${MIN_CHALLENGE_WINDOW_HOURS}h)`,
        cooldownExpires: null,
      };
    }

    this.config.schedule = schedule;
    this.config.cooldowns = cooldowns;
    this.config.lastChanges.schedule_change = new Date().toISOString();
    this.saveConfig();
    return { accepted: true, reason: 'Schedule updated', cooldownExpires: null };
  }

  /** Record that a governance action was performed (for cooldown tracking). */
  recordAction(actionType: string): void {
    this.config.lastChanges[actionType] = new Date().toISOString();
    this.saveConfig();
  }

  /** Get the system timezone. */
  get timezone(): string {
    return this.config.timezone;
  }

  /** Whether the system is enabled. */
  get enabled(): boolean {
    return this.config.enabled;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private isWithinSchedule(now: Date): boolean {
    const tz = this.config.timezone;
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const dayFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' });

    const timeStr = formatter.format(now);
    const dayStr = dayFormatter.format(now);
    const isWeekend = dayStr === 'Sat' || dayStr === 'Sun';

    const period = isWeekend ? this.config.schedule.weekends : this.config.schedule.weekdays;
    return this.timeInRange(timeStr, period.start, period.end);
  }

  private timeInRange(current: string, start: string, end: string): boolean {
    const c = this.timeToMinutes(current);
    const s = this.timeToMinutes(start);
    const e = this.timeToMinutes(end);

    if (s <= e) {
      // Same day range (e.g. 09:00 to 17:00)
      return c >= s && c < e;
    }
    // Crosses midnight (e.g. 22:00 to 06:00)
    return c >= s || c < e;
  }

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  }

  private getPeriodEnd(now: Date): string | null {
    const tz = this.config.timezone;
    const dayFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' });
    const dayStr = dayFormatter.format(now);
    const isWeekend = dayStr === 'Sat' || dayStr === 'Sun';
    const period = isWeekend ? this.config.schedule.weekends : this.config.schedule.weekdays;
    // Return the end time as today or tomorrow
    const dateStr = now.toISOString().split('T')[0];
    return `${dateStr}T${period.end}:00`;
  }

  private computeWindowHours(start: string, end: string): number {
    const s = this.timeToMinutes(start);
    const e = this.timeToMinutes(end);
    const mins = e > s ? e - s : 1440 - s + e; // handles wrap-around (e.g. 22:00-06:00 = 480 min)
    return mins / 60;
  }

  private getCooldownKey(actionType: string): string | null {
    if (actionType.includes('budget')) return 'budget_change';
    if (actionType.includes('schedule')) return 'schedule_change';
    if (actionType.includes('tool_registration') || actionType.includes('mcp')) return 'tool_registration';
    return null;
  }

  private getCooldownDays(key: string): number {
    switch (key) {
      case 'budget_change':
        return this.config.cooldowns.budgetChangeDays;
      case 'schedule_change':
        return this.config.cooldowns.scheduleChangeDays;
      case 'tool_registration':
        return this.config.cooldowns.toolRegistrationDays;
      default:
        return 7;
    }
  }

  private loadConfig(): void {
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.config = { ...DEFAULT_CONFIG, ...parsed, timezone: this.config.timezone };
      // Safety floor: Challenge Me More cannot be disabled via config file
      if (this.config.enabled === false) {
        console.warn('[!] Challenge Me More cannot be disabled — safety floor enforced (enabled=true)');
        this.config.enabled = true;
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
