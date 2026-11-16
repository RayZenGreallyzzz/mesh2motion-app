import { type Bone, Vector3 } from 'three'

export const CORE_RADIUS = .45
export const CORE_TOP = 1.35
export const smooth = (x: number): number => {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}

interface ArmSegment {
  start: Vector3
  end: Vector3
  radius: number
}

export interface HumanoidHeadRegion {
  base: Vector3
  end: Vector3
  axis: Vector3
  length: number
  neckLength: number
  coreStart: number
  largeHead: boolean
  arms: ArmSegment[]
  raisedArms: ArmSegment[]
}

export function distance_to_segment(point: Vector3, start: Vector3, end: Vector3, offset: Vector3, axis: Vector3): number {
  axis.copy(end).sub(start)
  const length = axis.lengthSq()
  const fraction = length > 1e-12 ? Math.max(0, Math.min(1, offset.copy(point).sub(start).dot(axis) / length)) : 0
  return offset.copy(start).addScaledVector(axis, fraction).distanceTo(point)
}

export function humanoid_head_region(bones: Bone[], neck: Bone, head: Bone, tip: Bone): HumanoidHeadRegion | undefined {
  const base = head.getWorldPosition(new Vector3())
  const end = tip.getWorldPosition(new Vector3())
  const neckBase = neck.getWorldPosition(new Vector3())
  const length = base.distanceTo(end), neckLength = base.distanceTo(neckBase)
  if (length < 1e-6 || neckLength < 1e-6) return
  const pelvis = bones.find(bone => bone.name === 'pelvis')
  const torsoLength = pelvis ? neckBase.distanceTo(pelvis.getWorldPosition(new Vector3())) : length
  const axis = end.clone().sub(base).divideScalar(length)
  const coreStart = Math.max(neckLength * .5, length * .2)
  const arms: ArmSegment[] = [], raisedArms: ArmSegment[] = []
  const offset = new Vector3()
  for (const bone of bones) {
    if (!/^(?:upperarm|lowerarm|hand|thumb_\d+|index_\d+|middle_\d+|ring_\d+|pinky_\d+)_[lr]$/.test(bone.name)) continue
    const start = bone.getWorldPosition(new Vector3())
    for (const child of bone.children) {
      if (!(child as Bone).isBone) continue
      const end = child.getWorldPosition(new Vector3())
      const segment = { start, end, radius: torsoLength * .09 + start.distanceTo(end) * .12 }
      arms.push(segment)
      if (Math.max(offset.copy(start).sub(base).dot(axis), offset.copy(end).sub(base).dot(axis)) >= coreStart) {
        raisedArms.push(segment)
      }
    }
  }
  return { base, end, axis, length, neckLength, coreStart, largeHead: Boolean(pelvis && length > torsoLength * .8), arms, raisedArms }
}

/** A limb can cover the head in a raised-arm pose. Its centreline has to reach
 * the head and be distinctly closer to the sample than the skull axis. A
 * lower shoulder with a wide exclusion capsule cannot veto the skull core.
 */
export function head_core_arm_mask(region: HumanoidHeadRegion, point: Vector3, offset: Vector3, axis: Vector3): number {
  if (!region.raisedArms.length) return 1
  const headDistance = distance_to_segment(point, region.base, region.end, offset, axis)
  if (headDistance < 1e-6) return 1
  let mask = 1
  for (const segment of region.raisedArms) {
    const distance = distance_to_segment(point, segment.start, segment.end, offset, axis)
    const outside = smooth((distance / Math.max(segment.radius, 1e-6) - .60) / .40)
    const closerToHead = smooth((distance / headDistance - .55) / .20)
    mask = Math.min(mask, Math.max(outside, closerToHead))
  }
  return mask
}
