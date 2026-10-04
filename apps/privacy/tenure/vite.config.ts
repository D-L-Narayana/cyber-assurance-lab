/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built bundle can be served from any sub-path (preview gallery or Vercel root).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 6102, strictPort: true, host: '127.0.0.1' },
  preview: { port: 6102, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // jsdom + Testing Library user-event flows take ~2–5 s each on a loaded host; the default 5 s budget produced a
    // spurious timeout (see qa/baseline-rerun.txt). Assertions are unchanged; only the budget is wider.
    testTimeout: 20_000,
  },
});
