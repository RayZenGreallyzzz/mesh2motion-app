import { BufferAttribute, BufferGeometry, Color, Matrix4, ShapeUtils, Vector2, Vector3 } from 'three'

export type MeshSelection = Map<number, number>
export type Face = { a: number, b: number, c: number }

const xyz_key = (p: { getX(i: number): number, getY(i: number): number, getZ(i: number): number }, i: number): string =>
  p.getX(i) + ',' + p.getY(i) + ',' + p.getZ(i)

function each_face (geometry: BufferGeometry, visit: (a: number, b: number, c: number) => void): void {
  const index = geometry.index
  const count = index?.count ?? geometry.attributes.position.count
  for (let i = 0; i + 2 < count; i += 3) visit(index?.getX(i) ?? i, index?.getX(i + 1) ?? i + 1, index?.getX(i + 2) ?? i + 2)
}

// Pick a connected patch inside the brush volume. Exact position aliases join
// UV seams without selecting a second sheet merely because it is close.
export function brush_selection (geometry: BufferGeometry, matrix: Matrix4, hit: Vector3, face: Face, radius: number): MeshSelection {
  const position = geometry.attributes.position
  const point = new Vector3(), parent = new Int32Array(position.count).fill(-1)
  const candidates = new Map<number, number>(), aliases = new Map<string, number>()
  for (let i = 0; i < position.count; i++) {
    const d2 = point.fromBufferAttribute(position, i).applyMatrix4(matrix).distanceToSquared(hit)
    if (d2 >= radius * radius) continue
    const t = 1 - Math.sqrt(d2) / radius
    candidates.set(i, t * t * (3 - 2 * t))
    const key = xyz_key(position, i), same = aliases.get(key)
    parent[i] = same ?? i
    if (same === undefined) aliases.set(key, i)
  }
  if (!candidates.size) return candidates
  const root = (i: number): number => {
    while (i !== parent[i]) { parent[i] = parent[parent[i]]; i = parent[i] }
    return i
  }
  const link = (a: number, b: number): void => {
    if (parent[a] >= 0 && parent[b] >= 0) parent[root(a)] = root(b)
  }
  each_face(geometry, (a, b, c) => { link(a, b); link(b, c); link(c, a) })
  const roots = new Set([face.a, face.b, face.c].filter(i => parent[i] >= 0).map(root))
  for (const i of candidates.keys()) if (!roots.has(root(i))) candidates.delete(i)
  return candidates
}

export function copy_geometry (source: BufferGeometry): BufferGeometry {
  const geometry = new BufferGeometry()
  for (const [key, attr] of Object.entries(source.attributes)) geometry.setAttribute(key, attr)
  geometry.setIndex(source.index)
  geometry.morphAttributes = { ...source.morphAttributes }
  geometry.morphTargetsRelative = source.morphTargetsRelative
  geometry.groups = source.groups.map(group => ({ ...group }))
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count)
  return geometry
}

function packed (attribute: BufferGeometry['attributes'][string], vertices?: number[]): BufferAttribute {
  const count = vertices?.length ?? attribute.count
  const array = new Float32Array(count * attribute.itemSize)
  for (let i = 0; i < count; i++) for (let c = 0; c < attribute.itemSize; c++) {
    array[i * attribute.itemSize + c] = attribute.getComponent(vertices?.[i] ?? i, c)
  }
  return new BufferAttribute(array, attribute.itemSize)
}

export function deform_selection (source: BufferGeometry, selection: MeshSelection, deform: (point: Vector3, weight: number) => Vector3): BufferGeometry {
  const result = copy_geometry(source), position = packed(source.attributes.position)
  const point = new Vector3(), affected = new Set(selection.keys())
  for (const [i, weight] of selection) {
    const p = deform(point.fromBufferAttribute(position, i), weight)
    position.setXYZ(i, p.x, p.y, p.z)
  }
  result.setAttribute('position', position)
  if (source.attributes.normal) {
    each_face(source, (a, b, c) => {
      if (selection.has(a) || selection.has(b) || selection.has(c)) { affected.add(a); affected.add(b); affected.add(c) }
    })
    const original = packed(source.attributes.normal)
    result.deleteAttribute('normal'); result.computeVertexNormals()
    for (const i of affected) {
      point.fromBufferAttribute(result.attributes.normal, i)
      if (point.lengthSq() > 0) original.setXYZ(i, point.x, point.y, point.z)
    }
    result.setAttribute('normal', original)
  }
  return result
}

export function tint_selection (source: BufferGeometry, selection: MeshSelection, color: Color, strength: number): BufferGeometry {
  const result = copy_geometry(source), prior = source.attributes.color
  const colors = prior ? packed(prior) : new BufferAttribute(new Float32Array(source.attributes.position.count * 3).fill(1), 3)
  for (const [i, w] of selection) {
    const t = w * strength
    colors.setXYZ(i, colors.getX(i) * (1 - t) + color.r * t, colors.getY(i) * (1 - t) + color.g * t, colors.getZ(i) * (1 - t) + color.b * t)
  }
  result.setAttribute('color', colors)
  return result
}

export type DirectedEdge = { from: number, to: number }
type BoundaryEdge = DirectedEdge & { kept: number, removed: number }

export function cap_boundary (position: BufferGeometry['attributes'][string], edges: DirectedEdge[], triangles: number[]): number {
  const directed = new Map<string, DirectedEdge[]>()
  for (const e of edges) {
    const key = xyz_key(position, e.from)
    const group = directed.get(key) ?? []
    group.push(e); directed.set(key, group)
  }
  const seen = new Set<DirectedEdge>()
  let filled = 0
  for (const start of edges) {
    if (seen.has(start)) continue
    const ring: number[] = []
    let next: DirectedEdge | undefined = start
    while (next && !seen.has(next)) {
      seen.add(next); ring.push(next.from)
      const choices: DirectedEdge[] | undefined = directed.get(xyz_key(position, next.to))
      next = choices?.length === 1 ? choices[0] : undefined
    }
    if (next !== start || ring.length < 3 || ring.length > 2048) continue
    const points = ring.map(i => new Vector3().fromBufferAttribute(position, i))
    const normal = new Vector3(), origin = points[0], cross = new Vector3(), delta = new Vector3()
    for (let i = 1; i < points.length - 1; i++) normal.add(cross.copy(points[i]).sub(origin).cross(delta.copy(points[i + 1]).sub(origin)))
    if (normal.lengthSq() <= 1e-20) continue
    normal.normalize()
    const x = points[1].clone().sub(origin).normalize(), y = normal.clone().cross(x).normalize()
    const flat = points.map(p => new Vector2(delta.copy(p).sub(origin).dot(x), delta.dot(y)))
    const faces = ShapeUtils.triangulateShape(flat, [])
    if (faces.length !== ring.length - 2) continue
    for (const face of faces) {
      const [a, b, c] = face
      const same = cross.copy(points[b]).sub(points[a]).cross(delta.copy(points[c]).sub(points[a])).dot(normal) > 0
      triangles.push(ring[a], ring[same ? b : c], ring[same ? c : b])
    }
    filled += ring.length
  }
  return filled
}

export function cut_selection (source: BufferGeometry, selection: MeshSelection, close: boolean): { geometry: BufferGeometry, removed: number, open: boolean } {
  const position = source.attributes.position, triangles: number[] = []
  const edge_stats = new Map<string, BoundaryEdge>()
  let removed = 0
  each_face(source, (a, b, c) => {
    const a_in = selection.has(a), b_in = selection.has(b), c_in = selection.has(c)
    const cut = a_in && b_in && c_in
    if (cut) removed++
    else triangles.push(a, b, c)
    if (!close || Number(a_in) + Number(b_in) + Number(c_in) < 2) return
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      if (!selection.has(i) || !selection.has(j)) continue
      const x = xyz_key(position, i), y = xyz_key(position, j)
      if (x === y) continue
      const key = x < y ? x + ':' + y : y + ':' + x
      const e = edge_stats.get(key) ?? { from: i, to: j, kept: 0, removed: 0 }
      if (cut) e.removed++
      else { e.kept++; e.from = j; e.to = i }
      edge_stats.set(key, e)
    }
  })
  if (!removed) throw new Error('Выделите целый участок сетки для удаления.')
  if (!triangles.length) throw new Error('Выделение охватывает всю деталь. Уменьшите область среза.')
  const boundary = [...edge_stats.values()].filter(e => e.kept === 1 && e.removed === 1)
  const filled = close ? cap_boundary(position, boundary, triangles) : 0
  const active: number[] = [], reindex = new Int32Array(position.count).fill(-1)
  const index = new Uint32Array(triangles.length)
  for (let i = 0; i < triangles.length; i++) {
    const vertex = triangles[i]
    if (reindex[vertex] < 0) { reindex[vertex] = active.length; active.push(vertex) }
    index[i] = reindex[vertex]
  }
  const geometry = new BufferGeometry()
  for (const [key, value] of Object.entries(source.attributes)) geometry.setAttribute(key, packed(value, active))
  for (const key of ['position', 'normal', 'color'] as const) {
    const values = source.morphAttributes[key]
    if (values) geometry.morphAttributes[key] = values.map(value => packed(value, active))
  }
  geometry.morphTargetsRelative = source.morphTargetsRelative
  geometry.setIndex(new BufferAttribute(index, 1))
  return { geometry, removed, open: !close || filled < boundary.length || [...edge_stats.values()].some(e => e.removed > 0 && e.kept > 0 && e.kept + e.removed > 2) }
}
