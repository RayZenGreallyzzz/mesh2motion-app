import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer, preview } from 'vite'

const server = await createServer({ server: { port: 4191, strictPort: true, open: false } })
await server.listen()
const production = await preview({ preview: { port: 4192, strictPort: true, open: false } })
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  await mkdir('artifacts', { recursive: true })
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true })
  const page = await context.newPage(), errors = [], external = []
  page.setDefaultTimeout(60000)
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['localhost', '127.0.0.1'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
    external.push(url.origin + url.pathname)
    return route.abort('internetdisconnected')
  })
  await page.goto('http://localhost:4191/my-rigs/index.html')
  const fixture = Buffer.from(await page.evaluate(async () => {
    const { own_rig_fixture } = await import('/test/OwnRigFixture.ts')
    return Array.from(new Uint8Array(await own_rig_fixture()))
  }))
  await writeFile('artifacts/own-rig-fixture.glb', fixture)
  await page.goto('http://localhost:4192/my-rigs/index.html')
  await page.locator('#model-file').setInputFiles({ name: 'Creature.glb', mimeType: 'model/gltf-binary', buffer: fixture })
  await page.waitForFunction(() => document.getElementById('clip-count').textContent === '2' && !document.getElementById('export').disabled)
  assert.match(await page.locator('#asset-stats').textContent(), /2 скел.*4 костей/)
  await page.locator('#clips button').first().click()
  await page.waitForFunction(() => parseFloat(document.getElementById('time').textContent) > 0.1)
  await page.locator('#save-library').click()
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Копия сохранена'))
  await page.screenshot({ path: 'artifacts/own-rigs-portrait.png', fullPage: true })
  await page.reload()
  await page.click('#library-tab')
  await page.locator('.library-card button').first().click()
  await page.waitForFunction(() => document.getElementById('clip-count').textContent === '2' && !document.getElementById('export').disabled)
  await page.locator('#motion-file').setInputFiles({ name: 'MoreMotions.glb', mimeType: 'model/gltf-binary', buffer: fixture })
  await page.waitForSelector('#mapping-dialog[open]')
  assert.equal(await page.locator('#apply-motion').isDisabled(), false)
  await page.screenshot({ path: 'artifacts/own-rigs-mapping.png', fullPage: true })
  await page.click('#apply-motion')
  await page.waitForFunction(() => document.getElementById('clip-count').textContent === '4')
  await page.locator('#clips button').last().click()
  const download = page.waitForEvent('download')
  await page.click('#export')
  await (await download).saveAs('artifacts/own-rigs-roundtrip.glb')
  const output = await readFile('artifacts/own-rigs-roundtrip.glb')
  const json = JSON.parse(output.subarray(20, 20 + output.readUInt32LE(12)).toString())
  assert.equal(json.skins.length, 2)
  assert.deepEqual(json.animations.map(clip => clip.channels.length), [4, 1, 4, 1])
  assert.deepEqual(new Set(json.animations[0].channels.map(channel => channel.target.path)), new Set(['rotation', 'translation', 'scale', 'weights']))
  await page.locator('#model-file').setInputFiles({ name: 'Roundtrip.glb', mimeType: 'model/gltf-binary', buffer: output })
  await page.waitForFunction(() => document.getElementById('asset-name').textContent === 'Roundtrip' && !document.getElementById('export').disabled)
  assert.equal(await page.locator('#clip-count').textContent(), '4')
  await page.locator('#model-file').setInputFiles({ name: 'Broken.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('broken') })
  await page.waitForSelector('#status.error')
  assert.equal(await page.locator('#asset-name').textContent(), 'Roundtrip')
  assert.equal(await page.locator('#clips button').count(), 4)
  await page.locator('#clips button').first().click()
  for (const viewport of [{ width: 412, height: 915 }, { width: 915, height: 412 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport)
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    const timeline = await page.locator('#timeline').boundingBox()
    assert(timeline.x >= 12 && timeline.x + timeline.width <= viewport.width - 12)
    await page.screenshot({ path: 'artifacts/own-rigs-' + viewport.width + '.png', fullPage: true })
  }
  assert.deepEqual(external, [])
  assert.deepEqual(errors, [])
  await writeFile('artifacts/own-rigs-results.json', JSON.stringify({
    skins: json.skins.length, clips: json.animations.length, offline: true,
    libraryReload: true, preservesPartialMorphTranslationScale: true, external, errors
  }, null, 2))
  console.log('PASS own rigs: offline production import → two skins → playback → library reload → add clips → GLB roundtrip')
} finally {
  await browser.close()
  await server.close()
  await new Promise(resolve => production.httpServer.close(resolve))
}
