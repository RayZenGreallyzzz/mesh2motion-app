/** Optional, bounded skin-weight refinement against sampled animation poses.
 * Coordinates are in bind-world space; each matrix maps bind-world to posed-world.
 * No geometry, bone indices, animation tracks or input buffers are modified.
 */
export interface MotionWeightInput {
  positions: Float32Array
  triangles: Uint32Array
  indices: Uint16Array
  weights: Float32Array
  matrices: Float32Array
  boneCount: number
  groups: number[]
  locked?: Uint8Array
}

export interface MotionWeightStats {
  improved: boolean
  vertices: number
  weldedVertices: number
  sampledPoses: number
  modifiedVertices: number
  beforeOverstretch: number
  afterOverstretch: number
  beforeEnergy: number
  afterEnergy: number
}

export interface MotionWeightOptions {
  iterations?: number
  maxWorkingBytes?: number
  onProgress?: (fraction: number) => void
}

const LIMIT = 2.01
const BUDGET = 384 * 1024 * 1024

export function refineAnimationWeights (
  input: MotionWeightInput, options: MotionWeightOptions = {}
): { weights: Float32Array, stats: MotionWeightStats } {
  const { positions, triangles, indices, weights, matrices, boneCount, groups, locked } = input
  const n = positions.length / 3, poses = groups.length
  if (!Number.isInteger(n) || n < 1 || triangles.length % 3 !== 0 ||
      indices.length !== n * 4 || weights.length !== n * 4 ||
      !Number.isInteger(boneCount) || boneCount < 1 || boneCount > 65536 ||
      poses < 1 || poses > 40 || matrices.length !== poses * boneCount * 16 ||
      (locked !== undefined && locked.length !== n)) throw new Error('Invalid motion-weight input')
  const groupIds = [...new Set(groups)]
  if (groupIds.length > 8 || groups.some(v => !Number.isInteger(v) || v < 0)) throw new Error('Invalid pose groups')
  const groupIndex = groups.map(v => groupIds.indexOf(v)), groupCount = groupIds.length
  // Includes conservative allowances for Map/Set keys and adjacency containers,
  // plus the detached scene and message copies held by the caller.
  const estimate = n * (600 + poses * 48) + triangles.length * (90 + groupCount * 16)
  const budget = options.maxWorkingBytes ?? BUDGET
  if (!Number.isFinite(budget) || budget <= 0 || estimate > budget) throw new Error('Motion-weight memory budget exceeded; select fewer animations')
  if (!positions.every(Number.isFinite) || !matrices.every(Number.isFinite)) throw new Error('Non-finite motion data')
  for (let v = 0; v < n; v++) {
    let sum = 0
    for (let k = 0; k < 4; k++) {
      const i = v * 4 + k, w = weights[i]
      if (indices[i] >= boneCount || !Number.isFinite(w) || w < 0) throw new Error('Invalid skin weights')
      sum += w
    }
    if (Math.abs(sum - 1) > 1e-5) throw new Error('Skin weights must be normalized')
  }
  if (triangles.some(v => v >= n)) throw new Error('Invalid triangle index')
  for (let i = 0; i < matrices.length; i += 16) {
    if (Math.abs(matrices[i + 3]) > 1e-6 || Math.abs(matrices[i + 7]) > 1e-6 ||
        Math.abs(matrices[i + 11]) > 1e-6 || Math.abs(matrices[i + 15] - 1) > 1e-6) throw new Error('Skin matrices must be affine')
  }
  options.onProgress?.(0)

  // Welding is exact and includes the complete influence signature. Separate
  // surfaces at the same position with different skinning remain independent.
  const vertexMap = new Uint32Array(n), weld = new Map<string, number>()
  const representatives: number[] = [], order: number[][] = [], locks: boolean[] = []
  for (let v = 0; v < n; v++) {
    const slots = [0, 1, 2, 3].filter(k => weights[v * 4 + k] > 0)
      .sort((a, b) => indices[v * 4 + a] - indices[v * 4 + b] || weights[v * 4 + a] - weights[v * 4 + b])
    const key = `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}|` +
      slots.map(k => `${indices[v * 4 + k]}:${weights[v * 4 + k]}`).join(',')
    let w = weld.get(key)
    if (w === undefined) {
      w = representatives.length; weld.set(key, w); representatives.push(v); locks.push(false)
    }
    vertexMap[v] = w; order.push(slots)
    if (locked?.[v]) locks[w] = true
  }
  weld.clear()
  const count = representatives.length
  const ids = new Uint16Array(count * 4), base = new Float32Array(count * 4), slotCounts = new Uint8Array(count)
  representatives.forEach((v, w) => {
    slotCounts[w] = order[v].length
    order[v].forEach((slot, k) => { ids[w * 4 + k] = indices[v * 4 + slot]; base[w * 4 + k] = weights[v * 4 + slot] })
  })
  const current = base.slice()
  const faces: number[] = [], faceSet = new Set<string>()
  const edges: number[] = [], edgeMap = new Map<string, number>()
  const incidentEdges: number[][] = Array.from({ length: count }, () => [])
  const incidentFaces: number[][] = Array.from({ length: count }, () => [])
  for (let t = 0; t < triangles.length; t += 3) {
    const a = vertexMap[triangles[t]], b = vertexMap[triangles[t + 1]], c = vertexMap[triangles[t + 2]]
    if (a === b || b === c || c === a) continue
    // Keep opposite-winding coincident faces independent.
    const cyc = [[a, b, c], [b, c, a], [c, a, b]].sort((x, y) => x[0] - y[0])[0]
    const faceKey = cyc.join(',')
    if (faceSet.has(faceKey)) continue
    faceSet.add(faceKey)
    const f = faces.length / 3; faces.push(a, b, c)
    for (const v of [a, b, c]) incidentFaces[v].push(f)
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = `${Math.min(u, v)},${Math.max(u, v)}`
      if (!edgeMap.has(key)) {
        const e = edges.length / 2; edgeMap.set(key, e); edges.push(u, v)
        incidentEdges[u].push(e); incidentEdges[v].push(e)
      }
    }
  }
  faceSet.clear(); edgeMap.clear()
  const edgeCount = edges.length / 2, restSq = new Float64Array(edgeCount)
  for (let e = 0; e < edgeCount; e++) {
    const a = representatives[edges[e * 2]] * 3, b = representatives[edges[e * 2 + 1]] * 3
    restSq[e] = (positions[a] - positions[b]) ** 2 + (positions[a + 1] - positions[b + 1]) ** 2 + (positions[a + 2] - positions[b + 2]) ** 2
  }
  const originalPosed = new Float64Array(poses * count * 3)
  const bonePosition = (v: number, p: number, k: number, out: number[]): void => {
    const original = representatives[v] * 3, x = positions[original], y = positions[original + 1], z = positions[original + 2]
    const m = (p * boneCount + ids[v * 4 + k]) * 16
    out[0] = matrices[m] * x + matrices[m + 4] * y + matrices[m + 8] * z + matrices[m + 12]
    out[1] = matrices[m + 1] * x + matrices[m + 5] * y + matrices[m + 9] * z + matrices[m + 13]
    out[2] = matrices[m + 2] * x + matrices[m + 6] * y + matrices[m + 10] * z + matrices[m + 14]
  }
  const point = [0, 0, 0]
  for (let p = 0; p < poses; p++) for (let v = 0; v < count; v++) {
    const o = (p * count + v) * 3
    for (let k = 0; k < slotCounts[v]; k++) {
      bonePosition(v, p, k, point)
      for (let d = 0; d < 3; d++) originalPosed[o + d] += base[v * 4 + k] * point[d]
    }
  }
  const posed = originalPosed.slice()
  const upper = new Float64Array(groupCount * edgeCount), lower = new Float64Array(groupCount * edgeCount).fill(Infinity)
  const severity = new Float64Array(count)
  function edgeLengthSq (array: Float64Array, p: number, e: number): number {
    const a = (p * count + edges[e * 2]) * 3, b = (p * count + edges[e * 2 + 1]) * 3
    return (array[a] - array[b]) ** 2 + (array[a + 1] - array[b + 1]) ** 2 + (array[a + 2] - array[b + 2]) ** 2
  }
  for (let p = 0; p < poses; p++) for (let e = 0; e < edgeCount; e++) {
    const r = restSq[e]
    if (r <= 1e-20) continue
    const sq = edgeLengthSq(posed, p, e), o = groupIndex[p] * edgeCount + e
    upper[o] = Math.max(upper[o], sq, r * 4)
    lower[o] = Math.min(lower[o], sq, r * .25)
    if (sq > r * LIMIT ** 2) for (const v of [edges[e * 2], edges[e * 2 + 1]]) severity[v] = Math.max(severity[v], sq / r)
  }
  function metrics (): { count: number, energy: number } {
    let over = 0, energy = 0
    for (let p = 0; p < poses; p++) for (let e = 0; e < edgeCount; e++) {
      if (restSq[e] <= 1e-20) continue
      const ratio = Math.sqrt(edgeLengthSq(posed, p, e) / restSq[e])
      if (ratio > LIMIT) over++
      energy += Math.max(0, ratio - 2) ** 2
    }
    return { count: over, energy }
  }
  const before = metrics()
  const candidates = representatives.map((_, i) => i).filter(v => severity[v] > 0 && !locks[v] && slotCounts[v] > 1)
    .sort((a, b) => severity[b] - severity[a])
  const proposed = new Float64Array(poses * 3), basis = new Float64Array(poses * 12)
  const normal = (array: Float64Array, p: number, f: number, changed = -1): number[] => {
    const coords: number[][] = []
    for (let k = 0; k < 3; k++) {
      const v = faces[f * 3 + k], o = (p * count + v) * 3
      coords.push(v === changed ? [proposed[p * 3], proposed[p * 3 + 1], proposed[p * 3 + 2]] : [array[o], array[o + 1], array[o + 2]])
    }
    const u = coords[1].map((x, i) => x - coords[0][i]), v = coords[2].map((x, i) => x - coords[0][i])
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  }
  const iterations = Math.max(1, Math.min(24, Math.floor(options.iterations ?? 24)))
  if (!Number.isFinite(iterations)) throw new Error('Invalid iteration count')
  for (let iteration = 0; iteration < iterations; iteration++) {
    let accepted = 0
    for (const v of candidates) {
      const gradient = [0, 0, 0, 0], slots = slotCounts[v]
      const oldGroupEnergy = new Float64Array(groupCount)
      let oldEnergy = 0
      for (let p = 0; p < poses; p++) {
        for (let k = 0; k < slots; k++) {
          bonePosition(v, p, k, point)
          for (let d = 0; d < 3; d++) basis[p * 12 + k * 3 + d] = point[d]
        }
        for (const e of incidentEdges[v]) {
          const r = restSq[e]
          if (r <= 1e-20) continue
          const neighbor = edges[e * 2] === v ? edges[e * 2 + 1] : edges[e * 2]
          const a = (p * count + v) * 3, b = (p * count + neighbor) * 3
          const delta = [posed[a] - posed[b], posed[a + 1] - posed[b + 1], posed[a + 2] - posed[b + 2]]
          const ratio = Math.sqrt((delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2) / r)
          if (ratio <= 2) continue
          oldEnergy += (ratio - 2) ** 2
          oldGroupEnergy[groupIndex[p]] += (ratio - 2) ** 2
          const factor = 2 * (ratio - 2) / (r * ratio)
          for (let k = 0; k < slots; k++) for (let d = 0; d < 3; d++) gradient[k] += factor * delta[d] * basis[p * 12 + k * 3 + d]
        }
      }
      if (oldEnergy < 1e-12) continue
      const mean = gradient.slice(0, slots).reduce((a, b) => a + b, 0) / slots
      for (let k = 0; k < slots; k++) gradient[k] -= mean
      const maxGradient = Math.max(...gradient.map(Math.abs))
      if (maxGradient < 1e-12) continue
      for (let step = .1; step > 1e-7; step *= .5) {
        let next = Array.from({ length: slots }, (_, k) => current[v * 4 + k] - step * gradient[k] / maxGradient)
        // Euclidean projection onto the probability simplex.
        const sorted = [...next].sort((a, b) => b - a)
        let threshold = 0, sum = 0
        for (let k = 0; k < slots; k++) { sum += sorted[k]; const t = (sum - 1) / (k + 1); if (sorted[k] > t) threshold = t }
        next = next.map(x => Math.max(0, x - threshold))
        const distance = next.reduce((s, x, k) => s + Math.abs(x - base[v * 4 + k]), 0)
        if (distance > .5) next = next.map((x, k) => base[v * 4 + k] + (x - base[v * 4 + k]) * (.5 / distance))
        next = next.map(Math.fround)
        let energy = 0, valid = true
        const groupEnergy = new Float64Array(groupCount)
        for (let p = 0; p < poses && valid; p++) {
          for (let d = 0; d < 3; d++) {
            proposed[p * 3 + d] = 0
            for (let k = 0; k < slots; k++) proposed[p * 3 + d] += next[k] * basis[p * 12 + k * 3 + d]
          }
          for (const e of incidentEdges[v]) {
            const r = restSq[e]
            if (r <= 1e-20) continue
            const neighbor = edges[e * 2] === v ? edges[e * 2 + 1] : edges[e * 2], b = (p * count + neighbor) * 3
            const sq = (proposed[p * 3] - posed[b]) ** 2 + (proposed[p * 3 + 1] - posed[b + 1]) ** 2 + (proposed[p * 3 + 2] - posed[b + 2]) ** 2
            const o = groupIndex[p] * edgeCount + e
            if (sq > upper[o] + r * 1e-7 || sq < lower[o] - r * 1e-7) { valid = false; break }
            const cost = Math.max(0, Math.sqrt(sq / r) - 2) ** 2
            energy += cost; groupEnergy[groupIndex[p]] += cost
          }
          if (!valid) break
          for (const face of incidentFaces[v]) {
            const baseline = normal(originalPosed, p, face), candidate = normal(posed, p, face, v)
            const square = baseline.reduce((s, x) => s + x * x, 0)
            if (square > 1e-30 && baseline.reduce((s, x, k) => s + x * candidate[k], 0) < square * .12) { valid = false; break }
          }
        }
        if (!valid || groupEnergy.some((cost, g) => cost > oldGroupEnergy[g] + 1e-12) ||
            energy >= oldEnergy - Math.max(1e-12, oldEnergy * 1e-8)) continue
        for (let k = 0; k < slots; k++) current[v * 4 + k] = next[k]
        for (let p = 0; p < poses; p++) for (let d = 0; d < 3; d++) posed[(p * count + v) * 3 + d] = proposed[p * 3 + d]
        accepted++; break
      }
    }
    options.onProgress?.((iteration + 1) / iterations)
    if (accepted === 0) break
  }
  const after = metrics()
  const improved = after.energy < before.energy * (1 - 1e-7) && after.count <= before.count
  const output = weights.slice()
  let modified = 0
  if (improved) for (let v = 0; v < n; v++) {
    const w = vertexMap[v]
    let difference = 0
    order[v].forEach((slot, k) => { const value = current[w * 4 + k]; difference += Math.abs(value - output[v * 4 + slot]); output[v * 4 + slot] = value })
    if (difference > 1e-7) modified++
  }
  options.onProgress?.(1)
  return { weights: output, stats: {
    improved, vertices: n, weldedVertices: count, sampledPoses: poses,
    modifiedVertices: modified, beforeOverstretch: before.count,
    afterOverstretch: improved ? after.count : before.count,
    beforeEnergy: before.energy, afterEnergy: improved ? after.energy : before.energy
  } }
}
