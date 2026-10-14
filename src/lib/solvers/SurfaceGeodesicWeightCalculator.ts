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
  // Cover both the length and circumference of tapered limbs and clothing.
  private readonly seedsPerBone = 32
  private readonly smoothingIterations = 3
  private readonly smoothingAlpha = 0.42
  private readonly boneNeighborhoodDepth = 2

  private nodePositions: Vector3[] = []
  private originalVertexToNode: number[] = []
  private nodeToOriginalVertices: number[][] = []
  private adjacency: Array<Array<{ node: number, length: number }>> = []
  private components: number[][] = []
  private boneSurfaceData: BoneSurfaceData[] = []
  private boneSurfaceByIndex = new Map<number, BoneSurfaceData>()
  private boneNeighborhoods: Array<Set<number>> = []
  private nearestSurfaceBones: number[] = []
  private skeletonHeight = 1

  constructor (bones: Bone[], geometry: BufferGeometry) {
    this.bones = bones
    this.geometry = geometry
  }

  public calculate (skinIndices: number[], skinWeights: number[]): void {
    skinIndices.length = 0
    skinWeights.length = 0

    this.buildBoneSurfaceData()
    this.boneSurfaceByIndex = new Map(this.boneSurfaceData.map(bone => [bone.boneIndex, bone]))
    this.buildBoneNeighborhoods()
    this.buildSurfaceGraph()
    this.nearestSurfaceBones = this.nodePositions.map(point => this.closestBoneToPoint(point))
    this.buildConnectedComponents()

    const vertexCount = this.geometry.getAttribute('position').count
    const resultBones: number[][] = Array.from({ length: this.nodePositions.length }, () => [])
    const resultWeights: number[][] = Array.from({ length: this.nodePositions.length }, () => [])

    console.time('surface_geodesic_skinning')
    for (const component of this.components) {
      this.solveComponent(component, resultBones, resultWeights)
    }
    console.timeEnd('surface_geodesic_skinning')

    // v6.0 joint blend: Dijkstra gives good locality, but high-poly cylindrical
    // limbs can still receive a razor-sharp boundary if the nearest seed set is
    // uneven around the circumference. Smooth the already-local influences over
    // the welded surface graph. Only bones within two hierarchy hops of the
    // dominant bone may enter the blend, so hand weights cannot bleed into chest.
    this.smoothNodeWeights(resultBones, resultWeights)

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

      const childBones = bone.children.filter(child => child.type === 'Bone' && this.bones.includes(child as Bone)) as Bone[]
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
      // Historically this used only Y range, which can be almost zero for
      // horizontal snakes, fish, wings and long tails. The cutoff/smoothing
      // scale must cover the full arbitrary 3D skeleton.
      const min = new Vector3(Infinity, Infinity, Infinity)
      const max = new Vector3(-Infinity, -Infinity, -Infinity)
      for (const point of bonePositions) {
        min.min(point)
        max.max(point)
      }
      this.skeletonHeight = Math.max(0.001, min.distanceTo(max))
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
      const point = this.nodePositions[node]
      const local_distances = bones.map(index => Math.sqrt(this.distanceSqToBone(
        point, this.boneSurfaceByIndex.get(index)!
      )))
      const local_min = Math.min(...local_distances)

      for (let slot = 0; slot < bones.length; slot++) {
        // Surface paths keep disconnected/occluded regions separate. A local
        // distance penalty also prevents the broad falloff from sharing a
        // thick trouser leg with the opposite thigh. It is continuous through
        // the joint/equidistance plane, unlike dropping weights by bone family.
        const relativeDistance = Math.max(0, distances[slot] - minDistance) +
          2 * Math.max(0, local_distances[slot] - local_min)
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

    // Every part of a connected surface needs local bone coverage. A handful
    // of farthest-point samples only visits the extremities of a full body:
    // fingers can fill those samples while upper arms receive no candidates.
    // Keep the local nearest-four rule, but visit every welded node. This also
    // works for long tails, wings and rigs with more than 32 deform bones.
    const selected = new Set<number>()
    const local_allowance = Math.max(
      this.skeletonHeight * 0.025,
      Math.min(this.skeletonHeight * 0.075, componentSpan * 0.065)
    )
    const minimum = componentSpan > this.skeletonHeight * 0.08 ? 2 : 1
    const nearest_bones: BoneSurfaceData[] = []
    const nearest_distances: number[] = []

    for (const node of component) {
      nearest_bones.length = 0
      nearest_distances.length = 0
      const point = this.nodePositions[node]

      // Reuse four slots instead of allocating/sorting the entire rig at each
      // vertex. Distances stay squared until the local cutoff is calculated.
      for (const bone of this.boneSurfaceData) {
        const distance_sq = this.distanceSqToBone(point, bone)
        let slot = nearest_distances.length
        while (slot > 0 && distance_sq < nearest_distances[slot - 1]) slot--
        if (slot >= 4) continue
        nearest_bones.splice(slot, 0, bone)
        nearest_distances.splice(slot, 0, distance_sq)
        if (nearest_bones.length > 4) {
          nearest_bones.pop()
          nearest_distances.pop()
        }
      }

      const cutoff_sq = (Math.sqrt(nearest_distances[0]) + local_allowance) ** 2
      for (let slot = 0; slot < nearest_bones.length; slot++) {
        if (slot >= minimum && nearest_distances[slot] > cutoff_sq) break
        selected.add(nearest_bones[slot].boneIndex)
      }
      if (selected.size === this.boneSurfaceData.length) break
    }

    // The propagation pass already caps influences per node. A component-wide
    // cap discards valid limb bones solely because of traversal order.
    return this.boneSurfaceData.filter(bone => selected.has(bone.boneIndex))
  }

  private findBoneSeeds (
    component: number[],
    bone: BoneSurfaceData,
    count: number
  ): Array<{ node: number, distance: number }> {
    // A global nearest-N pool concentrates all seeds at the thinnest ring of a
    // tapered limb. Choose the nearest surface point in each longitudinal and
    // angular cell so a dense wrist cannot leave the forearm unseeded.
    const bins_per_segment = 4
    const sectors = Math.max(4, Math.ceil(count / bins_per_segment))
    const bucket_count = bone.segments.length * bins_per_segment * sectors
    const buckets: Array<{ node: number, distance_sq: number } | undefined> =
      Array.from({ length: bucket_count }, () => undefined)
    const radial_bases = bone.segments.map(([a, b]) => {
      const axis = b.clone().sub(a).normalize()
      if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0)
      const u = new Vector3().crossVectors(axis, Math.abs(axis.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize()
      return [u, new Vector3().crossVectors(axis, u)] as const
    })

    for (const node of component) {
      const point = this.nodePositions[node]
      // A connected character is not a seed region for every bone. In
      // particular, angular buckets can plant RIGHT calf seeds on the LEFT
      // leg, bypassing the surface path around the crotch. Only seed the
      // nearest segment; propagation handles the rest of the surface and
      // keeps smooth transitions at real joints. Even seeding a sibling via
      // the shared pelvis would reintroduce opposite-thigh anchors.
      const nearest_index = this.nearestSurfaceBones[node]
      if (nearest_index !== bone.boneIndex) continue
      let distance_sq = Infinity
      let bucket = 0
      for (let segment = 0; segment < bone.segments.length; segment++) {
        const [a, b] = bone.segments[segment]
        const dx = b.x - a.x; const dy = b.y - a.y; const dz = b.z - a.z
        const length_sq = dx * dx + dy * dy + dz * dz
        const t = length_sq > 1e-12
          ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) / length_sq))
          : 0
        const px = point.x - a.x - t * dx
        const py = point.y - a.y - t * dy
        const pz = point.z - a.z - t * dz
        const candidate_distance = px * px + py * py + pz * pz
        if (candidate_distance < distance_sq) {
          distance_sq = candidate_distance
          const [u, v] = radial_bases[segment]
          const angle = Math.atan2(px * v.x + py * v.y + pz * v.z, px * u.x + py * u.y + pz * u.z) + Math.PI
          const sector = Math.min(sectors - 1, Math.floor(angle / (2 * Math.PI) * sectors))
          bucket = (segment * bins_per_segment + Math.min(bins_per_segment - 1, Math.floor(t * bins_per_segment))) * sectors + sector
        }
      }
      const nearest = buckets[bucket]
      if (nearest === undefined || distance_sq < nearest.distance_sq) {
        buckets[bucket] = { node, distance_sq }
      }
    }

    return buckets.flatMap(seed => seed === undefined ? [] : [{ node: seed.node, distance: Math.sqrt(seed.distance_sq) }])
  }

  private buildBoneNeighborhoods (): void {
    const indexByBone = new Map<Bone, number>()
    this.bones.forEach((bone, index) => indexByBone.set(bone, index))

    this.boneNeighborhoods = this.bones.map((bone, boneIndex) => {
      const allowed = new Set<number>([boneIndex])
      const visited = new Set<Bone>([bone])
      let frontier: Bone[] = [bone]

      for (let depth = 0; depth < this.boneNeighborhoodDepth; depth++) {
        const next: Bone[] = []
        for (const current of frontier) {
          const relatives: Bone[] = []
          if (current.parent?.type === 'Bone') relatives.push(current.parent as Bone)
          for (const child of current.children) {
            if (child.type === 'Bone') relatives.push(child as Bone)
          }

          for (const relative of relatives) {
            if (visited.has(relative)) continue
            visited.add(relative)
            next.push(relative)
            const index = indexByBone.get(relative)
            if (index !== undefined) allowed.add(index)
          }
        }
        frontier = next
      }

      return allowed
    })
  }

  private smoothNodeWeights (resultBones: number[][], resultWeights: number[][]): void {
    if (this.smoothingIterations <= 0 || this.smoothingAlpha <= 0) return

    for (let iteration = 0; iteration < this.smoothingIterations; iteration++) {
      const nextBones: number[][] = Array.from({ length: resultBones.length }, () => [])
      const nextWeights: number[][] = Array.from({ length: resultWeights.length }, () => [])

      for (let node = 0; node < resultBones.length; node++) {
        const ownBones = resultBones[node]
        const ownWeights = resultWeights[node]
        if (ownBones.length === 0) continue

        const dominantBone = ownBones[0]
        // Keep influences already established by surface propagation. The
        // hierarchy restriction only controls NEW influences from neighbors;
        // dropping existing weights at a dominant-bone boundary creates tears.
        const allowed = new Set([
          ...ownBones,
          ...(this.boneNeighborhoods[dominantBone] ?? [])
        ])
        const accumulated = new Map<number, number>()

        const add = (bone: number, value: number): void => {
          if (!allowed.has(bone) || value <= 0) return
          accumulated.set(bone, (accumulated.get(bone) ?? 0) + value)
        }

        const selfFactor = 1 - this.smoothingAlpha
        for (let slot = 0; slot < ownBones.length; slot++) {
          add(ownBones[slot], ownWeights[slot] * selfFactor)
        }

        const neighbors = this.adjacency[node]
        if (neighbors.length > 0) {
          const neighborFactor = this.smoothingAlpha / neighbors.length
          for (const edge of neighbors) {
            const neighborBones = resultBones[edge.node]
            const neighborWeights = resultWeights[edge.node]
            for (let slot = 0; slot < neighborBones.length; slot++) {
              add(neighborBones[slot], neighborWeights[slot] * neighborFactor)
            }
          }
        } else {
          for (let slot = 0; slot < ownBones.length; slot++) {
            add(ownBones[slot], ownWeights[slot] * this.smoothingAlpha)
          }
        }

        const sorted = [...accumulated.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, this.outputInfluenceCount)
        const sum = sorted.reduce((value, entry) => value + entry[1], 0)

        if (sum <= 1e-8) {
          nextBones[node] = [...ownBones]
          nextWeights[node] = [...ownWeights]
          continue
        }

        nextBones[node] = sorted.map(entry => entry[0])
        nextWeights[node] = sorted.map(entry => entry[1] / sum)
      }

      for (let node = 0; node < resultBones.length; node++) {
        resultBones[node] = nextBones[node]
        resultWeights[node] = nextWeights[node]
      }
    }
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
    // This runs for every node/bone pair; avoid temporary Vector3 allocations.
    const dx = end.x - start.x
    const dy = end.y - start.y
    const dz = end.z - start.z
    const px = point.x - start.x
    const py = point.y - start.y
    const pz = point.z - start.z
    const length_sq = dx * dx + dy * dy + dz * dz
    const t = length_sq <= 1e-12
      ? 0
      : Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / length_sq))
    return (px - dx * t) ** 2 + (py - dy * t) ** 2 + (pz - dz * t) ** 2
  }
}
