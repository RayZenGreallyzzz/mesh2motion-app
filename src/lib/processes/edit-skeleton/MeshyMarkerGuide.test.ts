import { describe, expect, it } from 'vitest'
import { Bone } from 'three'
import { find_meshy_marker_bone, MESHY_HUMAN_MARKERS } from './MeshyMarkerGuide'

const create = (name: string): Bone => {
  const b = new Bone()
  b.name = name
  return b
}

describe('Meshy-inspired 12-marker guide', () => {
  it('contains the 12 anatomical landmarks', () => {
    expect(Object.keys(MESHY_HUMAN_MARKERS)).toHaveLength(12)
  })

  it('maps our Human hierarchy without confusing left and right', () => {
    const bones = ['head', 'pelvis', 'upperarm_l', 'upperarm_r',
      'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r',
      'shin_l', 'shin_r', 'foot_l', 'foot_r'].map(create)
    expect(find_meshy_marker_bone(bones, 'left-elbow')?.name).toBe('lowerarm_l')
    expect(find_meshy_marker_bone(bones, 'right-elbow')?.name).toBe('lowerarm_r')
    expect(find_meshy_marker_bone(bones, 'left-wrist')?.name).toBe('hand_l')
    expect(find_meshy_marker_bone(bones, 'right-ankle')?.name).toBe('foot_r')
    for (const marker of Object.keys(MESHY_HUMAN_MARKERS)) {
      expect(find_meshy_marker_bone(bones, marker)).not.toBeNull()
    }
  })

  it('maps namespaced Mixamo bones, never guessing a joint on unknown rigs', () => {
    const bones = ['mixamorig:Hips', 'mixamorig:Head',
      'mixamorig:LeftArm', 'mixamorig:RightArm',
      'mixamorig:LeftForeArm', 'mixamorig:RightForeArm',
      'mixamorig:LeftHand', 'mixamorig:RightHand',
      'mixamorig:LeftLeg', 'mixamorig:RightLeg',
      'mixamorig:LeftFoot', 'mixamorig:RightFoot'].map(create)
    expect(find_meshy_marker_bone(bones, 'left-shoulder')?.name).toBe('mixamorig:LeftArm')
    expect(find_meshy_marker_bone(bones, 'right-knee')?.name).toBe('mixamorig:RightLeg')
    expect(find_meshy_marker_bone(bones, 'groin')?.name).toBe('mixamorig:Hips')
    expect(find_meshy_marker_bone(bones, 'unknown')).toBeNull()
    expect(find_meshy_marker_bone([create('tail_01')], 'left-elbow')).toBeNull()
  })
})
