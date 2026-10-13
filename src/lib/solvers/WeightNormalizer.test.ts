import { describe, expect, it } from 'vitest'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { WeightNormalizer } from './WeightNormalizer'

function normalizer (vertexCount: number): WeightNormalizer {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(Array(vertexCount * 3).fill(0), 3))
  return new WeightNormalizer(geometry)
}

describe('Rig Animation Studio weight normalization', () => {
  it('preserves relative influence for one, two, three and four active bones', () => {
    const weights = [
      0.6, 0, 0, 0,
      0.6, 0.2, 0, 0,
      0.6, 0.2, 0.1, 0,
      0.6, 0.2, 0.1, 0.1
    ]
    normalizer(4).normalize_weights(weights)
    for (let vertex = 0; vertex < 4; vertex++) {
      const group = weights.slice(vertex * 4, vertex * 4 + 4)
      expect(group.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8)
      if (vertex > 0) expect(group[0] / group[1]).toBeCloseTo(3, 8)
    }
  })

  it('repairs NaN, infinities, negative and missing influences', () => {
    const weights = [NaN, Infinity, -3, 4, 0, 0, 0, 0]
    const calc = normalizer(2)
    expect(calc.find_vertices_with_incorrect_weight_sum(weights)).toEqual([0, 1])
    calc.normalize_weights(weights)
    expect(weights).toEqual([0, 0, 0, 1, 1, 0, 0, 0])
    expect(calc.find_vertices_with_incorrect_weight_sum(weights)).toEqual([])
  })
})
