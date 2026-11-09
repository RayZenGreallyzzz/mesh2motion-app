import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

// A small independently generated skinned GLB is the bridge's mock output.
// This proves the UI/transport path; it does not execute the ARM64 engine.
function outputGlb() {
  const input=readFileSync('static/rigs/rig-human.glb'),n=input.readUInt32LE(12),doc=JSON.parse(input.subarray(20,20+n)),oldBin=input.subarray(28+n)
  const chunks=[oldBin.subarray(0,doc.buffers[0].byteLength)];let offset=doc.buffers[0].byteLength
  if(offset%4){const pad=Buffer.alloc(4-offset%4);chunks.push(pad);offset+=pad.length}
  const add=(values,componentType,type,count,extra={})=>{const array=componentType===5123?new Uint16Array(values):new Float32Array(values),raw=Buffer.from(array.buffer),bv=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:raw.length});chunks.push(raw);offset+=raw.length;if(offset%4){const pad=Buffer.alloc(4-offset%4);chunks.push(pad);offset+=pad.length}doc.accessors.push({bufferView:bv,componentType,type,count,...extra});return doc.accessors.length-1}
  const oldSkin=doc.skins[0],root=doc.nodes.findIndex(n=>n.name==='root'),pelvis=doc.nodes.findIndex(n=>n.name==='pelvis'),accessor=doc.accessors[oldSkin.inverseBindMatrices],view=doc.bufferViews[accessor.bufferView]
  const matrices=new Float32Array(oldBin.buffer,oldBin.byteOffset+(view.byteOffset??0)+(accessor.byteOffset??0),accessor.count*16)
  const kept=oldSkin.joints.map((id,index)=>({id,index})).filter(o=>o.id!==root)
  oldSkin.joints=kept.map(o=>o.id);oldSkin.skeleton=pelvis;oldSkin.inverseBindMatrices=add(kept.flatMap(o=>Array.from(matrices.subarray(o.index*16,o.index*16+16))),5126,'MAT4',65)
  const position=add([-.3,0,0,.3,0,0,0,1,0],5126,'VEC3',3,{min:[-.3,0,0],max:[.3,1,0]}),joint=kept.findIndex(o=>o.id===pelvis)
  const joints=add([joint,0,0,0,joint,0,0,0,joint,0,0,0],5123,'VEC4',3),weights=add([1,0,0,0,1,0,0,0,1,0,0,0],5126,'VEC4',3)
  doc.meshes=[{primitives:[{attributes:{POSITION:position,JOINTS_0:joints,WEIGHTS_0:weights},material:0}]}];doc.materials=[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[.8,.55,.25,1]}}]
  doc.nodes.push({name:'native-mesh',mesh:0,skin:0});doc.scenes[0].nodes.push(doc.nodes.length-1)
  const base=new Quaternion().fromArray(doc.nodes[pelvis].rotation??[0,0,0,1]),end=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.4).multiply(base)
  const times=add([0,1],5126,'SCALAR',2,{min:[0],max:[1]}),rotations=add([...base.toArray(),...end.toArray()],5126,'VEC4',2)
  doc.animations=[{name:'Native bridge test motion',samplers:[{input:times,output:rotations}],channels:[{sampler:0,target:{node:pelvis,path:'rotation'}}]}]
  doc.buffers[0].byteLength=offset
  let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((-json.length)&3,32)]);const bin=Buffer.concat(chunks),header=Buffer.alloc(20),bh=Buffer.alloc(8)
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4)
  return Buffer.concat([header,json,bh,bin]).toString('base64')
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
    window.__nativeCalls = []; window.__nativeFail = false; window.__nativeComplex = false
    const methods = ['capabilities', 'begin', 'append', 'prepare', 'run', 'read', 'discard', 'cancel', 'addListener', 'removeListener']
    const pending = new Map(); let callback = 0
    window.Capacitor = {
      PluginHeaders: [{ name: 'RigNativeEngine', methods: methods.map(name => ({ name, rtype: name === 'addListener' ? 'callback' : 'promise' })) }, { name: 'RigFileExport', methods: ['begin', 'append', 'finish', 'abort'].map(name => ({ name, rtype: 'promise' })) }],
      nativePromise(pluginId, methodName, options) { return new Promise(resolve => { const callbackId = String(++callback); pending.set(callbackId, resolve); window.androidBridge.postMessage(JSON.stringify({ pluginId, methodName, options, callbackId })) }) },
      nativeCallback(pluginId, methodName, options, handler) { const callbackId = String(++callback); if (handler) pending.set(callbackId, handler); window.androidBridge.postMessage(JSON.stringify({ pluginId, methodName, options, callbackId })); return callbackId },
      fromNative(result) { pending.get(result.callbackId)?.(result.data); pending.delete(result.callbackId) }
    }
    let id = 0
    window.androidBridge = { postMessage(text) {
      const request = JSON.parse(text); if (request.type === 'js.error') return
      const { pluginId, methodName, options = {}, callbackId } = request
      if (pluginId === 'RigFileExport') {
        let data = {}
        if (methodName === 'begin') { window.__exportParts = []; data = { id: 'export-test' } }
        if (methodName === 'append') window.__exportParts.push(options.data)
        if (methodName === 'finish') { window.__exportBytes = window.__exportParts.flatMap(part => [...atob(part)].map(c => c.charCodeAt(0))); data = { status: 'saved' } }
        setTimeout(() => window.Capacitor.fromNative({ callbackId, pluginId, methodName, success: true, data }), 5); return
      }
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
        if (options.command === 'INITIAL_BODY_GUIDES' && window.__nativeComplex) { nativeReport.status = 'FAILED'; nativeReport.errorCode = 'MESH_TOO_COMPLEX_FOR_LOCAL_RIG'; nativeReport.detail = 'POSITION limit or type' }
        if (options.command === 'COMPUTE_WEIGHTS' && window.__nativeFail) { nativeReport.status = 'FAILED'; nativeReport.errorCode = 'TEST_WEIGHT_FAILURE' }
        data = { receipt: { command: options.command, status: nativeReport.status, nativeReport } }
      }
      if (methodName === 'read') { const raw = atob(output), part = raw.slice(options.offset, options.offset + options.size); data = { offset: options.offset, total: raw.length, data: btoa(part) } }
      setTimeout(() => window.Capacitor.fromNative({ callbackId, pluginId, methodName, success: true, data }), 5)
    } }
  }, { output: outputGlb() })
  await page.goto('http://127.0.0.1:4181/my-rigs/index.html?native=1')
  await page.waitForFunction(() => document.getElementById('empty').hidden)
  assert.equal(await page.locator('.workspace-dialog:not([hidden])').count(), 0)
  const viewport = await page.locator('#viewport canvas').boundingBox(); assert.ok(viewport.width > 950 && viewport.height > 850)
  await page.getByRole('button', { name: 'Файл', exact: true }).click(); await page.locator('#asset-info').waitFor({ state: 'visible' })
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.workspace-dialog:not([hidden])').count(), 0)
  await page.getByRole('button', { name: 'Вид', exact: true }).click(); assert.equal(await page.locator('#room-enabled').isChecked(), true)
  await page.locator('#room-enabled').uncheck(); await page.locator('#room-enabled').check(); await page.keyboard.press('Escape')
  await page.screenshot({ path: 'artifacts/native-source-visible.png' })
  await page.getByRole('button', { name: 'Риг', exact: true }).click()
  const beforeHeadName = await page.locator('#asset-name').textContent(), beforeHeadStats = await page.locator('#asset-stats').textContent()
  let releaseTemplate
  const templateGate = new Promise(resolve => { releaseTemplate = resolve })
  const templateUrl = '**/rigs/rig-human.glb'
  await page.route(templateUrl, async route => { await templateGate; await route.continue() })
  await page.getByRole('button', { name: 'Уточнить голову вручную', exact: true }).click()
  await page.mouse.click(24, 320)
  assert.equal(await page.locator('.workspace-dialog:not([hidden])').count(), 0)
  releaseTemplate()
  const headReview = page.getByRole('region', { name: 'Ориентиры головы', exact: true })
  await headReview.waitFor({ state: 'visible' })
  await page.unroute(templateUrl)
  assert.equal(await page.locator('#asset-name').textContent(), beforeHeadName); assert.equal(await page.locator('#asset-stats').textContent(), beforeHeadStats)
  const headChecked = page.getByLabel('Проверил шею и голову спереди и сбоку', { exact: false })
  assert.equal(await headChecked.isDisabled(), true)
  assert.equal(await page.locator('#open-model').isDisabled(), true)
  await page.getByRole('button', { name: 'Голова спереди', exact: true }).click(); await page.getByRole('button', { name: 'Голова сбоку', exact: true }).click(); await headChecked.check()
  await page.mouse.click(24, 320)
  await headReview.waitFor({ state: 'hidden' })
  const resumeHead = page.getByRole('button', { name: 'Голова', exact: true })
  assert.equal(await resumeHead.getAttribute('aria-expanded'), 'false')
  await resumeHead.click()
  await headReview.waitFor({ state: 'visible' })
  assert.equal(await headChecked.isChecked(), true)
  assert.equal(await page.getByRole('button', { name: 'Продолжить с этой головой', exact: true }).isDisabled(), false)
  await page.getByText('Координаты головы', { exact: true }).click()
  const headX = page.getByLabel('Основание головы X', { exact: true }); await headX.fill(String(Number(await headX.inputValue()) + .00001)); await headX.dispatchEvent('change')
  assert.equal(await headChecked.isChecked(), false)
  assert.equal(await page.getByRole('button', { name: 'Продолжить с этой головой', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Отменить уточнение головы', exact: true }).click(); await headReview.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Риг', exact: true }).waitFor()
  assert.equal(await page.locator('#asset-name').textContent(), beforeHeadName); assert.equal(await page.locator('#asset-stats').textContent(), beforeHeadStats)
  await page.getByRole('button', { name: 'Уточнить голову вручную', exact: true }).click(); await headReview.waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Голова спереди', exact: true }).click(); await page.getByRole('button', { name: 'Голова сбоку', exact: true }).click(); await headChecked.check()
  await page.screenshot({ path: 'artifacts/native-head-review.png' })
  await page.getByRole('button', { name: 'Продолжить с этой головой', exact: true }).click()
  await page.locator('#status').filter({hasText:'Готов полный риг: 65 костей'}).waitFor({timeout:60000})
  await headReview.waitFor({ state: 'hidden' }); assert.match(await page.locator('#asset-stats').textContent(), /65 костей/)
  await page.getByRole('button', { name: 'Создать полный риг · 65 костей', exact: true }).click()
  await page.locator('#status').filter({hasText:'Готов полный риг: 65 костей'}).waitFor({timeout:60000})
  assert.match(await page.locator('#asset-stats').textContent(), /65 костей/)
  await page.getByText('Нативные ориентиры тела · тест', {exact:true}).click()
  await page.getByRole('button', { name: '1. Найти ориентиры тела', exact: true }).waitFor()
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '1. Найти ориентиры тела').disabled)
  const complexityName = await page.locator('#asset-name').textContent(), complexityStats = await page.locator('#asset-stats').textContent()
  await page.evaluate(() => { window.__nativeComplex = true })
  await page.getByRole('button', { name: '1. Найти ориентиры тела', exact: true }).click()
  const recovery = page.getByRole('button', { name: 'Продолжить полным ригом · 65 костей', exact: true })
  await recovery.waitFor({ state: 'visible' })
  assert.equal(await page.locator('#asset-name').textContent(), complexityName); assert.equal(await page.locator('#asset-stats').textContent(), complexityStats)
  assert.match(await page.getByLabel('Отчёт нативного риггера', { exact: true }).inputValue(), /MESH_TOO_COMPLEX_FOR_LOCAL_RIG/)
  await recovery.click()
  await page.locator('#status').filter({hasText:'Готов полный риг: 65 костей'}).waitFor({timeout:60000})
  assert.match(await page.locator('#asset-stats').textContent(), /65 костей/); await recovery.waitFor({ state: 'hidden' })
  await page.evaluate(() => { window.__nativeComplex = false })
  const originalName = await page.locator('#asset-name').textContent(), originalStats = await page.locator('#asset-stats').textContent()
  assert.equal(await page.locator('#viewport canvas').count(), 1)
  await page.getByRole('button', { name: '1. Найти ориентиры тела', exact: true }).click()
  await page.locator('#status').filter({ hasText: 'Ориентиры показаны на модели.' }).waitFor()
  await page.getByRole('button', { name: '2. Подогнать суставы', exact: true }).click()
  await page.locator('#status').filter({ hasText: 'Суставы показаны цветными точками.' }).waitFor()
  await page.getByRole('button', { name: '3. Показать скелет', exact: true }).click()
  await page.locator('#status').filter({ hasText: 'Скелет показан на персонаже.' }).waitFor()
  assert.equal(await page.getByLabel('Проверил суставы спереди и сбоку', { exact: false }).isDisabled(), true)
  await page.getByRole('button', { name: 'Спереди', exact: true }).click(); await page.getByRole('button', { name: 'Сбоку', exact: true }).click()
  await page.getByLabel('Проверил суставы спереди и сбоку', { exact: false }).check()
  await page.evaluate(() => { window.__nativeFail = true })
  await page.getByRole('button', { name: '4. Рассчитать веса и открыть риг', exact: true }).click()
  await page.getByText('Риггер остановился: TEST_WEIGHT_FAILURE', { exact: false }).first().waitFor()
  assert.equal(await page.locator('#asset-name').textContent(), originalName); assert.equal(await page.locator('#asset-stats').textContent(), originalStats)
  await page.evaluate(() => { window.__nativeFail = false })
  await page.getByRole('button', { name: '4. Рассчитать веса и открыть риг', exact: true }).click()
  await page.locator('#status').filter({ hasText: 'Результат открыт.' }).waitFor()
  assert.match(await page.locator('#asset-name').textContent(), /полный риг 65/)
  assert.equal(await page.locator('#skeleton').isChecked(), true)
  await page.getByRole('button', { name: 'Native bridge test motion', exact: false }).click()
  await page.waitForFunction(() => parseFloat(document.getElementById('time').textContent) > 0.05)
  await page.screenshot({ path: 'artifacts/native-result-motion.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Риг', exact: true }).click()
  await page.locator('#initial-pose').click()
  await page.getByRole('region', { name: 'Исходная поза персонажа' }).waitFor()
  assert.equal(await page.locator('#pause').isDisabled(), true)
  await page.getByLabel('Кость для исходной позы').selectOption({ label: 'pelvis' })
  const angle = page.getByLabel('Поворот, ° Z', { exact: true })
  await angle.fill('25'); await angle.dispatchEvent('input')
  await page.screenshot({ path: 'artifacts/native-pose-edit.png' })
  await page.getByRole('button', { name: 'Сохранить исходную позу', exact: true }).click()
  await page.locator('#status').filter({ hasText: 'Исходная поза сохранена' }).waitFor()
  await page.getByRole('button', { name: 'Анимации', exact: true }).click()
  await page.getByRole('button', { name: 'Native bridge test motion', exact: false }).click()
  await page.waitForFunction(() => parseFloat(document.getElementById('time').textContent) > 0.05)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Анимации', exact: true }).click()
  await page.locator('#export').click()
  await page.locator('#status').filter({ hasText: 'GLB сохранён' }).waitFor()
  const exported = Buffer.from(await page.evaluate(() => window.__exportBytes))
  const doc = JSON.parse(exported.subarray(20, 20 + exported.readUInt32LE(12)).toString())
  const originalRig=JSON.parse(Buffer.from(outputGlb(),'base64').subarray(20,20+Buffer.from(outputGlb(),'base64').readUInt32LE(12)));const pelvisSaved=doc.nodes.find(n=>n.name==='pelvis');const expected=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),25*Math.PI/180).multiply(new Quaternion().fromArray(originalRig.nodes.find(n=>n.name==='pelvis').rotation??[0,0,0,1]));assert.ok(new Quaternion().fromArray(pelvisSaved.rotation).angleTo(expected)<.0001)
  const original = Buffer.from(outputGlb(), 'base64'), originalDoc = JSON.parse(original.subarray(20, 20 + original.readUInt32LE(12)).toString())
  assert.deepEqual(doc.skins, originalDoc.skins); assert.deepEqual(doc.meshes, originalDoc.meshes)
  assert.deepEqual(exported.subarray(28 + exported.readUInt32LE(12), 28 + exported.readUInt32LE(12) + originalDoc.buffers[0].byteLength), original.subarray(28 + original.readUInt32LE(12)))
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Риг', exact: true }).click(); await page.locator('#initial-pose').click()
  await page.getByLabel('Кость для исходной позы').selectOption({ label: 'pelvis' })
  await page.getByLabel('Поворот, ° Z', { exact: true }).fill('10'); await page.getByLabel('Поворот, ° Z', { exact: true }).dispatchEvent('input')
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await page.getByRole('button', { name: 'Файл', exact: true }).click()
  await page.locator('#model-file').setInputFiles({ name: 'pose-roundtrip.glb', mimeType: 'model/gltf-binary', buffer: exported })
  await page.locator('#asset-name').filter({ hasText: 'pose-roundtrip' }).waitFor()
  await page.keyboard.press('Escape'); await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Вид', exact: true }).click()
  const small = await page.locator('#workspace-view').boundingBox(); assert.ok(small.width < 390 && small.height < 430)
  await page.keyboard.press('Escape'); await page.screenshot({ path: 'artifacts/native-room-portrait.png' })
  const commands = await page.evaluate(() => window.__nativeCalls)
  assert.deepEqual(commands, ['INITIAL_BODY_GUIDES', 'INITIAL_BODY_GUIDES', 'PROPOSE_BODY', 'PREVIEW_BODY', 'BUILD_SKELETON', 'COMPUTE_WEIGHTS', 'BUILD_SKELETON', 'COMPUTE_WEIGHTS', 'EXPORT'])
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ status: 'passed', modelVisible: true, roomScene: true, popupSettings: true, portraitSettings: true, skeletonPreview: true, reviewGate: true, nativeFailurePreservesModel: true, outputAndAnimationVisible: true, initialPoseEditAndExport: true, complete65RigCreatedInWorker: true, manualHeadReviewAndResume: true, headReviewCancelPreservesModel: true, complexityRecoveryPreservesModel: true, transport: 'mock bridge; ARM64 engine not executed', commands }))
} catch (error) {
  if (page) { console.log('Browser state:', await page.locator('#native-rig-panel').innerText().catch(() => 'Page unavailable')); await page.screenshot({ path: 'artifacts/native-failure.png' }).catch(() => {}) }
  throw error
} finally { await browser?.close(); server.kill() }

