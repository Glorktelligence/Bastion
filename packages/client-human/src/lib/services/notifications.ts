// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Desktop notification service for the human client.
 * Uses an injectable adapter pattern so it can be backed by Tauri's
 * notification API in the real app, or by an in-memory stub for testing.
 */

import type { Writable } from '../store.js';
import { writable } from '../store.js';

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface NotificationOptions {
  readonly icon?: string;
  readonly sound?: boolean;
}

export interface NotificationAdapter {
  /** Show a notification. */
  show(title: string, body: string, options?: NotificationOptions): Promise<void>;
  /** Request permission to show notifications. Returns true if granted. */
  requestPermission(): Promise<boolean>;
  /** Whether notifications are supported in this environment. */
  isSupported(): boolean;
}

// ---------------------------------------------------------------------------
// In-memory adapter for testing
// ---------------------------------------------------------------------------

export interface SentNotification {
  readonly title: string;
  readonly body: string;
  readonly category: string;
  readonly timestamp: string;
  readonly options?: NotificationOptions;
}

export class InMemoryNotificationAdapter implements NotificationAdapter {
  readonly sent: SentNotification[] = [];
  private _permitted = true;
  private _supported = true;

  setPermitted(v: boolean): void {
    this._permitted = v;
  }
  setSupported(v: boolean): void {
    this._supported = v;
  }

  async show(title: string, body: string, options?: NotificationOptions): Promise<void> {
    this.sent.push({
      title,
      body,
      category: '',
      timestamp: new Date().toISOString(),
      options,
    });
  }

  async requestPermission(): Promise<boolean> {
    return this._permitted;
  }

  isSupported(): boolean {
    return this._supported;
  }
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

export type NotificationCategory = 'incomingMessages' | 'challenges' | 'fileOffers' | 'connectionChanges';

export interface NotificationPreferences {
  readonly enabled: boolean;
  readonly incomingMessages: boolean;
  readonly challenges: boolean;
  readonly fileOffers: boolean;
  readonly connectionChanges: boolean;
}

export interface NotificationServiceState {
  readonly preferences: NotificationPreferences;
  readonly permissionGranted: boolean;
  readonly supported: boolean;
  readonly history: readonly SentNotification[];
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  incomingMessages: true,
  challenges: true,
  fileOffers: true,
  connectionChanges: true,
};

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createNotificationService(adapter: NotificationAdapter): {
  store: Writable<NotificationServiceState>;
  notify(category: NotificationCategory, title: string, body: string): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  updatePreferences(updates: Partial<NotificationPreferences>): void;
  clearHistory(): void;
} {
  const store = writable<NotificationServiceState>({
    preferences: { ...DEFAULT_PREFERENCES },
    permissionGranted: false,
    supported: adapter.isSupported(),
    history: [],
  });

  async function notify(category: NotificationCategory, title: string, body: string): Promise<boolean> {
    const state = store.get();

    // Check master switch and category preference
    if (!state.preferences.enabled) return false;
    if (!state.preferences[category]) return false;
    if (!state.supported) return false;
    if (!state.permissionGranted) return false;

    try {
      await adapter.show(title, body);
      const entry: SentNotification = {
        title,
        body,
        category,
        timestamp: new Date().toISOString(),
      };
      store.update((s) => ({
        ...s,
        history: [entry, ...s.history].slice(0, 100), // Cap history at 100
      }));
      return true;
    } catch {
      return false;
    }
  }

  async function requestPermission(): Promise<boolean> {
    const granted = await adapter.requestPermission();
    store.update((s) => ({ ...s, permissionGranted: granted }));
    return granted;
  }

  function updatePreferences(updates: Partial<NotificationPreferences>): void {
    store.update((s) => ({
      ...s,
      preferences: { ...s.preferences, ...updates },
    }));
  }

  function clearHistory(): void {
    store.update((s) => ({ ...s, history: [] }));
  }

  return {
    store,
    notify,
    requestPermission,
    updatePreferences,
    clearHistory,
  };
}
