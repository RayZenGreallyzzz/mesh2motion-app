import { type Vector3 } from 'three'

export interface ArmPoseEstimate {
  shoulderY: number
  handY: number
  tPose: boolean
}

/**
 * Detect the actual lateral arms rather than assuming shoulders are at 79%
 * of total height. Tall ears, horns or huge hair can shift the bounding box
 * without moving the arms at all.
 *
 * Only samples an upper-body halfspace, so broad hip-level capes, tails and
 * skirts cannot be misidentified as forearms.
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


/**
 * Find the wrist at the narrow forearm->palm transition, not at the fingers.
 *
 * Distances use the character's half-width (from centre to the farthest side).
 * Unlike the previous 91% reach constant, the 70-84% cross-sections can locate
 * the wrist BEFORE an outstretched palm/fingers. Limit samples to the arm's
 * expected Y line so a wide skirt or hip fur cannot be mistaken for a wrist.
 *
 * When the geometry does not have a reliable constriction, return a
 * conservative 78% instead of placing the hand joint at the fingertips.
 */
export function estimate_wrist_reach (
  points: readonly Vector3[],
  centerX: number,
  width: number,
  minY: number,
  height: number,
  sideSign: number,
  shoulderY: number,
  handY: number
): number {
  const fallback = 0.78
  if (width <= 0 || height <= 0 || !Number.isFinite(shoulderY) ||
      !Number.isFinite(handY)) return fallback

  const halfWidth = width * 0.5
  const candidates: Array<{ reach: number, thickness: number }> = []
  const levels = [0.70, 0.74, 0.78, 0.82, 0.85]
  const allowanceY = height * 0.085

  for (const reach of levels) {
    const depths: number[] = []
    for (const point of points) {
      const projected = (point.x - centerX) * sideSign / halfWidth
      if (Math.abs(projected - reach) > 0.02) continue
      const pathT = Math.max(0, Math.min(1, (reach - 0.25) / 0.75))
      const expectedY = shoulderY + (handY - shoulderY) * pathT
      if (Math.abs(point.y - expectedY) > allowanceY) continue
      if (point.y <= minY + height * 0.54) continue
      depths.push(point.z)
    }
    if (depths.length < 10) continue
    depths.sort((a, b) => a - b)
    const lo = depths[Math.floor((depths.length - 1) * 0.15)]
    const hi = depths[Math.floor((depths.length - 1) * 0.85)]
    candidates.push({ reach, thickness: hi - lo })
  }

  // Uniform-thickness arms don't contain a trustworthy wrist landmark.
  if (candidates.length < 3) return fallback
  const thickest = Math.max(...candidates.map(c => c.thickness))
  const thinnest = Math.min(...candidates.map(c => c.thickness))
  if (thickest <= 1e-7 || thickest - thinnest < thickest * 0.12) {
    return fallback
  }
  // Penalize extreme positions slightly: a fingertip or the middle of the
  // forearm can be narrow too. Prefer the distal forearm near 76-80% reach.
  candidates.sort((a, b) =>
    (a.thickness / thickest + Math.abs(a.reach - 0.77) * 0.8) -
    (b.thickness / thickest + Math.abs(b.reach - 0.77) * 0.8)
  )
  return Math.min(0.85, Math.max(0.70, candidates[0].reach))
}
