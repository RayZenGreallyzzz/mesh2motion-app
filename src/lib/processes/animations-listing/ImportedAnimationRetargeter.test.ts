// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { AnimationClip, AnimationMixer, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three'
import { MixamoMapper } from '../../../retarget/bone-automap/MixamoMapper.ts'
import { RestSpaceRetargeter } from '../../../retarget/RestSpaceRetargeter.ts'
import { retarget_imported_clips } from './ImportedAnimationRetargeter.ts'

function rig (mixamo = false): Group {
  const group = new Group()
  const add = (parent: Group | Bone, name: string, x: number, y: number, z = 0): Bone => {
    const b = new Bone()
    b.name = mixamo ? MixamoMapper.map_source_bone_name_to_mixamo(name) ?? name : name
    b.position.set(x, y, z); parent.add(b); return b
  }
  const root = add(group, 'root', 0, 0)
  const hips = add(root, 'pelvis', 0, 1)
  const a = add(hips, 'spine_01', 0, .15), b = add(a, 'spine_02', 0, .15), chest = add(b, 'spine_03', 0, .15)
  const neck = add(chest, 'neck_01', 0, .2); add(neck, 'head', 0, .15)
  for (const [side, sign] of [['l', 1], ['r', -1]] as const) {
    const clavicle = add(chest, 'clavicle_' + side, sign * .1, 0)
    const upper = add(clavicle, 'upperarm_' + side, sign * .15, 0)
    const lower = add(upper, 'lowerarm_' + side, sign * .3, 0)
    const hand = add(lower, 'hand_' + side, sign * .3, 0)
    add(hand, 'index_01_' + side, sign * .1, 0)
    if (!mixamo) add(hand, 'middle_01_' + side, sign * .1, 0)
    const thigh = add(hips, 'thigh_' + side, sign * .15, 0)
    const calf = add(thigh, 'calf_' + side, 0, -.45)
    add(calf, 'foot_' + side, 0, -.45)
  }
  return group
}
const spaces = (root: Group) => {
  const all = RestSpaceRetargeter.capture(root)
  const result = new Map([...all].filter(([name]) => root.getObjectByName(name)?.type === 'Bone'))
  return result
}
const direction = (root: Group, a: string, b: string) => root.getObjectByName(b)!.getWorldPosition(new Vector3())
  .sub(root.getObjectByName(a)!.getWorldPosition(new Vector3())).normalize()

describe('Mixamo import through the existing editor rig', () => {
  it('maps to fitted T/A poses, retains missing fingers, and preserves the input clips', () => {
    const source = rig(true), reference = rig(), target = rig()
    target.traverse(o => {
      if (o.type !== 'Bone') return
      o.position.multiplyScalar(.8)
      if (/^(lowerarm|hand)_[lr]$/.test(o.name)) o.position.applyAxisAngle(new Vector3(0,0,1), o.name.endsWith('_l') ? -.6 : .6)
    })
    const from = 'mixamorigLeftForeArm'
    const q = new Quaternion().setFromAxisAngle(new Vector3(0,0,1), 1.4)
    const clip = new AnimationClip('Mixamo bend', 2, [new QuaternionKeyframeTrack(from + '.quaternion', [0,1], [0,0,0,1,...q.toArray()])])
    const input = Array.from(clip.tracks[0].values)
    const sourceRest = spaces(source), targetRest = spaces(target), referenceRest = spaces(reference)
    const expected = retarget_imported_clips([clip], sourceRest, referenceRest)[0]
    const converted = retarget_imported_clips([clip], sourceRest, targetRest, referenceRest)[0]
    expect(Array.from(clip.tracks[0].values)).toEqual(input)
    expect(converted.tracks.every(t => targetRest.has(t.name.slice(0,t.name.lastIndexOf('.'))))).toBe(true)
    const a = new AnimationMixer(reference), b = new AnimationMixer(target)
    a.clipAction(expected).play(); b.clipAction(converted).play()
    for (const time of [0,.2,.6,.99]) {
      a.setTime(time); b.setTime(time)
      for (const [start, end] of [['upperarm_l','lowerarm_l'],['lowerarm_l','hand_l'],['hand_l','middle_01_l']]) {
        expect(direction(reference,start,end).dot(direction(target,start,end))).toBeGreaterThan(.99999)
      }
      expect(target.getObjectByName('hand_l')!.position.length()).toBeCloseTo(.24,6)
    }
  })

  it('accepts different Mixamo prefixes and optional thumb bones on a ready rig', () => {
    const source = rig(true), target = rig(true)
    source.traverse(o => { o.name = o.name.replace('mixamorig','mixamorig:') })
    const hand = source.getObjectByName('mixamorig:LeftHand')!
    const thumb = new Bone(); thumb.name = 'mixamorig:LeftHandThumb1'; hand.add(thumb)
    const clip = new AnimationClip('idle', 1, [new QuaternionKeyframeTrack('mixamorig:LeftHandThumb1.quaternion',[0],[0,0,0,1]),
      new QuaternionKeyframeTrack('mixamorig:Hips.quaternion',[0],[0,0,0,1])])
    const [result] = retarget_imported_clips([clip],spaces(source),spaces(target))
    expect(result.tracks.every(t => !t.name.includes('Thumb'))).toBe(true)
    expect(result.tracks.some(t => t.name === 'mixamorigHips.quaternion')).toBe(true)
  })

  it('rejects an incomplete body and keeps unknown legacy tracks visible to validation', () => {
    const source = rig(true), target = rig()
    source.getObjectByName('mixamorigLeftForeArm')!.name = 'missing_forearm'
    const clip = new AnimationClip('bad',1,[new QuaternionKeyframeTrack('mixamorigHips.quaternion',[0],[0,0,0,1])])
    expect(() => retarget_imported_clips([clip],spaces(source),spaces(target))).toThrow(/lowerarm_l/)
    const legacy = new AnimationClip('legacy',1,[new QuaternionKeyframeTrack('foreign.quaternion',[0],[0,0,0,1])])
    target.name = 'Mixamo_Imported_Model'
    const result = retarget_imported_clips([legacy],spaces(target),spaces(target))[0]
    expect(result.tracks.map(t => t.name)).toEqual(['foreign.quaternion'])
  })
})
