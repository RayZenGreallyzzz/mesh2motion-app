import { type Bone, type Object3D, Matrix4, Vector3 } from 'three'

const percentile = (values: number[], q: number): number => {
  values.sort((a, b) => a - b)
  return values[Math.floor((values.length - 1) * q)]
}

/** Fit the standard template's skull pivot at the narrow neck, not at 91% of
 * total height (inside the face). Hair/raised hands must not define this joint.
 * The setup-frame coordinates and authored local rotation basis are preserved.
 */
export function fit_humanoid_head(points: readonly Vector3[], bones: Bone[], frame: Object3D | null, bodyHeight?: number): boolean {
  const neck = bones.find(b => b.name === 'neck_01'), head = bones.find(b => b.name === 'head')
  const tip = bones.find(b => b.name === 'head_leaf'), pelvis = bones.find(b => b.name === 'pelvis')
  const arms = ['upperarm_l', 'upperarm_r'].map(name => bones.find(b => b.name === name))
  if (!neck || !head || !tip || !pelvis || arms.some(b => !b) || head.parent !== neck || tip.parent !== head) return false
  const inverse = frame?.matrixWorld.clone().invert() ?? new Matrix4()
  const at = (b: Bone) => b.getWorldPosition(new Vector3()).applyMatrix4(inverse)
  let bottom = Infinity, top = -Infinity
  for (const p of points) { bottom = Math.min(bottom, p.y); top = Math.max(top, p.y) }
  const height = bodyHeight ?? top - bottom
  if (!(height > 1e-6)) return false
  const center = at(pelvis).x, shoulder = (at(arms[0]!).y + at(arms[1]!).y) * .5
  const oldHead = at(head), oldTip = at(tip)
  const rows: Array<{ y: number, width: number, z: number }> = []
  const start = Math.max(shoulder + height * .025, bottom + height * .79)
  const end = Math.min(bottom + height * .875, shoulder + height * .12)
  for (let y = start; y <= end; y += height * .005) {
    const slice = points.filter(p => Math.abs(p.y - y) < height * .006 && Math.abs(p.x - center) < height * .065 && Math.abs(p.z - oldHead.z) < height * .09)
    if (slice.length < 10) continue
    const width = percentile(slice.map(p => Math.abs(p.x - center)), .85)
    if (width < height * .012 || width > height * .05) continue
    const z = (percentile(slice.map(p => p.z), .12) + percentile(slice.map(p => p.z), .88)) * .5
    rows.push({ y, width, z })
  }
  if (!rows.length) return false
  const narrow = rows.reduce((a,b) => a.width < b.width ? a : b)
  // A shallow smooth band avoids selecting an isolated sparse slice.
  const band = rows.filter(r => r.width <= narrow.width * 1.18 && Math.abs(r.y - narrow.y) < height * .016)
  const y = band.reduce((sum,r) => sum+r.y, 0) / band.length
  const z = band.reduce((sum,r) => sum+r.z, 0) / band.length
  const place = (b: Bone, p: Vector3) => {
    b.parent?.updateWorldMatrix(true, false)
    if (frame) p.applyMatrix4(frame.matrixWorld)
    b.position.copy(b.parent ? b.parent.worldToLocal(p) : p)
    b.updateWorldMatrix(true, true)
  }
  const headY = y + height * .002
  if (oldTip.y <= headY + height * .04) return false
  place(neck, new Vector3(center, Math.max(shoulder + height * .018, y - height * .028), z))
  place(head, new Vector3(center, headY, z))
  place(tip, new Vector3(center, oldTip.y, z))
  return true
}

/** Sparse meshes need triangle intersections: vertex counts near a neck depend
 * on tessellation. Only closed, unambiguous contours may supply a fallback. */
export function fit_humanoid_head_surface(surface: Float32Array, bones: Bone[], frame: Object3D | null, height: number): boolean {
  const get = (name: string) => bones.find(b => b.name === name)
  const neck = get('neck_01'), head = get('head'), tip = get('head_leaf'), pelvis = get('pelvis'), left = get('upperarm_l'), right = get('upperarm_r')
  if (!neck || !head || !tip || !pelvis || !left || !right || head.parent !== neck || tip.parent !== head || !(height > 1e-6) || !surface.length) return false
  const inverse = frame?.matrixWorld.clone().invert() ?? new Matrix4(), at = (bone: Bone) => bone.getWorldPosition(new Vector3()).applyMatrix4(inverse)
  const shoulder = (at(left).y + at(right).y) * .5, center = at(pelvis).x, oldHead = at(head), oldTip = at(tip)
  const rows: Array<{ y: number, width: number, x: number, z: number }> = [], step = height * .006, tolerance = height * .00002
  for (let y = shoulder + height * .012; y < Math.min(shoulder + height * .22, oldTip.y - height * .025); y += step) {
    const vertices: Array<{ x: number, z: number, edges: Set<number> }> = [], ids = new Map<string, number>()
    const vertex = (x: number, z: number): number => {
      const key = Math.round(x / tolerance) + ':' + Math.round(z / tolerance)
      let id = ids.get(key)
      if (id === undefined) { id = vertices.length; ids.set(key, id); vertices.push({ x, z, edges: new Set() }) }
      return id
    }
    for (let i = 0; i < surface.length; i += 9) {
      const intersections: number[] = []
      for (let a = 0; a < 3; a++) {
        const b = (a + 1) % 3, ay = surface[i + a * 3 + 1], by = surface[i + b * 3 + 1]
        if ((ay <= y) === (by <= y)) continue
        const t = (y - ay) / (by - ay), x = surface[i + a * 3] + t * (surface[i + b * 3] - surface[i + a * 3]), z = surface[i + a * 3 + 2] + t * (surface[i + b * 3 + 2] - surface[i + a * 3 + 2])
        if (Number.isFinite(x) && Number.isFinite(z)) intersections.push(vertex(x, z))
      }
      if (intersections.length === 2 && intersections[0] !== intersections[1]) {
        vertices[intersections[0]].edges.add(intersections[1]); vertices[intersections[1]].edges.add(intersections[0])
      }
    }
    const seen = new Set<number>(), candidates: typeof rows = []
    for (let i = 0; i < vertices.length; i++) {
      if (seen.has(i)) continue
      const component: number[] = [], queue = [i]; seen.add(i)
      while (queue.length) { const id = queue.pop()!; component.push(id); for (const next of vertices[id].edges) if (!seen.has(next)) { seen.add(next); queue.push(next) } }
      if (component.length < 4 || component.some(id => vertices[id].edges.size !== 2)) continue
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
      for (const id of component) { const p = vertices[id]; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z) }
      const width = (x1 - x0) * .5, depth = (z1 - z0) * .5, x = (x1 + x0) * .5, z = (z1 + z0) * .5
      if (width < height * .012 || width > height * .08 || depth < height * .012 || depth > height * .10 || Math.abs(x - center) > height * .04 || Math.abs(z - oldHead.z) > height * .09) continue
      candidates.push({ y, width, x, z })
    }
    if (candidates.length === 1) rows.push(candidates[0])
  }
  // A coherent narrow band with a wider skull above it. Open contours, isolated
  // jewellery and a straight cylinder cannot silently become an anatomical fit.
  const possible = rows.filter(r => r.width <= height * .055 && rows.filter(q => Math.abs(q.y - r.y) < step * 2.5 && q.width <= r.width * 1.2).length >= 4 && rows.some(q => q.y > r.y + height * .035 && q.y < r.y + height * .12 && q.width > r.width * 1.15))
  if (!possible.length) return false
  const narrow = possible.reduce((a, b) => a.width < b.width ? a : b), band = possible.filter(r => r.width <= narrow.width * 1.15 && Math.abs(r.y - narrow.y) < height * .016)
  const mean = (key: 'x' | 'y' | 'z') => band.reduce((n, r) => n + r[key], 0) / band.length
  const x = mean('x'), y = mean('y'), z = mean('z')
  if (oldTip.y < y + height * .04) return false
  const place = (bone: Bone, point: Vector3) => { bone.parent?.updateWorldMatrix(true, false); if (frame) point.applyMatrix4(frame.matrixWorld); bone.position.copy(bone.parent ? bone.parent.worldToLocal(point) : point); bone.updateWorldMatrix(true, true) }
  place(neck, new Vector3(x, Math.max(shoulder + height * .006, y - height * .028), z))
  place(head, new Vector3(x, y + height * .002, z)); place(tip, new Vector3(x, oldTip.y, z))
  return true
}
