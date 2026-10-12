import { describe, expect, it } from 'vitest'
import { Bone, Quaternion, Skeleton, Vector3 } from 'three'
import { IndependentBoneMovement } from './IndependentBoneMovement'

const makeRig = () => {
  const root = new Bone(); root.name = 'root'
  const shoulder = new Bone(); shoulder.name = 'shoulder_l'; shoulder.position.set(0, 1, 0); root.add(shoulder)
  const upper = new Bone(); upper.name = 'upperarm_l'; upper.position.set(0.2, 0, 0); shoulder.add(upper)
  const fore = new Bone(); fore.name = 'forearm_l'; fore.position.set(0.3, -0.1, 0); upper.add(fore)
  const hand = new Bone(); hand.name = 'hand_l'; hand.position.set(0.3, 0, 0); fore.add(hand)
  const spine = new Bone(); spine.name = 'spine'; spine.position.set(0, 0.6, 0); root.add(spine)
  root.updateWorldMatrix(true, true)
  return { root, shoulder, upper, fore, hand, spine, skeleton: new Skeleton([root, shoulder, upper, fore, hand, spine]) }
}

describe('Arm rest frame at Bind Pose', () => {
  it('reorients fitted arm bone axes without moving wrist, elbow or unrelated spine', () => {
    const s = makeRig()
    const processor = new IndependentBoneMovement()
    processor.set_rest_pose(s.skeleton)
    const originalRestDirection = s.fore.getWorldPosition(new Vector3()).sub(s.upper.getWorldPosition(new Vector3())).normalize()

    // AutoRig/manual drags elbow and hand to a sloping forward arm.
    s.fore.position.set(0.27, -0.20, 0.25)
    s.hand.position.set(0.26, -0.15, 0.23)
    s.root.updateWorldMatrix(true, true)

    const expected = s.skeleton.bones.map(bone => bone.getWorldPosition(new Vector3()))
    const spineQuaternion = s.spine.quaternion.clone()
    processor.finalize_unrotated_arm_frames(s.skeleton)

    s.skeleton.bones.forEach((bone, i) => {
      expect(bone.getWorldPosition(new Vector3()).distanceTo(expected[i])).toBeLessThan(1e-5)
    })
    expect(s.spine.quaternion.angleTo(spineQuaternion)).toBeLessThan(1e-7)

    const newDirection = expected[3].clone().sub(expected[2]).normalize()
    const rotatedDirection = originalRestDirection.clone().applyQuaternion(s.upper.getWorldQuaternion(new Quaternion()))
    expect(rotatedDirection.angleTo(newDirection)).toBeLessThan(1e-4)

    const afterFirst = s.upper.quaternion.clone()
    processor.finalize_unrotated_arm_frames(s.skeleton)
    expect(s.upper.quaternion.angleTo(afterFirst)).toBeLessThan(1e-5)
  })

  it('preserves deliberate manual twist while aligning other joints', () => {
    const s = makeRig()
    const processor = new IndependentBoneMovement()
    processor.set_rest_pose(s.skeleton)
    s.fore.position.set(0.4, -0.20, 0.1)
    const manual = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.35)
    s.upper.quaternion.copy(manual)
    s.root.updateWorldMatrix(true, true)
    const originalPositions = s.skeleton.bones.map(bone => bone.getWorldPosition(new Vector3()))
    processor.finalize_unrotated_arm_frames(s.skeleton)
    expect(s.upper.quaternion.angleTo(manual)).toBeLessThan(1e-6)
    s.skeleton.bones.forEach((bone, i) => {
      expect(bone.getWorldPosition(new Vector3()).distanceTo(originalPositions[i])).toBeLessThan(1e-5)
    })
  })
})
