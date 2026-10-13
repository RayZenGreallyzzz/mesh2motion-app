import { describe, expect, it } from 'vitest'
import { Bone, BufferGeometry, Float32BufferAttribute } from 'three'
import { HeadWeightCorrector } from './HeadWeightCorrector'

describe('Rig Animation Studio safe head weight correction', () => {
  it('preserves a raised hand above the divider while correcting head hair', () => {
    const head = new Bone()
    head.name = 'head'
    head.position.set(0, 2, 0)
    const arm = new Bone()
    arm.name = 'upperarm_l'
    arm.position.set(1, 2, 0)
    head.updateWorldMatrix(true, true)
    arm.updateWorldMatrix(true, true)

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      0, 2.05, 0, // hair, close to head
      1, 2, 0     // raised upper arm
    ], 3))
    const indices = [1, 0, 0, 0, 1, 0, 0, 0]
    const weights = [1, 0, 0, 0, 1, 0, 0, 0]
    new HeadWeightCorrector(geometry, [head, arm], 1.4).apply_head_weight_correction(indices, weights)

    expect(indices[0]).toBe(0)
    expect(weights[0]).toBe(1)
    expect(indices[4]).toBe(1)
    expect(weights[4]).toBe(1)
  })
})
