import { describe, expect, it } from 'vitest'
import { AnimationClip, Bone, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh, Quaternion, QuaternionKeyframeTrack, Skeleton, Vector3, VectorKeyframeTrack } from 'three'
import { CharacterWeightField } from '../lib/solvers/CharacterWeightField.ts'
import { solve_weight_job } from '../lib/solvers/CharacterWeightJob.ts'
import SkinningAlgorithm from '../lib/solvers/SkinningAlgorithm.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
import { JointVolumeSupport } from '../lib/solvers/JointVolumeSupport.ts'
import { RestSpaceRetargeter } from '../retarget/RestSpaceRetargeter.ts'
import { RestPoseAnimationBridge } from '../lib/processes/animations-listing/RestPoseAnimationBridge.ts'
import { AnimationUtility } from '../lib/processes/animations-listing/AnimationUtility.ts'
import { fit_humanoid_rig } from '../lib/processes/edit-skeleton/HumanoidAutoFit.ts'
import { AnimalAutoFit } from '../lib/processes/edit-skeleton/AnimalAutoFit.ts'
import { RigConfig } from '../lib/RigConfig.ts'
import { read_glb } from './GlbFixture.ts'

function chain () {
  const bones = ['root', 'upperarm_l', 'lowerarm_l', 'hand_leaf_l'].map(name => { const b = new Bone(); b.name = name; return b })
  bones.forEach((b, i) => { if (i) { bones[i - 1].add(b); b.position.y = i === 1 ? -1 : 1 } })
  bones[0].updateWorldMatrix(true, true)
  return bones
}

it('keeps separately meshed joint rings joined at a 140 degree bend, with volume supports', () => {
  const bones = chain(), skeleton = JointVolumeSupport.addToSkeleton(new Skeleton(bones))
  skeleton.calculateInverses()
  const parts = [-.5, .5].map(y => new CylinderGeometry(.2, .2, 1, 24, 8, true).translate(0, y, 0))
  const field = new CharacterWeightField(), solver = new SkinningAlgorithm(bones[0], SkeletonType.Human)
  const data = field.calculate(parts, solver)
  parts.forEach((p, i) => JointVolumeSupport.applyWeights(p, skeleton, data[i][0], data[i][1]))
  bones[2].rotation.z = 140 * Math.PI / 180
  skeleton.bones[skeleton.bones.length - 1].rotation.z = 70 * Math.PI / 180
  bones[0].updateWorldMatrix(true, true)
  const rings = parts.map((geometry, part) => {
    const p = geometry.getAttribute('position'), ring = new Map<string, Vector3>()
    for (let i = 0; i < p.count; i++) {
      const point = new Vector3().fromBufferAttribute(p, i)
      if (Math.abs(point.y) > 1e-6) continue
      const result = new Vector3()
      for (let k = 0; k < 4; k++) {
        const index = data[part][0][i * 4 + k], weight = data[part][1][i * 4 + k]
        result.addScaledVector(point.clone().applyMatrix4(skeleton.boneInverses[index]).applyMatrix4(skeleton.bones[index].matrixWorld), weight)
      }
      ring.set(`${point.x.toFixed(6)},${point.z.toFixed(6)}`, result)
    }
    return ring
  })
  for (const [key, p] of rings[0]) expect(p.distanceTo(rings[1].get(key)!)).toBeLessThan(1e-6)
})

it('worker endpoints/topology produce identical weights and cached weights are isolated from edits', () => {
  const bones = chain(); bones[0].rotation.set(.2, .1, -.3); bones[0].updateWorldMatrix(true, true)
  const geometry = new CylinderGeometry(.2, .2, 2, 12, 8, true)
  const solver = new SkinningAlgorithm(bones[0], SkeletonType.Human)
  const field = new CharacterWeightField(), original = field.calculate([geometry], solver)[0]
  const job = { ...solver.worker_config(), positions: Array.from(geometry.getAttribute('position').array), triangles: Array.from(geometry.index!.array) }
  const worker = solve_weight_job(job)
  expect(worker[0]).toEqual(original[0])
  worker[1].forEach((w, i) => expect(w).toBeCloseTo(original[1][i], 6))
  original[1].fill(0)
  expect(field.calculate([geometry], solver)[0][1]).toEqual(worker[1])
  bones[2].position.x += .5
  expect(field.calculate([geometry], solver)[0][1]).not.toEqual(worker[1])
})

it('mirrors uppercase animal pairs and unpaired tail/root tracks', () => {
  const left = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .9)
  const clip = new AnimationClip('walk', 1, [new QuaternionKeyframeTrack('Leg_L.quaternion', [0], left.toArray()),
    new QuaternionKeyframeTrack('Leg_R.quaternion', [0], [0, 0, 0, 1]),
    new QuaternionKeyframeTrack('Tail.quaternion', [0], left.toArray()), new VectorKeyframeTrack('Root.position', [0], [2, 3, 4])])
  const mirrored = AnimationUtility.create_mirrored_clip(clip)
  expect(mirrored.tracks[0].values[1]).toBeCloseTo(0)
  expect(mirrored.tracks[1].values[1]).toBeCloseTo(-left.y)
  expect(mirrored.tracks[2].values[1]).toBeCloseTo(-left.y)
  expect(mirrored.tracks[3].values[0]).toBe(-2)
  expect(clip.tracks[0].values[1]).toBeCloseTo(left.y)
})

it('retargets rest and rotation axis across differently rolled parent/bone frames', () => {
  const source = new Group(), target = new Group(), a = new Bone(), b = new Bone()
  a.name = 'Source'; b.name = 'Target'; source.add(a); target.add(b)
  source.rotation.y = .3; target.rotation.z = -.4; a.rotation.x = .2; b.rotation.y = .8
  const s = RestSpaceRetargeter.capture(source), t = RestSpaceRetargeter.capture(target)
  const clip = new AnimationClip('rest', 1, [new QuaternionKeyframeTrack('Source.quaternion', [0], a.quaternion.toArray())])
  const converted = RestSpaceRetargeter.retarget(clip, s, t, new Map([['Target', 'Source']]))
  expect(new Quaternion().fromArray(converted.tracks[0].values).normalize().angleTo(b.quaternion)).toBeLessThan(1e-6)
})

it('preserves zero and non-unit cubic tangents while rebasing', () => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .6)
  const track = new QuaternionKeyframeTrack('Leg.quaternion', [0], [0, 0, 0, 0, 0, 0, 0, 1, .2, .3, 0, 0])
  const position = new VectorKeyframeTrack('Leg.position', [0], [0, 0, 0, 1, 2, 3, .2, .3, .4])
  const clip = new AnimationClip('cubic', 1, [track, position])
  RestPoseAnimationBridge.rebase_clip_to_rest_pose(clip,
    new Map([['Leg', { quaternion: new Quaternion(), position: new Vector3(1, 2, 3) }]]),
    new Map([['Leg', { quaternion: q, position: new Vector3(4, 5, 6) }]]))
  expect(Array.from(track.values.slice(0, 4))).toEqual([0, 0, 0, 0])
  expect(new Quaternion().fromArray(track.values, 4).angleTo(q)).toBeLessThan(1e-6)
  expect(Math.hypot(...track.values.slice(8))).toBeCloseTo(Math.hypot(.2, .3))
  expect(Array.from(position.values.slice(0, 6))).toEqual([0, 0, 0, 4, 5, 6])
  expect(position.values[6]).toBeCloseTo(.2)
})

it('human fit and undo snapshot are invariant to a shared rotated, scaled scene frame', async () => {
  const run = async (transformed: boolean) => {
    const [model, rig] = await Promise.all([read_glb('static/models/model-human.glb'), read_glb('static/rigs/rig-human.glb')])
    const frame = new Group(); frame.add(model.scene, rig.scene)
    if (transformed) { frame.rotation.set(.2, 1.3, -.1); frame.scale.setScalar(1.7); frame.position.set(2, 3, -4) }
    const bones: Bone[] = []; rig.scene.traverse(b => { if (b instanceof Bone) bones.push(b) })
    const initial = bones.map(b => b.position.toArray())
    let undo: number[][] = []
    fit_humanoid_rig(model.scene, new Skeleton(bones), frame, () => { undo = bones.map(b => b.position.toArray()) })
    expect(undo).toEqual(initial)
    return bones.map(b => frame.worldToLocal(b.getWorldPosition(new Vector3())))
  }
  const plain = await run(false), transformed = await run(true)
  plain.forEach((p, i) => expect(p.distanceTo(transformed[i])).toBeLessThan(1e-5))
})

for (const config of RigConfig.all.filter(c => ![SkeletonType.Human, SkeletonType.MobileFemale].includes(c.skeleton_type))) {
  it(`fits actual ${config.skeleton_type} mesh in shared rotated coordinates without drifting on repeat`, async () => {
    const [model, rig] = await Promise.all([read_glb('static/' + config.model_file), read_glb('static/' + config.rig_file)])
    const reference = AnimalAutoFit.reference(model.scene, rig.scene)
    const bones: Bone[] = []; rig.scene.traverse(b => { if (b instanceof Bone) bones.push(b) })
    const skeleton = new Skeleton(bones), frame = new Group()
    model.scene.scale.set(1.15, .85, 1.3); frame.add(model.scene, rig.scene)
    frame.rotation.set(.3, 1.1, -.2); frame.position.set(3, 2, 1); frame.scale.setScalar(1.2)
    AnimalAutoFit.fit(model.scene, skeleton, frame, reference, () => {})
    const once = bones.map(b => frame.worldToLocal(b.getWorldPosition(new Vector3())))
    bones.forEach((b, i) => expect(once[i].distanceTo(reference.joints.get(b.name)!.position.clone().multiply(new Vector3(1.15, .85, 1.3)))).toBeLessThan(1e-4))
    AnimalAutoFit.fit(model.scene, skeleton, frame, reference, () => {})
    bones.forEach((b, i) => expect(frame.worldToLocal(b.getWorldPosition(new Vector3())).distanceTo(once[i])).toBeLessThan(1e-5))
  })
}
