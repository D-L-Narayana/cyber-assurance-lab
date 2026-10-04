/// <reference types="vitest/config" />
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built bundle works from any sub-path (portfolio gallery or a Vercel root).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 6114, strictPort: true },
  preview: { port: 6114, strictPort: true },
  // fonts must ship as files: the production CSP is font-src 'self' (no data:), so nothing may be inlined as a data: URL.
  build: { sourcemap: false, target: 'es2022', assetsInlineLimit: 0 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
