import { describe, expect, it } from 'vitest'
import { Bone, Group, Matrix4, Quaternion, Skeleton, Vector3 } from 'three'
import { RigRestPoseSnapshot } from './RigRestPoseSnapshot'

describe('Universal manual/auto rest pose reset', () => {
  it.each(['manual humanoid', 'auto quadruped', 'manual dragon'])(
    'restores exact edited joint positions and rotations for %s',
    () => {
      const root = new Group()
      root.name = 'root'
      root.position.set(0.4, -0.3, 1.1)
      const hip = new Bone()
      hip.name = 'hips'
      hip.position.set(1.2, 1, -0.1)
      hip.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 7)
      root.add(hip)
      const limb = new Bone()
      limb.name = 'wing_or_arm'
      limb.position.set(0.6, 0.4, 0.2)
      limb.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -0.42)
      hip.add(limb)
      root.updateWorldMatrix(true, true)

      const skeleton = new Skeleton([hip, limb])
      skeleton.calculateInverses()

      // Deliberately break the current transforms while retaining the saved rest.
      const snapshots = new RigRestPoseSnapshot()
      snapshots.remember(skeleton)
      const expected = hip.matrixWorld.clone()
      const childExpected = limb.matrixWorld.clone()

      hip.position.set(8, 9, 10)
      hip.quaternion.identity()
      limb.position.set(7, 8, 9)
      limb.quaternion.identity()
      root.position.set(-6, -7, -8)
      root.updateWorldMatrix(true, true)

      expect(snapshots.restore(skeleton)).toBe(true)
      expect(hip.matrixWorld.elements).toEqual(expected.elements)
      expect(limb.matrixWorld.elements).toEqual(childExpected.elements)
      expect(hip.quaternion.equals(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 7))).toBe(true)
    }
  )

  it('does not restore an unrelated skeleton or stale state', () => {
    const snapshots = new RigRestPoseSnapshot()
    expect(snapshots.restore(new Skeleton([new Bone()]))).toBe(false)
  })
})
