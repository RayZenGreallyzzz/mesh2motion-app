import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'scripts/pose-check.ts', outDir: 'pose-tool', minify: false, rollupOptions: { output: { entryFileNames: 'pose-check.mjs' } } }, ssr: { noExternal: true } })
