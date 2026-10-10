import { describe, expect, it } from 'vitest'
import { Bone, CylinderGeometry } from 'three'

import { SurfaceGeodesicWeightCalculator } from './SurfaceGeodesicWeightCalculator.ts'

describe('SurfaceGeodesicWeightCalculator v6 joint blend', () => {
  it('creates a smooth upperarm/forearm transition around an elbow ring', () => {
    const root = new Bone()
    root.name = 'root'

    const upper = new Bone()
    upper.name = 'upperarm_l'
    root.add(upper)

    const fore = new Bone()
    fore.name = 'forearm_l'
    fore.position.set(0, 1, 0)
    upper.add(fore)

    const hand = new Bone()
    hand.name = 'hand_l'
    hand.position.set(0, 1, 0)
    fore.add(hand)

    root.updateWorldMatrix(true, true)

    // Straight cylindrical arm from y=0..2 with the elbow at y=1.
    const geometry = new CylinderGeometry(0.18, 0.18, 2, 20, 16, true)
    geometry.translate(0, 1, 0)

    const calculator = new SurfaceGeodesicWeightCalculator(
      [root, upper, fore, hand],
      geometry
    )

    const indices: number[] = []
    const weights: number[] = []
    calculator.calculate(indices, weights)

    const position = geometry.getAttribute('position')
    let elbowVertices = 0
    let blendedElbowVertices = 0
    let upperSamples = 0
    let upperDominant = 0
    let foreSamples = 0
    let foreDominant = 0

    const weightFor = (vertex: number, boneIndex: number): number => {
      const offset = vertex * 4
      let total = 0
      for (let slot = 0; slot < 4; slot++) {
        if (indices[offset + slot] === boneIndex) total += weights[offset + slot]
      }
      return total
    }

    for (let vertex = 0; vertex < position.count; vertex++) {
      const y = position.getY(vertex)
      const upperWeight = weightFor(vertex, 1)
      const foreWeight = weightFor(vertex, 2)

      if (Math.abs(y - 1) <= 0.13) {
        elbowVertices++
        if (upperWeight >= 0.12 && foreWeight >= 0.12) blendedElbowVertices++
      }

      if (y >= 0.32 && y <= 0.62) {
        upperSamples++
        if (upperWeight > foreWeight) upperDominant++
      }

      if (y >= 1.38 && y <= 1.68) {
        foreSamples++
        if (foreWeight > upperWeight) foreDominant++
      }
    }

    expect(elbowVertices).toBeGreaterThan(0)
    expect(blendedElbowVertices / elbowVertices).toBeGreaterThan(0.7)
    expect(upperDominant / Math.max(upperSamples, 1)).toBeGreaterThan(0.8)
    expect(foreDominant / Math.max(foreSamples, 1)).toBeGreaterThan(0.8)
  })
})
