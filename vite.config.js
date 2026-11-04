import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: 'src',
  base: './',
  publicDir: resolve('static'),
  define: {
    'PROCESS_ENV.WORKERS_CI_COMMIT_SHA': JSON.stringify(process.env.GITHUB_SHA ?? 'local'),
    'PROCESS_ENV.WORKERS_CI_BRANCH': JSON.stringify(process.env.GITHUB_REF_NAME ?? 'local')
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve('src/index.html'),
        my_rigs: resolve('src/my-rigs/index.html'),
        create: resolve('src/create.html')
      }
    }
  },
  server: { host: '127.0.0.1' }
})
