import type { Bone } from 'three'

/**
 * Meshy-inspired HUMAN marker ordering. These names are only UI landmarks,
 * not a new armature hierarchy or a skinning algorithm.
 *
 * Strict aliases prevent picking the wrong side or a neighboring joint on an
 * unfamiliar creature. Unknown rigs return null and remain unchanged.
 */
export const MESHY_HUMAN_MARKERS = {
  chin: ['head', 'mixamorigHead'],
  'left-shoulder': ['upperarm_l', 'shoulder_l', 'mixamorigLeftArm', 'mixamorigLeftShoulder'],
  'right-shoulder': ['upperarm_r', 'shoulder_r', 'mixamorigRightArm', 'mixamorigRightShoulder'],
  'left-elbow': ['lowerarm_l', 'forearm_l', 'mixamorigLeftForeArm'],
  'right-elbow': ['lowerarm_r', 'forearm_r', 'mixamorigRightForeArm'],
  'left-wrist': ['hand_l', 'mixamorigLeftHand'],
  'right-wrist': ['hand_r', 'mixamorigRightHand'],
  groin: ['pelvis', 'hips', 'mixamorigHips'],
  'left-knee': ['shin_l', 'lowerleg_l', 'mixamorigLeftLeg'],
  'right-knee': ['shin_r', 'lowerleg_r', 'mixamorigRightLeg'],
  'left-ankle': ['foot_l', 'mixamorigLeftFoot'],
  'right-ankle': ['foot_r', 'mixamorigRightFoot']
} as const

export type MeshyHumanMarker = keyof typeof MESHY_HUMAN_MARKERS

function normalize (name: string): string {
  // Handles Blender, Mixamo namespace separator, and glTF-compatible names.
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function find_meshy_marker_bone (
  bones: readonly Bone[], marker: string
): Bone | null {
  if (!Object.prototype.hasOwnProperty.call(MESHY_HUMAN_MARKERS, marker)) return null
  const aliases = MESHY_HUMAN_MARKERS[marker as MeshyHumanMarker]
  for (const name of aliases) {
    const match = bones.find(b => normalize(b.name) === normalize(name))
    if (match !== undefined) return match
  }
  return null
}
