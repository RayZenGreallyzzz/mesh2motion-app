import { Vector3 } from 'three'
import { estimate_arm_pose } from './AutoRigArmPoseEstimator.ts'

/** Recover the lateral axis of an upright humanoid in T/A pose. Models whose
 * arms or legs do not give clear evidence retain the existing setup frame. */
export function humanoid_fit_yaw(points: readonly Vector3[], floor: number, height: number): number {
  if (!(height > 1e-6)) return 0
  const stride = Math.max(1, Math.ceil(points.length / 10000))
  const sample: Vector3[] = [], upper: Vector3[] = []
  for (let i = 0; i < points.length; i += stride) {
    const p = points[i]
    sample.push(p)
    const y = (p.y - floor) / height
    if (y >= .51 && y <= .93) upper.push(p)
  }
  if (upper.length < 64) return 0
  const center = upper.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(upper.length)
  let xx = 0, xz = 0, zz = 0
  for (const p of upper) {
    const x = p.x - center.x, z = p.z - center.z
    xx += x * x; xz += x * z; zz += z * z
  }
  const spread = Math.hypot(xx - zz, 2 * xz)
  if (xx + zz < 1e-10 || spread < (xx + zz) * .30) return 0
  const angle = Math.atan2(2 * xz, xx - zz) * .5
  // Leave a conventional X-aligned pose in its original frame.
  if (Math.abs(angle) < .12) return 0
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const rotated = sample.map(p => new Vector3(p.x * cos + p.z * sin, p.y, -p.x * sin + p.z * cos))
  let min = Infinity, max = -Infinity
  for (const p of rotated) { min = Math.min(min, p.x); max = Math.max(max, p.x) }
  const mid = (min + max) * .5
  if (!estimate_arm_pose(rotated, mid, max - min, floor, height)) return 0

  // Decide which of the two lateral directions leaves the toes in front.
  const quantile = (sorted: number[], fraction: number) => sorted[Math.floor((sorted.length - 1) * fraction)]
  const feet = [-1, 1].map(side => {
    const sole: number[] = [], ankle: number[] = []
    for (const p of rotated) {
      if ((p.x - mid) * side <= 0) continue
      const y = (p.y - floor) / height
      if (y < .045) sole.push(p.z)
      else if (y > .085 && y < .14) ankle.push(p.z)
    }
    if (sole.length < 8 || ankle.length < 8) return 0
    sole.sort((a, b) => a - b); ankle.sort((a, b) => a - b)
    return quantile(sole, .92) + quantile(sole, .08) - 2 * quantile(ankle, .5)
  })
  return feet.every(offset => offset < -height * .015) ? Math.PI - angle : -angle
}
