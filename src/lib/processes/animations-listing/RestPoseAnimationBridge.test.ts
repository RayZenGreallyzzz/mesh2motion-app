import { describe, expect, it } from 'vitest'
import {
  AnimationClip,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack
} from 'three'
import {
  RestPoseAnimationBridge,
  type AnimationRestTransform
} from './RestPoseAnimationBridge.ts'

const rest = (position = new Vector3(), quaternion = new Quaternion()): AnimationRestTransform => ({
  position, quaternion
})

const quaternionAt = (track: QuaternionKeyframeTrack, index: number): Quaternion => {
  const offset = index * 4
  return new Quaternion(
    track.values[offset], track.values[offset + 1],
    track.values[offset + 2], track.values[offset + 3]
  ).normalize()
}

describe('Mobile Female bind-space animation conversion', () => {
  it('keeps edited rest orientation and applies source animation deltas', () => {
    const axis = new Vector3(0, 0, 1)
    const sourceRest = new Quaternion().setFromAxisAngle(axis, Math.PI / 6)
    const targetRest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 3)
    const sourceDelta = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 4)
    const animatedSource = sourceRest.clone().multiply(sourceDelta)

    const rotation = new QuaternionKeyframeTrack(
      'upperarm_l.quaternion', [0, 1],
      [...sourceRest.toArray(), ...animatedSource.toArray()]
    )
    const clip = new AnimationClip('arm', 1, [rotation])
    const source = new Map([['upperarm_l', rest(new Vector3(), sourceRest)]])
    const target = new Map([['upperarm_l', rest(new Vector3(), targetRest)]])

    RestPoseAnimationBridge.rebase_clip_to_rest_pose(clip, source, target)

    expect(Math.abs(quaternionAt(rotation, 0).dot(targetRest))).toBeCloseTo(1, 5)
    const expected = targetRest.clone().multiply(sourceDelta)
    expect(Math.abs(quaternionAt(rotation, 1).dot(expected))).toBeCloseTo(1, 5)
    // Working maps must not be mutated by one clip: all 178 share the same rest.
    expect(Math.abs(source.get('upperarm_l')!.quaternion.dot(sourceRest))).toBeCloseTo(1, 6)
  })

  it('does not replace the edited pelvis joint with the stock absolute position', () => {
    const pelvisPosition = new VectorKeyframeTrack(
      'pelvis.position', [0, 1],
      [0, 1, 0, 0.12, 1.3, 0.05]
    )
    const clip = new AnimationClip('move', 1, [pelvisPosition])
    const source = new Map([['pelvis', rest(new Vector3(0, 1, 0))]])
    const target = new Map([['pelvis', rest(new Vector3(0, 1.72, 0.15))]])

    RestPoseAnimationBridge.rebase_clip_to_rest_pose(clip, source, target)

    expect(Array.from(pelvisPosition.values)).toEqual(expect.arrayContaining([0]))
    expect(pelvisPosition.values[1]).toBeCloseTo(1.72, 5)
    expect(pelvisPosition.values[2]).toBeCloseTo(0.15, 5)
    expect(pelvisPosition.values[3]).toBeCloseTo(0.12, 5)
    expect(pelvisPosition.values[4]).toBeCloseTo(2.02, 5)
    expect(pelvisPosition.values[5]).toBeCloseTo(0.20, 5)
  })

  it('accounts for the scaled source rest and supports .bones[name] track bindings', () => {
    // AnimationLoader has already multiplied position keys by 2.
    const pelvisPosition = new VectorKeyframeTrack(
      '.bones[pelvis].position', [0, 1], [0, 2, 0, 0, 2.2, 0]
    )
    const clip = new AnimationClip('scaled', 1, [pelvisPosition])
    const source = new Map([['pelvis', rest(new Vector3(0, 1, 0))]])
    const target = new Map([['pelvis', rest(new Vector3(0, 3, 0))]])

    RestPoseAnimationBridge.rebase_clip_to_rest_pose(clip, source, target, 2)

    expect(pelvisPosition.values[1]).toBeCloseTo(3, 5)
    expect(pelvisPosition.values[4]).toBeCloseTo(3.2, 5)
  })

  it('leaves non-matching bones and non-pose tracks unchanged', () => {
    const unmapped = new QuaternionKeyframeTrack('missing.quaternion', [0], [0, 0, 0, 1])
    const position = new VectorKeyframeTrack('pelvis.position', [0], [0, 5, 0])
    const clip = new AnimationClip('other', 1, [unmapped, position])
    RestPoseAnimationBridge.rebase_clip_to_rest_pose(clip, new Map(), new Map())

    expect([...unmapped.values]).toEqual([0, 0, 0, 1])
    expect([...position.values]).toEqual([0, 5, 0])
  })
})
