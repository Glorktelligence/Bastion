// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * API Key Manager — handles API key storage and rotation (spec §5).
 *
 * Rotation flow:
 *  1. Receive new key (from config_update message)
 *  2. Test with a validation function (e.g. test API call)
 *  3. If test passes → replace stored key, return success
 *  4. If test fails  → retain old key, return failure with reason
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of an API key rotation attempt. */
export interface KeyRotationResult {
  readonly success: boolean;
  readonly previousKeyCleared: boolean;
  readonly error?: string;
}

/** API key manager interface. */
export interface ApiKeyManager {
  readonly hasKey: boolean;
  getKey(): string | null;
  setKey(key: string): void;
  clearKey(): void;
  /**
   * Rotate the API key with test validation.
   *
   * @param newKey - The new API key to install
   * @param testFn - Async function that validates the key works (e.g. test API call)
   * @returns Result of the rotation attempt
   */
  rotateKey(newKey: string, testFn: (key: string) => Promise<boolean>): Promise<KeyRotationResult>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a new API key manager.
 *
 * @param initialKey - Optional initial API key
 */
export function createApiKeyManager(initialKey?: string): ApiKeyManager {
  let currentKey: string | null = initialKey ?? null;

  return {
    get hasKey(): boolean {
      return currentKey !== null;
    },

    getKey(): string | null {
      return currentKey;
    },

    setKey(key: string): void {
      currentKey = key;
    },

    clearKey(): void {
      currentKey = null;
    },

    async rotateKey(newKey: string, testFn: (key: string) => Promise<boolean>): Promise<KeyRotationResult> {
      try {
        const testPassed = await testFn(newKey);
        if (testPassed) {
          currentKey = newKey;
          return { success: true, previousKeyCleared: true };
        }
        return {
          success: false,
          previousKeyCleared: false,
          error: 'API key validation test failed',
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          previousKeyCleared: false,
          error: `Key rotation failed: ${message}`,
        };
      }
    },
  };
}
