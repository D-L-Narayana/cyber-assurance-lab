/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built bundle can be served from any sub-path (preview gallery or Vercel root).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 6101, strictPort: true, host: '127.0.0.1' },
  preview: { port: 6101, strictPort: true, host: '127.0.0.1' },
  // assetsInlineLimit 0: fonts must ship as files — the production CSP is font-src 'self' (no data:), so an inlined data: URL would be blocked.
  build: { target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
