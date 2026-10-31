import { type Bone, type Object3D, Matrix4, Vector3 } from 'three'

const percentile = (values: number[], q: number): number => {
  values.sort((a, b) => a - b)
  return values[Math.floor((values.length - 1) * q)]
}

/** Fit the standard template's skull pivot at the narrow neck, not at 91% of
 * total height (inside the face). Hair/raised hands must not define this joint.
 * The setup-frame coordinates and authored local rotation basis are preserved.
 */
export function fit_humanoid_head(points: readonly Vector3[], bones: Bone[], frame: Object3D | null): boolean {
  const neck = bones.find(b => b.name === 'neck_01'), head = bones.find(b => b.name === 'head')
  const tip = bones.find(b => b.name === 'head_leaf'), pelvis = bones.find(b => b.name === 'pelvis')
  const arms = ['upperarm_l', 'upperarm_r'].map(name => bones.find(b => b.name === name))
  if (!neck || !head || !tip || !pelvis || arms.some(b => !b) || head.parent !== neck || tip.parent !== head) return false
  const inverse = frame?.matrixWorld.clone().invert() ?? new Matrix4()
  const at = (b: Bone) => b.getWorldPosition(new Vector3()).applyMatrix4(inverse)
  let bottom = Infinity, top = -Infinity
  for (const p of points) { bottom = Math.min(bottom, p.y); top = Math.max(top, p.y) }
  const height = top - bottom
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
