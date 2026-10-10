import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // The domain model lives in the backend and is shared with the dashboard.
      '@domain': fileURLToPath(new URL('../backend/src/types.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // In development the browser talks to the API through this proxy (no CORS, no env needed).
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
