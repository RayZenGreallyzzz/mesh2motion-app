import {
  Vector3,
  type Bone,
  type BufferGeometry
} from 'three'

import { Utility } from '../Utilities.js'

interface HeapEntry {
  node: number
  bone: number
  distance: number
}

interface BoneSurfaceData {
  boneIndex: number
  segments: Array<[Vector3, Vector3]>
}

interface ComponentMetrics {
  span: number
  averageEdgeLength: number
}

/**
 * Small binary min-heap used by the surface-distance propagation pass.
 * Keeping it local avoids adding another dependency to the Android bundle.
 */
class SurfaceMinHeap {
  private readonly entries: HeapEntry[] = []

  public get size (): number {
    return this.entries.length
  }

  public push (entry: HeapEntry): void {
    const heap = this.entries
    heap.push(entry)
    let index = heap.length - 1

    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (heap[parent].distance <= entry.distance) break
      heap[index] = heap[parent]
      index = parent
    }
    heap[index] = entry
  }

  public pop (): HeapEntry | null {
    const heap = this.entries
    if (heap.length === 0) return null

    const first = heap[0]
    const last = heap.pop()!
    if (heap.length === 0) return first

    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      if (left >= heap.length) break

      let child = left
      if (right < heap.length && heap[right].distance < heap[left].distance) child = right
      if (heap[child].distance >= last.distance) break

      heap[index] = heap[child]
      index = child
    }
    heap[index] = last
    return first
  }
}

/**
 * Humanoid skinning based on distance travelled across the mesh surface.
 *
 * The original Mesh2Motion solver starts each vertex at the closest bone in
 * straight 3D space. That is fast, but a hand can be physically close to a cape,
 * breast, belt or skirt even though those surfaces are not connected. This
 * solver deliberately separates those concepts:
 *
 * 1. Build a welded triangle-surface graph (UV seams share one virtual node).
 * 2. Split the graph into connected surface components.
 * 3. Represent every bone as one or more real joint-to-joint segments.
 * 4. Seed only bones that are physically close to each component.
 * 5. Propagate the nearest bone influences through surface edges with Dijkstra.
 * 6. Keep at most four normalized influences per original vertex.
 *
 * The result is still deterministic and local/offline, but influence cannot
 * teleport through empty space between disconnected clothes/body surfaces.
 */
export class SurfaceGeodesicWeightCalculator {
  private readonly bones: Bone[]
  private readonly geometry: BufferGeometry
  private readonly propagationInfluenceCount = 6
  private readonly outputInfluenceCount = 4
  private readonly seedsPerBone = 8

  private nodePositions: Vector3[] = []
  private originalVertexToNode: number[] = []
  private nodeToOriginalVertices: number[][] = []
  private adjacency: Array<Array<{ node: number, length: number }>> = []
  private components: number[][] = []
  private boneSurfaceData: BoneSurfaceData[] = []
  private skeletonHeight = 1

  constructor (bones: Bone[], geometry: BufferGeometry) {
    this.bones = bones
    this.geometry = geometry
  }

  public calculate (skinIndices: number[], skinWeights: number[]): void {
    skinIndices.length = 0
    skinWeights.length = 0

    this.buildBoneSurfaceData()
    this.buildSurfaceGraph()
    this.buildConnectedComponents()

    const vertexCount = this.geometry.getAttribute('position').count
    const resultBones: number[][] = Array.from({ length: this.nodePositions.length }, () => [])
    const resultWeights: number[][] = Array.from({ length: this.nodePositions.length }, () => [])

    console.time('surface_geodesic_skinning')
    for (const component of this.components) {
      this.solveComponent(component, resultBones, resultWeights)
    }
    console.timeEnd('surface_geodesic_skinning')

    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const node = this.originalVertexToNode[vertex]
      const bones = resultBones[node]
      const weights = resultWeights[node]

      if (bones.length === 0) {
        const fallback = this.closestBoneToPoint(this.nodePositions[node])
        skinIndices.push(fallback, 0, 0, 0)
        skinWeights.push(1, 0, 0, 0)
        continue
      }

      for (let slot = 0; slot < this.outputInfluenceCount; slot++) {
        skinIndices.push(bones[slot] ?? 0)
        skinWeights.push(weights[slot] ?? 0)
      }
    }

    console.log(
      `Surface skin v2: ${vertexCount} vertices -> ${this.nodePositions.length} welded nodes, ` +
      `${this.components.length} connected surface component(s), ${this.boneSurfaceData.length} deform bones`
    )
  }

  private buildBoneSurfaceData (): void {
    this.boneSurfaceData = []
    const bonePositions: Vector3[] = []

    this.bones.forEach((bone, boneIndex) => {
      const bonePosition = Utility.world_position_from_object(bone)
      bonePositions.push(bonePosition)

      const name = bone.name.toLowerCase()
      if (name === 'root' || name.endsWith(':root') || Utility.is_leaf_bone(bone)) return

      const childBones = bone.children.filter(child => child.type === 'Bone') as Bone[]
      const segments: Array<[Vector3, Vector3]> = []

      if (childBones.length > 0) {
        for (const child of childBones) {
          segments.push([bonePosition.clone(), Utility.world_position_from_object(child)])
        }
      } else {
        // Some imported rigs do not label their terminal control as a leaf.
        // Keep a point-segment so the parent bone can still receive nearby skin.
        segments.push([bonePosition.clone(), bonePosition.clone()])
      }

      this.boneSurfaceData.push({ boneIndex, segments })
    })

    if (bonePositions.length > 1) {
      let minY = Infinity
      let maxY = -Infinity
      for (const point of bonePositions) {
        minY = Math.min(minY, point.y)
        maxY = Math.max(maxY, point.y)
      }
      this.skeletonHeight = Math.max(0.001, maxY - minY)
    }
  }

  private buildSurfaceGraph (): void {
    const positions = this.geometry.getAttribute('position')
    const vertexCount = positions.count

    this.geometry.computeBoundingBox()
    const bbox = this.geometry.boundingBox
    const diagonal = bbox === null ? 1 : bbox.max.distanceTo(bbox.min)
    const weldEpsilon = Math.max(diagonal * 1e-5, 1e-6)
    const inverseWeld = 1 / weldEpsilon

    const nodeByPosition = new Map<string, number>()
    this.nodePositions = []
    this.originalVertexToNode = new Array<number>(vertexCount)
    this.nodeToOriginalVertices = []

    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const x = positions.getX(vertex)
      const y = positions.getY(vertex)
      const z = positions.getZ(vertex)
      const key = `${Math.round(x * inverseWeld)},${Math.round(y * inverseWeld)},${Math.round(z * inverseWeld)}`

      let node = nodeByPosition.get(key)
      if (node === undefined) {
        node = this.nodePositions.length
        nodeByPosition.set(key, node)
        this.nodePositions.push(new Vector3(x, y, z))
        this.nodeToOriginalVertices.push([])
      }

      this.originalVertexToNode[vertex] = node
      this.nodeToOriginalVertices[node].push(vertex)
    }

    const neighborSets: Array<Set<number>> = Array.from({ length: this.nodePositions.length }, () => new Set<number>())
    const index = this.geometry.getIndex()
    const triangleIndexCount = index?.count ?? vertexCount

    for (let triangle = 0; triangle + 2 < triangleIndexCount; triangle += 3) {
      const va = index === null ? triangle : index.getX(triangle)
      const vb = index === null ? triangle + 1 : index.getX(triangle + 1)
      const vc = index === null ? triangle + 2 : index.getX(triangle + 2)
      const a = this.originalVertexToNode[va]
      const b = this.originalVertexToNode[vb]
      const c = this.originalVertexToNode[vc]

      this.addUndirectedEdge(neighborSets, a, b)
      this.addUndirectedEdge(neighborSets, b, c)
      this.addUndirectedEdge(neighborSets, c, a)
    }

    this.adjacency = neighborSets.map((neighbors, node) => {
      const from = this.nodePositions[node]
      return [...neighbors].map(neighbor => ({
        node: neighbor,
        length: Math.max(1e-6, from.distanceTo(this.nodePositions[neighbor]))
      }))
    })
  }

  private addUndirectedEdge (adjacency: Array<Set<number>>, a: number, b: number): void {
    if (a === b) return
    adjacency[a].add(b)
    adjacency[b].add(a)
  }

  private buildConnectedComponents (): void {
    this.components = []
    const visited = new Uint8Array(this.nodePositions.length)

    for (let start = 0; start < this.nodePositions.length; start++) {
      if (visited[start] !== 0) continue

      const component: number[] = []
      const stack: number[] = [start]
      visited[start] = 1

      while (stack.length > 0) {
        const node = stack.pop()!
        component.push(node)
        for (const edge of this.adjacency[node]) {
          if (visited[edge.node] !== 0) continue
          visited[edge.node] = 1
          stack.push(edge.node)
        }
      }

      this.components.push(component)
    }
  }

  private solveComponent (
    component: number[],
    resultBones: number[][],
    resultWeights: number[][]
  ): void {
    if (component.length === 0) return

    const metrics = this.componentMetrics(component)
    const candidateBones = this.selectCandidateBones(component, metrics.span)
    if (candidateBones.length === 0) return

    const bestBones: number[][] = Array.from({ length: this.nodePositions.length }, () => [])
    const bestDistances: number[][] = Array.from({ length: this.nodePositions.length }, () => [])
    const heap = new SurfaceMinHeap()

    for (const bone of candidateBones) {
      const seeds = this.findBoneSeeds(component, bone, this.seedsPerBone)
      for (const seed of seeds) {
        if (this.offerInfluence(bestBones, bestDistances, seed.node, bone.boneIndex, seed.distance)) {
          heap.push({ node: seed.node, bone: bone.boneIndex, distance: seed.distance })
        }
      }
    }

    while (heap.size > 0) {
      const current = heap.pop()!
      const slot = bestBones[current.node].indexOf(current.bone)
      if (slot < 0 || current.distance > bestDistances[current.node][slot] + 1e-7) continue

      for (const edge of this.adjacency[current.node]) {
        const nextDistance = current.distance + edge.length
        if (this.offerInfluence(bestBones, bestDistances, edge.node, current.bone, nextDistance)) {
          heap.push({ node: edge.node, bone: current.bone, distance: nextDistance })
        }
      }
    }

    const sigma = Math.max(
      this.skeletonHeight * 0.035,
      metrics.span * 0.03,
      metrics.averageEdgeLength * 5,
      0.005
    )

    for (const node of component) {
      const bones = bestBones[node]
      const distances = bestDistances[node]
      if (bones.length === 0) continue

      const minDistance = distances[0]
      const weighted: Array<{ bone: number, weight: number }> = []

      for (let slot = 0; slot < bones.length; slot++) {
        const relativeDistance = Math.max(0, distances[slot] - minDistance)
        const weight = Math.exp(-relativeDistance / sigma)
        if (slot === 0 || weight >= 0.02) weighted.push({ bone: bones[slot], weight })
      }

      weighted.sort((a, b) => b.weight - a.weight)
      const top = weighted.slice(0, this.outputInfluenceCount)
      const sum = top.reduce((value, influence) => value + influence.weight, 0)

      resultBones[node] = top.map(influence => influence.bone)
      resultWeights[node] = top.map(influence => influence.weight / Math.max(sum, 1e-8))
    }
  }

  private componentMetrics (component: number[]): ComponentMetrics {
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    let edgeLengthSum = 0
    let edgeCount = 0

    const componentSet = new Set(component)
    for (const node of component) {
      const p = this.nodePositions[node]
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)

      for (const edge of this.adjacency[node]) {
        if (!componentSet.has(edge.node) || edge.node < node) continue
        edgeLengthSum += edge.length
        edgeCount++
      }
    }

    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.001)
    return {
      span,
      averageEdgeLength: edgeCount > 0 ? edgeLengthSum / edgeCount : span * 0.01
    }
  }

  private selectCandidateBones (component: number[], componentSpan: number): BoneSurfaceData[] {
    if (this.boneSurfaceData.length === 0) return []

    const sampleStride = Math.max(1, Math.ceil(component.length / 1800))
    const estimates = this.boneSurfaceData.map(bone => {
      let minDistanceSq = Infinity
      for (let i = 0; i < component.length; i += sampleStride) {
        minDistanceSq = Math.min(minDistanceSq, this.distanceSqToBone(this.nodePositions[component[i]], bone))
      }
      // Always include the final sampled node so tiny end regions are not missed.
      minDistanceSq = Math.min(
        minDistanceSq,
        this.distanceSqToBone(this.nodePositions[component[component.length - 1]], bone)
      )
      return { bone, distance: Math.sqrt(minDistanceSq) }
    }).sort((a, b) => a.distance - b.distance)

    const bestDistance = estimates[0].distance
    const allowance = Math.max(
      this.skeletonHeight * 0.018,
      Math.min(this.skeletonHeight * 0.065, componentSpan * 0.09)
    )

    const selected = estimates
      .filter(entry => entry.distance <= bestDistance + allowance)
      .map(entry => entry.bone)

    // A very small rigid accessory may legitimately belong to only one bone.
    // For larger connected surfaces keep at least the two closest candidates so
    // joints can still form a smooth transition.
    if (selected.length < 2 && componentSpan > this.skeletonHeight * 0.08 && estimates.length > 1) {
      selected.push(estimates[1].bone)
    }

    return selected
  }

  private findBoneSeeds (
    component: number[],
    bone: BoneSurfaceData,
    count: number
  ): Array<{ node: number, distance: number }> {
    const best: Array<{ node: number, distanceSq: number }> = []

    for (const node of component) {
      const distanceSq = this.distanceSqToBone(this.nodePositions[node], bone)

      if (best.length < count) {
        best.push({ node, distanceSq })
        best.sort((a, b) => a.distanceSq - b.distanceSq)
        continue
      }

      if (distanceSq >= best[best.length - 1].distanceSq) continue
      best[best.length - 1] = { node, distanceSq }
      best.sort((a, b) => a.distanceSq - b.distanceSq)
    }

    return best.map(seed => ({ node: seed.node, distance: Math.sqrt(seed.distanceSq) }))
  }

  private offerInfluence (
    bestBones: number[][],
    bestDistances: number[][],
    node: number,
    bone: number,
    distance: number
  ): boolean {
    const bones = bestBones[node]
    const distances = bestDistances[node]
    const existing = bones.indexOf(bone)

    if (existing >= 0) {
      if (distance >= distances[existing] - 1e-8) return false
      distances[existing] = distance
      this.sortInfluences(bones, distances)
      return true
    }

    if (bones.length >= this.propagationInfluenceCount && distance >= distances[distances.length - 1]) {
      return false
    }

    bones.push(bone)
    distances.push(distance)
    this.sortInfluences(bones, distances)

    if (bones.length > this.propagationInfluenceCount) {
      bones.pop()
      distances.pop()
    }
    return bones.includes(bone)
  }

  private sortInfluences (bones: number[], distances: number[]): void {
    const order = bones.map((bone, index) => ({ bone, distance: distances[index] }))
      .sort((a, b) => a.distance - b.distance)
    bones.length = 0
    distances.length = 0
    for (const entry of order) {
      bones.push(entry.bone)
      distances.push(entry.distance)
    }
  }

  private closestBoneToPoint (point: Vector3): number {
    let closest = this.boneSurfaceData[0]?.boneIndex ?? 0
    let bestDistanceSq = Infinity
    for (const bone of this.boneSurfaceData) {
      const distanceSq = this.distanceSqToBone(point, bone)
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq
        closest = bone.boneIndex
      }
    }
    return closest
  }

  private distanceSqToBone (point: Vector3, bone: BoneSurfaceData): number {
    let best = Infinity
    for (const [start, end] of bone.segments) {
      best = Math.min(best, this.pointSegmentDistanceSq(point, start, end))
    }
    return best
  }

  private pointSegmentDistanceSq (point: Vector3, start: Vector3, end: Vector3): number {
    const segment = new Vector3().subVectors(end, start)
    const lengthSq = segment.lengthSq()
    if (lengthSq <= 1e-12) return point.distanceToSquared(start)

    const t = Math.max(0, Math.min(1, new Vector3().subVectors(point, start).dot(segment) / lengthSq))
    const closest = start.clone().addScaledVector(segment, t)
    return point.distanceToSquared(closest)
  }
}
