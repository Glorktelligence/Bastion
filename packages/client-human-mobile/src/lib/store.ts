// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Store primitives compatible with React (via useStore hook) and Node.js.
 * Implements subscribe/get contract for reactive state management.
 */

/** A readable store. */
export interface Readable<T> {
  /** Subscribe to value changes. Returns an unsubscribe function. */
  subscribe(fn: (value: T) => void): () => void;
  /** Get the current value synchronously. */
  get(): T;
}

/** A writable store. */
export interface Writable<T> extends Readable<T> {
  /** Set a new value, notifying all subscribers. */
  set(value: T): void;
  /** Update the value using a function, notifying all subscribers. */
  update(fn: (value: T) => T): void;
}

/**
 * Create a writable store with an initial value.
 */
export function writable<T>(initial: T): Writable<T> {
  let value = initial;
  const subscribers = new Set<(value: T) => void>();

  function set(newValue: T): void {
    value = newValue;
    for (const fn of subscribers) {
      fn(value);
    }
  }

  return {
    subscribe(fn: (value: T) => void): () => void {
      subscribers.add(fn);
      fn(value); // Call immediately with current value
      return () => {
        subscribers.delete(fn);
      };
    },
    get(): T {
      return value;
    },
    set,
    update(fn: (value: T) => T): void {
      set(fn(value));
    },
  };
}

/**
 * Create a derived store that recomputes when any source store changes.
 */
export function derived<T, S extends Readable<unknown>[]>(
  stores: [...S],
  fn: (values: { [K in keyof S]: S[K] extends Readable<infer U> ? U : never }) => T,
): Readable<T> {
  const getValues = () => stores.map((s) => s.get()) as { [K in keyof S]: S[K] extends Readable<infer U> ? U : never };

  const derivedStore = writable(fn(getValues()));

  // Track unsubscribers so we can clean up when all downstream subscribers leave
  let upstreamUnsubs: (() => void)[] = [];
  let subscriberCount = 0;

  function startListening(): void {
    upstreamUnsubs = stores.map((s) =>
      s.subscribe(() => {
        derivedStore.set(fn(getValues()));
      }),
    );
  }

  function stopListening(): void {
    for (const unsub of upstreamUnsubs) {
      unsub();
    }
    upstreamUnsubs = [];
  }

  return {
    subscribe(callback: (value: T) => void): () => void {
      if (subscriberCount === 0) {
        startListening();
      }
      subscriberCount++;

      const unsub = derivedStore.subscribe(callback);
      return () => {
        unsub();
        subscriberCount--;
        if (subscriberCount === 0) {
          stopListening();
        }
      };
    },
    get(): T {
      // When no subscribers, derived is lazy — recompute fresh
      if (subscriberCount === 0) {
        return fn(getValues());
      }
      return derivedStore.get();
    },
  };
}
