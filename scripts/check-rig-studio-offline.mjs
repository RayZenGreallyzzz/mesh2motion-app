import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { preview } from 'vite'
import { chromium } from 'playwright'

// Use the PRODUCTION files copied into the APK, in a fresh browser context.
const server = await preview({ preview: { port: 4189, strictPort: true, open: false } })
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 800, height: 1280 }, hasTouch: true, acceptDownloads: true })
const external = [], errors = [], failed = []
page.setDefaultTimeout(120000)
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => { if (response.status() >= 400) failed.push(response.url() + ': ' + response.status()) })
await page.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.origin === 'http://localhost:4189' || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
  external.push(url.origin + url.pathname)
  return route.abort('internetdisconnected')
})
try {
  await mkdir('artifacts', { recursive: true })
  await page.goto('http://localhost:4189/index.html')
  await page.locator('#load-model-button').click()
  await page.locator('#skeleton-selection').selectOption('human-mobile-female')
  await page.locator('#load-skeleton-button').click()
  await page.locator('#autorig-humanoid-button').click()
  await page.waitForFunction(() => document.getElementById('rig-setup-status')?.textContent.includes('Подгонка:'))
  await page.screenshot({ path: 'artifacts/offline-human-fit.png' })
  // A/T controls must also carry the finger chains and remain usable repeatedly.
  for (const pose of ['a', 't', 'a', 't']) await page.locator('#pose-preset-' + pose).click()
  await page.locator('#action_bind_pose').click()
  await page.waitForFunction(() => document.getElementById('action_weights_to_animations')?.getClientRects().length > 0 &&
    !document.getElementById('action_weights_to_animations')?.closest('[inert]'))
  await page.locator('#action_weights_to_animations').click()
  await page.waitForFunction(() => document.querySelectorAll('#animations-items .anim-play-button').length >= 178)
  // Names are accessible labels; play a fast clip, then return to the top for a
  // clean view. This also exercises the lazily-generated joint-support tracks.
  const buttons = page.locator('#animations-items .anim-play-button')
  const labels = await buttons.evaluateAll(items => items.map(b => b.getAttribute('aria-label')))
  const index = labels.findIndex(label => /run female|sprint/i.test(label ?? ''))
  assert(index >= 0, 'Bundled human library must include a fast animation')
  await buttons.nth(index).click()
  await page.locator('#animations-items input[type=checkbox]').nth(index).check()
  await page.locator('#animations-items').evaluate(el => { el.scrollTop = 0 })
  await page.screenshot({ path: 'artifacts/offline-human-run.png' })
  const event = page.waitForEvent('download')
  await page.locator('#export-button').click()
  const download = await event
  await download.saveAs('artifacts/offline-human.glb')
  const bytes = await readFile('artifacts/offline-human.glb')
  assert.equal(bytes.readUInt32LE(0), 0x46546c67)
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString())
  assert.equal(json.animations.length, 1)
  assert(json.skins.length > 0 && json.meshes.length > 0)
  assert(json.nodes.some(node => /volume|support/i.test(node.name ?? '')), 'Joint support bones must survive export')
  assert.deepEqual(external, [], 'No external resource requests, including fonts')
  assert.deepEqual(failed, [], 'All requested bundled assets must exist')
  assert.deepEqual(errors, [])
  const report = { clips: labels.length, bytes: bytes.length, animation: json.animations[0].name, external, failed, errors }
  await writeFile('artifacts/offline-results.json', JSON.stringify(report, null, 2))
  console.log('PASS fresh offline production load → Humanoid fitting → A/T → weights → fast motion → GLB', report)
} finally {
  await page.screenshot({ path: 'artifacts/offline-last-state.png' }).catch(() => {})
  await browser.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
