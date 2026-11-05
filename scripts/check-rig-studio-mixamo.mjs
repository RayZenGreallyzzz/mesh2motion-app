import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ server: { port: 4194, strictPort: true, open: false } })
await server.listen()
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width: 800, height: 1280 }, hasTouch: true, acceptDownloads: true })
const page = await context.newPage(), errors = [], external = [], reports = []
page.setDefaultTimeout(120000)
page.on('pageerror', error => errors.push(error.message))
await page.route('**/*', route => {
  const url = new URL(route.request().url())
  if (['localhost','127.0.0.1'].includes(url.hostname) || ['blob:','data:'].includes(url.protocol)) return route.continue()
  external.push(url.href); return route.abort('internetdisconnected')
})
await page.route('**/CustomModelUploadBootstrap.ts', async route => {
  const response = await route.fetch()
  await route.fulfill({ response, body: await response.text() + '\nwindow.rigEngine = app.mesh2motion_engine;\n' })
})
const importFile = async file => {
  await page.locator('#import-animations-input').setInputFiles(file)
  const modal = page.locator('.modal-dialog-overlay').last()
  await modal.waitFor()
  const text = await modal.locator('.modal-dialog-body').textContent()
  assert(!text.includes('Ошибки'), text)
  await modal.locator('.modal-dialog-close').click()
  return text
}
try {
  await mkdir('artifacts', { recursive: true })
  await page.goto('http://localhost:4194/create.html')
  const fixture = await page.evaluate(async () => (await import('/test/BrowserMixamoFixture.ts')).mixamo_import_fixture())
  const zip = { name: 'Mixamo-test.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.zip) }
  for (const profile of ['human','woman']) {
    await page.goto('http://localhost:4194/create.html')
    await page.locator('#load-model-button').click()
    await page.locator('#skeleton-selection').selectOption(profile)
    await page.locator('#load-skeleton-button').click()
    await page.waitForFunction(() => window.rigEngine.process_step === 'edit-skeleton' && !window.rigEngine.auto_fit_in_progress)
    await page.locator('#autorig-humanoid-button').click()
    await page.waitForFunction(() => !window.rigEngine.auto_fit_in_progress)
    await page.locator('#action_bind_pose').click()
    await page.locator('#action_weights_to_animations').click()
    await page.waitForFunction(() => window.rigEngine.animations_listing_step.animation_clips_loaded.length >= 178)
    const first = await importFile(zip)
    assert(first.includes('Добавлено анимаций: 2'), first)
    assert(first.includes('Уже импортировано файлов: 1'), first)
    const repeated = await importFile(zip)
    assert(repeated.includes('Добавлено анимаций: 0'), repeated)
    const state = await page.evaluate(() => {
      const engine = window.rigEngine, pairs = engine.animations_listing_step.animation_clips_loaded
      const imported = pairs.filter(p => p.metadata.tags.includes('mixamo'))
      const names = new Set(engine.weight_skin_step.skeleton().bones.map(b => b.name))
      for (const pair of imported) {
        if (pair.display_animation_clip.tracks.some(t => !names.has(t.name.slice(0,t.name.lastIndexOf('.'))))) throw new Error('Unmapped Mixamo track')
      }
      const index = pairs.findIndex(p => p.display_animation_clip.name === 'Mixamo_Attack_Test')
      engine.animations_listing_step.play_animation(index)
      return { imported: imported.length, count: pairs.length, selected: index }
    })
    assert.equal(state.imported, 2)
    const download = page.waitForEvent('download')
    const exported = await page.evaluate(async () => {
      const engine = window.rigEngine, pairs = engine.animations_listing_step.animation_clips_loaded
      const clip = pairs.find(p => p.display_animation_clip.name === 'Mixamo_Attack_Test').display_animation_clip
      const { check_export } = await import('/test/BrowserExportCheck.ts')
      return check_export(engine.file_export_step, engine.weight_skin_step.final_skinned_meshes(), clip, engine.download_settings)
    })
    await (await download).saveAs('artifacts/mixamo-' + profile + '.glb')
    assert.equal(exported.clips, 1)
    if (profile === 'human') {
      const text = await importFile({ name: 'Samba Dancing.fbx', mimeType: 'application/octet-stream', buffer: await readFile('artifacts/Samba Dancing.fbx') })
      assert(text.includes('Добавлено анимаций: 1'), text)
    }
    await page.screenshot({ path: 'artifacts/mixamo-' + profile + '.png' })
    reports.push({ profile, ...state, exported })
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  await writeFile('artifacts/mixamo-results.json', JSON.stringify({ reports, errors, external }, null, 2))
  console.log('PASS Mixamo ZIP import, duplicate filtering, Human/Woman playback and export, and native FBX import', reports)
} finally {
  await page.screenshot({ path: 'artifacts/mixamo-last-state.png' }).catch(() => {})
  await browser.close(); await server.close()
}
