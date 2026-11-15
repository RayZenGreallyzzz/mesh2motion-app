import { BufferAttribute, BufferGeometry, Matrix4, ShapeUtils, Vector2, Vector3, Vector4 } from 'three'
import { cap_boundary, type DirectedEdge, type MeshSelection } from './MeshEditGeometry.ts'

export type MeshProjection = { matrix: Matrix4, width: number, height: number }
type Point = [number, number]
type Triangle = [number, number, number]
type NewVertex = { vertices: Triangle, bary: number[] }
const corner: Point[] = [[0, 0], [1, 0], [0, 1]]
const eps = 1e-8
const key = (p: Point): string => Math.round(p[0] / eps) + ',' + Math.round(p[1] / eps)
const area = (poly: Point[]): number => poly.reduce((sum, a, i) => {
  const b = poly[(i + 1) % poly.length]
  return sum + a[0] * b[1] - a[1] * b[0]
}, 0)
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
const value_at = (plane: Triangle, p: Point): number => plane[0] * (1 - p[0] - p[1]) + plane[1] * p[0] + plane[2] * p[1]
const on_edge = (p: Point, edge: number): boolean => Math.abs([p[1], 1 - p[0] - p[1], p[0]][edge]) < eps

function intersection (planes: Triangle[]): Point[] {
  let polygon = corner
  for (const plane of planes) {
    const next: Point[] = []
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length]
      const x = value_at(plane, a), y = value_at(plane, b)
      if (x >= 0) next.push(a)
      if ((x > 0 && y < 0) || (x < 0 && y > 0)) next.push(lerp(a, b, x / (x - y)))
    }
    if (next.length < 3) return []
    polygon = next
  }
  return polygon.filter((p, i) => key(p) !== key(polygon[(i + 1) % polygon.length]))
}

/** Reconstruct the kept polygon(s) from the remaining triangle edges and
 * the reversed incision. This avoids splitting adjacent faces along the
 * imaginary continuation of the blade beyond its endpoints. */
function subtract (hole: Point[], planes: Triangle[]): Point[][] {
  const edges: Array<[Point, Point]> = []
  for (let edge = 0; edge < 3; edge++) {
    const a = corner[edge], b = corner[(edge + 1) % 3]
    const parameter = (p: Point) => [p[0], p[1], 1 - p[1]][edge]
    const points = [a, ...hole.filter(p => on_edge(p, edge)), b].sort((x, y) => parameter(x) - parameter(y))
    for (let i = 1; i < points.length; i++) {
      const start = points[i - 1], end = points[i]
      if (key(start) === key(end)) continue
      const middle = lerp(start, end, .5)
      if (planes.some(plane => value_at(plane, middle) < -1e-9)) edges.push([start, end])
    }
  }
  for (let i = 0; i < hole.length; i++) {
    const a = hole[i], b = hole[(i + 1) % hole.length]
    if (![0, 1, 2].some(edge => on_edge(a, edge) && on_edge(b, edge))) edges.push([b, a])
  }
  const loops: Point[][] = []
  while (edges.length) {
    const [start, next] = edges.pop()!
    const loop = [start]
    let end = next
    while (key(end) !== key(start)) {
      loop.push(end)
      const link = edges.findIndex(([a]) => key(a) === key(end))
      if (link < 0) throw new Error('Нож проходит точно по ребру. Сдвиньте одну точку на экране.')
      end = edges.splice(link, 1)[0][1]
    }
    if (loop.length >= 3 && Math.abs(area(loop)) > 1e-12) loops.push(loop)
  }
  return loops
}

function position_in_view (matrix: Matrix4, width: number, height: number, position: BufferGeometry['attributes'][string], index: number, out: Vector4): void {
  out.set(position.getX(index), position.getY(index), position.getZ(index), 1).applyMatrix4(matrix)
  out.x = (out.x + out.w) * width / 2
  out.y = (out.w - out.y) * height / 2
}

export function knife_scope (source: BufferGeometry, selection: MeshSelection, projection: MeshProjection): { min_x: number, max_x: number, min_y: number, max_y: number } {
  const attr = source.attributes.position
  const {matrix, width, height} = projection
  const point = new Vector4()
  let min_x = Infinity, min_y = Infinity, max_x = -Infinity, max_y = -Infinity
  for (const id of selection.keys()) {
    position_in_view(matrix, width, height, attr, id, point)
    if (point.w <= eps) continue
    min_x = Math.min(min_x, point.x / point.w); max_x = Math.max(max_x, point.x / point.w)
    min_y = Math.min(min_y, point.y / point.w); max_y = Math.max(max_y, point.y / point.w)
  }
  // The visible selection bounds keep the tool local. The blade passes
  // through depth so it also cuts the back of a fused surface.
  const margin = 1
  min_x -= margin; max_x += margin; min_y -= margin; max_y += margin
  if (!Number.isFinite(min_x + max_x + min_y + max_y)) throw new Error('Сначала выделите область вокруг шва.')
  return { min_x, max_x, min_y, max_y }
}

export function knife_cut (source: BufferGeometry, selection: MeshSelection, projection: MeshProjection, start: Point, end: Point,
  width_px: number, close: boolean): { geometry: BufferGeometry, cut: number, open: boolean } {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  if (length < 5) throw new Error('Точки ножа слишком близко. Укажите два конца шва.')
  const ux = (end[0] - start[0]) / length, uy = (end[1] - start[1]) / length
  const half = width_px * .5, attr = source.attributes.position, point = new Vector4()
  const {matrix, width, height} = projection
  const { min_x, max_x, min_y, max_y } = knife_scope(source, selection, projection)
  const min_line_x = Math.min(start[0], end[0]) - half, max_line_x = Math.max(start[0], end[0]) + half
  const min_line_y = Math.min(start[1], end[1]) - half, max_line_y = Math.max(start[1], end[1]) + half
  const low_x = Math.max(min_x, min_line_x), high_x = Math.min(max_x, max_line_x)
  const low_y = Math.max(min_y, min_line_y), high_y = Math.min(max_y, max_line_y)
  const screen = new Float32Array(attr.count * 3)
  for (let i = 0; i < attr.count; i++) {
    position_in_view(matrix, width, height, attr, i, point)
    screen[i * 3] = point.x; screen[i * 3 + 1] = point.y; screen[i * 3 + 2] = point.w
  }
  const values = (id: number): number[] => {
    const w = screen[id * 3 + 2], x = screen[id * 3], y = screen[id * 3 + 1]
    const dx = x - start[0] * w, dy = y - start[1] * w
    const along = dx * ux + dy * uy, across = -dx * uy + dy * ux
    return [along, length * w - along, half * w + across, half * w - across,
      x - min_x * w, max_x * w - x, y - min_y * w, max_y * w - y]
  }
  const add: NewVertex[] = [], edges = new Map<string, number>(), cap_edges: [DirectedEdge[], DirectedEdge[]] = [[], []]
  const triangles: number[] = []
  const index = source.index, count = index?.count ?? attr.count
  const emit = (points: Point[], holes: Point[][], id: (p: Point) => number): void => {
    const flat = (row: Point[]) => row.map(p => new Vector2(...p))
    const all = points.concat(...holes)
    for (const [i, j, k] of ShapeUtils.triangulateShape(flat(points), holes.map(flat))) {
      const a = all[i], b = all[j], c = all[k]
      const dir = (b[0]-a[0]) * (c[1]-a[1]) - (b[1]-a[1]) * (c[0]-a[0])
      if (Math.abs(dir) > 1e-13) triangles.push(id(a), id(dir > 0 ? b : c), id(dir > 0 ? c : b))
    }
  }
  let cut = 0, uncapped = 0
  for (let i = 0; i + 2 < count; i += 3) {
    const a = index?.getX(i) ?? i, b = index?.getX(i + 1) ?? i + 1, c = index?.getX(i + 2) ?? i + 2
    const va = screen[a*3+2], vb = screen[b*3+2], vc = screen[c*3+2]
    const ax = screen[a*3]/va, bx = screen[b*3]/vb, cx = screen[c*3]/vc
    const ay = screen[a*3+1]/va, by = screen[b*3+1]/vb, cy = screen[c*3+1]/vc
    if (Math.min(va, vb, vc) <= eps ||
        Math.max(ax, bx, cx) < low_x || Math.min(ax, bx, cx) > high_x ||
        Math.max(ay, by, cy) < low_y || Math.min(ay, by, cy) > high_y) { triangles.push(a,b,c); continue }
    const av = values(a), bv = values(b), cv = values(c)
    const planes: Triangle[] = av.map((v, k) => [v, bv[k], cv[k]])
    const hole = intersection(planes)
    if (hole.length < 3 || area(hole) < 1e-12) { triangles.push(a,b,c); continue }
    cut++
    const vertices: Triangle = [a, b, c], inner = new Map<string, number>()
    const id = (p: Point): number => {
      const bary = [1 - p[0] - p[1], p[0], p[1]]
      const corner_index = bary.findIndex(w => w >= 1 - eps)
      if (corner_index >= 0) return vertices[corner_index]
      const zero = bary.findIndex(w => Math.abs(w) < eps)
      if (zero >= 0) {
        const u = (zero + 1) % 3, v = (zero + 2) % 3
        const first = vertices[u] < vertices[v] ? u : v, second = first === u ? v : u
        const t = Math.round(bary[second] / eps), hash = vertices[first] + ',' + vertices[second] + ',' + t
        const known = edges.get(hash)
        if (known !== undefined) return known
        const n = attr.count + add.length
        add.push({ vertices: [vertices[first], vertices[second], vertices[second]], bary: [1 - t * eps, t * eps, 0] })
        edges.set(hash, n)
        return n
      }
      const hash = key(p), known = inner.get(hash)
      if (known !== undefined) return known
      const n = attr.count + add.length
      add.push({vertices, bary}); inner.set(hash, n)
      return n
    }
    const loops = subtract(hole, planes)
    const outside = loops.filter(p => area(p) > 0), inside = loops.filter(p => area(p) < 0)
    for (const loop of outside) emit(loop, inside, id)
    if (!close) continue
    for (let k = 0; k < hole.length; k++) {
      const a = hole[k], b = hole[(k + 1) % hole.length]
      if ([0,1,2].some(edge => on_edge(a, edge) && on_edge(b, edge))) continue
      const on_side = (side: number) => Math.abs(value_at(planes[side], a)) < .001 && Math.abs(value_at(planes[side], b)) < .001
      const side = on_side(2) ? 0 : on_side(3) ? 1 : -1
      if (side === 0 || side === 1) cap_edges[side].push({from: id(a), to: id(b)})
      else uncapped++
    }
  }
  if (!cut) throw new Error('Лезвие не пересекло сетку в выделенной области. Проверьте положение точек.')
  if (!triangles.length) throw new Error('Лезвие захватывает всю выделенную деталь. Уменьшите ширину.')
  const active: number[] = [], lookup = new Int32Array(attr.count + add.length).fill(-1)
  const compact = (id: number): number => {
    if (lookup[id] < 0) { lookup[id] = active.length; active.push(id) }
    return lookup[id]
  }
  triangles.forEach(compact)
  for (const side of cap_edges) for (const edge of side) { compact(edge.from); compact(edge.to) }
  const result = new BufferGeometry()
  const transfer = (input: BufferGeometry['attributes'][string], normal = false): BufferAttribute => {
    const output = new Float32Array(active.length * input.itemSize), direction = new Vector3()
    for (let i = 0; i < active.length; i++) {
      const n = active[i], novel = add[n - attr.count], offset = i * input.itemSize
      for (let c = 0; c < input.itemSize; c++) {
        output[offset + c] = novel
          ? novel.bary.reduce((sum, w, k) => sum + w * input.getComponent(novel.vertices[k], c), 0)
          : input.getComponent(n, c)
      }
      if (normal && novel) direction.fromArray(output, offset).normalize().toArray(output, offset)
    }
    return new BufferAttribute(output, input.itemSize)
  }
  for (const [name, input] of Object.entries(source.attributes)) result.setAttribute(name, transfer(input, name === 'normal'))
  const source_ids = source.attributes.skinIndex, source_weights = source.attributes.skinWeight
  if (source_ids && source_weights) {
    const slots = result.attributes.skinIndex, weights = result.attributes.skinWeight
    for (let i = 0; i < active.length; i++) {
      const novel = add[active[i] - attr.count]
      if (!novel) continue
      const influence = new Map<number, number>()
      novel.vertices.forEach((vertex, k) => {
        for (let slot = 0; slot < 4; slot++) {
          const bone = source_ids.getComponent(vertex, slot)
          influence.set(bone, (influence.get(bone) ?? 0) + novel.bary[k] * source_weights.getComponent(vertex, slot))
        }
      })
      const top = [...influence].sort((a,b) => b[1] - a[1]).slice(0,4)
      const total = top.reduce((sum, v) => sum + v[1], 0)
      for (let j = 0; j < 4; j++) {
        slots.setComponent(i, j, top[j]?.[0] ?? 0)
        weights.setComponent(i, j, total > 0 ? (top[j]?.[1] ?? 0) / total : Number(j === 0))
      }
    }
  }
  for (const name of ['position', 'normal', 'color'] as const) {
    const morphs = source.morphAttributes[name]
    if (morphs) result.morphAttributes[name] = morphs.map(morph => transfer(morph))
  }
  result.morphTargetsRelative = source.morphTargetsRelative
  const compact_faces = triangles.map(id => lookup[id])
  for (const side of cap_edges) {
    const mapped = side.map(e => ({from: lookup[e.from], to: lookup[e.to]}))
    uncapped += mapped.length - cap_boundary(result.attributes.position, mapped, compact_faces)
  }
  result.setIndex(new BufferAttribute(Uint32Array.from(compact_faces), 1))
  return { geometry: result, cut, open: !close || uncapped > 0 }
}
