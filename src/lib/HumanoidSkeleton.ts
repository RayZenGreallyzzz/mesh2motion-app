import { HandSkeletonType, SkeletonType } from './enums/SkeletonType'

/**
 * Returns true for skeleton presets that must use the human-specific pipeline
 * (pelvis weighting, A-pose tools, hand pruning, human retargeting/export).
 */
export function is_humanoid_skeleton_type (type: SkeletonType | null | undefined): boolean {
  return type === SkeletonType.Human || type === SkeletonType.MobileFemale
}

/**
 * Mobile Female intentionally forces the lightest hand setup so the generated
 * rig stays appropriate for mobile/WebGL characters. Regular Human keeps the
 * hand option selected in the UI.
 */
export function effective_hand_skeleton_type (
  type: SkeletonType | null | undefined,
  selected: HandSkeletonType
): HandSkeletonType {
  return type === SkeletonType.MobileFemale ? HandSkeletonType.SingleBone : selected
}
