import { describe, expect, it } from 'vitest'
import { Bone, BufferGeometry, Float32BufferAttribute, PlaneGeometry } from 'three'
import { WeightCalculator } from './WeightCalculator'
import { SkeletonType } from '../enums/SkeletonType'

function weights_for (geometry: BufferGeometry, offset_y = 0): number[] {
  const pelvis = new Bone()
  pelvis.name = 'pelvis'
  pelvis.position.set(0, 1 + offset_y, 0)
  const leg = new Bone()
  leg.name = 'thigh_l'
  leg.position.set(0.3, 0.5 + offset_y, 0)
  const calculator = new WeightCalculator([pelvis, leg], geometry, SkeletonType.Human)
  calculator.initialize_caches()
  const indices: number[] = []
  calculator.calculate_median_bone_weights(indices, [])
  return indices
}

describe('pelvis weights', () => {
  it('keeps pelvis influences when a separate clothing mesh misses the downward ray', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([0.1, 1.05, 0.2], 3))
    expect(weights_for(geometry)[0]).toBe(0)
  })

  it('keeps the waistband above the crotch; result is invariant under vertical translation', () => {
    for (const offset_y of [0, 4, -3]) {
      const geometry = new PlaneGeometry(0.8, 0.8)
      geometry.rotateX(-Math.PI / 2)
      geometry.translate(0, 0.8 + offset_y, 0)
      const waistband = new BufferGeometry()
      // Include a triangle below the pelvis for the ray, plus waistband vertices.
      const floor = geometry.toNonIndexed().getAttribute('position')
      waistband.setAttribute('position', new Float32BufferAttribute([
        ...Array.from(floor.array), 0.1, 1 + offset_y, 0, 0.2, 1 + offset_y, 0, 0.1, 1.1 + offset_y, 0
      ], 3))
      expect(weights_for(waistband, offset_y).slice(-12).filter((_, i) => i % 4 === 0)).toEqual([0, 0, 0])
    }
  })

  it('does not silently bind a far-away valid vertex to the root', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([2000, 1, 0], 3))
    const root = new Bone()
    root.name = 'root'
    const pelvis = new Bone()
    pelvis.name = 'pelvis'
    const calculator = new WeightCalculator([root, pelvis], geometry, SkeletonType.Human)
    calculator.initialize_caches()
    const indices: number[] = []
    calculator.calculate_median_bone_weights(indices, [])
    expect(indices[0]).toBe(1)
  })
})
