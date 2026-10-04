/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the parent can host the built bundle under any sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 6130, strictPort: true, host: '127.0.0.1' },
  // assetsInlineLimit 0: fonts must ship as files — the production CSP is font-src 'self' (no data:), so an inlined woff2 subset would be blocked.
  build: { target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
