import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { copyFileSync, cpSync } from 'node:fs'
import './scripts/prepare-offline-codecs.mjs'

export default defineConfig({
  root: 'src',
  base: './',
  publicDir: false,
  plugins: [{
    name: 'wardrobe-offline-assets',
    closeBundle () {
      copyFileSync('static/animations/human-base-animations.glb', 'wardrobe-dist/demo.glb')
      for (const codec of ['basis', 'draco']) cpSync('static/' + codec, 'wardrobe-dist/' + codec, { recursive: true })
    }
  }],
  build: {
    outDir: '../wardrobe-dist',
    emptyOutDir: true,
    rollupOptions: { input: resolve('src/wardrobe/index.html') }
  },
  server: { host: '127.0.0.1', fs: { allow: ['.'] } }
})
