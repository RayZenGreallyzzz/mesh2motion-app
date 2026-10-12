import { describe, expect, it } from 'vitest'
import { Bone, BufferGeometry, Float32BufferAttribute } from 'three'
import { SkeletonType } from '../enums/SkeletonType'
import SkinningAlgorithm from './SkinningAlgorithm'

function rig (): Bone {
  const root = new Bone()
  root.name = 'root'
  const front = new Bone()
  front.name = 'front_leg'
  front.position.set(0, 0, 0)
  root.add(front)
  const frontTip = new Bone()
  frontTip.name = 'front_leg_end'
  frontTip.position.z = 1
  front.add(frontTip)
  const back = new Bone()
  back.name = 'back_leg'
  back.position.set(10, 0, 0)
  root.add(back)
  const backTip = new Bone()
  backTip.name = 'back_leg_end'
  backTip.position.z = 1
  back.add(backTip)
  root.updateWorldMatrix(true, true)
  return root
}

function mesh (): BufferGeometry {
  const g = new BufferGeometry()
  // Two disconnected triangle islands that happen to share one geometry.
  g.setAttribute('position', new Float32BufferAttribute([
    -0.1, 0, 0, 0.1, 0, 0, 0, 0, 0.1,
    9.9, 0, 0, 10.1, 0, 0, 10, 0, 0.1
  ], 3))
  return g
}

describe('Surface Fit on nonhumanoid skeletons', () => {
  it.each([SkeletonType.Spider, SkeletonType.Fox, SkeletonType.Bird, SkeletonType.Dragon, SkeletonType.Snake, SkeletonType.Fish, SkeletonType.Horse, SkeletonType.Kaiju])(
    'skins disconnected parts without distance teleportation for %s', type => {
      const algorithm = new SkinningAlgorithm(rig(), type)
      algorithm.set_geometry(mesh())
      const [indices, weights] = algorithm.calculate_indexes_and_weights()
      expect(indices).toHaveLength(24)
      expect(weights).toHaveLength(24)
      expect(indices[0]).not.toBe(indices[12])
      for (let vertex = 0; vertex < 6; vertex++) {
        const offset = vertex * 4
        expect(weights.slice(offset, offset + 4).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
        expect(weights.slice(offset, offset + 4).every(w => w >= 0 && Number.isFinite(w))).toBe(true)
      }
    }
  )
})
