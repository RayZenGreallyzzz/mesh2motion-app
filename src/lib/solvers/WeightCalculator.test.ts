import { describe, expect, it } from 'vitest'
import { Bone, BufferGeometry, Float32BufferAttribute } from 'three'
import { SkeletonType } from '../enums/SkeletonType'
import { Utility } from '../Utilities'
import { WeightCalculator } from './WeightCalculator'

function make_rig (): Bone[] {
  const root = new Bone()
  root.name = 'root'
  const pelvis = new Bone()
  pelvis.name = 'pelvis'
  pelvis.position.y = 1
  root.add(pelvis)

  const spine = new Bone()
  spine.name = 'spine'
  spine.position.y = 0.4
  pelvis.add(spine)
  const neck = new Bone()
  neck.name = 'neck'
  neck.position.y = 0.4
  spine.add(neck)

  for (const side of [-1, 1]) {
    const thigh = new Bone()
    thigh.name = side < 0 ? 'upperleg_l' : 'upperleg_r'
    thigh.position.set(1.5 * side, -0.2, 0)
    pelvis.add(thigh)
    const calf = new Bone()
    calf.name = side < 0 ? 'lowerleg_l' : 'lowerleg_r'
    calf.position.y = -0.6
    thigh.add(calf)
  }
  root.updateWorldMatrix(true, true)
  return Utility.bone_list_from_hierarchy(root)
}

function make_geometry (): BufferGeometry {
  const geometry = new BufferGeometry()
  // A collinear face intentionally gives no ray hit: separate clothing, open
  // or non-watertight geometry must still get a correct pelvis boundary.
  geometry.setAttribute('position', new Float32BufferAttribute([
    0, 1.1, 0, // above the thigh joints
    0, 0.6, 0, // below the thigh joints, pelvis is still the nearest midpoint
    0, 0.9, 0 // just above the thigh joints
  ], 3))
  return geometry
}

describe('WeightCalculator pelvis boundary', () => {
  it('keeps the pelvis above the crotch and removes it only below', () => {
    const bones = make_rig()
    const calc = new WeightCalculator(bones, make_geometry(), SkeletonType.Human)
    calc.initialize_caches()
    const indices: number[] = []
    const weights: number[] = []
    calc.calculate_median_bone_weights(indices, weights)

    const pelvis = bones.findIndex(b => b.name === 'pelvis')
    expect(indices[0]).toBe(pelvis)
    expect(indices[4]).not.toBe(pelvis)
    expect(indices[8]).toBe(pelvis)
    expect(weights).toHaveLength(12)
  })

  it('does not apply humanoid crotch rules to a nonhuman rig', () => {
    const bones = make_rig()
    const calc = new WeightCalculator(bones, make_geometry(), SkeletonType.Fox)
    calc.initialize_caches()
    const indices: number[] = []
    const weights: number[] = []
    calc.calculate_median_bone_weights(indices, weights)
    expect(indices[4]).toBe(bones.findIndex(b => b.name === 'pelvis'))
  })
})
