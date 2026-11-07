import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

// A small independently generated skinned GLB is the bridge's mock output.
// This proves the UI/transport path; it does not execute the ARM64 engine.
function outputGlb() {
  const chunks = [], views = [], accessors = []; let offset = 0
  function accessor(values, componentType, type, count, extra = {}) {
    const array = componentType === 5123 ? new Uint16Array(values) : new Float32Array(values), raw = Buffer.from(array.buffer)
    const index = views.length; views.push({ buffer: 0, byteOffset: offset, byteLength: raw.length }); chunks.push(raw); offset += raw.length
    if (offset % 4) { const padding = Buffer.alloc(4 - offset % 4); chunks.push(padding); offset += padding.length }
    accessors.push({ bufferView: index, componentType, type, count, ...extra }); return accessors.length - 1
  }
  const position = accessor([-0.3, 0, 0, 0.3, 0, 0, 0, 1, 0], 5126, 'VEC3', 3, { min: [-0.3, 0, 0], max: [0.3, 1, 0] })
  const joints = accessor([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 5123, 'VEC4', 3)
  const weights = accessor([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 5126, 'VEC4', 3)
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], inverse = identity.slice(); inverse[13] = -0.5
  const matrices = accessor([...identity, ...inverse], 5126, 'MAT4', 2)
  const times = accessor([0, 1], 5126, 'SCALAR', 2, { min: [0], max: [1] }), rotations = accessor([0, 0, 0, 1, 0, 0, Math.sin(0.2), Math.cos(0.2)], 5126, 'VEC4', 2)
  const doc = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 2] }], nodes: [{ name: 'root', children: [1] }, { name: 'pelvis', translation: [0, 0.5, 0] }, { name: 'native-mesh', mesh: 0, skin: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: position, JOINTS_0: joints, WEIGHTS_0: weights }, material: 0 }] }], materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.55, 0.25, 1] } }], skins: [{ joints: [0, 1], inverseBindMatrices: matrices }], animations: [{ name: 'Native bridge test motion', samplers: [{ input: times, output: rotations }], channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }] }], accessors, bufferViews: views, buffers: [{ byteLength: offset }] }
  let json = Buffer.from(JSON.stringify(doc)); json = Buffer.concat([json, Buffer.alloc((-json.length) & 3, 32)]); const bin = Buffer.concat(chunks), header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8)
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + bin.length, 8); header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16); binaryHeader.writeUInt32LE(bin.length, 0); binaryHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, json, binaryHeader, bin]).toString('base64')
}
const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4181'], { stdio: ['ignore', 'pipe', 'pipe'] })
await mkdir('artifacts', { recursive: true })
let browser, page
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch('http://127.0.0.1:4181/my-rigs/index.html')).ok) break } catch {}; await new Promise(r => setTimeout(r, 100)) }
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 })
  const errors = []; page.on('pageerror', error => errors.push(String(error)))
  await page.addInitScript(({ output }) => {
    window.__nativeCalls = []; window.__nativeFail = false
    const methods = ['capabilities', 'begin', 'append', 'prepare', 'run', 'read', 'discard', 'cancel', 'addListener', 'removeListener']
    const pending = new Map(); let callback = 0
    window.Capacitor = {
      PluginHeaders: [{ name: 'RigNativeEngine', methods: methods.map(name => ({ name, rtype: name === 'addListener' ? 'callback' : 'promise' })) }],
      nativePromise(pluginId, methodName, options) { return new Promise(resolve => { const callbackId = String(++callback); pending.set(callbackId, resolve); window.androidBridge.postMessage(JSON.stringify({ pluginId, methodName, options, callbackId })) }) },
      nativeCallback(pluginId, methodName, options, handler) { const callbackId = String(++callback); if (handler) pending.set(callbackId, handler); window.androidBridge.postMessage(JSON.stringify({ pluginId, methodName, options, callbackId })); return callbackId },
      fromNative(result) { pending.get(result.callbackId)?.(result.data); pending.delete(result.callbackId) }
    }
    let id = 0
    window.androidBridge = { postMessage(text) {
      const request = JSON.parse(text); if (request.type === 'js.error') return
      const { pluginId, methodName, options = {}, callbackId } = request
      if (pluginId !== 'RigNativeEngine' || methodName === 'addListener') return
      let data = {}
      if (methodName === 'capabilities') data = { available: true }
      if (methodName === 'begin') data = { project: 'mock-' + (++id) }
      if (methodName === 'prepare') data = { receipt: { command: 'PREPARE', status: 'DONE', preparation: { testAdapter: true } } }
      if (methodName === 'run') {
        window.__nativeCalls.push(options.command)
        let stats = {}
        if (options.command === 'INITIAL_BODY_GUIDES') stats = { points: { pelvis: [0, 0.9, 0], thorax: [0, 1.35, 0], neck: [0, 1.6, 0] } }
        if (options.command === 'PROPOSE_BODY') stats = { landmarks: { pelvis: [0, 0.9, 0], chest: [0, 1.35, 0], neck: [0, 1.6, 0], head: [0, 1.8, 0], elbow_l: [-0.5, 1.4, 0], elbow_r: [0.5, 1.4, 0] } }
        const nativeReport = { status: 'DONE', stats: { vertices: 1000, meshes: 1 }, bodyPreview: stats }
        if (options.command === 'PREVIEW_BODY') nativeReport.bodyPreview = { bones: [{ name: 'pelvis', parent: -1, rigPosition: [0, 0.9, 0] }, { name: 'neck', parent: 0, rigPosition: [0, 1.6, 0] }] }
        if (options.command === 'COMPUTE_WEIGHTS' && window.__nativeFail) { nativeReport.status = 'FAILED'; nativeReport.errorCode = 'TEST_WEIGHT_FAILURE' }
        data = { receipt: { command: options.command, status: nativeReport.status, nativeReport } }
      }
      if (methodName === 'read') { const raw = atob(output), part = raw.slice(options.offset, options.offset + options.size); data = { offset: options.offset, total: raw.length, data: btoa(part) } }
      setTimeout(() => window.Capacitor.fromNative({ callbackId, pluginId, methodName, success: true, data }), 5)
    } }
  }, { output: outputGlb() })
  await page.goto('http://127.0.0.1:4181/my-rigs/index.html?native=1')
  await page.locator('#asset-info').waitFor({ state: 'visible' }); await page.getByRole('button', { name: '1. Найти ориентиры тела', exact: true }).waitFor()
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '1. Найти ориентиры тела').disabled)
  const originalName = await page.locator('#asset-name').textContent(), originalStats = await page.locator('#asset-stats').textContent()
  assert.equal(await page.locator('#viewport canvas').count(), 1)
  await page.screenshot({ path: 'artifacts/native-source-visible.png' })
  await page.getByRole('button', { name: '1. Найти ориентиры тела', exact: true }).click()
  await page.getByText('Ориентиры показаны на модели.', { exact: false }).waitFor()
  await page.getByRole('button', { name: '2. Подогнать суставы', exact: true }).click()
  await page.getByText('Суставы показаны цветными точками.', { exact: false }).waitFor()
  await page.getByRole('button', { name: '3. Показать скелет', exact: true }).click()
  await page.getByText('Скелет показан на персонаже.', { exact: false }).waitFor()
  assert.equal(await page.getByLabel('Проверил суставы спереди и сбоку', { exact: false }).isDisabled(), true)
  await page.getByRole('button', { name: 'Спереди', exact: true }).click(); await page.getByRole('button', { name: 'Сбоку', exact: true }).click()
  await page.getByLabel('Проверил суставы спереди и сбоку', { exact: false }).check()
  await page.evaluate(() => { window.__nativeFail = true })
  await page.getByRole('button', { name: '4. Рассчитать веса и открыть риг', exact: true }).click()
  await page.getByText('Риггер остановился: TEST_WEIGHT_FAILURE', { exact: false }).first().waitFor()
  assert.equal(await page.locator('#asset-name').textContent(), originalName); assert.equal(await page.locator('#asset-stats').textContent(), originalStats)
  await page.evaluate(() => { window.__nativeFail = false })
  await page.getByRole('button', { name: '4. Рассчитать веса и открыть риг', exact: true }).click()
  await page.getByText('Результат открыт.', { exact: false }).waitFor()
  assert.match(await page.locator('#asset-name').textContent(), /нативный риг/)
  assert.equal(await page.locator('#skeleton').isChecked(), true)
  await page.getByRole('button', { name: 'Native bridge test motion', exact: false }).click()
  await page.waitForFunction(() => parseFloat(document.getElementById('time').textContent) > 0.05)
  await page.screenshot({ path: 'artifacts/native-result-motion.png' })
  const commands = await page.evaluate(() => window.__nativeCalls)
  assert.deepEqual(commands, ['INITIAL_BODY_GUIDES', 'PROPOSE_BODY', 'PREVIEW_BODY', 'BUILD_SKELETON', 'COMPUTE_WEIGHTS', 'BUILD_SKELETON', 'COMPUTE_WEIGHTS', 'EXPORT'])
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ status: 'passed', modelVisible: true, skeletonPreview: true, reviewGate: true, nativeFailurePreservesModel: true, outputAndAnimationVisible: true, transport: 'mock bridge; ARM64 engine not executed', commands }))
} catch (error) {
  if (page) { console.log('Browser state:', await page.locator('#native-rig-panel').innerText().catch(() => 'Page unavailable')); await page.screenshot({ path: 'artifacts/native-failure.png' }).catch(() => {}) }
  throw error
} finally { await browser?.close(); server.kill() }
