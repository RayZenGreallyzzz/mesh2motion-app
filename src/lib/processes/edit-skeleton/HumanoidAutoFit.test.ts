// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Bone, Box3, Skeleton, Vector3 } from 'three'
import { read_glb } from '../../../test/GlbFixture.ts'
import { fit_humanoid_rig } from './HumanoidAutoFit.ts'
import { ModelCleanupUtility } from '../load-model/ModelCleanupUtility.ts'
import { capture_hand_shape, place_hand_shape } from './HandPose.ts'

describe('Humanoid fitting against real geometry', () => {
  it('keeps shoulders on the torso and reserves enough space for the whole hand', async () => {
    const model = (await read_glb('static/models/model-human.glb')).scene
    ModelCleanupUtility.bake_transforms_into_geometry(model)
    const clean = ModelCleanupUtility.strip_out_all_unecessary_model_data(model, 'human', false)
    ModelCleanupUtility.move_model_to_floor(clean)
    const rig = (await read_glb('static/rigs/rig-human.glb')).scene
    const bones: Bone[] = []
    rig.traverse(b => { if (b instanceof Bone) bones.push(b) })
    const box = new Box3().setFromObject(clean), size = box.getSize(new Vector3())
    fit_humanoid_rig(clean, new Skeleton(bones), null, () => {})
    const at = (name: string) => bones.find(b => b.name === name)!.getWorldPosition(new Vector3())
    for (const side of ['l', 'r']) {
      const shoulder = at('upperarm_' + side), elbow = at('lowerarm_' + side), wrist = at('hand_' + side)
      expect(Math.abs(shoulder.x)).toBeLessThan(size.y * 0.21)
      expect(shoulder.distanceTo(elbow)).toBeGreaterThan(size.y * 0.10)
      expect(elbow.distanceTo(wrist)).toBeGreaterThan(size.y * 0.10)
      for (const bone of bones.filter(b => /thumb|index|middle|ring|pinky/.test(b.name))) {
        const p = bone.getWorldPosition(new Vector3())
        expect(p.x).toBeGreaterThan(box.min.x - size.y * 0.01)
        expect(p.x).toBeLessThan(box.max.x + size.y * 0.01)
      }
    }
  })

  it('turns all finger joints with the forearm and remains reversible', async () => {
    const rig = (await read_glb('static/rigs/rig-human.glb')).scene
    const hand = rig.getObjectByName('hand_l') as Bone, fore = rig.getObjectByName('lowerarm_l') as Bone
    const original = capture_hand_shape(hand, fore)
    const down = new Vector3(0.5, -0.866, 0).normalize()
    place_hand_shape(hand, original, down)
    const fitted = capture_hand_shape(hand, fore)
    fitted.direction.copy(down)
    const middle = rig.getObjectByName('middle_04_leaf_l') as Bone
    expect(middle.getWorldPosition(new Vector3()).sub(hand.getWorldPosition(new Vector3())).normalize().dot(down)).toBeGreaterThan(0.95)
    place_hand_shape(hand, fitted, original.direction)
    const restored = capture_hand_shape(hand, fore)
    for (const [bone, offset] of original.offsets) expect(restored.offsets.get(bone)!.distanceTo(offset)).toBeLessThan(1e-6)
  })
})
