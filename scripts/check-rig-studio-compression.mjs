import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer, preview } from 'vite'
import { chromium } from 'playwright'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRDracoMeshCompression, KHRTextureBasisu, KHRTextureTransform } from '@gltf-transform/extensions'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'
import draco3d from 'draco3dgltf'

const server = await createServer({ server: { port: 4196, strictPort: true, open: false } })
await server.listen()
const production = await preview({ preview: { port: 4197, strictPort: true, open: false } })
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width: 800, height: 1280 }, hasTouch: true, acceptDownloads: true })
const page = await context.newPage(), probe = await context.newPage(), errors = [], external = [], reports = []
page.setDefaultTimeout(120000); probe.setDefaultTimeout(120000)
for (const tab of [page, probe]) {
  tab.on('pageerror', error => errors.push(error.message))
  await tab.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['localhost', '127.0.0.1'].includes(url.hostname) || ['blob:', 'data:'].includes(url.protocol)) return route.continue()
    external.push(url.href); return route.abort('internetdisconnected')
  })
}
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
  'draco3d.encoder': await draco3d.createEncoderModule(), 'draco3d.decoder': await draco3d.createDecoderModule()
})
const json = bytes => JSON.parse(Buffer.from(bytes).subarray(20, 20 + Buffer.from(bytes).readUInt32LE(12)).toString())
const compress = async (bytes, method, textureName) => {
  const doc = await io.readBinary(new Uint8Array(bytes))
  const texture = doc.createTexture('KTX2 ' + textureName).setMimeType('image/ktx2').setImage(new Uint8Array(await readFile('artifacts/' + textureName + '.ktx2')))
  doc.createExtension(KHRTextureBasisu).setRequired(true)
  const transform = doc.createExtension(KHRTextureTransform)
  for (const material of doc.getRoot().listMaterials()) {
    material.setBaseColorTexture(texture)
    material.getBaseColorTextureInfo().setExtension(KHRTextureTransform.EXTENSION_NAME,
      transform.createTransform().setOffset([.125,.25]).setScale([.75,.5]).setRotation(.17))
  }
  doc.createExtension(method === 'meshopt' ? EXTMeshoptCompression : KHRDracoMeshCompression).setRequired(true)
  const output = await io.writeBinary(doc)
  assert(json(output).extensionsRequired.includes('KHR_texture_basisu'))
  assert(json(output).extensionsRequired.includes(method === 'meshopt' ? 'EXT_meshopt_compression' : 'KHR_draco_mesh_compression'))
  return Buffer.from(output)
}
const pixels = async (source, output) => probe.evaluate(async ({ source, output }) => {
  const { check_texture_roundtrip } = await import('/test/BrowserCompressedAssetCheck.ts')
  return check_texture_roundtrip(source, output)
}, { source: Array.from(source), output: Array.from(output) })
const importMotion = async bytes => {
  await page.locator('#import-animations-input').setInputFiles({ name: 'Mixamo-meshopt-ktx2.glb', mimeType: 'model/gltf-binary', buffer: bytes })
  const modal = page.locator('.modal-dialog-overlay').last(); await modal.waitFor()
  const text = await modal.locator('.modal-dialog-body').textContent()
  assert(text.includes('Добавлено анимаций: 1') && !text.includes('Ошибки'), text)
  await modal.locator('.modal-dialog-close').click()
}
try {
  await mkdir('artifacts', { recursive: true })
  await probe.goto('http://localhost:4196/create.html')
  const fixture = await probe.evaluate(async () => (await import('/test/BrowserMixamoFixture.ts')).mixamo_import_fixture())
  const readyVariants = []
  for (const [method, image] of [['meshopt','2d_etc1s'], ['meshopt','2d_uastc'], ['draco','2d_uastc']]) {
    const original = await compress(fixture.model, method, image)
    readyVariants.push(original)
    await page.goto('http://localhost:4197/my-rigs/index.html')
    await page.locator('#model-file').setInputFiles({ name: method + '-' + image + '.glb', mimeType: 'model/gltf-binary', buffer: original })
    await page.waitForFunction(() => !document.getElementById('export').disabled && Number(document.getElementById('clip-count').textContent) === 1)
    await page.locator('#clips button').first().click()
    const download = page.waitForEvent('download'); await page.locator('#export').click()
    const name = 'artifacts/compression-ready-' + method + '-' + image + '.glb'
    await (await download).saveAs(name)
    const output = await readFile(name), doc = json(output)
    assert(doc.extensionsRequired.includes('KHR_texture_basisu'))
    assert(doc.extensionsRequired.includes(method === 'meshopt' ? 'EXT_meshopt_compression' : 'KHR_draco_mesh_compression'))
    assert.equal(doc.animations.length, 1)
    const check = await pixels(original, output)
    assert(check.sourceCompressed && check.outputCompressed)
    assert(check.maxPixelError <= 2, JSON.stringify(check))
    reports.push({ path: 'own-rig', method, image, ...check })
    await page.screenshot({ path: name.replace('.glb','.png') })
  }
  const original = await compress(await readFile('static/models/model-human.glb'), 'meshopt', '2d_etc1s')
  await page.goto('http://localhost:4197/create.html')
  await page.locator('#model-upload').setInputFiles({ name: 'human-meshopt-ktx2.glb', mimeType: 'model/gltf-binary', buffer: original })
  await page.locator('#skeleton-selection').selectOption('human')
  await page.locator('#load-skeleton-button').click(); await page.locator('#autorig-humanoid-button').click()
  await page.waitForFunction(() => document.getElementById('rig-setup-status').textContent.includes('Подгонка:'))
  await page.locator('#action_bind_pose').click(); await page.locator('#action_weights_to_animations').click()
  await page.waitForFunction(() => document.querySelectorAll('#animations-items .anim-play-button').length >= 178)
  await importMotion(readyVariants[0])
  await page.locator('#animation-filter').fill('Mixamo')
  await page.waitForFunction(() => document.querySelectorAll('#animations-items .anim-play-button').length === 1 && document.querySelector('#animations-items .anim-play-button')?.textContent.includes('Mixamo'))
  await page.locator('#animations-items .anim-play-button').first().click()
  await page.locator('#animations-items input[type="checkbox"]').first().check()
  const download = page.waitForEvent('download'); await page.locator('#export-button').click()
  const name = 'artifacts/compression-autorig-plain.glb'; await (await download).saveAs(name)
  const output = await readFile(name), doc = json(output)
  assert(!doc.extensionsRequired?.includes('KHR_texture_basisu'))
  assert(doc.images?.length && doc.images.every(image => image.mimeType === 'image/png' || image.mimeType === 'image/jpeg'))
  assert(doc.skins.length > 0 && doc.animations.length === 1, JSON.stringify({ skins: doc.skins?.length, animations: doc.animations?.map(a => a.name) }))
  assert(doc.animations[0].name.includes('Mixamo'))
  const check = await pixels(original, output)
  console.log('Ordinary GLB texture comparison:', JSON.stringify(check))
  assert(check.sourceCompressed && !check.outputCompressed)
  assert(check.maxPixelError <= 3 && check.meanPixelError <= 1, JSON.stringify(check))
  reports.push({ path: 'autorig-and-compressed-motion-to-plain-glb', ...check })
  await page.screenshot({ path: 'artifacts/compression-autorig.png' })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  await writeFile('artifacts/compression-results.json', JSON.stringify({ reports, errors, external }, null, 2))
  console.log('PASS offline Meshopt/Draco + KTX2 ETC1S/UASTC, ready rig preservation, autorig, compressed Mixamo import and PNG export', reports)
} finally {
  await page.screenshot({ path: 'artifacts/compression-last-state.png' }).catch(() => {})
  await browser.close(); await server.close(); await new Promise(resolve => production.httpServer.close(resolve))
}
