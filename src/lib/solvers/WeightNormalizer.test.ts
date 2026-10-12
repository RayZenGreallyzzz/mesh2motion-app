import { describe, expect, it } from 'vitest'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { WeightNormalizer } from './WeightNormalizer'

function geometry_with_vertices (count: number): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(new Array(count * 3).fill(0), 3))
  return g
}

describe('WeightNormalizer', () => {
  it('scales valid influences proportional to their actual total', () => {
    const normalizer = new WeightNormalizer(geometry_with_vertices(2))
    const weights = [0.2, 0.3, 0, 0, 0.9, 0.9, 0, 0]
    normalizer.normalize_weights(weights)
    expect(weights.slice(0, 4)).toEqual([0.4, 0.6, 0, 0])
    expect(weights[4]).toBeCloseTo(0.5)
    expect(weights[5]).toBeCloseTo(0.5)
    expect(normalizer.find_vertices_with_incorrect_weight_sum(weights)).toEqual([])
  })

  it('repairs negative, non-finite, and empty influences', () => {
    const normalizer = new WeightNormalizer(geometry_with_vertices(3))
    const weights = [NaN, 0.5, -1, 0, 0, 0, 0, 0, Infinity, 0.25, 0.25, 0]
    expect(normalizer.find_vertices_with_incorrect_weight_sum(weights)).toEqual([0, 1, 2])
    normalizer.normalize_weights(weights)
    expect(weights).toEqual([0, 1, 0, 0, 1, 0, 0, 0, 0, 0.5, 0.5, 0])
    expect(normalizer.find_vertices_with_incorrect_weight_sum(weights)).toEqual([])
  })
})
