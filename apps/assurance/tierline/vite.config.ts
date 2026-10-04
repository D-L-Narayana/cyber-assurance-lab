import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built bundle can be served from any sub-path (preview gallery requirement).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 6122, strictPort: true, host: '127.0.0.1' },
  preview: { port: 6122, strictPort: true, host: '127.0.0.1' },
  // assetsInlineLimit 0: fonts must ship as files — the production CSP is font-src 'self' (no data:), so inlined subsets would be blocked.
  build: { target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['verbose'],
  },
});
