import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  clearScreen: false,
  server: {
    port: 9445,
    strictPort: true,
    proxy: {
      // Proxy /api requests to the admin HTTPS server, bypassing browser cert rejection
      '/api': {
        target: 'https://127.0.0.1:9444',
        changeOrigin: true,
        secure: false, // Accept self-signed certs
      },
    },
  },
});
