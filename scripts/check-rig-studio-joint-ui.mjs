import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { preview } from 'vite'
import { chromium } from 'playwright'

const server = await preview({ preview: { port: 4190, strictPort: true, open: false } })
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 800, height: 1280 }, hasTouch: true })
page.setDefaultTimeout(90000)
const errors = [], failures = []
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => { if (response.status() >= 400) failures.push(response.url()) })
await page.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
  return route.abort('internetdisconnected')
})
const reports = []
try {
  await mkdir('artifacts', { recursive: true })
  await page.goto('http://localhost:4190/index.html')
  await page.locator('#load-model-button').click()
  await page.locator('#skeleton-selection').selectOption('human')
  await page.locator('#load-skeleton-button').click()
  await page.locator('#autorig-humanoid-button').click()
  await page.waitForFunction(() => document.getElementById('rig-setup-status')?.textContent.includes('Подгонка:'))
  await page.locator('#action_bind_pose').click()
  await page.locator('#manual-weight-focus').click()
  assert(await page.locator('#manual-weight-toolbar').isVisible())
  const weightToolbar = await page.locator('#manual-weight-toolbar').boundingBox()
  assert(weightToolbar && weightToolbar.y < 150)
  await page.locator('#manual-weight-focus-back').click()
  assert.equal(await page.locator('#manual-weight-toolbar').isVisible(), false)
  await page.locator('#action_weights_to_animations').click()
  await page.waitForFunction(() => document.querySelectorAll('#animations-items .anim-play-button').length >= 178)
  const clips = page.locator('#animations-items .anim-play-button')
  const labels = await clips.evaluateAll(items => items.map(b => b.getAttribute('aria-label') ?? ''))
  const melee = labels.findIndex(label => /melee hook/i.test(label))
  assert(melee >= 0)
  await clips.nth(melee).click()
  await page.locator('#play-pause-button').click()
  await page.locator('#animation-scrubber').evaluate(input => {
    input.value = String(Number(input.max) * .5)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  for (const viewport of [{ width: 800, height: 1280 }, { width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.locator('#props-toggle-button').click()
    await page.locator('#props-right-hand-trigger').click()
    const popup = page.locator('#props-right-hand-listbox')
    const bounds = await popup.boundingBox()
    assert(bounds && bounds.height <= Math.min(321, viewport.height * .4 + 1))
    assert(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1)
    assert(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1)
    assert(await popup.evaluate(element => element.scrollHeight > element.clientHeight))
    await popup.locator('[data-value="sword-a"]').click()
    await page.locator('#props-left-hand-trigger').click()
    await page.locator('#props-left-hand-listbox [data-value="shield-a"]').click()
    const layout = await page.evaluate(() => {
      const player = document.getElementById('animation-player').getBoundingClientRect()
      const panel = document.getElementById('tool-panel').getBoundingClientRect()
      const overlap = Math.max(0, Math.min(player.right, panel.right) - Math.max(player.left, panel.left)) *
        Math.max(0, Math.min(player.bottom, panel.bottom) - Math.max(player.top, panel.top))
      return { player: { top: player.top, bottom: player.bottom }, overlap,
        documentHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight }
    })
    assert(layout.player.top >= 0 && layout.player.bottom < viewport.height / 2)
    assert.equal(layout.overlap, 0)
    assert.equal(await page.locator('#manual-weight-toolbar').isVisible(), false)
    assert(layout.documentHeight <= layout.viewportHeight + 1)
    await page.screenshot({ path: 'artifacts/joint-ui-' + viewport.width + 'x' + viewport.height + '.png' })
    reports.push({ viewport, layout, picker: bounds })
    await page.locator('#props-close-button').click()
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(failures, [])
  await writeFile('artifacts/joint-ui-results.json', JSON.stringify({ reports, errors, failures }, null, 2))
  console.log('PASS production tablet player, bounded weapon picker, weapon selection and portrait/landscape layout', reports)
} finally {
  await page.screenshot({ path: 'artifacts/joint-ui-last-state.png' }).catch(() => {})
  await browser.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
