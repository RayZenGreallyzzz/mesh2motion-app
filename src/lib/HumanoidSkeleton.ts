import { HandSkeletonType, SkeletonType } from './enums/SkeletonType'

/**
 * Returns true for skeleton presets that must use the human-specific pipeline
 * (pelvis weighting, A-pose tools, hand pruning, human retargeting/export).
 */
export function is_humanoid_skeleton_type (type: SkeletonType | null | undefined): boolean {
  return type === SkeletonType.Human || type === SkeletonType.MobileFemale
}

/**
 * The mobile humanoid uses the simplified articulated hand. This keeps the rig
 * light enough for WebGL/Android while preserving fingers instead of collapsing
 * the whole hand into one rigid bone.
 */
export function effective_hand_skeleton_type (
  type: SkeletonType | null | undefined,
  selected: HandSkeletonType
): HandSkeletonType {
  return type === SkeletonType.MobileFemale ? HandSkeletonType.SimplifiedHand : selected
}
