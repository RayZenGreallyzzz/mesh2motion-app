import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'
const server = await createServer({ server: { port: 4187, strictPort: true, open: false } })
await server.listen()
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  await mkdir('artifacts', { recursive: true })
  const page = await browser.newPage({ viewport: { width: 800, height: 1280 }, hasTouch: true })
  const errors = [], external = []
  page.setDefaultTimeout(60000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['localhost', '127.0.0.1'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
    external.push(url.origin + url.pathname); return route.abort('internetdisconnected')
  })
  await page.route('**/CustomModelUploadBootstrap.ts', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: await response.text() + '\nwindow.rigEngine = app.mesh2motion_engine;\n' })
  })
  await page.goto('http://localhost:4187/create.html')
  await page.waitForFunction(() => window.rigEngine)
  await page.evaluate(async () => {
    const { creature_fixture_url } = await import('/test/BrowserCreatureFixture.ts')
    const url = await creature_fixture_url()
    window.creatureFixtureUrl = url
    await window.rigEngine.load_model_step.load_model_file(url, 'glb')
  })
  await page.waitForFunction(() => window.rigEngine.process_step === 'load-skeleton')
  await page.selectOption('#skeleton-selection', 'dragon')
  await page.evaluate(() => window.rigEngine.load_skeleton_step.load_skeleton_file('rigs/rig-dragon.glb'))
  await page.waitForFunction(() => window.rigEngine.process_step === 'edit-skeleton')
  assert(await page.locator('#creature-fit-options').isVisible())
  await page.selectOption('#creature-fit-mode', 'upright-winged')
  await page.click('#autorig-humanoid-button')
  await page.waitForFunction(() => !window.rigEngine.auto_fit_in_progress)
  assert.match(await page.locator('#rig-setup-status').textContent(), /двуногий/)
  await page.screenshot({ path: 'artifacts/creature-fitted.png' })
  await page.click('#action_bind_pose')
  await page.waitForFunction(() => window.rigEngine.process_step === 'weight-skin' && !window.rigEngine.weights_busy)
  const bind = await page.evaluate(() => window.rigEngine.weight_skin_step.bind_rest_diagnostic())
  assert.equal(bind.failedMeshes, 0)
  await page.click('#action_weights_to_animations')
  await page.waitForFunction(() => window.rigEngine.animations_listing_step.animation_clips_loaded.length === 5)
  const names = await page.evaluate(() => window.rigEngine.animations_listing_step.animation_clips_loaded.map(p => p.display_animation_clip.name))
  assert(names.includes('Creature_Walk') && names.includes('Creature_Fly_Flap'))
  const download_event = page.waitForEvent('download')
  const exported = await page.evaluate(async () => {
    const e = window.rigEngine
    const pairs = e.animations_listing_step.animation_clips_loaded
    const index = pairs.findIndex(p => p.display_animation_clip.name === 'Creature_Fly_Flap')
    e.animations_listing_step.play_animation(index)
    const { check_export } = await import('/test/BrowserExportCheck.ts')
    return await check_export(e.file_export_step, e.weight_skin_step.final_skinned_meshes(), pairs[index].display_animation_clip, e.download_settings)
  })
  await (await download_event).saveAs('artifacts/creature-export.glb')
  const file = await readFile('artifacts/creature-export.glb')
  assert.equal(file.readUInt32LE(0), 0x46546c67)
  assert.equal(exported.clips, 1); assert(exported.skinned > 0 && exported.tracks > 90)
  await page.screenshot({ path: 'artifacts/creature-motion.png' })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  await writeFile('artifacts/creature-results.json', JSON.stringify({ bind, names, exported, external, errors }, null, 2))
  console.log('PASS creature → volume fit → weights → offline motions → GLB re-import', { bind, names, exported })
} finally { await browser.close(); await server.close() }
