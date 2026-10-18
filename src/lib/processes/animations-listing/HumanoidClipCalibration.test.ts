// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { AnimationClip, AnimationMixer, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three'
import { HumanoidClipCalibration, type HumanoidRestJoint } from './HumanoidClipCalibration.ts'
import { read_glb } from '../../../test/GlbFixture.ts'
import { AnimationUtility } from './AnimationUtility.ts'

const capture = (root: Group): Map<string, HumanoidRestJoint> => {
  const rest = new Map<string, HumanoidRestJoint>()
  root.traverse(bone => {
    if (!(bone instanceof Bone)) return
    rest.set(bone.name, { position: bone.position.clone(), quaternion: bone.quaternion.clone(),
      parent_name: bone.parent?.type === 'Bone' ? bone.parent.name : undefined })
  })
  return rest
}
const direction = (a: Bone, b: Bone): Vector3 => b.getWorldPosition(new Vector3()).sub(a.getWorldPosition(new Vector3())).normalize()

describe('Humanoid motion after joint fitting', () => {
  it('keeps the source arm direction after changing T to A, including an unanimated hand', () => {
    const source = new Group()
    const upper = new Bone(), lower = new Bone(), hand = new Bone(), digit = new Bone()
    upper.name = 'upperarm_l'; lower.name = 'lowerarm_l'; hand.name = 'hand_l'; digit.name = 'middle_01_l'
    source.add(upper); upper.add(lower); lower.add(hand); hand.add(digit)
    lower.position.set(1, 0, 0); hand.position.set(0.8, 0, 0); digit.position.set(0.2, 0, 0)
    const target = source.clone()
    const bones = new Map<string, Bone>()
    target.traverse(b => { if (b instanceof Bone) bones.set(b.name, b) })
    const a_pose = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 4)
    for (const b of bones.values()) b.position.applyQuaternion(a_pose).multiplyScalar(0.7)
    const clip = new AnimationClip('turn and bend', 1, [
      new QuaternionKeyframeTrack('upperarm_l.quaternion', [0, 1], [0, 0, 0, 1, ...new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1).toArray()]),
      new QuaternionKeyframeTrack('lowerarm_l.quaternion', [0, 1], [0, 0, 0, 1, ...new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1.5).toArray()])
    ])
    const fixed = clip.clone()
    new HumanoidClipCalibration(capture(source), capture(target)).apply(fixed, 1)
    const a = new AnimationMixer(source), b = new AnimationMixer(target)
    a.clipAction(clip).play(); b.clipAction(fixed).play()
    for (const t of [0, 0.25, 0.7, 0.99]) {
      a.setTime(t); b.setTime(t)
      for (const [start, end] of [[upper, lower], [lower, hand], [hand, digit]]) {
        const p = bones.get(start.name)!, q = bones.get(end.name)!
        expect(direction(start, end).dot(direction(p, q))).toBeGreaterThan(0.99999)
        expect(p.getWorldPosition(new Vector3()).distanceTo(q.getWorldPosition(new Vector3())))
          .toBeCloseTo(end.position.length() * 0.7, 5)
      }
    }
  })

  it('preserves the motion directions across every stock human clip on an edited A-pose', async () => {
    const rig = await read_glb('static/rigs/rig-human.glb')
    const source = rig.scene, target = source.clone()
    const source_bones = new Map<string, Bone>(), target_bones = new Map<string, Bone>()
    source.traverse(o => { if (o instanceof Bone) source_bones.set(o.name, o) })
    target.traverse(o => { if (o instanceof Bone) target_bones.set(o.name, o) })
    const changed = new Set(['lowerarm_l', 'hand_l', 'lowerarm_r', 'hand_r'])
    for (const [name, bone] of target_bones) {
      bone.position.multiplyScalar(0.8)
      if (changed.has(name)) bone.position.applyAxisAngle(new Vector3(1, 0, 0), 0.55)
    }
    const calibration = new HumanoidClipCalibration(capture(source), capture(target))
    const source_rest = capture(source), target_rest = capture(target)
    const chains = [['upperarm_l', 'lowerarm_l'], ['lowerarm_l', 'hand_l'], ['upperarm_r', 'lowerarm_r'],
      ['lowerarm_r', 'hand_r'], ['thigh_l', 'calf_l'], ['calf_l', 'foot_l']]
    let tested = 0
    for (const file of ['base', 'addon', 'mocap']) {
      const library = await read_glb('static/animations/human-' + file + '-animations.glb')
      AnimationUtility.clean_track_data(library.animations, 'pelvis')
      for (const clip of library.animations) {
        for (const [bones, rest] of [[source_bones, source_rest], [target_bones, target_rest]] as const) {
          for (const [name, bone] of bones) { bone.position.copy(rest.get(name)!.position); bone.quaternion.copy(rest.get(name)!.quaternion) }
        }
        const fixed = clip.clone(); calibration.apply(fixed, 1)
        const a = new AnimationMixer(source), b = new AnimationMixer(target)
        a.clipAction(clip).play(); b.clipAction(fixed).play()
        for (const fraction of [0.13, 0.51, 0.87]) {
          a.setTime(clip.duration * fraction); b.setTime(clip.duration * fraction)
          for (const [start, end] of chains) {
            const error = direction(source_bones.get(start)!, source_bones.get(end)!)
              .angleTo(direction(target_bones.get(start)!, target_bones.get(end)!))
            expect(error, clip.name + ': ' + start).toBeLessThan(0.0001)
          }
        }
        a.stopAllAction(); b.stopAllAction(); tested++
      }
    }
    expect(tested).toBeGreaterThanOrEqual(178)
  }, 20000)
})
