import { Box3, Mesh, Object3D, Raycaster, Vector3 } from 'three'

/** One-shot geometric queries for joint placement; independent of vertex density. */
export class HumanoidSurfaceSampler {
  private readonly meshes: Mesh[] = []
  private readonly surfaces: Array<{ positions: Float32Array, index: ArrayLike<number> | null }> = []
  public readonly bounds = new Box3()
  public readonly points: Vector3[] = []
  private readonly forward = new Raycaster()
  private readonly backward = new Raycaster()

  constructor (model: Object3D) {
    model.updateWorldMatrix(true, true)
    model.traverse(object => {
      if (!(object as Mesh).isMesh) return
      const mesh = object as Mesh
      const attribute = mesh.geometry.getAttribute('position')
      if (attribute === undefined) return
      this.meshes.push(mesh)
      const positions = new Float32Array(attribute.count * 3)
      const point = new Vector3()
      for (let vertex = 0; vertex < attribute.count; vertex++) {
        point.fromBufferAttribute(attribute, vertex).applyMatrix4(object.matrixWorld)
        point.toArray(positions, vertex * 3)
        this.bounds.expandByPoint(point)
        this.points.push(point.clone())
      }
      this.surfaces.push({ positions, index: mesh.geometry.index?.array ?? null })
    })
  }

  public get height (): number { return this.bounds.max.y - this.bounds.min.y }

  /** Pair the visible body entrance with its nearest exit, excluding rear hair. */
  public depth_center (x: number, y: number, fallback: number): number {
    const margin = Math.max(this.height, 0.001)
    this.forward.set(new Vector3(x, y, this.bounds.max.z + margin), new Vector3(0, 0, -1))
    this.backward.set(new Vector3(x, y, this.bounds.min.z - margin), new Vector3(0, 0, 1))
    const entries = this.forward.intersectObjects(this.meshes, false)
    const exits = this.backward.intersectObjects(this.meshes, false)
    const epsilon = Math.max(1e-6, this.height * 1e-5)
    for (const entry of entries) {
      let nearestExit = -Infinity
      for (const exit of exits) {
        if (exit.object !== entry.object || exit.point.z >= entry.point.z - epsilon) continue
        nearestExit = Math.max(nearestExit, exit.point.z)
      }
      if (Number.isFinite(nearestExit)) return (entry.point.z + nearestExit) * 0.5
    }
    return fallback
  }

  /** Project exact triangle/vertical-plane sections onto Y and find the arm. */
  public arm_center_y (x: number, expectedY: number): number {
    const intervals: Array<[number, number]> = []
    for (const { positions: p, index } of this.surfaces) {
      const count = index?.length ?? p.length / 3
      for (let face = 0; face + 2 < count; face += 3) {
        const a = (index?.[face] ?? face) * 3
        const b = (index?.[face + 1] ?? face + 1) * 3
        const c = (index?.[face + 2] ?? face + 2) * 3
        if (x < Math.min(p[a], p[b], p[c]) || x > Math.max(p[a], p[b], p[c])) continue
        let lo = Infinity; let hi = -Infinity
        for (const [start, end] of [[a, b], [b, c], [c, a]]) {
          const delta = p[end] - p[start]
          if (Math.abs(delta) < 1e-10) continue
          const t = (x - p[start]) / delta
          if (t < 0 || t > 1) continue
          const yy = p[start + 1] + (p[end + 1] - p[start + 1]) * t
          lo = Math.min(lo, yy); hi = Math.max(hi, yy)
        }
        if (hi >= lo) intervals.push([lo, hi])
      }
    }
    intervals.sort((a, b) => a[0] - b[0])
    const merged: Array<[number, number]> = []
    const gap = this.height * 0.001
    for (const interval of intervals) {
      const last = merged[merged.length - 1]
      if (last !== undefined && interval[0] <= last[1] + gap) last[1] = Math.max(last[1], interval[1])
      else merged.push([...interval])
    }
    let best = expectedY; let distance = Infinity
    for (const [lo, hi] of merged) {
      const center = (lo + hi) * 0.5
      if (hi - lo > this.height * 0.20 || center < this.bounds.min.y + this.height * 0.42) continue
      if (Math.abs(center - expectedY) < distance) {
        best = center; distance = Math.abs(center - expectedY)
      }
    }
    return best
  }
}
