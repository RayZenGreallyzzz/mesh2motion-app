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
