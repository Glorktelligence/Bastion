// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * DateTimeManager — sole DateTime authority for the Bastion AI client.
 *
 * No other component should call new Date() or Date.now() directly for
 * business logic — they should use DateTimeManager. This ensures consistent
 * timezone handling, auditable time sources, and a single point of control
 * for all temporal operations.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DateTimeInfo {
  readonly iso: string;
  readonly unix: number;
  readonly formatted: string;
  readonly timezone: string;
  readonly source: string;
  readonly uptimeMs: number;
}

export interface DateTimeManagerConfig {
  readonly timezone?: string;
}

// ---------------------------------------------------------------------------
// DateTimeManager
// ---------------------------------------------------------------------------

export class DateTimeManager {
  private readonly startedAt: number = Date.now();
  private readonly timezone: string;
  private readonly source: string;

  constructor(config?: DateTimeManagerConfig) {
    this.timezone =
      config?.timezone || process.env.BASTION_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    this.source = 'system-clock';
  }

  /** Get current time from the authoritative source. */
  now(): DateTimeInfo {
    const now = new Date();
    return {
      iso: now.toISOString(),
      unix: now.getTime(),
      formatted: now.toLocaleString('en-GB', { timeZone: this.timezone }),
      timezone: this.timezone,
      source: this.source,
      uptimeMs: now.getTime() - this.startedAt,
    };
  }

  /** Format a duration in milliseconds as human-readable. */
  formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  /** Format time difference between two dates as human-readable. */
  formatTimeDiff(from: Date, to?: Date): string {
    const target = to || new Date();
    return this.formatDuration(target.getTime() - from.getTime());
  }

  /** Build the temporal awareness block for system prompt injection. */
  buildTemporalBlock(): string {
    const info = this.now();
    return [
      '--- Temporal Awareness ---',
      `Current: ${info.iso} (${info.timezone}, ${info.formatted})`,
      `Source: ${info.source}`,
      `AI client uptime: ${this.formatDuration(info.uptimeMs)}`,
    ].join('\n');
  }
}
