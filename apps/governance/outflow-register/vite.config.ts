import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' so the built bundle can be served from any sub-path (preview gallery, Vercel root).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 6144, strictPort: true },
  preview: { port: 6144, strictPort: true },
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
