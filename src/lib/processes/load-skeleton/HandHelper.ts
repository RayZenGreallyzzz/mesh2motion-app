import { type Bone, type Object3D } from 'three'
import { HandSkeletonType } from '../../enums/SkeletonType'

/**
 * Prunes real finger bone chains before skinning. An unselected digit must
 * never receive vertex weights; hiding its helper would not accomplish this.
 * Wrist and palm bones are always preserved.
 */
export class HandHelper {
  public modify_hand_skeleton (armature: Object3D, hand_type: HandSkeletonType): void {
    const allowed = this.allowed_fingers(hand_type)
    const remove: Bone[] = []
    armature.traverse((object) => {
      if (object.type !== 'Bone') return
      const bone = object as Bone
      const name = bone.name.toLowerCase()
      const digit = this.digit_for_name(name)
      if (digit === null) return

      // Terminal/leaf orientation controls don't deform a mesh.
      if (!allowed.has(digit) || this.is_tip(name)) remove.push(bone)
      // Legacy single-bone mode keeps only the palm.
    })
    // Remove deepest nodes first; parent chains can contain pruned tip nodes.
    remove.sort((a, b) => this.depth(b) - this.depth(a))
    for (const bone of remove) bone.removeFromParent()
    armature.updateWorldMatrix(true, true)
  }

  private allowed_fingers (mode: HandSkeletonType): Set<string> {
    switch (mode) {
      case HandSkeletonType.SingleBone: return new Set()
      case HandSkeletonType.OneFinger: return new Set(['middle'])
      case HandSkeletonType.TwoFingers:
      case HandSkeletonType.ThumbAndIndex: return new Set(['thumb', 'index'])
      case HandSkeletonType.ThreeFingers: return new Set(['thumb', 'index', 'middle'])
      case HandSkeletonType.FiveFingers:
      case HandSkeletonType.AllFingers:
      case HandSkeletonType.SimplifiedHand:
      default: return new Set(['thumb', 'index', 'middle', 'ring', 'pinky'])
    }
  }

  private digit_for_name (name: string): string | null {
    for (const digit of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      // Only actual finger chains. Never identify a wrist/hand/palm control
      // or arbitrary bone with a coincidental substring as a finger.
      if (new RegExp('(?:^|[_:.\\-])' + digit + '(?:[_:.\\-]|$)').test(name)) return digit
    }
    return null
  }

  private is_tip (name: string): boolean {
    return /(?:^|[_:.\\-])(?:leaf|tip|end)(?:[_:.\\-]|$)/.test(name)
  }

  private depth (bone: Bone): number {
    let depth = 0
    let current = bone.parent
    while (current !== null) { depth++; current = current.parent }
    return depth
  }
}
