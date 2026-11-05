// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  AnimationClip, AnimationMixer, Bone, BufferGeometry, CylinderGeometry, Float32BufferAttribute,
  MeshBasicMaterial, Quaternion, QuaternionKeyframeTrack, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3
} from 'three'
import SkinningAlgorithm from './SkinningAlgorithm.ts'
import { HumanoidJointWeightCorrector } from './HumanoidJointWeightCorrector.ts'
import { JointVolumeSupport } from './JointVolumeSupport.ts'
import { SkeletonType } from '../enums/SkeletonType.ts'

function limb (role: 'arm' | 'leg', side: string) {
  const upper = new Bone(), lower = new Bone(), tip = new Bone()
  upper.name = (role === 'arm' ? 'upperarm_' : 'thigh_') + side
  lower.name = (role === 'arm' ? 'lowerarm_' : 'calf_') + side
  tip.name = (role === 'arm' ? 'hand_' : 'foot_') + side
  lower.position.y = 1; tip.position.y = 1
  upper.add(lower); lower.add(tip); upper.updateWorldMatrix(true, true)
  return { upper, lower, tip, bones: [upper, lower, tip] }
}

describe('Humanoid elbow and knee weights', () => {
  it.each(['arm', 'leg'] as const)('preserves the %s joint ring through the actual solver and volume support', role => {
    for (const side of ['l', 'r']) {
      const { upper, lower, bones } = limb(role, side)
      const geometry = new CylinderGeometry(.18, .18, 2, 24, 20, true)
      geometry.translate(0, 1, 0)
      const solver = new SkinningAlgorithm(upper, SkeletonType.Human)
      solver.set_geometry(geometry)
      const [indices, weights] = solver.calculate_indexes_and_weights()
      const skeleton = JointVolumeSupport.addToSkeleton(new Skeleton(bones))
      JointVolumeSupport.applyWeights(geometry, skeleton, indices, weights)
      geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4))
      geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
      const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
      mesh.add(upper); mesh.updateMatrixWorld(true); mesh.bind(skeleton)
      const rest = skeleton.bones.map(bone => bone.quaternion.clone())
      for (const degrees of [60, 90, 140]) {
        const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degrees * Math.PI / 180)
        const clip = new AnimationClip('bend', 2, [new QuaternionKeyframeTrack(
          lower.name + '.quaternion', [0, 1], [0, 0, 0, 1, ...rotation.toArray()])])
        JointVolumeSupport.updateClip(clip, skeleton)
        const mixer = new AnimationMixer(mesh)
        mixer.clipAction(clip).play(); mixer.setTime(1)
        mesh.updateMatrixWorld(true); skeleton.update()
        const position = geometry.getAttribute('position')
        let samples = 0
        for (let vertex = 0; vertex < position.count; vertex++) {
          expect(weights.slice(vertex * 4, vertex * 4 + 4).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
          if (Math.abs(position.getY(vertex) - 1) > 1e-6) continue
          const point = new Vector3().fromBufferAttribute(position, vertex)
          mesh.applyBoneTransform(vertex, point)
          expect(point.distanceTo(new Vector3(0, 1, 0))).toBeGreaterThan(.17)
          samples++
        }
        expect(samples).toBeGreaterThan(20)
        mixer.stopAllAction()
        skeleton.bones.forEach((bone, i) => bone.quaternion.copy(rest[i]))
        mesh.updateMatrixWorld(true)
      }
    }
  })

  it('fades smoothly at the capsule boundary and preserves unrelated influences', () => {
    const { bones } = limb('leg', 'l')
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      .41999, 1, 0, .42001, 1, 0, .18, 1, 0, .18, 1, 0
    ], 3))
    const indices = [0,1,2,0, 0,1,2,0, 0,1,2,0, 2,0,0,0]
    const weights = [.7,.2,.1,0, .7,.2,.1,0, .7,.2,.1,0, 1,0,0,0]
    new HumanoidJointWeightCorrector(geometry, bones).apply(indices, weights)
    expect(Math.abs(weights[0] - weights[4])).toBeLessThan(1e-5)
    expect(weights[10]).toBeCloseTo(.1, 8)
    expect(weights[8]).toBeCloseTo(.45, 6)
    expect(weights[9]).toBeCloseTo(.45, 6)
    expect(weights.slice(12)).toEqual([1,0,0,0])
  })
})
