import { Matrix4 } from 'three'
import type { MotionWeightInput } from '../src/lib/solvers/AnimationWeightRefiner.ts'

export function weightFixture (seam = false): MotionWeightInput {
  const positions = new Float32Array([0, 0, 0, .1, 0, 0, 0, .1, 0, .1, .1, 0, ...(seam ? [0, 0, 0] : [])])
  const weights = new Float32Array([.9, .1, 0, 0, .1, .9, 0, 0, .9, .1, 0, 0, .1, .9, 0, 0, ...(seam ? [.1, .9, 0, 0] : [])])
  const indices = new Uint16Array([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, ...(seam ? [1, 0, 0, 0] : [])])
  const matrices = new Float32Array(4 * 16)
  new Matrix4().toArray(matrices, 0); new Matrix4().toArray(matrices, 16)
  new Matrix4().toArray(matrices, 32); new Matrix4().makeTranslation(2, 0, 0).toArray(matrices, 48)
  return { positions, weights, indices, triangles: new Uint32Array([0, 1, 2, 1, 3, 2, ...(seam ? [4, 1, 2] : [])]), matrices, boneCount: 2, groups: [0, 1] }
}

export function posed (input: MotionWeightInput, weights: Float32Array, pose: number): number[][] {
  return Array.from({ length: input.positions.length / 3 }, (_, v) => {
    const p = [0, 0, 0], x = input.positions[v * 3], y = input.positions[v * 3 + 1], z = input.positions[v * 3 + 2]
    for (let k = 0; k < 4; k++) {
      const m = (pose * input.boneCount + input.indices[v * 4 + k]) * 16, w = weights[v * 4 + k], a = input.matrices
      for (let d = 0; d < 3; d++) p[d] += w * (a[m + d] * x + a[m + 4 + d] * y + a[m + 8 + d] * z + a[m + 12 + d])
    }
    return p
  })
}
