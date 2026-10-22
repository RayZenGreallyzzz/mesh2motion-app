import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ server: { host: '127.0.0.1', port: 4193, strictPort: true, open: false } })
await server.listen()
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.RIG_CHROMIUM_EXECUTABLE || undefined,
  args: process.env.RIG_CHROMIUM_ARGS ? JSON.parse(process.env.RIG_CHROMIUM_ARGS) : ['--enable-unsafe-swiftshader']
})
try {
  await mkdir('artifacts', { recursive: true })
  const page = await browser.newPage({ viewport: { width: 800, height: 1280 }, hasTouch: true })
  page.setDefaultTimeout(120000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/CustomModelUploadBootstrap.ts', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: await response.text() + '\nwindow.rigEngine = app.mesh2motion_engine;\n' })
  })
  const results = []
  const cases = [{ name: 'Quantized.glb' }]
  if (process.env.RIG_PRIVATE_MODELS_DIR) {
    for (const name of (await readdir(process.env.RIG_PRIVATE_MODELS_DIR)).sort((a,b) => a.length-b.length || a.localeCompare(b))) {
      if (name.endsWith('.glb')) cases.push({ name, path: process.env.RIG_PRIVATE_MODELS_DIR + '/' + name })
    }
  }
  for (const [index, entry] of cases.entries()) {
    console.log('CHECK quantized import', entry.name)
    await page.goto('http://127.0.0.1:4193/create.html')
    await page.waitForFunction(() => window.rigEngine)
    if (entry.path) {
      await page.locator('#model-upload').setInputFiles(entry.path)
    } else {
      const fixture = Buffer.from(await page.evaluate(async () => {
        const { quantized_import_fixture } = await import('/test/QuantizedImportFixture.ts')
        return Array.from(new Uint8Array(quantized_import_fixture()))
      }))
      await writeFile('artifacts/quantized-import-fixture.glb', fixture)
      await page.locator('#model-upload').setInputFiles({ name: entry.name, mimeType: 'model/gltf-binary', buffer: fixture })
    }
    await page.waitForFunction(() => window.rigEngine.process_step === 'load-skeleton')
    const bounds = await page.evaluate(async () => {
      const { Box3, Vector3 } = await import('/test/QuantizedImportFixture.ts')
      const e = window.rigEngine, model = e.load_model_step.model_meshes()
      const box = new Box3().setFromObject(model)
      const meshes = []
      model.traverse(o => { if (o.isMesh) meshes.push({
        position: o.geometry.getAttribute('position').array.constructor.name,
        vertices: o.geometry.getAttribute('position').count
      }) })
      // Keep the saved pose and camera stable between the two screenshots.
      e.scene_environment.set_turntable_speed(0)
      e.camera_shake.update(100)
      return { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new Vector3()).toArray(), meshes }
    })
    assert(bounds.size.every(value => Number.isFinite(value) && value > 0.01), 'Model must retain its 3D extent: ' + entry.name)
    assert(bounds.meshes.every(mesh => mesh.position === 'Float32Array'))
    // Compare actual composited pixels with and without the model. Merely having
    // geometry in the scene or a non-empty canvas did not catch the old regression.
    await page.waitForTimeout(300)
    const visible = await page.screenshot()
    await page.evaluate(() => { window.rigEngine.load_model_step.model_meshes().visible = false })
    await page.waitForTimeout(150)
    const hidden = await page.screenshot()
    await page.evaluate(() => { window.rigEngine.load_model_step.model_meshes().visible = true })
    const changed = await page.evaluate(async ({a,b}) => {
      const decode = async value => {
        const blob = await (await fetch('data:image/png;base64,' + value)).blob()
        const bitmap = await createImageBitmap(blob)
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')
        context.drawImage(bitmap, 0, 0)
        const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data
        bitmap.close()
        return data
      }
      const first = await decode(a), second = await decode(b)
      let count = 0
      for (let i = 0; i < first.length; i += 4) {
        if (Math.abs(first[i]-second[i])+Math.abs(first[i+1]-second[i+1])+Math.abs(first[i+2]-second[i+2]) > 15) count++
      }
      return count
    }, {a:visible.toString('base64'),b:hidden.toString('base64')})
    assert(changed > 150, 'Model must be visibly rendered, not hidden by layout or collapsed: ' + entry.name + ' pixels=' + changed)
    // Private reference screenshots are never matched by the public CI artifact glob.
    await writeFile('artifacts/' + (entry.path ? 'private-import-' : 'quantized-import-') + index + '.png', visible)
    results.push({ name: entry.name, ...bounds, changedPixels: changed })
    console.log('PASS visible quantized import', JSON.stringify(results.at(-1)))
  }
  assert.deepEqual(errors, [])
  await writeFile('artifacts/' + (process.env.RIG_PRIVATE_MODELS_DIR ? 'private-import-results' : 'quantized-import-results') + '.json', JSON.stringify({results,errors},null,2))
} finally { await browser.close(); await server.close() }
