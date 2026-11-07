import { describe, expect, it } from 'vitest'
import { AnimationClip, AnimationMixer, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { PoseCalibration, restore_calibrated_export_pose } from '../src/lib/pose/PoseCalibration.ts'
import { AnimationUtility } from '../src/lib/processes/animations-listing/AnimationUtility.ts'

function setup() {
  const root = new Bone(); root.name = 'root'
  const upper = new Bone(); upper.name = 'front_leg_upper_r'; upper.position.set(-0.15, 1, 0); root.add(upper)
  const knee = new Bone(); knee.name = 'front_leg_lower_r'; knee.position.set(0, -0.45, 0); upper.add(knee)
  const foot = new Bone(); foot.name = 'front_leg_foot_r'; foot.position.set(0, -0.45, 0); knee.add(foot)
  const helper = new Bone(); helper.name = 'rig_volume_front_leg_lower_r'; helper.position.copy(knee.position); upper.add(helper)
  const group = new Group(); group.add(root); group.updateMatrixWorld(true)
  return { root, upper, knee, foot, helper, group, calibration: new PoseCalibration([root, upper, knee, foot, helper]) }
}
describe('initial pose calibration', () => {
  it('bakes the same local correction into all frames, preserves originals and mirrors in target space', () => {
    const { knee, helper, calibration: c } = setup()
    const source = new AnimationClip('Walk', 1, [new QuaternionKeyframeTrack(knee.name + '.quaternion', [0, 1], [0, 0, 0, 1, 0.1, 0, 0, Math.sqrt(.99)])])
    const original = Array.from(source.tracks[0].values)
    c.begin(); c.set(knee, [30, 0, 0], [0, .02, 0]); c.commit()
    const copy = source.clone(); c.apply_clip(copy)
    const offset = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 6)
    for (let i = 0; i < 2; i++) expect(new Quaternion().fromArray(copy.tracks[0].values, i * 4).angleTo(offset.clone().multiply(new Quaternion().fromArray(original, i * 4)))).toBeLessThan(.001)
    expect(Array.from(source.tracks[0].values)).toEqual(original)
    expect(copy.tracks.some(t => t.name === helper.name + '.quaternion')).toBe(true)
    const once = copy.tracks.map(t => Array.from(t.values)); c.apply_clip(copy)
    expect(copy.tracks.map(t => Array.from(t.values))).toEqual(once)
    const mirror = AnimationUtility.create_mirrored_clip(copy)
    const unposedMirror = AnimationUtility.create_mirrored_clip(source); c.apply_clip(unposedMirror)
    expect(mirror.tracks.map(t => Array.from(t.values))).toEqual(unposedMirror.tracks.map(t => Array.from(t.values)))
    const exported = new Bone(); expect(restore_calibrated_export_pose(knee, exported)).toBe(true)
    expect(exported.quaternion.angleTo(offset)).toBeLessThan(.00001)
  })
  it('keeps GLTF cubic quaternion tangents linear and translation tangents unchanged', () => {
    const { knee, calibration: c } = setup()
    const q = new QuaternionKeyframeTrack(knee.name + '.quaternion', [0], [1, 2, 3, 4, 0, 0, 0, 1, 5, 6, 7, 8])
    const p = new VectorKeyframeTrack(knee.name + '.position', [0], [1, 2, 3, 0, -.45, 0, 4, 5, 6])
    const clip = new AnimationClip('Cubic', 1, [q, p]); c.begin(); c.set(knee, [45, 0, 0], [0, .1, 0]); c.commit(); c.apply_clip(clip)
    expect(Array.from(p.values.slice(0, 3))).toEqual([1, 2, 3]); expect(Array.from(p.values.slice(6))).toEqual([4, 5, 6]); expect(p.values[4]).toBeCloseTo(-.35)
    expect(new Quaternion().fromArray(q.values).length()).toBeCloseTo(Math.sqrt(30))
    expect(new Quaternion().fromArray(q.values, 4).length()).toBeCloseTo(1)
  })
  it('provides missing channels, resets reversibly, and does not drift on clip switching', () => {
    const { root, knee, calibration: c, group } = setup()
    c.begin(); c.set(knee, [20, 0, 0], [0, .03, 0]); c.cancel(); expect(knee.position.y).toBe(-.45); expect(c.has_changes).toBe(false)
    c.begin(); c.set(knee, [20, 0, 0], [0, .03, 0]); c.commit()
    const clips = [0, 1].map(i => new AnimationClip('Test' + i, 1, [new VectorKeyframeTrack(root.name + '.position', [0, 1], [0, 0, 0, 0, 0, .1])]))
    clips.forEach(clip => c.apply_clip(clip)); const mixer = new AnimationMixer(group)
    for (const clip of [...clips, ...clips]) { mixer.stopAllAction(); c.restore_bind(); mixer.clipAction(clip).play(); mixer.update(.4); expect(knee.position.y).toBeCloseTo(-.42); expect(knee.rotation.x).toBeCloseTo(Math.PI / 9) }
    mixer.stopAllAction(); c.begin(); c.reset_working(); c.commit(); expect(c.has_changes).toBe(false)
    expect(restore_calibrated_export_pose(knee, new Bone())).toBe(false)
  })
  it('lowers a bent foot without moving the root or changing segment lengths', () => {
    const { root, upper, knee, foot, group, calibration: unused } = setup()
    upper.rotation.x = .5; knee.rotation.x = -1; group.updateMatrixWorld(true)
    const c = new PoseCalibration([root, upper, knee, foot]), lengths = [upper, knee, foot].map(b => b.position.length())
    c.begin(); const result = c.lower_to_floor(foot, .18)
    expect(result.error).toBeLessThan(.001); expect(foot.getWorldPosition(new Vector3()).y).toBeCloseTo(.18, 3)
    expect(root.position.length()).toBe(0); expect(root.quaternion.angleTo(new Quaternion())).toBe(0)
    expect([upper, knee, foot].map(b => b.position.length())).toEqual(lengths)
    c.cancel(); expect(upper.rotation.x).toBeCloseTo(.5); expect(knee.rotation.x).toBeCloseTo(-1)
  })
})
