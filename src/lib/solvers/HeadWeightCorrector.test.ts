import { describe, expect, it } from 'vitest'
import { Bone, BufferGeometry, Float32BufferAttribute } from 'three'
import { HeadWeightCorrector } from './HeadWeightCorrector'

describe('head correction anatomical limit', () => {
  it('never moves waist clothing to the head even if the user plane is too low', () => {
    const arm = new Bone()
    arm.name = 'upperarm_l'
    const head = new Bone()
    head.name = 'head'
    head.position.y = 1.5
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([0.1, 1, 0, 0.1, 1.7, 0], 3))
    const indices = [0, 0, 0, 0, 0, 0, 0, 0]
    const weights = [1, 0, 0, 0, 1, 0, 0, 0]
    new HeadWeightCorrector(geometry, [arm, head], 0.5).apply_head_weight_correction(indices, weights)
    expect(indices[0]).toBe(0)
    expect(indices[4]).toBe(1)
    expect(weights).toEqual([1, 0, 0, 0, 1, 0, 0, 0])
  })
})
