// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Infrastructure blue palette for the relay admin UI.
 *
 * Dark theme with blue accents — designed for infrastructure
 * monitoring and administration dashboards.
 */

export const THEME = {
  bg: {
    primary: '#0a1628',
    secondary: '#111d33',
    surface: '#1a2740',
    elevated: '#243352',
  },
  accent: {
    primary: '#3b82f6',
    secondary: '#60a5fa',
    muted: '#1e3a5f',
  },
  text: {
    primary: '#e2e8f0',
    secondary: '#94a3b8',
    muted: '#64748b',
  },
  status: {
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
  },
  border: {
    default: '#1e3a5f',
    active: '#3b82f6',
  },
} as const;

/** Map audit event types to status colours. */
export function auditEventColor(eventType: string): string {
  if (
    eventType.includes('rejected') ||
    eventType.includes('failure') ||
    eventType.includes('violation') ||
    eventType.includes('maliclaw')
  ) {
    return THEME.status.error;
  }
  if (
    eventType.includes('rate_limited') ||
    eventType.includes('expired') ||
    eventType.includes('timeout') ||
    eventType.includes('deactivated')
  ) {
    return THEME.status.warning;
  }
  if (
    eventType.includes('success') ||
    eventType.includes('routed') ||
    eventType.includes('approved') ||
    eventType.includes('delivered')
  ) {
    return THEME.status.success;
  }
  return THEME.status.info;
}

/** Map connection/provider status to colour. */
export function statusColor(active: boolean): string {
  return active ? THEME.status.success : THEME.status.error;
}

/** Map quarantine state to colour. */
export function quarantineStateColor(state: string): string {
  switch (state) {
    case 'quarantined':
      return THEME.status.warning;
    case 'offered':
      return THEME.status.info;
    case 'accepted':
      return THEME.status.success;
    case 'delivered':
      return THEME.status.success;
    case 'rejected':
      return THEME.status.error;
    case 'hash_mismatch':
      return THEME.status.error;
    case 'purged':
      return THEME.text.muted;
    case 'timed_out':
      return THEME.text.muted;
    default:
      return THEME.text.secondary;
  }
}

/** Format bytes to human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Format a timestamp for display. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Relative time description (e.g. "5 min ago"). */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
