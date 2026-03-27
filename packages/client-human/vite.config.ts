import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  resolve: {
    alias: {
      // Force Vite to use the CJS builds of libsodium which don't have
      // broken relative ESM imports under PNPM's strict symlink layout.
      // The CJS UMD wrapper works correctly with Vite's esbuild bundler.
      'libsodium-wrappers-sumo': 'libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js',
      'libsodium-sumo': 'libsodium-sumo/dist/modules-sumo/libsodium-sumo.js',
    },
  },
  optimizeDeps: {
    include: ['libsodium-wrappers-sumo', 'libsodium-sumo'],
  },
});
