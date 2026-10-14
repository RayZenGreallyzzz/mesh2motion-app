import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

// Exercise the real page/CSS and shared control without loading a character.
// Touch input goes through Chromium's native range control, not synthetic input events.
const server = await createServer({ server: { port: 4179, strictPort: true, open: false } })
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  await mkdir('artifacts', { recursive: true })
  const html = (await readFile('src/create.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  for (const [width, height] of [[533, 853], [800, 1280], [1280, 800], [360, 800]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    await page.route('**/create.html', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto('http://localhost:4179/create.html')
    await page.evaluate(async () => {
      const panel = document.getElementById('tool-panel')
      const listing = document.getElementById('skinned-step-animation-export-options')
      panel.innerHTML = listing.outerHTML
      document.getElementById('skinned-step-animation-export-options').style.display = 'block'
      const { DOMUtilities } = await import('/lib/DOMUtilities.ts')
      DOMUtilities.populate_arm_extension_controls(document.getElementById('arm-extension-mount'))
      document.querySelector('.arm-extension-heading label').textContent = 'Расширить / сузить руки'
      document.getElementById('animations-items').innerHTML = Array.from({ length: 16 }, (_, i) => `
        <div class="anim-item"><button class="anim-play-button"><div class="anim-preview-placeholder"></div></button>
        <label class="anim-row-checkbox"><input type="checkbox">Run ${i}</label></div>`).join('')
      const { ArmExtensionControl } = await import('/lib/processes/animations-listing/ArmExtensionControl.ts')
      ArmExtensionControl.getInstance().initialize(value => { window.testArmValue = value })
    })
    const slider = page.locator('#extend-arm-range-input')
    await slider.scrollIntoViewIfNeeded()
    const bounds = await slider.boundingBox()
    const panel = await page.locator('#tool-panel').boundingBox()
    await page.screenshot({ path: `artifacts/panel-${width}x${height}-before.png` })
    console.log('Panel bounds', width, height, JSON.stringify(await page.evaluate(() => {
      let element = document.getElementById('extend-arm-range-input')
      const result = []
      while (element !== null && element !== document.body) {
        const style = getComputedStyle(element)
        result.push({ id: element.id, bounds: element.getBoundingClientRect().toJSON(), width: style.width,
          minWidth: style.minWidth, display: style.display, flex: style.flex, padding: style.padding })
        element = element.parentElement
      }
      return result
    })))
    assert(bounds.x >= panel.x + 8, 'Slider starts outside the panel')
    assert(bounds.x + bounds.width <= panel.x + panel.width - 8, 'Slider is clipped by the panel')
    assert(panel.x + panel.width <= width - 23, 'Panel has no safe inset from the screen edge')
    const cdp = await context.newCDPSession(page)
    for (const target of [7, -50, 20, -120, 7]) {
      const current = Number(await slider.inputValue())
      const point = value => ({
        x: bounds.x + 8 + (bounds.width - 16) * (value + 120) / 140,
        y: bounds.y + bounds.height / 2
      })
      const start = point(current)
      const end = point(target)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] })
      for (let step = 1; step <= 8; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
          x: start.x + (end.x - start.x) * step / 8, y: start.y, id: 1
        }] })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      const actual = Number(await slider.inputValue())
      assert(Math.abs(actual - target) <= 2, `${width}x${height}: repeated touch drag to ${target} gave ${actual}`)
      assert.equal(Number(await page.locator('#extend-arm-numeric-input').inputValue()), actual)
      assert.equal(await page.evaluate(() => window.testArmValue), actual)
    }
    await page.screenshot({ path: `artifacts/panel-${width}x${height}.png` })
    console.log(`PASS ${width}x${height}: full slider visible; repeated touch drags through 7%, both extremes, and back`)
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}
