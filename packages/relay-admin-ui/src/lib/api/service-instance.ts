// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * Shared DataService singleton for the admin UI.
 *
 * Uses same-origin /api paths (proxied by Vite in dev, or served directly
 * by the relay admin server in production). Credentials are configured
 * via environment variables or the login form.
 */

import { AdminApiClient } from './admin-client.js';
import { DataService } from './data-service.js';

// ---------------------------------------------------------------------------
// Shared instance
// ---------------------------------------------------------------------------

/**
 * Create a DataService using same-origin API paths.
 *
 * In development, Vite proxies /api/* to https://127.0.0.1:9444.
 * In production, the admin UI is served by the relay's admin server,
 * so /api/* resolves to the same host.
 *
 * Credentials default to env vars or empty strings (for unauthenticated
 * dev mode when the admin server is configured for it).
 */
export function createSharedService(credentials?: {
  username: string;
  password: string;
  totpCode: string;
}): DataService {
  const client = new AdminApiClient({
    baseUrl: '', // Same-origin — /api paths are relative
    credentials: credentials ?? {
      username: '',
      password: '',
      totpCode: '',
    },
  });

  return new DataService({ client });
}
