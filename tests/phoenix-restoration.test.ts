// @vitest-environment node
import fs from 'node:fs'
import { afterAll, expect, it } from 'vitest'
import { AnimationMixer, Box3, LoopOnce, Vector3 } from 'three'
import packs from '../src/library/phoenix-packs.json'
import { library_asset } from './library-fixtures.ts'
import { prepare_pack_rig } from '../src/library/PackRigSource.ts'
import { dispose_rig_scene, restore_rig_pose } from '../src/my-rigs/RigAsset.ts'
import { inspect_glb } from '../src/my-rigs/GlbEnvelope.ts'

const only = new Set((process.env.RIG_PACK_IDS ?? '').split(',').filter(Boolean))
const reports: unknown[] = []
fs.mkdirSync('checks', { recursive: true })
afterAll(() => fs.writeFileSync('checks/phoenix-restoration.json', JSON.stringify(reports, null, 2)))

for (const pack of packs.filter(p => !only.size || only.has(p.id))) {
  it('opens the actual offline pack, prepares its skeleton and preserves all clips: ' + pack.id, async () => {
    const path = 'static/' + pack.path
    const original = fs.readFileSync(path)
    inspect_glb(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength))
    const asset = await library_asset(path)
    try {
      expect(asset.clips).toHaveLength(pack.clips)
      const prepared = await prepare_pack_rig(asset)
      expect(prepared.clips).toHaveLength(pack.clips)
      expect(prepared.reference.joints.size).toBeGreaterThan(0)
      let invalid = 0, maxBoundsError = 0, frames = 0
      let worstSample: unknown
      const referencePath = 'checks/phoenix-source/' + pack.id + '.json'
      const reference = fs.existsSync(referencePath) ? JSON.parse(fs.readFileSync(referencePath, 'utf8')) : null
      const mixer = new AnimationMixer(asset.scene)
      for (const clip of asset.clips) {
        restore_rig_pose(asset)
        const source = reference?.clips.find((c: { name: string }) => c.name === clip.name)
        if (reference) expect(source, clip.name).toBeDefined()
        if (source) expect(clip.duration).toBeCloseTo(source.duration, 4)
        const action = mixer.clipAction(clip).setLoop(LoopOnce, 1)
        action.clampWhenFinished = true
        action.play()
        const samples = source?.samples ?? [0, .25, .5, .75, 1].map(f => ({ time: clip.duration * f }))
        for (const sample of samples) {
          mixer.setTime(sample.time)
          asset.scene.updateMatrixWorld(true)
          const box = new Box3(), p = new Vector3()
          asset.scene.traverse((object: any) => {
            if (!object.isMesh) return
            if (object.isSkinnedMesh) object.skeleton.update()
            const count = object.geometry.getAttribute('position').count
            for (let i = 0; i < count; i++) {
              object.getVertexPosition(i, p).applyMatrix4(object.matrixWorld)
              if (!p.toArray().every(Number.isFinite)) invalid++
              box.expandByPoint(p)
            }
          })
          if (source) {
            const expected = sample.bounds
            const height = Math.max(...reference.rest_bounds[1].map((v: number, i: number) => v - reference.rest_bounds[0][i]))
            const a = box.min.toArray(), b = box.max.toArray()
            const error = Math.max(...a.map((v, i) => Math.abs(v - expected[0][i])), ...b.map((v, i) => Math.abs(v - expected[1][i]))) / height
            if (error > maxBoundsError) { maxBoundsError = error; worstSample = { clip: clip.name, time: sample.time, error } }
          }
          frames++
        }
        mixer.stopAllAction()
        mixer.uncacheClip(clip)
      }
      reports.push({ id: pack.id, clips: asset.clips.length, sourceBones: pack.bones, preparedBones: prepared.reference.joints.size, checkedFrames: frames, maxBoundsError, comparedWithBlender: !!reference })
      expect(invalid).toBe(0)
      expect(maxBoundsError, JSON.stringify(worstSample)).toBeLessThan(.001)
      mixer.uncacheRoot(asset.scene)
    } finally { dispose_rig_scene(asset.scene) }
  }, 120000)
}
