import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'

// Visual review artifacts from the actual built launch page.
const server = await preview({ preview: { port: 4181, strictPort: true, open: false } })
const browser = await chromium.launch({ headless: true })
const origin = 'http://localhost:4181'
try {
  await mkdir('artifacts', { recursive: true })
  for (const [width, height] of [[360, 800], [800, 1280], [1280, 800], [800, 360]]) {
    // Disable JS only for still renders; navigation is checked separately below.
    const context = await browser.newContext({ viewport: { width, height }, javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto(origin, { waitUntil: 'networkidle' })
    await page.screenshot({ path: `artifacts/branding-splash-${width}x${height}.png` })
    await context.close()
  }
  const page = await browser.newPage({ viewport: { width: 900, height: 400 } })
  await page.goto(origin)
  await page.waitForURL('**/create.html', { timeout: 6000 })
  await page.locator('.ras-brand-mark').evaluate(image => image.decode())
  console.log('Branding: automatic launch reached editor and portrait decoded')
  await page.setContent(`<html><head><base href="${origin}/"><style>
    *{box-sizing:border-box}body{margin:0;background:#18191e;color:#fff2dc;font:18px system-ui}
    main{display:flex;align-items:center;justify-content:center;gap:80px;height:400px}
    section{text-align:center}h2{font-size:16px;font-weight:500;color:#ccb99d;margin:20px 0}
    .icon{width:144px;height:144px;background:#111216;display:grid;place-items:center;overflow:hidden}
    .icon img{width:128px;height:128px;object-fit:contain}.round{border-radius:50%}.square{border-radius:32px}
    .small{width:48px;height:48px;border-radius:12px;margin:auto}.small img{width:42px;height:42px}
  </style></head><body><main>
    <section><div class="icon round"><img src="images/branding/hedgehog-icon.png"></div><h2>Круглая иконка</h2></section>
    <section><div class="icon square"><img src="images/branding/hedgehog-icon.png"></div><h2>Квадратная иконка</h2></section>
    <section><div class="icon small"><img src="images/branding/hedgehog-icon.png"></div><h2>48 × 48</h2></section>
  </main></body></html>`)
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())))
  await page.screenshot({ path: 'artifacts/branding-icon-preview.png' })
} finally {
  await browser.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
