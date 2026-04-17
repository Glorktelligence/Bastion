import { readFileSync } from 'node:fs';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Read version at build time from the single source of truth (VERSION file).
// Cannot import @bastion/protocol — it pulls in node:crypto via hash.ts.
const version = (() => {
  try {
    return readFileSync('../../VERSION', 'utf-8').trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    __BASTION_VERSION__: JSON.stringify(version),
  },
  clearScreen: false,
});
