import {defineConfig} from 'vite'
export default defineConfig({build:{ssr:'scripts/check-chest-local.ts',outDir:'chest-tool',minify:false,rollupOptions:{output:{entryFileNames:'check.mjs'}}},ssr:{noExternal:true}})
