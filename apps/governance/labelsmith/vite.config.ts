import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' so the built bundle can be served from any sub-path (preview gallery, Vercel root).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 6141, strictPort: true },
  preview: { port: 6141, strictPort: true },
  // assetsInlineLimit 0: fonts must ship as files — the production CSP is font-src 'self' (no data:), so an inlined subset would be blocked.
  build: { target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
