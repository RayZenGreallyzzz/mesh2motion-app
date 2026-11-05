import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer, preview } from 'vite'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Vector3 } from 'three'

const server = await createServer({ server: { port: 4194, strictPort: true, open: false } })
await server.listen()
const production = await preview({ preview: { port: 4195, strictPort: true, open: false } })
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
  const jointFixtures = await page.evaluate(async () => (await import('/test/BrowserMixamoFixture.ts')).joint_fit_import_fixtures())
  const zip = { name: 'Mixamo-test.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.zip) }
  for (const profile of ['human','woman']) {
    await page.goto('http://localhost:4195/create.html')
    await page.locator('#load-model-button').click()
    await page.locator('#skeleton-selection').selectOption(profile)
    await page.locator('#load-skeleton-button').click()
    await page.locator('#autorig-humanoid-button').click()
    await page.waitForFunction(() => document.getElementById('rig-setup-status')?.textContent.includes('Подгонка:'))
    await page.locator('#action_bind_pose').click()
    await page.locator('#action_weights_to_animations').click()
    await page.waitForFunction(() => document.querySelectorAll('#animations-items .anim-play-button').length >= 178)
    const first = await importFile(zip)
    assert(first.includes('Добавлено анимаций: 2'), first)
    assert(first.includes('Уже импортировано файлов: 1'), first)
    const repeated = await importFile(zip)
    assert(repeated.includes('Добавлено анимаций: 0'), repeated)
    await page.locator('#animation-filter').fill('Mixamo')
    await page.waitForFunction(() => document.querySelectorAll('#animations-items .anim-play-button').length === 2)
    const imported = await page.locator('#animations-items .anim-play-button').count()
    await page.locator('#animations-items .anim-play-button').first().click()
    await page.locator('#animations-items input[type="checkbox"]').first().check()
    const download = page.waitForEvent('download')
    await page.locator('#export-button').click()
    const output = 'artifacts/mixamo-' + profile + '.glb'
    await (await download).saveAs(output)
    const bytes = await readFile(output)
    assert.equal(bytes.readUInt32LE(0), 0x46546c67)
    const doc = JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString())
    assert.equal(doc.animations.length,1)
    assert(doc.skins.length > 0 && doc.meshes.length > 0)
    const exported = { clips: doc.animations.length, bytes: bytes.length }
    if (profile === 'human') {
      const text = await importFile({ name: 'Samba Dancing.fbx', mimeType: 'application/octet-stream', buffer: await readFile('artifacts/Samba Dancing.fbx') })
      assert(text.includes('Добавлено анимаций: 1'), text)
    }
    await page.screenshot({ path: 'artifacts/mixamo-' + profile + '.png' })
    reports.push({ profile, imported, exported })
  }
  for (const item of jointFixtures) {
    await page.goto('http://localhost:4195/create.html')
    await page.locator('#model-upload').setInputFiles({ name: 'proportions-' + item.profile + '.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(item.model) })
    await page.locator('#skeleton-selection').selectOption(item.profile)
    await page.locator('#load-skeleton-button').click()
    await page.locator('#autorig-humanoid-button').click()
    await page.waitForFunction(() => document.getElementById('rig-setup-status')?.textContent.includes('Подгонка:'))
    await page.screenshot({ path: 'artifacts/joint-fit-' + item.profile + '-setup.png' })
    await page.locator('#action_bind_pose').click()
    await page.locator('#action_weights_to_animations').click()
    await page.waitForFunction(() => document.querySelectorAll('#animations-items .anim-play-button').length >= 178)
    await importFile(zip)
    await page.locator('#animation-filter').fill('Mixamo')
    await page.locator('#animations-items .anim-play-button').first().click()
    await page.locator('#animations-items input[type="checkbox"]').first().check()
    const download = page.waitForEvent('download')
    await page.locator('#export-button').click()
    const output = 'artifacts/joint-fit-' + item.profile + '.glb'
    await (await download).saveAs(output)
    const bytes = await readFile(output)
    const glb = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '')
    let skeleton
    glb.scene.traverse(o => { if (o.isSkinnedMesh && !skeleton) skeleton = o.skeleton })
    assert(skeleton)
    const errors = []
    for (const [side, sign] of [['l',1],['r',-1]]) {
      for (const [name, expected] of [
        ['calf_' + side, new Vector3(sign * .19, item.knee, 0)],
        ['lowerarm_' + side, new Vector3(sign * item.elbow, 1.51, 0)]
      ]) {
        if (item.pose === 'A' && name.startsWith('lowerarm')) {
          const shoulder = new Vector3(sign * .23, 1.51, 0)
          expected.sub(shoulder).applyAxisAngle(new Vector3(0,0,1), -sign * .45).add(shoulder)
        }
        const index = skeleton.bones.findIndex(b => b.name === name)
        assert(index >= 0, name)
        const bindPosition = new Vector3().setFromMatrixPosition(skeleton.boneInverses[index].clone().invert())
        const distance = bindPosition.distanceTo(expected)
        assert(distance < .03, item.profile + ' ' + name + ': ' + distance)
        errors.push({ name, error: distance })
      }
    }
    await page.screenshot({ path: 'artifacts/joint-fit-' + item.profile + '-animation.png' })
    reports.push({ profile: item.profile, customProportions: true, errors })
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  await writeFile('artifacts/mixamo-results.json', JSON.stringify({ reports, errors, external }, null, 2))
  console.log('PASS Mixamo ZIP import, duplicate filtering, Human/Woman playback and export, and native FBX import', reports)
} finally {
  await page.screenshot({ path: 'artifacts/mixamo-last-state.png' }).catch(() => {})
  await browser.close(); await server.close(); await new Promise(resolve => production.httpServer.close(resolve))
}
