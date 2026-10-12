import { type Object3D } from 'three'
import { HandSkeletonType } from '../../enums/SkeletonType'

/**
 * Prunes actual digit chains before skinning. The palm and wrist remain
 * untouched. The user choice controls deforming bones, not merely visibility.
 */
export class HandHelper {
  public modify_hand_skeleton (armature: Object3D, mode: HandSkeletonType): void {
    const allowed = this.digits_for_mode(mode)
    const to_remove: Object3D[] = []
    armature.traverse(bone => {
      if (bone.type !== 'Bone') return
      const name = bone.name.toLowerCase()
      const digit = this.digit_of(name)
      if (digit === null) return // includes wrists, palms, toe bones, etc.
      const leaf = /(?:leaf|tip|end)$/i.test(name) ||
        /(?:leaf|tip|end)[_:.\\-]/i.test(name)
      if (!allowed.has(digit) || (leaf && mode !== HandSkeletonType.AllFingers)) {
        to_remove.push(bone)
      }
    })

    // Removing only the highest rejected nodes prevents detached descendants.
    const removed = new Set(to_remove)
    for (const bone of to_remove) {
      let ancestor = bone.parent
      let ancestor_removed = false
      while (ancestor !== null) {
        if (removed.has(ancestor)) { ancestor_removed = true; break }
        ancestor = ancestor.parent
      }
      if (!ancestor_removed) bone.removeFromParent()
    }
    armature.updateWorldMatrix(true, true)
  }

  private digits_for_mode (mode: HandSkeletonType): ReadonlySet<string> {
    switch (mode) {
      case HandSkeletonType.SingleBone: return new Set()
      case HandSkeletonType.OneFinger: return new Set(['middle'])
      case HandSkeletonType.TwoFingers:
      case HandSkeletonType.ThumbAndIndex: return new Set(['thumb', 'index'])
      case HandSkeletonType.ThreeFingers: return new Set(['thumb', 'index', 'middle'])
      case HandSkeletonType.FiveFingers:
      case HandSkeletonType.SimplifiedHand:
      case HandSkeletonType.AllFingers:
      default: return new Set(['thumb', 'index', 'middle', 'ring', 'pinky'])
    }
  }

  private digit_of (name: string): string | null {
    for (const digit of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      if (name.includes(digit)) return digit
    }
    return null
  }
}
