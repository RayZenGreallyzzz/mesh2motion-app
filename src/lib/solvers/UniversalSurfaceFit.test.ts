import { describe, expect, it } from 'vitest'
import { Bone, CylinderGeometry, PlaneGeometry } from 'three'
import SkinningAlgorithm from './SkinningAlgorithm'
import { SkeletonType } from '../enums/SkeletonType'

function bone (name: string, x: number, y: number, z: number, parent?: Bone): Bone {
  const result = new Bone()
  result.name = name
  result.position.set(x, y, z)
  parent?.add(result)
  return result
}

describe('Rig Animation Studio universal Surface Fit', () => {
  it.each([
    SkeletonType.Fox, SkeletonType.Bird, SkeletonType.Dragon,
    SkeletonType.Kaiju, SkeletonType.Spider, SkeletonType.Snake,
    SkeletonType.Fish, SkeletonType.Horse
  ])('skins a horizontal long creature with four normalized influences (%s)', species => {
    const root = bone('root', 0, 0, 0)
    const torso = bone('torso', 0, 0, 0, root)
    const tail = bone('tail', 1, 0, 0, torso)
    const tip = bone('tail_tip', 1, 0, 0, tail)
    root.updateWorldMatrix(true, true)
    const geometry = new CylinderGeometry(0.13, 0.13, 2, 10, 14, true)
    geometry.rotateZ(Math.PI / 2)
    geometry.translate(1, 0, 0)
    const solver = new SkinningAlgorithm(root, species)
    solver.set_geometry(geometry)
    const [indices, weights] = solver.calculate_indexes_and_weights()
    expect(indices).toHaveLength(geometry.getAttribute('position').count * 4)
    for (let vertex = 0; vertex < geometry.getAttribute('position').count; vertex++) {
      const slice = weights.slice(vertex * 4, vertex * 4 + 4)
      expect(slice.every(value => Number.isFinite(value) && value >= 0)).toBe(true)
      expect(slice.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    }
  })

  it('keeps lower-core bones eligible for a long cape near the head', () => {
    const root = bone('root', 0, 0, 0)
    const hips = bone('hips', 0, 0.1, 0, root)
    const chest = bone('chest', 0, 0.9, 0, hips)
    const head = bone('head', 0, 1, 0, chest)
    bone('arm_l', 0.65, -0.2, 0, chest)
    root.updateWorldMatrix(true, true)

    // A connected garment: collar almost touches head, lower hem is farther
    // from core. A global minimum at the collar must not discard the hips.
    const cape = new PlaneGeometry(0.35, 2, 9, 24)
    cape.translate(0, 1, 0)
    const pos = cape.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      pos.setZ(i, 0.02 + (2 - y) * 0.22)
    }
    const solver = new SkinningAlgorithm(root, SkeletonType.Human)
    solver.set_geometry(cape)
    const [indices, weights] = solver.calculate_indexes_and_weights()
    let lowerCoreWeight = 0
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0.3) continue
      for (let j = 0; j < 4; j++) {
        if (indices[i * 4 + j] === 1) lowerCoreWeight = Math.max(lowerCoreWeight, weights[i * 4 + j])
      }
    }
    expect(lowerCoreWeight).toBeGreaterThan(0.1)
  })
})
