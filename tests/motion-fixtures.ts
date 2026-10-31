import fs from 'node:fs'
import JSZip from 'jszip'
import { Group } from 'three'
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { build_rig_asset, type RigAsset } from '../src/my-rigs/RigAsset.ts'

export const sampleDir = process.env.RIG_SAMPLE_DIR ?? '../rig741-samples/Игра'
export const zombiePath = process.env.RIG_ZOMBIE_MODEL ?? '../rig74-input/056_Зомби Атака.glb'
export function bytes (buffer: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(buffer.byteLength); new Uint8Array(result).set(buffer); return result
}
export async function bvh_asset (number: number): Promise<RigAsset> {
  const name = '01_' + String(number).padStart(2, '0')
  const zip = await JSZip.loadAsync(fs.readFileSync(sampleDir + '/' + name + '.zip'))
  const parsed = new BVHLoader().parse(await zip.file(name + '.bvh')!.async('string'))
  const bones = parsed.skeleton.bones, scene = new Group()
  bones.forEach((bone, i) => { if (bone.name === 'ENDSITE') bone.name = 'ENDSITE_' + i })
  scene.add(bones[0]); scene.updateMatrixWorld(true)
  const associations = new Map(bones.map((bone, i) => [bone, { nodes: i }]))
  parsed.clip.name = 'BVH ' + name
  const asset = build_rig_asset({ scene, animations: [parsed.clip], parser: { associations } } as unknown as GLTF,
    { asset: { version: '2.0' }, nodes: bones.map(bone => ({ name: bone.name })), skins: [{ joints: bones.map((_, i) => i) }] }, new ArrayBuffer(0), name)
  asset.skeleton_count = 1
  return asset
}

// Explicit preprocessing for the user's verified 01_01–01_14 batch only.
// All 14 files contain the same inserted calibration pose at sample zero.
export function without_calibration_frame (asset: RigAsset): RigAsset {
  const clips = asset.clips.map(original => {
    const clip = original.clone(), start = clip.tracks[0].times[1]
    if (!(start > 0)) throw new Error('Не найден первый кадр движения')
    for (const track of clip.tracks) {
      if (track.times.length < 3 || track.times[0] !== 0 || track.times[1] !== start) throw new Error('Не совпадают временные сетки BVH')
      track.values = track.values.slice(track.getValueSize())
      track.times = track.times.slice(1).map(time => time - start)
    }
    return clip.resetDuration()
  })
  return { ...asset, clips }
}
