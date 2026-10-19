import { defineConfig } from 'vite';

export default defineConfig({
  root: 'converter',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 1700,
  },
});
