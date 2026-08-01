import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist-ui', emptyOutDir: true },
  test: { include: ['src/**/*.test.ts'] }
});
