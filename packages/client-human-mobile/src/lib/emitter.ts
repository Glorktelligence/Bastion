// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Lightweight typed event emitter that works in both React Native and Node.js.
 * No dependency on node:events — compatible with all JavaScript runtimes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;

export class TypedEmitter<Events extends { [K in keyof Events]: unknown[] }> {
  private readonly listeners = new Map<keyof Events, Set<Listener>>();

  on<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener);
  }

  off<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): void {
    this.listeners.get(event)?.delete(fn as Listener);
  }

  once<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): void {
    const wrapper = ((...args: Events[K]) => {
      this.off(event, wrapper);
      fn(...args);
    }) as (...args: Events[K]) => void;
    this.on(event, wrapper);
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      fn(...args);
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
