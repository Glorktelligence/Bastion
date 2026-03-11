// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * React hook that bridges the store system to React state.
 * Subscribes to a Readable store and re-renders on change.
 */

import { useEffect, useState } from 'react';
import type { Readable } from '../lib/store';

/**
 * Subscribe to a store and return its current value.
 * Re-renders the component whenever the store value changes.
 */
export function useStore<T>(store: Readable<T>): T {
  const [value, setValue] = useState<T>(() => store.get());

  useEffect(() => {
    const unsub = store.subscribe(setValue);
    return unsub;
  }, [store]);

  return value;
}
