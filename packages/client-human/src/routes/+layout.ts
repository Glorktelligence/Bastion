// Copyright 2026 Glorktelligence — Harry Smith
// Licensed under the Apache License, Version 2.0
// See LICENSE file for full terms

/**
 * SPA-mode layout configuration.
 *
 * Disabling SSR ensures SvelteKit performs client-side navigation
 * for all route transitions. Without this, the dev server may
 * trigger full page loads on navigation, which causes the browser
 * to close the WebSocket (code 1001 — "Going Away") and forces a
 * full reconnect cycle.
 *
 * csr = true is the default but stated explicitly for clarity —
 * the app is a pure client-side SPA (Tauri WebView / browser).
 */
export const ssr = false;
export const csr = true;
