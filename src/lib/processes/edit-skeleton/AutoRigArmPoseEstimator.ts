import { type Vector3 } from 'three'

export interface ArmPoseEstimate {
  shoulderY: number
  handY: number
  tPose: boolean
  /** A separate low arm band below a large head/ears, not a human proportion. */
  shortBody?: boolean
}

/**
 * Detect the actual lateral arms rather than assuming shoulders are at 79%
 * of total height. Tall ears, horns or huge hair can shift the bounding box
 * without moving the arms at all.
 *
 * A distinct low bilateral band handles short bodies first. The conventional
 * estimator then samples an upper-body halfspace to reject hip-level clothes.
 *
 * Returns null if both sides lack enough distinct samples, allowing the
 * original heuristic to serve as a conservative fallback.
 */
export function estimate_arm_pose (
  points: readonly Vector3[],
  centerX: number,
  width: number,
  minY: number,
  height: number
): ArmPoseEstimate | null {
  if (width <= 0 || height <= 0) return null
  const low = low_horizontal_arms(points, centerX, width, minY, height)
  if (low) return low
  const upperRegionY = minY + height * 0.55

  const collect = (side: -1 | 1, minReach: number, maxReach: number): number[] => {
    const heights: number[] = []
    for (const p of points) {
      if (p.y < upperRegionY) continue
      const reach = (p.x - centerX) * side / width
      if (reach >= minReach && reach <= maxReach) heights.push(p.y)
    }
    return heights
  }
  const median = (heights: number[]): number => {
    heights.sort((a, b) => a - b)
    const mid = Math.floor(heights.length / 2)
    return heights.length % 2 === 0
      ? (heights[mid - 1] + heights[mid]) * 0.5
      : heights[mid]
  }

  const innerLeft = collect(-1, 0.26, 0.37)
  const innerRight = collect(1, 0.26, 0.37)
  const outerLeft = collect(-1, 0.42, 0.52)
  const outerRight = collect(1, 0.42, 0.52)
  if ([innerLeft, innerRight, outerLeft, outerRight].some(a => a.length < 8)) return null

  const armBase = (median(innerLeft) + median(innerRight)) * 0.5
  const wrist = (median(outerLeft) + median(outerRight)) * 0.5

  // A/T distinction comes from the actual slope of the visible arm, not a
  // hard-coded Y slice that is displaced by large heads and pointy ears.
  const tPose = Math.abs(armBase - wrist) <= height * 0.055
  return {
    shoulderY: armBase,
    handY: wrist,
    tPose
  }
}

/** Require a narrow, bilateral, continuous lateral band. A single wide ear,
 * hip or tail cannot satisfy all ten independent reach bins. Ordinary A/T
 * characters keep the existing estimator; this only handles clearly low arms. */
function low_horizontal_arms (points: readonly Vector3[], center: number, width: number, floor: number, height: number): ArmPoseEstimate | null {
  const valid: number[] = []
  for (let row = 0; row <= 44; row++) {
    const y = floor + height * (.25 + row * .01)
    const bins = new Uint16Array(10)
    for (const p of points) {
      if (Math.abs(p.y - y) > height * .025) continue
      const reach = Math.abs(p.x - center) / width
      const bin = Math.floor((reach - .26) / .04)
      if (bin >= 0 && bin < 5) bins[bin + (p.x < center ? 0 : 5)]++
    }
    if (bins.every(n => n >= 2)) valid.push(y)
  }
  if (!valid.length) return null
  // Keep separate appendages separate; do not median arms together with ears.
  const band: number[] = [valid[0]]
  for (const y of valid.slice(1)) {
    if (y - band[band.length - 1] > height * .015) break
    band.push(y)
  }
  if (band.length < 3 || band[band.length - 1] - band[0] > height * .18) return null
  const samples = points.filter(p => p.y >= band[0] - height * .025 && p.y <= band[band.length - 1] + height * .025)
  const median = (a: number[]) => { a.sort((a, b) => a - b); return a[Math.floor(a.length / 2)] }
  const at = (low: number, high: number, side: number) => samples.filter(p => {
    const x = (p.x - center) * side / width
    return x >= low && x <= high
  }).map(p => p.y)
  const inner = [-1, 1].map(s => at(.26, .37, s)), outer = [-1, 1].map(s => at(.42, .50, s))
  if ([...inner, ...outer].some(a => a.length < 8)) return null
  const shoulderY = (median(inner[0]) + median(inner[1])) / 2
  const handY = (median(outer[0]) + median(outer[1])) / 2
  if (shoulderY > floor + height * .64 || Math.abs(handY - shoulderY) > height * .055) return null
  return { shoulderY, handY, tPose: true, shortBody: true }
}
