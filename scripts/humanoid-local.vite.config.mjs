import {defineConfig} from 'vite'
export default defineConfig({build:{ssr:'scripts/check-humanoid65-local.ts',outDir:'humanoid-check',minify:false,rollupOptions:{output:{entryFileNames:'check.mjs'}}},ssr:{noExternal:true}})
