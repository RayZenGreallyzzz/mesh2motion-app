import { describe, expect, it } from 'vitest'
import { Bone, Object3D } from 'three'
import { HandSkeletonType } from '../../enums/SkeletonType'
import { HandHelper } from './HandHelper'

function rig (): Object3D {
  const root = new Object3D()
  for (const side of ['l', 'r']) {
    const hand = new Bone()
    hand.name = 'hand_' + side
    root.add(hand)
    for (const digit of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      let parent = hand
      for (let segment = 1; segment <= 3; segment++) {
        const bone = new Bone()
        bone.name = digit + '_0' + segment + '_' + side
        parent.add(bone)
        parent = bone
      }
      const leaf = new Bone()
      leaf.name = digit + '_04_leaf_' + side
      parent.add(leaf)
    }
  }
  return root
}

function digitRoots (root: Object3D, side: string): string[] {
  const names: string[] = []
  root.traverse(obj => {
    if (obj.type === 'Bone' && obj.name.endsWith('_01_' + side)) {
      names.push(obj.name.split('_')[0])
    }
  })
  return names.sort()
}

describe('HandHelper digit count', () => {
  const choices: Array<[HandSkeletonType, string[]]> = [
    [HandSkeletonType.OneFinger, ['middle']],
    [HandSkeletonType.TwoFingers, ['index', 'thumb']],
    [HandSkeletonType.ThreeFingers, ['index', 'middle', 'thumb']],
    [HandSkeletonType.FiveFingers, ['index', 'middle', 'pinky', 'ring', 'thumb']]
  ]

  it.each(choices)('retains the selected digits on both hands: %s', (mode, names) => {
    const skeleton = rig()
    new HandHelper().modify_hand_skeleton(skeleton, mode)
    for (const side of ['l', 'r']) {
      expect(digitRoots(skeleton, side)).toEqual(names)
      expect(skeleton.getObjectByName('hand_' + side)).toBeDefined()
      const remainingLeaves: string[] = []
      skeleton.traverse(obj => {
        if (obj.name.endsWith('_04_leaf_' + side)) remainingLeaves.push(obj.name)
      })
      expect(remainingLeaves).toEqual([])
    }
  })
})
