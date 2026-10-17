import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'
const server = await createServer({ server: { port: 4183, strictPort: true, open: false } })
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  await mkdir('artifacts', { recursive: true })
  const html = (await readFile('src/create.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  for (const [width, height] of [[800, 1280], [360, 800], [1280, 800], [800, 360]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true })
    await page.route('**/create.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto('http://localhost:4183/create.html')
    await page.evaluate(async () => {
      const panel = document.getElementById('tool-panel')
      panel.innerHTML = document.getElementById('skinned-step-animation-export-options').outerHTML
      document.getElementById('skinned-step-animation-export-options').style.display = 'block'
      const { DOMUtilities } = await import('/lib/DOMUtilities.ts')
      DOMUtilities.populate_download_control(document.getElementById('download-control-mount'))
      DOMUtilities.populate_arm_extension_controls(document.getElementById('arm-extension-mount'))
      const { DownloadSettings } = await import('/lib/processes/export-to-file/DownloadSettings.ts')
      window.downloadSettings = new DownloadSettings()
      document.getElementById('animation-selection-count').textContent = '3'
      document.getElementById('export-button').onclick = () => { window.requestedExport = true }
    })
    await page.locator('#download-settings-toggle').click()
    const dialog = page.locator('#download-settings')
    assert(await dialog.evaluate(d => d.open))
    const bounds = await dialog.boundingBox()
    assert(bounds.x >= 15 && bounds.y >= 15 && bounds.x + bounds.width <= width - 15 && bounds.y + bounds.height <= height - 15)
    assert.equal(await dialog.evaluate(d => d.scrollWidth <= d.clientWidth), true, 'No horizontal clipping')
    await page.locator('#download-export-format-group label').filter({ hasText: 'FBX' }).click()
    assert.equal(await page.locator('#download-fbx-preset-section').isVisible(), true)
    await page.locator('#download-export-contents-group label').filter({ hasText: 'Skeleton only' }).click()
    assert.equal(await page.evaluate(() => window.downloadSettings.export_contents()), 'skeleton')
    await page.locator('#download-export-contents-group label').filter({ hasText: 'Model + animations' }).click()
    await page.locator('#download-export-format-group label').filter({ hasText: 'GLB' }).click()
    assert.equal(await page.locator('#download-fbx-preset-section').isVisible(), false)
    await page.screenshot({ path: `artifacts/menu-export-${width}x${height}.png` })
    await page.locator('#download-settings-close').click()
    assert.equal(await dialog.isVisible(), false)
    await page.locator('#download-settings-toggle').click()
    await page.keyboard.press('Escape')
    assert.equal(await dialog.isVisible(), false)
    await page.locator('#download-settings-toggle').click()
    await page.locator('#download-dialog-export').click()
    assert.equal(await page.evaluate(() => window.requestedExport), true)
    assert.equal(await dialog.isVisible(), false)
    console.log(`PASS export menu ${width}x${height}: no clipping, formats, contents, close, escape and export`)
    await page.close()
  }
} finally { await browser.close(); await server.close() }
