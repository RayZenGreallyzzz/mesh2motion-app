import { describe, expect, it } from 'vitest'
import {
  AnimationClip, AnimationMixer, Bone, CylinderGeometry, Float32BufferAttribute,
  MeshBasicMaterial, Quaternion, QuaternionKeyframeTrack, Skeleton, SkinnedMesh,
  Uint16BufferAttribute, Vector3
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { JointVolumeSupport } from './JointVolumeSupport.ts'
import CustomAnimationValidation from '../processes/animations-listing/CustomAnimationValidation.ts'

function makeLimb (role: 'arm' | 'leg', side: string, support_enabled = true): SkinnedMesh {
  const upper = new Bone()
  upper.name = `${role === 'arm' ? 'upperarm' : 'thigh'}_${side}`
  const lower = new Bone()
  lower.name = `${role === 'arm' ? 'lowerarm' : 'calf'}_${side}`
  lower.position.y = 1
  upper.add(lower)
  const tip = new Bone()
  tip.name = `${role === 'arm' ? 'hand' : 'foot'}_${side}`
  tip.position.y = 1
  lower.add(tip)
  upper.updateWorldMatrix(true, true)
  let skeleton = new Skeleton([upper, lower, tip])
  if (support_enabled) skeleton = JointVolumeSupport.addToSkeleton(skeleton)
  const geometry = new CylinderGeometry(0.18, 0.18, 2, 32, 20, true)
  geometry.translate(0, 1, 0)
  const indices: number[] = []
  const weights: number[] = []
  const position = geometry.getAttribute('position')
  for (let vertex = 0; vertex < position.count; vertex++) {
    const blend = Math.max(0, Math.min(1, (position.getY(vertex) - 0.65) / 0.7))
    indices.push(0, 1, 0, 0)
    weights.push(1 - blend, blend, 0, 0)
  }
  if (support_enabled) JointVolumeSupport.applyWeights(geometry, skeleton, indices, weights)
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  mesh.add(upper)
  mesh.updateMatrixWorld(true)
  mesh.bind(skeleton)
  return mesh
}

function bendClip (mesh: SkinnedMesh, degrees: number): AnimationClip {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degrees * Math.PI / 180)
  const clip = new AnimationClip('bend', 2, [new QuaternionKeyframeTrack(
    `${mesh.skeleton.bones[1].name}.quaternion`, [0, 1, 2],
    [0, 0, 0, 1, ...q.toArray(), ...q.toArray()]
  )])
  JointVolumeSupport.updateClip(clip, mesh.skeleton)
  return clip
}

function sample (mesh: SkinnedMesh, clip: AnimationClip, time: number): Vector3[] {
  const mixer = new AnimationMixer(mesh)
  mixer.clipAction(clip).play()
  mixer.setTime(time)
  mesh.updateMatrixWorld(true)
  const positions = mesh.geometry.getAttribute('position')
  return Array.from({ length: positions.count }, (_, vertex) =>
    mesh.applyBoneTransform(vertex, new Vector3().fromBufferAttribute(positions, vertex)))
}

describe('JointVolumeSupport', () => {
  it.each(['arm', 'leg'] as const)('preserves %s ring thickness at a 140-degree bend on both sides', (role) => {
    for (const side of ['l', 'r']) {
      for (const enabled of [false, true]) {
        const mesh = makeLimb(role, side, enabled)
        const clip = bendClip(mesh, side === 'l' ? 140 : -140)
        const points = sample(mesh, clip, 1)
        const positions = mesh.geometry.getAttribute('position')
        let minimum_radius = Infinity
        for (let vertex = 0; vertex < positions.count; vertex++) {
          if (Math.abs(positions.getY(vertex) - 1) > 1e-6) continue
          minimum_radius = Math.min(minimum_radius, points[vertex].distanceTo(new Vector3(0, 1, 0)))
        }
        if (enabled) expect(minimum_radius).toBeCloseTo(0.18, 5)
        else expect(minimum_radius).toBeLessThan(0.065)
      }
    }
  })

  it('leaves the bind shape, rigid limb centers and four normalized influences intact', () => {
    const mesh = makeLimb('leg', 'l')
    mesh.position.set(0.3, -0.2, 0.4)
    mesh.rotation.y = 0.7
    mesh.updateMatrixWorld(true)
    const position = mesh.geometry.getAttribute('position')
    const weights = mesh.geometry.getAttribute('skinWeight')
    const indices = mesh.geometry.getAttribute('skinIndex')
    for (let vertex = 0; vertex < position.count; vertex++) {
      const rest = new Vector3().fromBufferAttribute(position, vertex)
      expect(mesh.applyBoneTransform(vertex, rest.clone()).distanceTo(rest)).toBeLessThan(1e-6)
      let sum = 0
      for (let slot = 0; slot < 4; slot++) {
        sum += weights.array[vertex * 4 + slot]
        expect(indices.array[vertex * 4 + slot]).toBeLessThan(mesh.skeleton.bones.length)
      }
      expect(sum).toBeCloseTo(1, 6)
      if (rest.y < 0.5 || rest.y > 1.5) {
        const slot = rest.y < 1 ? 0 : 1
        expect(weights.array[vertex * 4 + slot]).toBe(1)
        expect(indices.array[vertex * 4 + slot]).toBe(slot)
      }
    }
  })

  it('is idempotent and the same pose is independent of playback speed', () => {
    const mesh = makeLimb('arm', 'r')
    const original_bones = [...mesh.skeleton.bones]
    expect(JointVolumeSupport.addToSkeleton(mesh.skeleton)).toBe(mesh.skeleton)
    expect(mesh.skeleton.bones).toEqual(original_bones)
    const clip = bendClip(mesh, 130)
    JointVolumeSupport.updateClip(clip, mesh.skeleton)
    JointVolumeSupport.updateClip(clip, mesh.skeleton)
    expect(clip.tracks).toHaveLength(2)
    const direct = sample(mesh, clip, 1)
    mesh.skeleton.pose()
    const mixer = new AnimationMixer(mesh)
    mixer.clipAction(clip).play().setEffectiveTimeScale(4)
    for (let frame = 0; frame < 15; frame++) mixer.update(1 / 60)
    mesh.updateMatrixWorld(true)
    for (let vertex = 0; vertex < direct.length; vertex++) {
      const point = new Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), vertex)
      expect(mesh.applyBoneTransform(vertex, point).distanceTo(direct[vertex])).toBeLessThan(1e-5)
    }
  })

  it('does not require generated support tracks in a custom animation', () => {
    const mesh = makeLimb('arm', 'l')
    const clip = new AnimationClip('custom', 1, mesh.skeleton.bones.slice(0, 3).map(bone =>
      new QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0], [0, 0, 0, 1])))
    expect(() => CustomAnimationValidation.validate_animation_bones_match([clip], [mesh])).not.toThrow()
    clip.tracks.pop()
    expect(() => CustomAnimationValidation.validate_animation_bones_match([clip], [mesh])).toThrow()
  })

  it('preserves the corrected bend after GLB export and reload', async () => {
    const mesh = makeLimb('leg', 'l')
    const clip = bendClip(mesh, 140)
    const expected = sample(mesh, clip, 1)
    mesh.skeleton.pose()
    mesh.updateMatrixWorld(true)
    const data = await new GLTFExporter().parseAsync(mesh, { binary: true, animations: [clip] })
    const result = await new GLTFLoader().parseAsync(data as ArrayBuffer, '')
    let imported: SkinnedMesh | undefined
    result.scene.traverse(object => { if (object instanceof SkinnedMesh) imported = object })
    expect(imported).toBeDefined()
    expect(imported!.skeleton.bones.filter(bone => JointVolumeSupport.isSupportBone(bone))).toHaveLength(1)
    const actual = sample(imported!, result.animations[0], 1)
    for (let vertex = 0; vertex < expected.length; vertex++) {
      expect(actual[vertex].distanceTo(expected[vertex])).toBeLessThan(1e-5)
    }
  })
})
