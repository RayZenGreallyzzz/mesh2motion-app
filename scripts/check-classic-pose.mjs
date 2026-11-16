import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4182'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch('http://127.0.0.1:4182/create.html')).ok) break } catch {}; await new Promise(r => setTimeout(r, 100)) }
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } })
  await page.goto('http://127.0.0.1:4182/create.html')
  const result = await page.evaluate(async () => {
    const { Bone, BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, MeshBasicMaterial, SkinnedMesh, Skeleton, AnimationClip, QuaternionKeyframeTrack, Quaternion } = await import('/@id/three')
    const { StepAnimationsListing } = await import('/lib/processes/animations-listing/StepAnimationsListing.ts')
    const { copy_rigs_for_export } = await import('/lib/processes/export-to-file/ExportRigCopy.ts')
    const { SkeletonType } = await import('/lib/enums/SkeletonType.ts')
    const root = new Bone(); root.name = 'root'
    const limb = new Bone(); limb.name = 'front_leg_upper_r'; limb.position.y = 1; root.add(limb)
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, .2, 0, 0, 0, 1, 0], 3)); geometry.setAttribute('skinIndex', new Uint16BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4)); geometry.setAttribute('skinWeight', new Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4))
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial()); mesh.add(root); mesh.updateMatrixWorld(true); mesh.bind(new Skeleton([root, limb]))
    const before = mesh.skeleton.boneInverses.map(m => m.toArray())
    const step = new StepAnimationsListing(undefined)
    step.skeleton_type = SkeletonType.Human; step.skinned_meshes_to_animate = [mesh]; step.rest_pose_snapshots.remember(mesh.skeleton)
    step.animation_clips_loaded = [0, 1].map(i => { const clip = new AnimationClip('Motion' + i, 1, [new QuaternionKeyframeTrack(limb.name + '.quaternion', [0, 1], [0,0,0,1,0,0,Math.sin(.1),Math.cos(.1)])]); return { original_animation_clip: clip, display_animation_clip: clip.clone(), metadata: { source_type: 'default-library', tags: [] } } })
    step.play_animation(0); step.frame_change(.3)
    // This is the same entry point used by both classic UI buttons.
    document.getElementById('skinned-step-animation-export-options').style.display = 'block'
    step.open_initial_pose_editor()
    window.__classicPose = { step, limb, mesh, before, copy_rigs_for_export, Quaternion }
    return { open: !document.querySelector('#classic-pose-panel section').hidden, buttons: !!document.getElementById('weight-initial-pose-button') && !!document.getElementById('classic-initial-pose-button') }
  })
  assert.deepEqual(result, { open: true, buttons: true })
  await page.locator('#classic-pose-panel select').selectOption({ label: 'front_leg_upper_r' })
  await page.locator('#classic-pose-panel').getByLabel('Поворот, ° X', { exact: true }).fill('20')
  await page.locator('#classic-pose-panel').getByLabel('Поворот, ° X', { exact: true }).dispatchEvent('input')
  const editing = await page.evaluate(() => { const { step, limb } = window.__classicPose; const before = limb.quaternion.toArray(); step.frame_change(.5); return { before, after: limb.quaternion.toArray() } })
  assert.deepEqual(editing.after, editing.before)
  await page.locator('#classic-pose-panel').getByRole('button', { name: 'Сохранить исходную позу', exact: true }).click()
  const checked = await page.evaluate(() => {
    const { step, limb, mesh, before, copy_rigs_for_export, Quaternion } = window.__classicPose
    const errors = []
    for (const i of [1, 0, 1]) { step.mixer().stopAllAction(); step.play_animation(i); step.mixer().update(0); errors.push(Math.abs(limb.rotation.x - 20 * Math.PI / 180)) }
    const clips = step.animation_clips(), copy = copy_rigs_for_export([mesh])[0]
    const saved = copy.skeleton.bones.find(b => b.name === limb.name).rotation.x
    step.stop_and_restore_pose()
    return { errors, saved, restored: limb.quaternion.angleTo(new Quaternion()), inverses: JSON.stringify(before) === JSON.stringify(mesh.skeleton.boneInverses.map(m => m.toArray())), clipCount: clips.length }
  })
  assert.ok(checked.errors.every(e => e < .0001)); assert.ok(Math.abs(checked.saved - 20 * Math.PI / 180) < .0001); assert.ok(checked.restored < .00001); assert.equal(checked.inverses, true); assert.equal(checked.clipCount, 2)
  console.log(JSON.stringify({ classicPoseEditor: 'passed', pausesMixer: true, clipSwitching: true, exportPose: true, restoresBindBeforeLeaving: true, inverseBindMatricesPreserved: true }))
} finally { await browser?.close(); server.kill() }
