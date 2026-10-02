/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the parent can host the built bundle under any sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 6134, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
