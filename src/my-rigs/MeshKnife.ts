import { BufferAttribute, BufferGeometry, Matrix4, ShapeUtils, Vector2, Vector3 } from 'three'
import { cap_boundary, type DirectedEdge } from './MeshEditGeometry.ts'
import { repair_knife_leg_weights, type KnifeLegSkin } from './MeshKnifeSkin.ts'

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

function vertices_in_blade (source: BufferGeometry, to_blade: Matrix4): Float64Array {
  const attr = source.attributes.position, point = new Vector3()
  const local = new Float64Array(attr.count * 3)
  for (let i = 0; i < attr.count; i++) point.fromBufferAttribute(attr, i).applyMatrix4(to_blade).toArray(local, i * 3)
  return local
}

/** Measure the full depth of surfaces inside the existing thin footprint.
 * The footprint and thickness are preserved. Ignore far-off geometry. */
export function foot_knife_depth (source: BufferGeometry, to_blade: Matrix4): { offset: number, scale: number } | undefined {
  const local = vertices_in_blade(source, to_blade), index = source.index
  const count = index?.count ?? source.attributes.position.count
  let min = -.5, max = .5
  for (let i = 0; i + 2 < count; i += 3) {
    const a = (index?.getX(i) ?? i) * 3, b = (index?.getX(i + 1) ?? i + 1) * 3, c = (index?.getX(i + 2) ?? i + 2) * 3
    const ax = local[a], bx = local[b], cx = local[c], ay = local[a+1], by = local[b+1], cy = local[c+1]
    if (Math.min(ax,bx,cx) > .5 || Math.max(ax,bx,cx) < -.5 ||
      Math.min(ay,by,cy) > .5 || Math.max(ay,by,cy) < -.5) continue
    const az = local[a+2], bz = local[b+2], cz = local[c+2]
    if (Math.min(az,bz,cz) >= -.5 && Math.max(az,bz,cz) <= .5) continue
    const polygon = intersection([[.5+ax,.5+bx,.5+cx],[.5-ax,.5-bx,.5-cx],[.5+ay,.5+by,.5+cy],[.5-ay,.5-by,.5-cy]])
    for (const point of polygon) {
      const z = value_at([az,bz,cz],point)
      if (z < -1.3 || z > .8) return
      min = Math.min(min,z); max = Math.max(max,z)
    }
  }
  if (max - min <= 1 + eps) return
  min -= .02; max += .02
  return { offset: (min + max) * .5, scale: max - min }
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

/** Subtract the finite glass plate. The matrix maps mesh vertices into
 * the plate's unit box. Its three extents and orientation come from the gizmo. */
export function knife_cut (
  source: BufferGeometry, to_blade: Matrix4, close: boolean, leg?: { skin: KnifeLegSkin, dimensions: Vector3 }
):
  { geometry: BufferGeometry, cut: number, open: boolean, seam?: number } {
  const attr = source.attributes.position, local = vertices_in_blade(source, to_blade)
  const values = (id: number): number[] => {
    const x = local[id * 3], y = local[id * 3 + 1], z = local[id * 3 + 2]
    return [.5 + x, .5 - x, .5 + y, .5 - y, .5 + z, .5 - z]
  }
  const add: NewVertex[] = [], edges = new Map<string, number>()
  const cap_edges: DirectedEdge[][] = Array.from({length: 6}, () => [])
  const material_faces = new Map<number, number[]>()
  const groups = source.groups
  let group_index = 0
  let triangles: number[] = []
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
    while (groups[group_index] && i >= groups[group_index].start + groups[group_index].count) group_index++
    const material = groups[group_index]?.materialIndex ?? 0
    triangles = material_faces.get(material) ?? []
    material_faces.set(material, triangles)
    let outside_bounds = false
    for (let axis = 0; axis < 3; axis++) {
      const ax = local[a * 3 + axis], bx = local[b * 3 + axis], cx = local[c * 3 + axis]
      if (Math.max(ax, bx, cx) < -.5 || Math.min(ax, bx, cx) > .5) { outside_bounds = true; break }
    }
    if (outside_bounds) { triangles.push(a,b,c); continue }
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
        add.push({ vertices: [vertices[first], vertices[second], vertices[second]], bary: [1 - bary[second], bary[second], 0] })
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
      const side = planes.findIndex(plane => Math.abs(value_at(plane, a)) < 1e-7 && Math.abs(value_at(plane, b)) < 1e-7)
      if (side >= 0) cap_edges[side].push({from: id(a), to: id(b)})
      else uncapped++
    }
  }
  if (!cut) throw new Error('Пластина не пересекает поверхность. Проверьте её глубину сбоку.')
  if (![...material_faces.values()].some(faces => faces.length)) throw new Error('Пластина захватывает всю деталь. Уменьшите её размер.')
  const active: number[] = [], lookup = new Int32Array(attr.count + add.length).fill(-1)
  const compact = (id: number): number => {
    if (lookup[id] < 0) { lookup[id] = active.length; active.push(id) }
    return lookup[id]
  }
  for (const faces of material_faces.values()) faces.forEach(compact)
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
  const blade_component = (id: number, axis: number): number => {
    const novel = add[id - attr.count]
    if (!novel) return local[id * 3 + axis]
    return novel.bary.reduce((sum, weight, i) => sum + weight * local[novel.vertices[i] * 3 + axis], 0)
  }
  if (source_ids && source_weights) {
    const slots = result.attributes.skinIndex, weights = result.attributes.skinWeight
    for (let i = 0; i < active.length; i++) {
      const novel = add[active[i] - attr.count]
      if (!novel) continue
      const influence = new Map<number, number>()
      const x = blade_component(active[i], 0)
      const side = Math.sign(x)
      const across_slot = Math.abs(Math.abs(x) - .5) < 1e-6 &&
        novel.vertices.some(vertex => side * local[vertex * 3] < -.5) &&
        novel.vertices.some((vertex, k) => side * local[vertex * 3] >= .5 - 1e-6 && novel.bary[k] > eps)
      novel.vertices.forEach((vertex, k) => {
        // When a face spans the slot, a new rim must follow the surviving
        // surface on its side of the plate.
        if (across_slot && side * local[vertex * 3] < .5 - 1e-6) return
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
  const compact_faces: number[] = [], caps: number[] = []
  for (const [material, faces] of [...material_faces].sort(([a], [b]) => a - b)) {
    if (!faces.length) continue
    result.addGroup(compact_faces.length, faces.length, material)
    for (const id of faces) compact_faces.push(lookup[id])
  }
  for (const [plane, side] of cap_edges.entries()) {
    const mapped = side.map(e => ({from: lookup[e.from], to: lookup[e.to]}))
    const axis = Math.floor(plane / 2)
    const vertex_key = (vertex: number): string =>
      Math.round(blade_component(active[vertex], (axis + 1) % 3) * 1e6) + ',' +
      Math.round(blade_component(active[vertex], (axis + 2) % 3) * 1e6)
    uncapped += mapped.length - cap_boundary(result.attributes.position, mapped, caps, vertex_key)
  }
  const seam = caps.length ? Math.max(0, ...material_faces.keys()) + 1 : undefined
  if (seam !== undefined) {
    result.addGroup(compact_faces.length, caps.length, seam)
    for (const id of caps) compact_faces.push(id)
  } else if (!groups.length) result.clearGroups()
  if (leg && seam !== undefined && !uncapped) {
    const rim = (plane: number) => cap_edges[plane].flatMap(edge => [lookup[edge.from],lookup[edge.to]])
    repair_knife_leg_weights(result, [rim(0),rim(1)],
      (id, axis) => blade_component(active[id], axis), leg.dimensions, leg.skin)
  }
  result.setIndex(new BufferAttribute(Uint32Array.from(compact_faces), 1))
  return { geometry: result, cut, open: !close || uncapped > 0, seam }
}
