import { describe, expect, it } from 'vitest'
import { Bone, BufferGeometry, CatmullRomCurve3, CylinderGeometry, TubeGeometry, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

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

describe('SurfaceGeodesicWeightCalculator component coverage', () => {
  it('does not anchor one leg to the other on a connected trouser surface', () => {
    const pelvis = new Bone()
    pelvis.name = 'pelvis'
    pelvis.position.y = 1
    const bones = [pelvis]
    for (const side of [-1, 1]) {
      const thigh = new Bone()
      thigh.name = side < 0 ? 'thigh_r' : 'thigh_l'
      thigh.position.set(side * 0.14, 0, 0)
      pelvis.add(thigh)
      const calf = new Bone()
      calf.name = side < 0 ? 'calf_r' : 'calf_l'
      calf.position.y = -0.5
      thigh.add(calf)
      const foot = new Bone()
      foot.name = side < 0 ? 'foot_r' : 'foot_l'
      foot.position.y = -0.5
      calf.add(foot)
      bones.push(thigh, calf, foot)
    }
    pelvis.updateWorldMatrix(true, true)
    const curve = new CatmullRomCurve3([
      new Vector3(-0.14, 0, 0), new Vector3(-0.14, 0.5, 0),
      new Vector3(-0.14, 1, 0), new Vector3(0, 1.08, 0),
      new Vector3(0.14, 1, 0), new Vector3(0.14, 0.5, 0), new Vector3(0.14, 0, 0)
    ])
    const geometry = new TubeGeometry(curve, 160, 0.09, 16, false)
    const indices: number[] = []
    const weights: number[] = []
    new SurfaceGeodesicWeightCalculator(bones, geometry).calculate(indices, weights)
    const positions = geometry.getAttribute('position')
    let samples = 0
    let wrong_total = 0
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const y = positions.getY(vertex)
      if (y < 0.15 || y > 0.4) continue
      const wrong_side = positions.getX(vertex) < 0 ? '_l' : '_r'
      for (let slot = 0; slot < 4; slot++) {
        if (bones[indices[vertex * 4 + slot]].name.endsWith(wrong_side)) wrong_total += weights[vertex * 4 + slot]
      }
      samples++
    }
    expect(samples).toBeGreaterThan(100)
    expect(wrong_total / samples).toBeLessThan(0.01)
  })

  it.each([24, 40])('weights every segment of a connected %i-bone limb', (segment_count) => {
    // Generic names and a horizontal chain cover tails/wings too. Twenty-four
    // segments catch sparse sampling; forty also catch the old 32-bone cap.
    const root = new Bone()
    root.name = 'root'
    const bones = [root]
    for (let segment = 0; segment <= segment_count; segment++) {
      const bone = new Bone()
      bone.name = segment === segment_count ? 'tip' : `segment_${segment}`
      bone.position.x = segment === 0 ? 0 : 0.3
      bones[bones.length - 1].add(bone)
      bones.push(bone)
    }
    root.updateWorldMatrix(true, true)

    const length = segment_count * 0.3
    const geometry = new CylinderGeometry(0.04, 0.04, length, 8, segment_count * 4, true)
    geometry.rotateZ(-Math.PI / 2)
    geometry.translate(length / 2, 0, 0)
    const indices: number[] = []
    const weights: number[] = []
    new SurfaceGeodesicWeightCalculator(bones, geometry).calculate(indices, weights)

    const position = geometry.getAttribute('position')
    const covered = new Set<number>()
    for (let vertex = 0; vertex < position.count; vertex++) {
      const segment_position = position.getX(vertex) / 0.3
      const segment = Math.floor(segment_position)
      if (Math.abs(segment_position - segment - 0.5) > 0.01) continue
      expect(indices[vertex * 4]).toBe(segment + 1)
      expect(weights.slice(vertex * 4, vertex * 4 + 4).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
      covered.add(segment)
    }
    expect(covered.size).toBe(segment_count)
    geometry.dispose()
  })

  it('keeps disconnected small accessories attached only to their nearby bone', () => {
    const root = new Bone()
    root.name = 'root'
    const bones = [root]
    const parts: CylinderGeometry[] = []
    for (const x of [-5, 5]) {
      const bone = new Bone()
      bone.name = `attachment_${x}`
      bone.position.set(x, 0, 0)
      const tip = new Bone()
      tip.name = 'tip'
      tip.position.y = 0.2
      bone.add(tip)
      root.add(bone)
      bones.push(bone, tip)
      const geometry = new CylinderGeometry(0.04, 0.04, 0.2, 8, 4, true)
      geometry.translate(x, 0.1, 0)
      parts.push(geometry)
    }
    root.updateWorldMatrix(true, true)
    const geometry = mergeGeometries(parts)!
    const indices: number[] = []
    const weights: number[] = []
    new SurfaceGeodesicWeightCalculator(bones, geometry).calculate(indices, weights)
    const position = geometry.getAttribute('position')
    for (let vertex = 0; vertex < position.count; vertex++) {
      expect(indices[vertex * 4]).toBe(position.getX(vertex) < 0 ? 1 : 3)
      expect(weights[vertex * 4]).toBe(1)
      expect(weights.slice(vertex * 4 + 1, vertex * 4 + 4)).toEqual([0, 0, 0])
    }
    geometry.dispose()
    parts.forEach(part => part.dispose())
  })

  it('does not let a nearby limb capture the opposite side of a tapered torso', () => {
    const root = new Bone()
    root.name = 'root'
    const torso = new Bone()
    torso.name = 'torso'
    const torso_tip = new Bone()
    torso_tip.name = 'torso_tip'
    torso_tip.position.y = 2
    torso.add(torso_tip)
    const limb = new Bone()
    limb.name = 'limb'
    limb.position.set(0.35, 0.5, 0)
    const limb_tip = new Bone()
    limb_tip.name = 'limb_tip'
    limb_tip.position.x = 0.35
    limb.add(limb_tip)
    root.add(torso, limb)
    root.updateWorldMatrix(true, true)

    // The narrow top attracts a global nearest-N seed pool. The lower, wider
    // torso still needs its own seeds when a limb is close to one side.
    const geometry = new CylinderGeometry(0.07, 0.35, 2, 32, 64, true)
    geometry.translate(0, 1, 0)
    const indices: number[] = []
    const weights: number[] = []
    new SurfaceGeodesicWeightCalculator([root, torso, torso_tip, limb, limb_tip], geometry)
      .calculate(indices, weights)

    const position = geometry.getAttribute('position')
    let samples = 0
    for (let vertex = 0; vertex < position.count; vertex++) {
      if (position.getX(vertex) > -0.15 || position.getY(vertex) < 0.3 || position.getY(vertex) > 0.75) continue
      expect(indices[vertex * 4]).toBe(1)
      expect(weights[vertex * 4]).toBeGreaterThan(0.5)
      samples++
    }
    expect(samples).toBeGreaterThan(100)
    geometry.dispose()
  })

  it('preserves an established blend across a dominant-bone boundary', () => {
    const geometry = new BufferGeometry()
    const calculator = new SurfaceGeodesicWeightCalculator([], geometry)
    // Surface propagation may legitimately blend distant hierarchy branches.
    // The smoothing pass must not erase that blend when the leading bone flips.
    const smoothing = calculator as unknown as {
      adjacency: Array<Array<{ node: number, length: number }>>
      boneNeighborhoods: Array<Set<number>>
      smoothNodeWeights: (bones: number[][], weights: number[][]) => void
    }
    smoothing.adjacency = [[{ node: 1, length: 0.01 }], [{ node: 0, length: 0.01 }]]
    smoothing.boneNeighborhoods = [new Set([0]), new Set([1])]
    const bones = [[0, 1], [1, 0]]
    const weights = [[0.51, 0.49], [0.51, 0.49]]
    smoothing.smoothNodeWeights(bones, weights)
    for (const blend of weights) {
      expect(blend).toHaveLength(2)
      expect(Math.min(...blend)).toBeGreaterThan(0.4)
      expect(blend.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
    }
    geometry.dispose()
  })
})
