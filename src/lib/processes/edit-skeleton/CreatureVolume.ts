import { Box3, Matrix4, type Mesh, type Object3D, Quaternion, Vector3 } from 'three'

/** Bounded solid grid used while fitting. Ray pairs exclude air between limbs;
 * graph distances follow occupied cells, including curled necks and tails. */
export class CreatureVolume {
  readonly min: Vector3
  readonly size: Vector3
  readonly step: number
  readonly nx: number
  readonly ny: number
  readonly nz: number
  readonly solid: Uint8Array
  readonly radius: Uint8Array
  readonly cells: number[] = []

  constructor (model: Object3D, frame: Object3D | null, yaw: Quaternion, points: Vector3[], resolution = 144) {
    const box = new Box3().setFromPoints(points)
    const transform = new Matrix4().makeRotationFromQuaternion(yaw.clone().invert())
      .multiply(frame?.matrixWorld.clone().invert() ?? new Matrix4())
    model.updateWorldMatrix(true, true)
    model.traverse(object => {
      const mesh = object as Mesh
      if (!mesh.isMesh || !mesh.geometry.getAttribute('position')) return
      mesh.geometry.computeBoundingBox()
      if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox.clone().applyMatrix4(transform.clone().multiply(mesh.matrixWorld)))
    })
    this.step = Math.max(...box.getSize(new Vector3()).toArray()) / resolution
    this.min = box.min.clone().addScalar(-this.step * 2)
    this.size = box.getSize(new Vector3()).addScalar(this.step * 4)
    this.nx = Math.ceil(this.size.x / this.step)
    this.ny = Math.ceil(this.size.y / this.step)
    this.nz = Math.ceil(this.size.z / this.step)
    this.solid = new Uint8Array(this.nx * this.ny * this.nz)
    this.radius = new Uint8Array(this.solid.length)
    const a = new Vector3(), b = new Vector3(), c = new Vector3()
    const row = (y: number) => (y - this.min.y) / this.step - .5
    const column = (z: number) => (z - this.min.z) / this.step - .5
    model.traverse(object => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const matrix = transform.clone().multiply(mesh.matrixWorld)
      const p = mesh.geometry.getAttribute('position'), index = mesh.geometry.index
      if (!p) return
      // Union each mesh independently: overlapping solid pieces must not XOR.
      const hits: number[][] = Array.from({ length: this.ny * this.nz }, () => [])
      for (let i = 0; i + 2 < (index?.count ?? p.count); i += 3) {
        a.fromBufferAttribute(p, index?.getX(i) ?? i).applyMatrix4(matrix)
        b.fromBufferAttribute(p, index?.getX(i + 1) ?? i + 1).applyMatrix4(matrix)
        c.fromBufferAttribute(p, index?.getX(i + 2) ?? i + 2).applyMatrix4(matrix)
        const determinant = (b.z - c.z) * (a.y - c.y) + (c.y - b.y) * (a.z - c.z)
        if (Math.abs(determinant) < 1e-12) continue
        const lo_y = Math.max(0, Math.ceil(row(Math.min(a.y, b.y, c.y))))
        const hi_y = Math.min(this.ny - 1, Math.floor(row(Math.max(a.y, b.y, c.y))))
        const lo_z = Math.max(0, Math.ceil(column(Math.min(a.z, b.z, c.z))))
        const hi_z = Math.min(this.nz - 1, Math.floor(column(Math.max(a.z, b.z, c.z))))
        for (let y = lo_y; y <= hi_y; y++) for (let z = lo_z; z <= hi_z; z++) {
          const py = this.min.y + (y + .5) * this.step, pz = this.min.z + (z + .5) * this.step
          const u = ((b.z - c.z) * (py - c.y) + (c.y - b.y) * (pz - c.z)) / determinant
          const v = ((c.z - a.z) * (py - c.y) + (a.y - c.y) * (pz - c.z)) / determinant
          if (u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001) hits[y * this.nz + z].push(u * a.x + v * b.x + (1 - u - v) * c.x)
        }
      }
      hits.forEach((values, line) => {
        values.sort((a, b) => a - b)
        const unique = values.filter((value, j) => !j || value - values[j - 1] > this.step * .001)
        for (let j = 0; j + 1 < unique.length; j += 2) {
          const lo = Math.max(1, Math.ceil((unique[j] - this.min.x) / this.step - .5))
          const hi = Math.min(this.nx - 2, Math.floor((unique[j + 1] - this.min.x) / this.step - .5))
          for (let x = lo; x <= hi; x++) {
            const i = line * this.nx + x
            if (!this.solid[i]) { this.solid[i] = 1; this.cells.push(i) }
          }
        }
      })
    })
    // Padded grid: linear neighbours cannot wrap at an occupied boundary.
    const offsets = [1, -1, this.nx, -this.nx, this.nx * this.nz, -this.nx * this.nz]
    const queue: number[] = []
    for (const i of this.cells) if (offsets.some(d => !this.solid[i + d])) { this.radius[i] = 1; queue.push(i) }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]
      for (const d of offsets) if (this.solid[i + d] && !this.radius[i + d]) {
        this.radius[i + d] = Math.min(255, this.radius[i] + 1); queue.push(i + d)
      }
    }
  }

  point (i: number): Vector3 {
    const x = i % this.nx, yz = Math.floor(i / this.nx)
    return new Vector3(this.min.x + (x + .5) * this.step,
      this.min.y + (Math.floor(yz / this.nz) + .5) * this.step,
      this.min.z + (yz % this.nz + .5) * this.step)
  }

  select (score: (p: Vector3, radius: number, i: number) => number): number {
    let best = -1, value = -Infinity
    for (const i of this.cells) {
      const next = score(this.point(i), this.radius[i] * this.step, i)
      if (next > value) { value = next; best = i }
    }
    return best
  }

  nearest (point: Vector3, accept: (p: Vector3) => boolean = () => true): number {
    return this.select(p => accept(p) ? -p.distanceToSquared(point) : -Infinity)
  }

  /** Medial-biased shortest paths cannot jump gaps between body parts. */
  paths (seed: number, accept: (p: Vector3) => boolean = () => true): { distance: Float32Array, parent: Int32Array } {
    const distance = new Float32Array(this.solid.length).fill(Infinity)
    const parent = new Int32Array(this.solid.length).fill(-1)
    if (seed < 0) return { distance, parent }
    const allowed = new Uint8Array(this.solid.length)
    for (const i of this.cells) if (accept(this.point(i))) allowed[i] = 1
    const offsets: Array<[number, number]> = []
    for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) {
      if (x || y || z) offsets.push([x + this.nx * (z + this.nz * y), Math.hypot(x, y, z)])
    }
    const heap: Array<[number, number]> = []
    const push = (node: [number, number]) => {
      let i = heap.length; heap.push(node)
      while (i > 0) {
        const p = (i - 1) >> 1
        if (heap[p][1] <= node[1]) break
        heap[i] = heap[p]; i = p
      }
      heap[i] = node
    }
    const pop = (): [number, number] => {
      const top = heap[0], end = heap.pop()!
      if (heap.length) {
        let i = 0
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1
          if (child + 1 < heap.length && heap[child + 1][1] < heap[child][1]) child++
          if (end[1] <= heap[child][1]) break
          heap[i] = heap[child]; i = child
        }
        heap[i] = end
      }
      return top
    }
    distance[seed] = 0; push([seed, 0])
    while (heap.length) {
      const [i, cost] = pop()
      if (cost > distance[i] + 1e-4) continue
      for (const [offset, length] of offsets) {
        const next = i + offset
        if (!allowed[next]) continue
        const total = cost + length / Math.sqrt(Math.min(this.radius[i], this.radius[next]) + .25)
        if (total >= distance[next] - 1e-5) continue
        distance[next] = total; parent[next] = i; push([next, distance[next]])
      }
    }
    return { distance, parent }
  }

  path (end: number, parent: Int32Array): Vector3[] {
    const path: Vector3[] = []
    for (let i = end; i >= 0; i = parent[i]) path.push(this.point(i))
    path.reverse()
    return path.map((p, i) => {
      if (i === 0 || i === path.length - 1) return p
      const window = path.slice(Math.max(0, i - 2), Math.min(path.length, i + 3))
      return window.reduce((sum, q) => sum.add(q), new Vector3()).divideScalar(window.length)
    })
  }

  static along (path: Vector3[], fraction: number): Vector3 {
    if (!path.length) throw new Error('Empty anatomical path')
    const lengths = path.slice(1).map((p, i) => p.distanceTo(path[i]))
    let remaining = lengths.reduce((a, b) => a + b, 0) * Math.max(0, Math.min(1, fraction))
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i]) return path[i].clone().lerp(path[i + 1], remaining / Math.max(1e-10, lengths[i]))
      remaining -= lengths[i]
    }
    return path[path.length - 1].clone()
  }
}
