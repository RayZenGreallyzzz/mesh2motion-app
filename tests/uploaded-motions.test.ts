import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { AnimationMixer, Vector3, VectorKeyframeTrack, type SkinnedMesh } from 'three'
import { bvh_asset, bytes, sampleDir, zombiePath, without_calibration_frame } from './motion-fixtures.ts'
import { load_rig_asset, export_rig_asset } from '../src/my-rigs/RigAssetLoader.ts'
import { restore_rig_pose, dispose_rig_scene, type RigAsset } from '../src/my-rigs/RigAsset.ts'
import { dedupe_identical_keys } from '../src/my-rigs/RigTrackSanitizer.ts'
import { inspect_skin_weights } from '../src/my-rigs/RigSkinDiagnostics.ts'
import { suggest_mapping, inspect_transfer, transfer_clips } from '../src/my-rigs/RigMotionTransfer.ts'

function skin_hash (asset: RigAsset): string {
  const hash = createHash('sha256')
  asset.scene.traverse(object => {
    const mesh = object as SkinnedMesh; if (!mesh.isSkinnedMesh) return
    for (const key of ['position', 'skinIndex', 'skinWeight']) { const a = mesh.geometry.getAttribute(key).array; hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)) }
    hash.update(JSON.stringify(mesh.skeleton.boneInverses.map(m => m.toArray())))
  }); return hash.digest('hex')
}

describe('Uploaded motion regression cases', () => {
  it('deduplicates only identical samples, including a cubic-sized stride', () => {
    const track = new VectorKeyframeTrack('bone.position', [0, .5, .5, 1], [0,0,0, 1,2,3, 1,2,3, 4,5,6])
    dedupe_identical_keys(track); expect(Array.from(track.times)).toEqual([0,.5,1]); expect(Array.from(track.values)).toEqual([0,0,0,1,2,3,4,5,6])
    const conflicting = new VectorKeyframeTrack('bone.position', [0,0], [0,0,0,1,0,0]); expect(() => dedupe_identical_keys(conflicting)).toThrow()
    const cubic = new VectorKeyframeTrack('bone.position', [0,0,1], [...Array(18).fill(1), ...Array(9).fill(2)])
    dedupe_identical_keys(cubic); expect(cubic.times).toHaveLength(2); expect(cubic.values).toHaveLength(18)
  })

  it.skipIf(!fs.existsSync(zombiePath) || !fs.existsSync(sampleDir + '/01_14.zip'))('checks all 14 BVHs on the uploaded 41-joint GLB through their full duration', async () => {
    const target = await load_rig_asset(bytes(fs.readFileSync(zombiePath)), 'Zombie'), original = target.clips.slice(), before = skin_hash(target)
    expect(inspect_skin_weights(target).cross_limb_vertices).toBe(0)
    const report: { clips: unknown[], checkedFrames: number, maxJointOffsetChange: number, unchangedWeights?: boolean } = { clips: [], checkedFrames: 0, maxJointOffsetChange: 0 }
    const pack = new JSZip()
    try {
      for (let i = 1; i <= 14; i++) {
        const source = await bvh_asset(i), map = suggest_mapping(source, target), info = inspect_transfer(source, target, map, [0])
        const byName = (name: string) => [...source.nodes.values()].find(node => node.name === name)!
        expect(target.nodes.get(map[byName('LeftUpLeg').id])?.name).toBe('mixamorigLeftUpLeg')
        expect(target.nodes.get(map[byName('RightUpLeg').id])?.name).toBe('mixamorigRightUpLeg')
        expect(target.nodes.get(map[byName('Neck1').id])?.name).toBe('mixamorigNeck')
        expect(target.nodes.get(map[byName('LowerBack').id])?.name).toBe('mixamorigSpine')
        expect(target.nodes.get(map[byName('Spine').id])?.name).toBe('mixamorigSpine1')
        expect(target.nodes.get(map[byName('Spine1').id])?.name).toBe('mixamorigSpine2')
        expect(map[byName('LHipJoint').id]).toBeUndefined(); expect(info.mapped_bones).toBeGreaterThanOrEqual(26)
        const clip = transfer_clips(source, target, map, [0])[0], mixer = new AnimationMixer(target.scene), action = mixer.clipAction(clip)
        action.play(); let finite = true, maxOffset = 0
        const frames = Math.ceil(clip.duration * 30)
        for (let frame = 0; frame <= frames; frame++) {
          action.time = Math.min(frame / 30, clip.duration - 1e-7); mixer.update(0); target.scene.updateMatrixWorld(true)
          for (const node of target.nodes.values()) {
            finite &&= [...node.object.position.toArray(), ...node.object.quaternion.toArray(), ...node.object.scale.toArray()].every(Number.isFinite)
            if (node.is_joint && node.name !== 'mixamorigHips') maxOffset = Math.max(maxOffset, node.object.position.distanceTo(node.position))
          }
          target.scene.traverse(object => {
            const mesh = object as SkinnedMesh; if (!mesh.isSkinnedMesh) return
            mesh.skeleton.update(); const count = mesh.geometry.getAttribute('position').count
            for (let v = 0; v < count; v += Math.max(1, Math.floor(count / 24))) finite &&= mesh.getVertexPosition(v, new Vector3()).toArray().every(Number.isFinite)
          })
        }
        expect(finite).toBe(true); expect(maxOffset).toBeLessThan(1e-7); expect(skin_hash(target)).toBe(before)
        report.checkedFrames += frames + 1; report.maxJointOffsetChange = Math.max(report.maxJointOffsetChange, maxOffset)
        report.clips.push({ name: clip.name, seconds: clip.duration, sourceBones: info.source_bones, targetBones: info.target_bones, mapped: info.mapped_bones, frames: frames + 1, finite })
        mixer.stopAllAction(); mixer.uncacheRoot(target.scene); restore_rig_pose(target)
        if (process.env.WRITE_PACK === '1') {
          const prepared = without_calibration_frame(source)
          target.clips = transfer_clips(prepared, target, map, [0]); const output = await export_rig_asset(target)
          const reopened = await load_rig_asset(output, 'Roundtrip'); expect(reopened.clips).toHaveLength(1); expect(skin_hash(reopened)).toBe(before); dispose_rig_scene(reopened.scene)
          pack.file('GLB/BVH_01_' + String(i).padStart(2, '0') + '.glb', new Uint8Array(output)); target.clips = original
        }
        dispose_rig_scene(source.scene)
      }
      report.unchangedWeights = skin_hash(target) === before
      if (process.env.WRITE_PACK === '1') {
        pack.file('README.txt', '14 движений из ваших BVH 01_01–01_14, подготовленных для Rig Animation Studio 7.4.1 TEST.\n\nМои риги → Импорт ZIP с GLB → импортировать выбранные.\nОткройте своего персонажа, найдите набор в библиотеке и нажмите «Взять движения».\nПроверьте соответствия и предпросмотр. Для просмотра без ухода по сцене выберите «На месте, с прыжками».\n\nКаждый GLB содержит один клип и ваш манекен на 41 кость. Манекен — донор движений: его сетка не заменяет вашего персонажа.\nУ этих 14 записей удалён только первый служебный кадр с одинаковой позой, длительностью 0,0083333 с. Все следующие ключи сохранены при подготовке источника; затем выполнен перенос на манекен. Это убирает резкий переход из стартовой позы. Концы записей не сшивались: при циклическом повторе возможен переход между концом и началом.\nПрямой импорт BVH/FBX в этой версии не добавлен. Исходные BVH не изменены. Для анатомически разных существ понадобится ручная настройка; автоматической фиксации стоп нет.\n')
        fs.writeFileSync('../Rig-Studio-BVH-14-GLB-Pack.zip', await pack.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }))
      }
    } finally { fs.writeFileSync('checks/uploaded-motion-tests.json', JSON.stringify(report, null, 2)); target.clips = original; dispose_rig_scene(target.scene) }
  }, 120000)

  it.skipIf(!fs.existsSync(sampleDir + '/01_01.zip'))('removes the verified calibration sample without changing later source keys or the original BVH clip', async () => {
    const source = await bvh_asset(1), prepared = without_calibration_frame(source), before = source.clips[0], after = prepared.clips[0], offset = before.tracks[0].times[1]
    for (let i = 0; i < before.tracks.length; i++) {
      const original = before.tracks[i], trimmed = after.tracks[i]
      expect(original.times[0]).toBe(0); expect(original.times.length - trimmed.times.length).toBe(1)
      expect(Array.from(trimmed.values)).toEqual(Array.from(original.values.slice(original.getValueSize())))
      expect(Array.from(trimmed.times)).toEqual(Array.from(original.times.slice(1).map(t => t - offset)))
    }
    expect(after.duration).toBeCloseTo(before.duration - offset, 5); dispose_rig_scene(source.scene)
  })

  it.skipIf(!fs.existsSync('checks/walking-source-untextured.glb'))('opens both FBX-converted clips with repeated timestamps and preserves them through GLB export', async () => {
    const source = await load_rig_asset(bytes(fs.readFileSync('checks/walking-source-untextured.glb')), 'Walking'), output = await export_rig_asset(source)
    expect(source.clips).toHaveLength(2)
    const reopened = await load_rig_asset(output, 'Roundtrip'); expect(reopened.clips).toHaveLength(2)
    for (let i = 0; i < 2; i++) expect(reopened.clips[i].tracks.map(t => Array.from(t.values))).toEqual(source.clips[i].tracks.map(t => Array.from(t.values)))
    dispose_rig_scene(source.scene); dispose_rig_scene(reopened.scene)
  })
})
