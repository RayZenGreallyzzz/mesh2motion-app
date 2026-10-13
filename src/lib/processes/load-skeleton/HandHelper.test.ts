import { describe, expect, it } from 'vitest'
import { Bone, Object3D } from 'three'
import { HandSkeletonType } from '../../enums/SkeletonType'
import { HandHelper } from './HandHelper'

function buildHandRig (): Object3D {
  const root = new Object3D()
  for (const side of ['l', 'r']) {
    const wrist = new Bone(); wrist.name = 'wrist_' + side
    const hand = new Bone(); hand.name = 'hand_' + side
    root.add(wrist); wrist.add(hand)
    for (const digit of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      let parent = hand
      for (let joint = 1; joint <= 3; joint++) {
        const bone = new Bone()
        bone.name = digit + '_0' + joint + '_' + side
        parent.add(bone); parent = bone
      }
      const tip = new Bone(); tip.name = digit + '_leaf_' + side
      parent.add(tip)
    }
  }
  return root
}

describe('Rig Animation Studio hand digit choices', () => {
  it.each([
    [HandSkeletonType.OneFinger, ['middle']],
    [HandSkeletonType.TwoFingers, ['index', 'thumb']],
    [HandSkeletonType.ThreeFingers, ['index', 'middle', 'thumb']],
    [HandSkeletonType.FiveFingers, ['index', 'middle', 'pinky', 'ring', 'thumb']]
  ] as const)('keeps only required digits for both hands with %s', (mode, expected) => {
    const rig = buildHandRig()
    new HandHelper().modify_hand_skeleton(rig, mode)
    for (const side of ['l', 'r']) {
      const found: string[] = []
      for (const name of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
        if (rig.getObjectByName(name + '_01_' + side)) found.push(name)
      }
      expect(found.sort()).toEqual([...expected])
      expect(rig.getObjectByName('hand_' + side)).toBeDefined()
      expect(rig.getObjectByName('wrist_' + side)).toBeDefined()
      expect(rig.getObjectByName('middle_02_' + side) !== undefined).toBe(expected.includes('middle'))
      expect(rig.getObjectByName('thumb_leaf_' + side)).toBeUndefined()
    }
  })
})
