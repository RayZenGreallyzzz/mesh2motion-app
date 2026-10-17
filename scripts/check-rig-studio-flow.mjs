import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'
const server = await createServer({ server: { port: 4181, strictPort: true, open: false } })
await server.listen()
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  await mkdir('artifacts', { recursive: true })
  const page = await browser.newPage({ viewport: { width: 800, height: 1280 }, hasTouch: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/CustomModelUploadBootstrap.ts', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: await response.text() + '\nwindow.rigEngine = app.mesh2motion_engine;\n' })
  })
  await page.goto('http://localhost:4181/create.html')
  await page.waitForFunction(() => window.rigEngine)
  await page.evaluate(() => window.rigEngine.load_model_step.load_model_file('models/model-fox.glb', 'glb'))
  await page.waitForFunction(() => window.rigEngine.process_step === 'load-skeleton')
  await page.selectOption('#skeleton-selection', 'fox')
  await page.evaluate(() => window.rigEngine.load_skeleton_step.load_skeleton_file('rigs/rig-fox.glb'))
  await page.waitForFunction(() => window.rigEngine.process_step === 'edit-skeleton')
  await page.evaluate(() => window.rigEngine.auto_fit_humanoid_rig())
  await page.click('#action_bind_pose')
  await page.waitForFunction(() => window.rigEngine.process_step === 'weight-skin' && !window.rigEngine.weights_busy)
  const bind = await page.evaluate(() => window.rigEngine.weight_skin_step.bind_rest_diagnostic())
  assert.equal(bind.failedMeshes, 0)
  assert(bind.samples > 0)
  await page.check('#manual-weight-enabled')
  await page.waitForFunction(() => !window.rigEngine.weights_busy)
  assert(await page.evaluate(() => window.rigEngine.weight_skin_step.weight_painted_mesh_group().visible), 'Brush preview must be visible after async rebuild')
  await page.uncheck('#manual-weight-enabled')
  await page.click('#action_weights_to_animations')
  await page.waitForFunction(() => window.rigEngine.animations_listing_step.animation_clips_loaded.length >= 14)
  const result = await page.evaluate(async () => {
    const engine = window.rigEngine
    const clips = engine.animations_listing_step.animation_clips_loaded
    const run = clips.findIndex(c => /run/i.test(c.display_animation_clip.name))
    engine.animations_listing_step.play_animation(run)
    const { check_export } = await import('/test/BrowserExportCheck.ts')
    return await check_export(engine.file_export_step, engine.weight_skin_step.final_skinned_meshes(),
      clips[run].display_animation_clip, engine.download_settings)
  })
  assert(result.bytes > 1000 && result.clips === 1 && result.supports > 0 && result.skinned > 0)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: 'artifacts/flow-fox-run.png' })
  console.log('PASS complete model → animal AutoFit → worker weights → brush → animation → GLB re-import', result)
} finally { await browser.close(); await server.close() }
