import { Box3, Matrix4, type Mesh, type Object3D, Quaternion, Vector3 } from 'three'

/** Ray/triangle cross-sections through the body, not a density fit of surface
 * vertices. Empty space between two legs must never count as torso volume. */
export class AnimalCrossSection {
  private readonly rows = 80
  private readonly columns = 100
  private readonly widths: Float32Array
  private readonly min: Vector3
  private readonly size: Vector3

  constructor (model: Object3D, frame: Object3D | null, yaw: Quaternion, points: Vector3[]) {
    const box = new Box3().setFromPoints(points)
    this.min = box.min
    this.size = box.getSize(new Vector3())
    this.widths = new Float32Array(this.rows * this.columns)
    const hits: number[][] = Array.from({ length: this.widths.length }, () => [])
    const transform = new Matrix4().makeRotationFromQuaternion(yaw.clone().invert())
      .multiply(frame?.matrixWorld.clone().invert() ?? new Matrix4())
    const a = new Vector3(), b = new Vector3(), c = new Vector3()
    const row = (y: number) => (y - this.min.y) / this.size.y * this.rows - .5
    const column = (z: number) => (z - this.min.z) / this.size.z * this.columns - .5
    model.traverse(object => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const matrix = transform.clone().multiply(mesh.matrixWorld)
      const p = mesh.geometry.getAttribute('position'), index = mesh.geometry.index
      const count = index?.count ?? p.count
      for (let i = 0; i + 2 < count; i += 3) {
        a.fromBufferAttribute(p, index?.getX(i) ?? i).applyMatrix4(matrix)
        b.fromBufferAttribute(p, index?.getX(i + 1) ?? i + 1).applyMatrix4(matrix)
        c.fromBufferAttribute(p, index?.getX(i + 2) ?? i + 2).applyMatrix4(matrix)
        const determinant = (b.z - c.z) * (a.y - c.y) + (c.y - b.y) * (a.z - c.z)
        if (Math.abs(determinant) < 1e-12) continue
        const low_y = Math.max(0, Math.ceil(row(Math.min(a.y, b.y, c.y))))
        const high_y = Math.min(this.rows - 1, Math.floor(row(Math.max(a.y, b.y, c.y))))
        const low_z = Math.max(0, Math.ceil(column(Math.min(a.z, b.z, c.z))))
        const high_z = Math.min(this.columns - 1, Math.floor(column(Math.max(a.z, b.z, c.z))))
        for (let y = low_y; y <= high_y; y++) for (let z = low_z; z <= high_z; z++) {
          const py = this.min.y + (y + .5) / this.rows * this.size.y
          const pz = this.min.z + (z + .5) / this.columns * this.size.z
          const u = ((b.z - c.z) * (py - c.y) + (c.y - b.y) * (pz - c.z)) / determinant
          const v = ((c.z - a.z) * (py - c.y) + (a.y - c.y) * (pz - c.z)) / determinant
          if (u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001) hits[y * this.columns + z].push(u * a.x + v * b.x + (1 - u - v) * c.x)
        }
      }
    })
    const center = box.getCenter(new Vector3()).x
    hits.forEach((values, i) => {
      values.sort((a, b) => a - b)
      const unique = values.filter((value, j) => j === 0 || value - values[j - 1] > this.size.x * 1e-5)
      for (let j = 0; j + 1 < unique.length; j += 2) {
        const lo = unique[j], hi = unique[j + 1]
        if (lo <= center && hi >= center) this.widths[i] = Math.max(this.widths[i], hi - lo)
      }
    })
  }

  public center (z: number): { y: number, radius: number } | null {
    const column = Math.max(0, Math.min(this.columns - 1, Math.floor((z - this.min.z) / this.size.z * this.columns)))
    let best = 0, peak = 0
    const widths: number[] = []
    for (let row = 0; row < this.rows; row++) {
      let width = 0
      for (let dz = -2; dz <= 2; dz++) if (column + dz >= 0 && column + dz < this.columns) width += this.widths[row * this.columns + column + dz] / 5
      widths.push(width)
      if (width > peak) { peak = width; best = row }
    }
    if (peak < this.size.x * .015) return null
    let low = best, high = best
    while (low > 0 && widths[low - 1] > peak * .18) low--
    while (high < this.rows - 1 && widths[high + 1] > peak * .18) high++
    let sum = 0, moment = 0
    for (let row = low; row <= high; row++) {
      const weight = widths[row] ** 2
      sum += weight; moment += (this.min.y + (row + .5) / this.rows * this.size.y) * weight
    }
    return { y: moment / sum, radius: peak / 2 }
  }

  public tail (start: Vector3, count: number, allow_curl = false): Vector3[] | null {
    const start_row = Math.floor((start.y - this.min.y) / this.size.y * this.rows)
    const start_column = Math.floor((start.z - this.min.z) / this.size.z * this.columns)
    // Restrict the search to the rear. A curled tip may return slightly forward
    // of the attachment, but the path cannot enter the chest or front legs.
    const max_column = Math.min(this.columns - 1, start_column + 8)
    const attachment = this.center(start.z)
    const max_width = Math.max(this.size.x * .05, (attachment?.radius ?? this.size.x * .2) * 1.2)
    const valid = (row: number, column: number) => row >= 0 && row < this.rows && column >= 0 && column <= max_column &&
      this.widths[row * this.columns + column] > this.size.x * .008 && (allow_curl || this.widths[row * this.columns + column] < max_width)
    let seed = -1, nearest = Infinity
    for (let row = 0; row < this.rows; row++) for (let col = 0; col <= max_column; col++) if (valid(row, col) && col <= start_column && Math.abs(row - start_row) < this.rows * .18) {
      const distance = (row - start_row) ** 2 + (col - start_column) ** 2
      if (distance < nearest) { seed = row * this.columns + col; nearest = distance }
    }
    if (seed < 0) return null
    const parent = new Int32Array(this.widths.length).fill(-1)
    const distance = new Float32Array(this.widths.length).fill(-1)
    const queue = [seed]; distance[seed] = 0
    let farthest = seed
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head], row = Math.floor(current / this.columns), column = current % this.columns
      for (const [dy, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const y = row + dy, z = column + dz, next = y * this.columns + z
        if (!valid(y, z) || distance[next] >= 0) continue
        distance[next] = distance[current] + 1
        parent[next] = current; queue.push(next)
        if (distance[next] > distance[farthest]) farthest = next
      }
    }
    if (distance[farthest] < 6) return null
    const path: Vector3[] = []
    for (let i = farthest; i >= 0; i = parent[i]) {
      const row = Math.floor(i / this.columns), column = i % this.columns
      path.push(new Vector3(start.x, this.min.y + (row + .5) / this.rows * this.size.y, this.min.z + (column + .5) / this.columns * this.size.z))
    }
    path.reverse()
    // Smooth the grid path; original endpoints stay inside the occupied volume.
    const smooth = path.map((p, i) => {
      const slice = path.slice(Math.max(0, i - 4), Math.min(path.length, i + 5))
      return slice.reduce((sum, q) => sum.add(q), new Vector3()).divideScalar(slice.length)
    })
    return Array.from({ length: count }, (_, i) => smooth[Math.round(i * (smooth.length - 1) / Math.max(1, count - 1))].clone())
  }
}
