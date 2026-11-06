import { Box3, type Object3D, Quaternion, Vector3 } from 'three'
import { CreatureVolume } from './CreatureVolume.ts'

interface Limb { upper: string, names: string[], front: boolean, side: 'l' | 'r' }

/** Native Mesh2Motion and imported FrontUpperLeg.L/BackUpperLeg.L packs use
 * different spellings. Resolve complete chains, never guess from a title. */
export function quadruped_limbs (names: Iterable<string>): Limb[] {
  const all = [...names]
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const result: Limb[] = []
  for (const front of [true, false]) for (const side of ['l', 'r'] as const) {
    const candidates = all.filter(name => {
      const n = normalize(name)
      return (front ? /front|fore/.test(n) : /back|hind|rear/.test(n)) && n.endsWith(side) && !/ik|pole|control/.test(n)
    })
    const find = (role: RegExp) => candidates.find(name => role.test(normalize(name)))
    const uppers = candidates.filter(name => /upper/.test(normalize(name)) && !/tip|leaf/.test(normalize(name)))
    const lowers = candidates.filter(name => /lower/.test(normalize(name)) && !/tip|leaf/.test(normalize(name)))
    if (uppers.length !== 1 || lowers.length !== 1) continue
    const upper = uppers[0], lower = lowers[0]
    const foot = find(/foot/)
    if (!upper || !lower || !foot) continue
    const rank = (name: string) => {
      const n = normalize(name)
      return /leaf/.test(n) ? 7 : /tip/.test(n) ? 6 : /toe/.test(n) ? 5 : /foot1/.test(n) ? 4 : /foot/.test(n) ? 3 : /ankle/.test(n) ? 2 : /lower/.test(n) ? 1 : 0
    }
    const chain = candidates.filter(name => /upper|lower|ankle|foot|toe|tip|leaf/.test(normalize(name)))
      .sort((a, b) => rank(a) - rank(b))
    result.push({ upper, front, side, names: chain })
  }
  return result
}

/** Follow occupied volume separately for each leg, preserving a raised paw.
 * The authored joint names, hierarchy and rotation bases remain unchanged. */
export function fit_quadruped_limbs (model: Object3D, frame: Object3D | null, yaw: Quaternion,
  points: Vector3[], initial: Map<string, Vector3>): Map<string, Vector3> | null {
  const limbs = quadruped_limbs(initial.keys())
  if (limbs.length !== 4) return null
  const box = new Box3().setFromPoints(points), size = box.getSize(new Vector3()), mid = box.getCenter(new Vector3())
  const volume = new CreatureVolume(model, frame, yaw, points, 112)
  if (volume.cells.length < 200) return null
  const frontZ = limbs.filter(l => l.front).reduce((sum, l) => sum + initial.get(l.upper)!.z, 0) / 2
  const backZ = limbs.filter(l => !l.front).reduce((sum, l) => sum + initial.get(l.upper)!.z, 0) / 2
  if (Math.abs(frontZ - backZ) < size.z * .12) return null
  const split = (frontZ + backZ) / 2, facing = Math.sign(frontZ - backZ)
  const result = new Map<string, Vector3>()
  for (const limb of limbs) {
    const upper = initial.get(limb.upper)!
    const sign = Math.sign(upper.x - mid.x)
    if (!sign) return null
    const region = (p: Vector3) => (p.x - mid.x) * sign > volume.step * .25 &&
      (p.z - split) * facing * (limb.front ? 1 : -1) > 0
    let floor = Infinity
    for (const i of volume.cells) {
      const p = volume.point(i)
      if (region(p)) floor = Math.min(floor, p.y)
    }
    if (!Number.isFinite(floor) || upper.y - floor < volume.step * 3) return null
    const footHint = initial.get(limb.names[limb.names.length - 1])!
    const paw = volume.select((p, r) => region(p) && p.y < floor + Math.max(volume.step * 3, size.y * .045)
      ? r - Math.hypot(p.x - footHint.x, p.z - footHint.z) * .08 : -Infinity)
    if (paw < 0) return null
    const pawPoint = volume.point(paw)
    const toe = volume.select((p, r) => region(p) && p.distanceTo(pawPoint) < Math.max(volume.step * 4, size.y * .09) && p.y < floor + Math.max(volume.step * 3, size.y * .04)
      ? p.z * facing - Math.abs(p.y - pawPoint.y) * .3 : -Infinity)
    const seed = volume.select((p, r) => region(p) && p.y > floor + volume.step * 2
      ? -p.distanceTo(upper) + Math.min(r, size.y * .06) * .5 : -Infinity)
    if (seed < 0) return null
    const paths = volume.paths(seed, p => region(p) && p.y <= upper.y + size.y * .15)
    const end = toe >= 0 && Number.isFinite(paths.distance[toe]) ? toe : paw
    if (!Number.isFinite(paths.distance[end])) return null
    const path = volume.path(end, paths.parent)
    if (path.length < 4) return null
    const original = limb.names.map(n => initial.get(n)!)
    const lengths = original.slice(1).map((p, i) => p.distanceTo(original[i]))
    const total = lengths.reduce((a, b) => a + b, 0)
    let distance = 0
    limb.names.forEach((name, i) => {
      if (i) distance += lengths[i - 1]
      result.set(name, CreatureVolume.along(path, total > 1e-8 ? distance / total : i / (limb.names.length - 1)))
    })
  }
  return result
}
