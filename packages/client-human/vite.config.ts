import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  optimizeDeps: {
    // Pre-bundle libsodium so Vite resolves its internal ./libsodium-sumo.mjs
    // import correctly under PNPM's strict symlink layout.
    include: ['libsodium-wrappers-sumo'],
  },
});
