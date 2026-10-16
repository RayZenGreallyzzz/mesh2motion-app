import { afterEach, expect, it, vi } from 'vitest'
import { AnimationClip, Bone, Group, Quaternion, QuaternionKeyframeTrack } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { AnimationLoader } from '../lib/processes/animations-listing/AnimationLoader.ts'
import { RestSpaceRetargeter } from '../retarget/RestSpaceRetargeter.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('imports bracket-bound tracks once in target rest axes while retaining unknown bones for validation', async () => {
  const source = new Group(), target = new Group(), a = new Bone(), b = new Bone()
  a.name = b.name = 'Leg'; source.add(a); target.add(b); b.rotation.x = .8
  const clip = new AnimationClip('custom', 1, [
    new QuaternionKeyframeTrack('.bones[Leg].quaternion', [0], [0, 0, 0, 1]),
    new QuaternionKeyframeTrack('Unknown.quaternion', [0], [0, 0, 0, 1])
  ])
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} })
  vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation((_url, on_load) => {
    on_load({ scene: source, scenes: [source], animations: [clip], cameras: [], asset: { version: '2.0' }, parser: {} } as never)
  })
  const loader = new AnimationLoader()
  Reflect.set(loader, 'skeleton_type', SkeletonType.Fox)
  const result = await loader.load_animations_from_file(new File(['fixture'], 'motion.glb'), 1,
    { source_type: 'custom-import' }, RestSpaceRetargeter.capture(target))
  const tracks = result[0].display_animation_clip.tracks
  expect(tracks.map(t => t.name)).toEqual(['Leg.quaternion', 'Unknown.quaternion'])
  expect(new Quaternion().fromArray(tracks[0].values).normalize().angleTo(b.quaternion)).toBeLessThan(1e-6)
})
