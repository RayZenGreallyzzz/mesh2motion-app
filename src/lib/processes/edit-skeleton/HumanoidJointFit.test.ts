// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Bone, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, LatheGeometry, Mesh, Skeleton, Vector2, Vector3 } from 'three'
import { read_glb } from '../../../test/GlbFixture.ts'
import { joint_character } from '../../../test/HumanoidJointFixture.ts'
import { fit_humanoid_rig } from './HumanoidAutoFit.ts'
import { estimate_limb_joint, joint_fit_surface, refine_humanoid_joints } from './HumanoidJointFit.ts'

async function template () {
  const rig = (await read_glb('static/rigs/rig-human.glb')).scene
  const bones: Bone[] = []
  rig.traverse(b => { if (b instanceof Bone) bones.push(b) })
  return { rig, bones, skeleton: new Skeleton(bones) }
}

describe('Anatomical elbow and knee fitting', () => {
  it.each(['human', 'woman'] as const)('fits %s to different limb proportions and keeps repeated fits stable', async profile => {
    for (const kneeY of [.40, .57, .72]) for (const elbowX of [.54, .68]) {
      const model = joint_character(kneeY, elbowX), { bones, skeleton } = await template()
      expect(fit_humanoid_rig(model, skeleton, null, () => {}, profile)).toBe('T-pose')
      for (const [side, sign] of [['l', 1], ['r', -1]] as const) {
        const elbow = bones.find(b => b.name === 'lowerarm_' + side)!, knee = bones.find(b => b.name === 'calf_' + side)!
        expect(elbow.getWorldPosition(new Vector3()).distanceTo(new Vector3(sign * elbowX, 1.51, 0))).toBeLessThan(.018)
        expect(knee.getWorldPosition(new Vector3()).distanceTo(new Vector3(sign * .19, kneeY, 0))).toBeLessThan(.018)
        expect(elbow.userData.rigJointFit.source).toBe('surface')
        expect(knee.userData.rigJointFit.source).toBe('surface')
      }
      const saved = bones.map(b => b.position.clone())
      fit_humanoid_rig(model, skeleton, null, () => {}, profile)
      bones.forEach((b, i) => expect(b.position.distanceTo(saved[i])).toBeLessThan(1e-6))
    }
  })

  it.each(['human', 'woman'] as const)('uses the %s A-pose surface after shoulder fitting', async profile => {
    const model = joint_character(.64, .58, 'A'), { bones, skeleton } = await template()
    fit_humanoid_rig(model, skeleton, null, () => {}, profile)
    for (const [side, sign] of [['l', 1], ['r', -1]] as const) {
      const shoulder = new Vector3(sign * .23, 1.51, 0)
      const expected = new Vector3(sign * .58, 1.51, 0).sub(shoulder)
        .applyAxisAngle(new Vector3(0, 0, 1), -sign * .45).add(shoulder)
      const elbow = bones.find(b => b.name === 'lowerarm_' + side)!
      expect(elbow.getWorldPosition(new Vector3()).distanceTo(expected)).toBeLessThan(.025)
      expect(elbow.userData.rigJointFit.source).toBe('surface')
    }
  })

  it('finds a bend without a radius notch and refuses featureless or incomplete surfaces', () => {
    const tube = new BufferGeometry(), values: number[] = []
    const rings: Vector3[][] = []
    for (let ring = 0; ring <= 40; ring++) {
      const t = ring / 40, x = t > .57 ? (t - .57) * .65 : 0
      rings.push(Array.from({ length: 24 }, (_, segment) => {
        const a = segment / 24 * Math.PI * 2
        return new Vector3(.3 + x + Math.cos(a) * .045, t, Math.sin(a) * .045)
      }))
    }
    for (let ring = 0; ring < rings.length - 1; ring++) for (let s = 0; s < 24; s++) {
      const n = (s + 1) % 24
      for (const p of [rings[ring][s], rings[ring + 1][s], rings[ring][n], rings[ring][n], rings[ring + 1][s], rings[ring + 1][n]]) values.push(...p.toArray())
    }
    tube.setAttribute('position', new Float32BufferAttribute(values, 3))
    const estimate = estimate_limb_joint(joint_fit_surface(new Mesh(tube), null), new Vector3(.3, 0, 0),
      new Vector3(.3 + .43 * .65, 1, 0), new Vector3(.4, .5, 0), 0)
    expect(estimate?.evidence).toBe('bend')
    expect(estimate!.point.distanceTo(new Vector3(.3, .57, 0))).toBeLessThan(.035)
    const plain = new Mesh(new CylinderGeometry(.05, .05, 1, 24, 1, true))
    plain.position.set(.3, .5, 0)
    const args = [new Vector3(.3, 0, 0), new Vector3(.3, 1, 0), new Vector3(.3, .5, 0)] as const
    expect(estimate_limb_joint(joint_fit_surface(plain, null), ...args, 0)).toBeNull()
    expect(estimate_limb_joint(new Float32Array(), ...args, 0)).toBeNull()
    const open = new Mesh(new LatheGeometry([
      new Vector2(.08, 0), new Vector2(.04, .55), new Vector2(.08, 1)
    ], 24, 0, Math.PI))
    open.position.x = .3
    expect(estimate_limb_joint(joint_fit_surface(open, null), ...args, 0)).toBeNull()
  })

  it('respects the setup frame, scale, triangle seams and invisible accessories', async () => {
    const model = joint_character(.64, .58), { rig, bones, skeleton } = await template()
    const setup = new Group()
    setup.position.set(3, -2, 5); setup.rotation.set(.2, .7, -.12); setup.scale.setScalar(2.3)
    setup.add(model, rig); setup.updateWorldMatrix(true, true)
    const hidden = new Mesh(new CylinderGeometry(3, 3, 4)); hidden.visible = false; model.add(hidden)
    // The existing coarse fit samples visible geometry, just like refinement.
    fit_humanoid_rig(model, skeleton, setup, () => {})
    const inverse = setup.matrixWorld.clone().invert()
    const knee = bones.find(b => b.name === 'calf_l')!.getWorldPosition(new Vector3()).applyMatrix4(inverse)
    expect(knee.distanceTo(new Vector3(.19, .64, 0))).toBeLessThan(.018)
    const original = joint_fit_surface(model, setup)
    model.visible = false
    model.traverse(o => {
      const mesh = o as Mesh
      if (!mesh.geometry?.index) return
      mesh.geometry = mesh.geometry.toNonIndexed()
    })
    const duplicated = joint_fit_surface(model, setup)
    expect(duplicated).toEqual(original)
  })

  it('keeps wrists, ankles and toe offsets when the parent joints move', async () => {
    const model = joint_character(.64, .58), { bones, skeleton } = await template()
    fit_humanoid_rig(model, skeleton, null, () => {})
    const at = (name: string) => bones.find(b => b.name === name)!
    const start = at('upperarm_l'), joint = at('lowerarm_l'), end = at('hand_l')
    const thigh = at('thigh_l'), knee = at('calf_l'), ankle = at('foot_l')
    // Simulate editable joints moved away from the real landmark, keeping the
    // distal endpoint in place, as the correction pass must do in the app.
    const wrist = end.getWorldPosition(new Vector3()), foot = ankle.getWorldPosition(new Vector3())
    const place = (bone: Bone, p: Vector3) => {
      bone.parent!.updateWorldMatrix(true, false)
      bone.position.copy(bone.parent!.worldToLocal(p))
      bone.updateWorldMatrix(true, true)
    }
    place(joint, joint.getWorldPosition(new Vector3()).add(new Vector3(.06, 0, 0))); place(end, wrist.clone())
    place(knee, knee.getWorldPosition(new Vector3()).add(new Vector3(0, .07, 0))); place(ankle, foot.clone())
    const toePositions = ankle.children.map(b => b.getWorldPosition(new Vector3()))
    const rotations = bones.map(b => b.quaternion.clone())
    refine_humanoid_joints(model, [{ start, joint, end, kind: 'elbow' }, { start: thigh, joint: knee, end: ankle, kind: 'knee' }], null, 0)
    expect(end.getWorldPosition(new Vector3()).distanceTo(wrist)).toBeLessThan(1e-6)
    expect(ankle.getWorldPosition(new Vector3()).distanceTo(foot)).toBeLessThan(1e-6)
    ankle.children.forEach((b, i) => expect(b.getWorldPosition(new Vector3()).distanceTo(toePositions[i])).toBeLessThan(1e-6))
    bones.forEach((b, i) => expect(b.quaternion.toArray()).toEqual(rotations[i].toArray()))
  })
})
