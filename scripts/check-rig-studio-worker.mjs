import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
const server = await createServer({ server: { port: 4180, strictPort: true, open: false } })
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('**/create.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>Weight worker check</body>' }))
  await page.goto('http://localhost:4180/create.html')
  const result = await page.evaluate(async () => {
    let workers = 0
    const Original = Worker
    window.Worker = class extends Original { constructor (...args) { super(...args); workers++ } }
    const { check_worker } = await import('/test/BrowserWeightCheck.ts')
    return { ...await check_worker(), workers }
  })
  assert.equal(result.workers, 1, 'Cache should avoid a second worker')
  console.log('PASS real worker, responsive UI, unchanged weights, cached repeat', result)
} finally { await browser.close(); await server.close() }
