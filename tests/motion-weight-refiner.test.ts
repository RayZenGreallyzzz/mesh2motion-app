// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { refineAnimationWeights } from '../src/lib/solvers/AnimationWeightRefiner.ts'


import { weightFixture, posed } from './motion-weight-fixtures.ts'

const normal = (p: number[][], a: number, b: number, c: number): number[] => {
  const u = p[b].map((x, i) => x - p[a][i]), v = p[c].map((x, i) => x - p[a][i])
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
}

describe('animation-aware bounded weight refinement', () => {
  it('reduces measured stretch, preserves all inputs and bounds weight changes', () => {
    const input = weightFixture(), saved = structuredClone(input), progress: number[] = []
    const result = refineAnimationWeights(input, { onProgress: n => progress.push(n) })
    expect(result.stats.improved).toBe(true)
    expect(result.stats.afterEnergy).toBeLessThan(result.stats.beforeEnergy)
    expect(result.stats.afterOverstretch).toBeLessThanOrEqual(result.stats.beforeOverstretch)
    expect(input).toEqual(saved)
    for (let v = 0; v < 4; v++) {
      const row = result.weights.subarray(v * 4, v * 4 + 4)
      expect([...row].every(w => w >= 0 && Number.isFinite(w))).toBe(true)
      expect([...row].reduce((s, w) => s + w, 0)).toBeCloseTo(1, 6)
      expect([...row].reduce((s, w, k) => s + Math.abs(w - input.weights[v * 4 + k]), 0)).toBeLessThanOrEqual(.500001)
      expect(row[2]).toBe(0); expect(row[3]).toBe(0)
    }
    expect(progress[0]).toBe(0); expect(progress.at(-1)).toBe(1)
  })

  it('keeps original per-clip edge bounds and triangle orientation in every sampled pose', () => {
    const input = weightFixture(), result = refineAnimationWeights(input)
    for (let pose = 0; pose < input.groups.length; pose++) {
      const original = posed(input, input.weights, pose), output = posed(input, result.weights, pose)
      for (let t = 0; t < input.triangles.length; t += 3) {
        const [a, b, c] = input.triangles.subarray(t, t + 3), n = normal(original, a, b, c), q = normal(output, a, b, c)
        expect(n.reduce((s, x, i) => s + x * q[i], 0)).toBeGreaterThanOrEqual(n.reduce((s, x) => s + x * x, 0) * .12 - 1e-10)
        for (const [v, w] of [[a, b], [b, c], [c, a]]) {
          const length = (p: number[][]): number => Math.hypot(...p[v].map((x, i) => x - p[w][i]))
          const rest = Math.hypot(...[0, 1, 2].map(d => input.positions[v * 3 + d] - input.positions[w * 3 + d]))
          expect(length(output)).toBeLessThanOrEqual(Math.max(length(original), 2 * rest) + 1e-6)
          expect(length(output)).toBeGreaterThanOrEqual(Math.min(length(original), .5 * rest) - 1e-6)
        }
      }
    }
  })

  it('welds equal seams with reordered slots and locks all copies of a painted vertex', () => {
    const input = weightFixture(true), output = refineAnimationWeights(input)
    expect(output.stats.weldedVertices).toBe(4)
    expect(output.weights[0]).toBe(output.weights[4 * 4 + 1])
    expect(output.weights[1]).toBe(output.weights[4 * 4])
    input.locked = new Uint8Array(5); input.locked[4] = 1
    const locked = refineAnimationWeights(input)
    expect([...locked.weights.subarray(0, 4)]).toEqual([...input.weights.subarray(0, 4)])
    expect([...locked.weights.subarray(16, 20)]).toEqual([...input.weights.subarray(16, 20)])
    expect(locked.stats.improved).toBe(true)
  })

  it('leaves rigid or fully locked weights exact and rejects malformed or oversized jobs', () => {
    const input = weightFixture(); input.locked = new Uint8Array(4).fill(1)
    expect(refineAnimationWeights(input).weights).toEqual(input.weights)
    expect(refineAnimationWeights(input).stats.improved).toBe(false)
    delete input.locked
    for (let v = 0; v < 4; v++) input.weights.set([1, 0, 0, 0], v * 4)
    expect(refineAnimationWeights(input).weights).toEqual(input.weights)
    expect(() => refineAnimationWeights(input, { maxWorkingBytes: 1 })).toThrow(/memory budget/)
    input.weights[0] = NaN; expect(() => refineAnimationWeights(input)).toThrow(/Invalid skin/)
    input.weights[0] = .5; expect(() => refineAnimationWeights(input)).toThrow(/normalized/)
    input.weights[0] = 1; input.triangles[0] = 99; expect(() => refineAnimationWeights(input)).toThrow(/triangle/)
  })
})
