import { type Bone, type BufferGeometry, Vector3 } from 'three'
import { Utility } from '../Utilities.js'

interface Edge { target: number, cost: number }
interface BoneData { index: number, segments: Array<[Vector3, Vector3]> }
interface HeapValue { vertex: number, bone: number, distance: number }

/** Priority queue for multi-source geodesic distances on an arbitrary mesh. */
class MinHeap {
  private readonly data: HeapValue[] = []
  get size (): number { return this.data.length }
  push (value: HeapValue): void {
    const data = this.data
    let index = data.length
    data.push(value)
    while (index > 0) {
      const parent = (index - 1) >>> 1
      if (data[parent].distance <= value.distance) break
      data[index] = data[parent]
      index = parent
    }
    data[index] = value
  }
  pop (): HeapValue | undefined {
    const data = this.data
    if (data.length === 0) return undefined
    const first = data[0]
    const last = data.pop()!
    if (data.length === 0) return first
    let index = 0
    while (index * 2 + 1 < data.length) {
      let child = index * 2 + 1
      const right = child + 1
      if (right < data.length && data[right].distance < data[child].distance) child = right
      if (data[child].distance >= last.distance) break
      data[index] = data[child]
      index = child
    }
    data[index] = last
    return first
  }
}

/**
 * Species-independent Surface Fit skinning.
 *
 * - Bones are actual segments instead of assumptions about Y-up anatomy.
 * - UV seams are welded; distances propagate over mesh edges, not empty space.
 * - Every disconnected component is seeded independently so detached clothing
 *   cannot inherit an influence from a different body's surface graph.
 * - The output is four non-negative normalized bone weights per vertex.
 *
 * The solver assigns weights to an already positioned skeleton; it does not
 * infer a new animal/human skeleton or retarget missing animation bones.
 */
export class SurfaceGeodesicWeightCalculator {
  constructor (
    private readonly bones: Bone[],
    private readonly geometry: BufferGeometry
  ) {}

  public calculate (skinIndices: number[], skinWeights: number[]): void {
    const position = this.geometry.getAttribute('position')
    if (position === undefined || position.count === 0) return
    const boneData = this.createBoneData()
    if (boneData.length === 0) throw new Error('Surface Fit needs at least one deforming bone')

    this.geometry.computeBoundingBox()
    const diagonal = Math.max(1e-5, this.geometry.boundingBox?.getSize(new Vector3()).length() ?? 1)
    const inverseWeld = 1 / Math.max(1e-6, diagonal * 1e-5)
    const points: Vector3[] = []
    const vertexToNode: number[] = []
    const indexByPosition = new Map<string, number>()

    for (let vertex = 0; vertex < position.count; vertex++) {
      const x = position.getX(vertex)
      const y = position.getY(vertex)
      const z = position.getZ(vertex)
      const key = `${Math.round(x * inverseWeld)},${Math.round(y * inverseWeld)},${Math.round(z * inverseWeld)}`
      let node = indexByPosition.get(key)
      if (node === undefined) {
        node = points.length
        indexByPosition.set(key, node)
        points.push(new Vector3(x, y, z))
      }
      vertexToNode.push(node)
    }

    const adjacency: Array<Map<number, number>> = Array.from({ length: points.length }, () => new Map())
    const connect = (a: number, b: number): void => {
      if (a === b) return
      const distance = Math.max(1e-7, points[a].distanceTo(points[b]))
      adjacency[a].set(b, distance)
      adjacency[b].set(a, distance)
    }
    const indices = this.geometry.getIndex()
    const count = indices?.count ?? position.count
    for (let triangle = 0; triangle + 2 < count; triangle += 3) {
      const a = vertexToNode[indices ? indices.getX(triangle) : triangle]
      const b = vertexToNode[indices ? indices.getX(triangle + 1) : triangle + 1]
      const c = vertexToNode[indices ? indices.getX(triangle + 2) : triangle + 2]
      connect(a, b); connect(b, c); connect(c, a)
    }

    // This works for an arbitrary skeleton: human, quadruped, bird, spider,
    // snake, fish, dragon, etc. No hard-coded pelvis/hand/head region.
    const visited = new Uint8Array(points.length)
    const influences: Array<Map<number, number>> = Array.from({ length: points.length }, () => new Map())
    const rigBounds = new Vector3(Infinity, Infinity, Infinity)
    const rigMax = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const data of boneData) {
      for (const [a, b] of data.segments) {
        rigBounds.min(a).min(b); rigMax.max(a).max(b)
      }
    }
    const rigSpan = Math.max(0.001, rigBounds.distanceTo(rigMax))

    for (let start = 0; start < points.length; start++) {
      if (visited[start] !== 0) continue
      const component: number[] = [start]
      visited[start] = 1
      for (let i = 0; i < component.length; i++) {
        for (const neighbor of adjacency[component[i]].keys()) {
          if (visited[neighbor] !== 0) continue
          visited[neighbor] = 1
          component.push(neighbor)
        }
      }

      const componentMin = new Vector3(Infinity, Infinity, Infinity)
      const componentMax = new Vector3(-Infinity, -Infinity, -Infinity)
      for (const node of component) {
        componentMin.min(points[node])
        componentMax.max(points[node])
      }
      const componentSpan = Math.max(1e-4, componentMin.distanceTo(componentMax))
      const stride = Math.max(1, Math.floor(component.length / 1024))
      const distances = boneData.map(data => {
        let best = Infinity
        for (let i = 0; i < component.length; i += stride) {
          best = Math.min(best, this.distanceToBone(points[component[i]], data))
        }
        return { data, best }
      }).sort((a, b) => a.best - b.best)

      const tolerance = Math.max(0.025 * rigSpan, 0.08 * componentSpan)
      const nearest = distances[0].best
      const selected = distances.filter(candidate => candidate.best <= nearest + tolerance)
      // Large connected objects need at least two joints for a transition.
      if (selected.length < 2 && componentSpan > 0.08 * rigSpan && distances.length > 1) {
        selected.push(distances[1])
      }

      const heap = new MinHeap()
      const offer = (node: number, bone: number, distance: number): void => {
        const record = influences[node]
        const previous = record.get(bone)
        if (previous !== undefined && previous <= distance) return
        if (previous === undefined && record.size >= 4) {
          let farthest = -Infinity
          let farthestBone = -1
          for (const [currentBone, currentDistance] of record) {
            if (currentDistance > farthest) {
              farthest = currentDistance; farthestBone = currentBone
            }
          }
          if (distance >= farthest) return
          record.delete(farthestBone)
        }
        record.set(bone, distance)
        heap.push({ vertex: node, bone, distance })
      }

      // Place seeds along each bone segment, not just at the nearest midpoint.
      // This handles long tails, wings, tentacles and limbs in the same way.
      for (const { data } of selected) {
        for (const [a, b] of data.segments) {
          const samples = [0, 1 / 3, 2 / 3, 1]
          for (const t of samples) {
            const sample = a.clone().lerp(b, t)
            let nearestNode = component[0]
            let best = Infinity
            for (const node of component) {
              const distance = points[node].distanceToSquared(sample)
              if (distance < best) { best = distance; nearestNode = node }
            }
            offer(nearestNode, data.index, Math.sqrt(best))
          }
        }
      }

      while (heap.size > 0) {
        const item = heap.pop()!
        if (influences[item.vertex].get(item.bone) !== item.distance) continue
        for (const [neighbor, edgeLength] of adjacency[item.vertex]) {
          offer(neighbor, item.bone, item.distance + edgeLength)
        }
      }

      // Ensure isolated vertices and degenerate components still have weights.
      const fallbackBone = distances[0].data.index
      for (const node of component) {
        if (influences[node].size === 0) {
          influences[node].set(fallbackBone, 0)
        }
      }
    }

    skinIndices.length = 0
    skinWeights.length = 0
    for (let vertex = 0; vertex < position.count; vertex++) {
      const influencesForNode = [...influences[vertexToNode[vertex]].entries()]
        .sort((a, b) => a[1] - b[1])
      const nearest = influencesForNode[0][1]
      const softness = Math.max(diagonal * 0.025, rigSpan * 0.01, 0.001)
      const weighted = influencesForNode.map(([bone, distance]) => ({
        bone, weight: Math.exp(-(distance - nearest) / softness)
      })).sort((a, b) => b.weight - a.weight).slice(0, 4)
      const total = weighted.reduce((s, value) => s + value.weight, 0)
      for (let slot = 0; slot < 4; slot++) {
        skinIndices.push(weighted[slot]?.bone ?? 0)
        skinWeights.push(weighted[slot] !== undefined ? weighted[slot].weight / total : 0)
      }
    }
  }

  private createBoneData (): BoneData[] {
    const result: BoneData[] = []
    for (let index = 0; index < this.bones.length; index++) {
      const bone = this.bones[index]
      const name = bone.name.toLowerCase()
      if (name === 'root' || Utility.is_leaf_bone(bone)) continue
      const a = Utility.world_position_from_object(bone)
      const children = bone.children.filter(child => child.type === 'Bone') as Bone[]
      const segments: Array<[Vector3, Vector3]> = children.length > 0
        ? children.map(child => [a, Utility.world_position_from_object(child)])
        : [[a, a]]
      result.push({ index, segments })
    }
    return result
  }

  private distanceToBone (point: Vector3, data: BoneData): number {
    let minSq = Infinity
    for (const [a, b] of data.segments) {
      const axis = b.clone().sub(a)
      const lengthSq = axis.lengthSq()
      const t = lengthSq > 1e-12
        ? Math.max(0, Math.min(1, point.clone().sub(a).dot(axis) / lengthSq))
        : 0
      minSq = Math.min(minSq, point.distanceToSquared(a.clone().addScaledVector(axis, t)))
    }
    return Math.sqrt(minSq)
  }
}
