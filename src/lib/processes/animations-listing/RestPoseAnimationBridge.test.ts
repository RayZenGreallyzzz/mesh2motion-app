// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  AnimationClip, AnimationMixer, Bone, Group, Quaternion,
  QuaternionKeyframeTrack, Skeleton, Texture, Vector3, VectorKeyframeTrack
} from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RestPoseAnimationBridge } from './RestPoseAnimationBridge.ts'
import { AnimationLoader } from './AnimationLoader.ts'
import { AnimationUtility } from './AnimationUtility.ts'
import { SkeletonType } from '../../enums/SkeletonType.ts'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'

const asset = (path: string): string => fileURLToPath(new URL(`../../../../static/${path}`, import.meta.url))
const packs: GLTF[] = []
let reference: GLTF

async function loadAsset (path: string): Promise<GLTF> {
  // Exercise the real GLTFLoader, skeletons and animation accessors. Textures
  // are irrelevant to this CPU animation regression and need no Node canvas.
  const loader = new GLTFLoader().register(() => ({
    name: 'test_skip_textures', loadTexture: async () => new Texture()
  }))
  const bytes = readFileSync(asset(path))
  return await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
}

function rigFrom (gltf: GLTF): { group: Group, skeleton: Skeleton } {
  const group = new Group()
  group.add(gltf.scene.getObjectByName('root')!.clone(true))
  group.updateMatrixWorld(true)
  const bones: Bone[] = []
  group.traverse(object => { if (object instanceof Bone) bones.push(object) })
  return { group, skeleton: new Skeleton(bones) }
}

function fitArms (rig: ReturnType<typeof rigFrom>, degrees: number, lengthScale = 1): void {
  const positions = new Map(rig.skeleton.bones.map(bone => [bone.name, bone.getWorldPosition(new Vector3())]))
  for (const [side, sign] of [['l', -1], ['r', 1]] as const) {
    const upper = rig.skeleton.getBoneByName(`upperarm_${side}`)!
    const pivot = positions.get(upper.name)!
    const swing = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), sign * degrees * Math.PI / 180)
    upper.traverse(object => {
      if (!(object instanceof Bone) || object === upper) return
      const position = positions.get(object.name)!
      position.sub(pivot).multiplyScalar(lengthScale).applyQuaternion(swing).add(pivot)
    })
  }
  // Reproduce AutoRig: alter joint positions, leave authored local quaternions.
  for (const bone of rig.skeleton.bones) {
    bone.parent!.updateWorldMatrix(true, false)
    bone.position.copy(bone.parent!.worldToLocal(positions.get(bone.name)!.clone()))
    bone.updateWorldMatrix(true, false)
  }
  rig.group.updateMatrixWorld(true)
  rig.skeleton.calculateInverses()
}

function direction (rig: ReturnType<typeof rigFrom>, from: string, to: string): Vector3 {
  return rig.skeleton.getBoneByName(to)!.getWorldPosition(new Vector3())
    .sub(rig.skeleton.getBoneByName(from)!.getWorldPosition(new Vector3())).normalize()
}

function cleaned (clip: AnimationClip): AnimationClip {
  const result = AnimationUtility.deep_clone_animation_clip(clip)
  AnimationUtility.clean_track_data([result], 'pelvis')
  return result
}

beforeAll(async () => {
  // GLTFLoader checks self even though our texture plugin resolves all textures.
  vi.stubGlobal('self', globalThis)
  reference = await loadAsset('rigs/rig-human.glb')
  for (const pack of ['base', 'addon', 'mocap']) {
    packs.push(await loadAsset(`animations/human-${pack}-animations.glb`))
  }
})

describe('fitted humanoid animation frames — real GLB regressions', () => {
  it('uses the skeleton loaded from each animation file, including human-base', async () => {
    let index = 0
    const spy = vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
      onLoad(packs[index++])
    })
    try {
      const pairs = await new AnimationLoader().load_animations(SkeletonType.MobileFemale)
      expect(pairs).toHaveLength(178)
      for (const pack of packs) {
        const pair = pairs.find(p => p.original_animation_clip.name === pack.animations[0].name)!
        expect(pair.source_rest_pose?.size).toBe(66)
        const bone = pack.scene.getObjectByName('upperarm_l')!
        expect(pair.source_rest_pose!.get('upperarm_l')!.quaternion.angleTo(bone.quaternion)).toBeLessThan(0.001)
      }
      const baseRest = pairs.find(p => p.original_animation_clip.name === 'Idle_A')!.source_rest_pose!
      const templateRest = RestPoseAnimationBridge.capture_scene_rest_pose(reference.scene)
      expect(baseRest.get('upperarm_l')!.quaternion.angleTo(templateRest.get('upperarm_l')!.quaternion)).toBeGreaterThan(0.1)
    } finally { spy.mockRestore() }
  })

  it.each([0, 45])('keeps animated arm directions for all 178 clips fitted to %s° arms', (degrees) => {
    let checked = 0
    let worst = 0
    for (const pack of packs) {
      const source = rigFrom(pack)
      const target = rigFrom(reference)
      fitArms(target, degrees, 1.17)
      // Viewport transforms must not become retarget offsets.
      target.group.rotation.set(0.1, 0.4, 0)
      target.group.scale.setScalar(2.3)
      target.group.updateMatrixWorld(true)
      const sourceRest = RestPoseAnimationBridge.capture_rest_pose(source.skeleton.bones)
      const targetRest = RestPoseAnimationBridge.capture_rest_pose(target.skeleton.bones)
      target.group.rotation.set(0, 0, 0)
      target.group.scale.setScalar(1)
      target.group.updateMatrixWorld(true)
      const restPositions = target.skeleton.bones.map(b => b.position.clone())
      for (const raw of pack.animations) {
        const sourceClip = cleaned(raw)
        const converted = cleaned(raw)
        const originalTimes = converted.tracks.map(t => [...t.times])
        RestPoseAnimationBridge.rebase_clip_to_rest_pose(converted, sourceRest, targetRest)
        expect(converted.duration).toBe(raw.duration)
        originalTimes.forEach((times, i) => expect([...converted.tracks[i].times]).toEqual(times))
        const sourceMixer = new AnimationMixer(source.group)
        const targetMixer = new AnimationMixer(target.group)
        sourceMixer.clipAction(sourceClip).play()
        targetMixer.clipAction(converted).play()
        for (const fraction of [0, 0.37, 0.73]) {
          sourceMixer.setTime(raw.duration * fraction)
          targetMixer.setTime(raw.duration * fraction)
          source.group.updateMatrixWorld(true)
          target.group.updateMatrixWorld(true)
          for (const side of ['l', 'r']) {
            for (const [from, to] of [['clavicle', 'upperarm'], ['upperarm', 'lowerarm'], ['lowerarm', 'hand']]) {
              const error = direction(source, `${from}_${side}`, `${to}_${side}`)
                .angleTo(direction(target, `${from}_${side}`, `${to}_${side}`))
              worst = Math.max(worst, error)
              expect(error, `${raw.name} ${from}_${side} @ ${fraction}`).toBeLessThan(0.0001)
              checked++
            }
          }
          target.skeleton.bones.forEach((bone, i) => {
            expect(bone.quaternion.length()).toBeCloseTo(1, 5)
            if (bone.name !== 'pelvis' && bone.name !== 'root') {
              expect(bone.position.distanceTo(restPositions[i])).toBeLessThan(1e-7)
            }
          })
        }
        sourceMixer.stopAllAction()
        targetMixer.stopAllAction()
        sourceMixer.uncacheRoot(source.group)
        targetMixer.uncacheRoot(target.group)
      }
    }
    expect(checked).toBe(178 * 3 * 6)
    console.info(`Rig frames: ${degrees}°, ${checked} arm checks, max ${(worst * 180 / Math.PI).toFixed(6)}°`)
  })

  it('supplies a missing constant parent channel and keeps scaled pelvis motion', () => {
    const source = rigFrom(reference)
    const target = rigFrom(reference)
    fitArms(target, 45)
    const pelvis = target.skeleton.getBoneByName('pelvis')!
    pelvis.position.multiplyScalar(2)
    const sourceRest = RestPoseAnimationBridge.capture_rest_pose(source.skeleton.bones)
    const targetRest = RestPoseAnimationBridge.capture_rest_pose(target.skeleton.bones)
    const sourcePelvis = sourceRest.get('pelvis')!.position
    const translation = new VectorKeyframeTrack('.bones[pelvis].position', [0, 1], [
      ...sourcePelvis.clone().multiplyScalar(2).toArray(),
      ...sourcePelvis.clone().multiplyScalar(2).add(new Vector3(0, 0.2, 0)).toArray()
    ])
    const lower = source.skeleton.getBoneByName('lowerarm_l')!
    const clip = new AnimationClip('partial', 1, [translation,
      new QuaternionKeyframeTrack('lowerarm_l.quaternion', [0], lower.quaternion.toArray())])
    RestPoseAnimationBridge.rebase_clip_to_rest_pose(clip, sourceRest, targetRest, 2)
    expect(clip.tracks.some(t => t.name === 'upperarm_l.quaternion')).toBe(true)
    expect(new Vector3().fromArray(translation.values, 0).distanceTo(pelvis.position)).toBeLessThan(1e-6)
    expect(new Vector3().fromArray(translation.values, 3).distanceTo(pelvis.position.clone().add(new Vector3(0, 0.2, 0)))).toBeLessThan(1e-6)
  })

  it('converts preview/export copies equally without moving the live bind rig', () => {
    const source = rigFrom(packs[0])
    const target = rigFrom(reference)
    fitArms(target, 45)
    const positions = target.skeleton.bones.map(b => b.position.clone())
    const rotations = target.skeleton.bones.map(b => b.quaternion.clone())
    const raw = packs[0].animations.find(a => a.name === 'Idle_A')!
    const pair: TransformedAnimationClipPair = {
      original_animation_clip: cleaned(raw), display_animation_clip: cleaned(raw),
      metadata: { source_type: 'default-library', tags: [] },
      source_rest_pose: RestPoseAnimationBridge.capture_rest_pose(source.skeleton.bones)
    }
    RestPoseAnimationBridge.apply_to_mobile_female([pair], target.skeleton)
    pair.original_animation_clip.tracks.forEach((track, i) => {
      expect([...pair.display_animation_clip.tracks[i].values]).toEqual([...track.values])
      expect(pair.display_animation_clip.tracks[i].values).not.toBe(track.values)
    })
    target.skeleton.bones.forEach((b, i) => {
      expect(b.position.equals(positions[i])).toBe(true)
      expect(b.quaternion.equals(rotations[i])).toBe(true)
    })
    expect(() => RestPoseAnimationBridge.apply_to_mobile_female([{ ...pair, source_rest_pose: undefined }], target.skeleton)).toThrow('Missing source skeleton')
  })
})
