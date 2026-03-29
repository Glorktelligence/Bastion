// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * AI Disclosure store — holds relay-configured transparency banner config.
 *
 * The banner is relay-generated (not AI-generated) to support deployer
 * compliance with AI transparency regulations (EU AI Act Article 50, etc.).
 * Default is OFF — nothing renders unless the deployer configures it.
 *
 * Dismissal state uses localStorage so it persists within a browser session
 * but resets on next visit (per-session, not permanent).
 */

import type { Writable } from '../store.js';
import { writable } from '../store.js';

export interface AiDisclosureState {
  /** Disclosure config from the relay. Null = not configured (default). */
  readonly disclosure: AiDisclosureData | null;
  /** Whether the user has dismissed the banner this session. */
  readonly dismissed: boolean;
}

export interface AiDisclosureData {
  readonly text: string;
  readonly style: 'info' | 'legal' | 'warning';
  readonly position: 'banner' | 'footer';
  readonly dismissible: boolean;
  readonly link?: string;
  readonly linkText?: string;
  readonly jurisdiction?: string;
}

const DISMISS_KEY = 'bastion_disclosure_dismissed';

export interface AiDisclosureStore {
  readonly store: Writable<AiDisclosureState>;
  setDisclosure(data: AiDisclosureData): void;
  dismiss(): void;
  clear(): void;
}

export function createAiDisclosureStore(): AiDisclosureStore {
  const dismissed =
    typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage.getItem(DISMISS_KEY) === 'true' : false;

  const store = writable<AiDisclosureState>({ disclosure: null, dismissed });

  return {
    store,
    setDisclosure(data: AiDisclosureData): void {
      store.update((s) => ({ ...s, disclosure: data }));
    },
    dismiss(): void {
      try {
        globalThis.localStorage?.setItem(DISMISS_KEY, 'true');
      } catch {
        // localStorage unavailable
      }
      store.update((s) => ({ ...s, dismissed: true }));
    },
    clear(): void {
      try {
        globalThis.localStorage?.removeItem(DISMISS_KEY);
      } catch {
        // localStorage unavailable
      }
      store.set({ disclosure: null, dismissed: false });
    },
  };
}
