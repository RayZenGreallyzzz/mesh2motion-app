// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, Quaternion, Vector3 } from 'three'
import { AnimalAutoFit } from '../src/lib/processes/edit-skeleton/AnimalAutoFit.ts'
import { fit_quadruped_limbs, quadruped_limbs } from '../src/lib/processes/edit-skeleton/QuadrupedLimbFit.ts'

describe('quadruped limb fitting', () => {
  it('resolves complete native, lowercase horse and imported dotted chains', () => {
    for (const format of ['native', 'horse', 'pack']) {
      const names: string[] = []
      for (const end of ['Front', 'Back']) for (const side of ['L', 'R']) {
        for (const role of ['Upper', 'Lower', 'Foot']) names.push(format === 'pack' ? `${end}${role}Leg.${side}` : `${end}_Leg_${role}_${side}`)
        names.push(`${end}_Leg_Foot_1_${side}`, `${end}_Leg_Tip_${side}`, `${end}_Leg_Leaf_${side}`)
      }
      const input = format === 'horse' ? names.map(n => n.toLowerCase()) : names
      const limbs = quadruped_limbs(input)
      expect(limbs).toHaveLength(4)
      expect(limbs.every(l => l.names.length === 6)).toBe(true)
      expect(quadruped_limbs([...input, 'OtherFrontUpperLeg.L'])).toHaveLength(3)
    }
    expect(quadruped_limbs(['LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg'])).toHaveLength(0)
  })

  it('fits each paw independently, including a lifted front leg, without following a tall horn', () => {
    const model = new Group(), initial = new Map<string, Vector3>()
    const body = new Mesh(new BoxGeometry(.7, .5, 1.6)); body.position.y = 1; model.add(body)
    const horn = new Mesh(new BoxGeometry(.04, 2, .04)); horn.position.set(0, 2, .3); model.add(horn)
    for (const front of [true, false]) for (const side of ['L', 'R']) {
      const x = side === 'L' ? .25 : -.25, z = front ? .6 : -.6
      const floor = front && side === 'L' ? .4 : 0
      const leg = new Mesh(new BoxGeometry(.16, 1 - floor, .18)); leg.position.set(x, (1 + floor) / 2, z); model.add(leg)
      const name = front ? 'Front' : 'Back'
      initial.set(`${name}_Leg_Upper_${side}`, new Vector3(x * 1.8, .95, z))
      initial.set(`${name}_Leg_Lower_${side}`, new Vector3(x * 1.8, .5, z))
      initial.set(`${name}_Leg_Foot_${side}`, new Vector3(x * 1.8, .05, z))
      initial.set(`${name}_Leg_Tip_${side}`, new Vector3(x * 1.8, .02, z + .03))
    }
    model.updateMatrixWorld(true)
    const result = fit_quadruped_limbs(model, null, new Quaternion(), AnimalAutoFit.sample(model), initial)!
    expect(result).not.toBeNull()
    expect(result.get('Front_Leg_Foot_L')!.y).toBeGreaterThan(.38)
    expect(result.get('Front_Leg_Foot_R')!.y).toBeLessThan(.15)
    for (const [name, p] of result) {
      const side = name.endsWith('L') ? 1 : -1
      expect(p.x * side).toBeGreaterThan(.15)
      expect(p.x * side).toBeLessThan(.34)
      expect(Math.abs(p.z - (name.startsWith('Front') ? .6 : -.6))).toBeLessThan(.13)
    }
  })
})
