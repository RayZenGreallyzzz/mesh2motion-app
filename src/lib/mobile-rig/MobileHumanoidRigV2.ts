import { Bone, Object3D, type Object3DEventMap } from 'three'

/**
 * Runtime builder for the lightweight game humanoid.
 *
 * The source rig remains the proven Mesh2Motion human GLB so existing animation
 * clips keep their authored local rest frames. We then prune non-essential
 * finger/tip bones, insert four identity twist bones, and put a non-bone spacer
 * between root and pelvis so SkeletonHelper does not draw the huge root->pelvis
 * line. The spacer is identity, so root motion still propagates to the body.
 */
export class MobileHumanoidRigV2 {
  private static readonly removableExactNames = new Set([
    'head_leaf',
    'ball_leaf_l',
    'ball_leaf_r'
  ])

  private static readonly fingerPrefixes = [
    'thumb_',
    'index_',
    'middle_',
    'ring_',
    'pinky_'
  ]

  public static apply (armature: Object3D<Object3DEventMap>): void {
    armature.updateWorldMatrix(true, true)

    this.removeFingerAndTipBones(armature)

    const upperarmL = this.findBone(armature, 'upperarm_l')
    const lowerarmL = this.findBone(armature, 'lowerarm_l')
    const handL = this.findBone(armature, 'hand_l')
    const upperarmR = this.findBone(armature, 'upperarm_r')
    const lowerarmR = this.findBone(armature, 'lowerarm_r')
    const handR = this.findBone(armature, 'hand_r')

    this.insertIdentityTwist(upperarmL, lowerarmL, 'upperarm_twist_l')
    this.insertIdentityTwist(lowerarmL, handL, 'lowerarm_twist_l')
    this.insertIdentityTwist(upperarmR, lowerarmR, 'upperarm_twist_r')
    this.insertIdentityTwist(lowerarmR, handR, 'lowerarm_twist_r')

    this.hideRootPelvisHelperLink(armature)

    armature.userData.mobileHumanoidRigV2 = true
    armature.updateWorldMatrix(true, true)

    let boneCount = 0
    armature.traverse((obj) => {
      if (obj instanceof Bone) boneCount++
    })

    if (boneCount !== 27) {
      console.warn(`Humanoid Rig v2 expected 27 bones, got ${boneCount}. The rig will still be used.`)
    } else {
      console.log('Humanoid Rig v2 ready: 27 bones')
    }
  }

  private static removeFingerAndTipBones (armature: Object3D): void {
    const toRemove: Bone[] = []

    armature.traverse((obj) => {
      if (!(obj instanceof Bone)) return
      const name = obj.name.toLowerCase()
      if (this.removableExactNames.has(name) || this.fingerPrefixes.some(prefix => name.startsWith(prefix))) {
        toRemove.push(obj)
      }
    })

    // Remove only top-most matching branches. Removing every descendant after its
    // parent is detached is harmless, but avoiding it keeps the operation clear.
    const removeSet = new Set(toRemove)
    for (const bone of toRemove) {
      let parent = bone.parent
      let hasRemovedAncestor = false
      while (parent !== null) {
        if (parent instanceof Bone && removeSet.has(parent)) {
          hasRemovedAncestor = true
          break
        }
        parent = parent.parent
      }
      if (!hasRemovedAncestor) bone.removeFromParent()
    }
  }

  private static insertIdentityTwist (parent: Bone | undefined, child: Bone | undefined, name: string): void {
    if (parent === undefined || child === undefined) return
    if (parent.getObjectByName(name) !== undefined) return
    if (child.parent !== parent) {
      console.warn(`Cannot insert ${name}: ${child.name} is not a direct child of ${parent.name}`)
      return
    }

    // Splitting the existing local translation in half while keeping the twist
    // quaternion identity preserves the child's exact world-space rest transform.
    const originalPosition = child.position.clone()
    parent.remove(child)

    const twist = new Bone()
    twist.name = name
    twist.position.copy(originalPosition).multiplyScalar(0.5)
    twist.quaternion.identity()
    twist.scale.set(1, 1, 1)

    child.position.copy(originalPosition).multiplyScalar(0.5)
    parent.add(twist)
    twist.add(child)
  }

  private static hideRootPelvisHelperLink (armature: Object3D): void {
    const root = this.findBone(armature, 'root')
    const pelvis = this.findBone(armature, 'pelvis')
    if (root === undefined || pelvis === undefined) return
    if (pelvis.parent?.name === 'motion_root_spacer') return
    if (pelvis.parent !== root) return

    root.remove(pelvis)
    const spacer = new Object3D()
    spacer.name = 'motion_root_spacer'
    root.add(spacer)
    spacer.add(pelvis)
  }

  private static findBone (armature: Object3D, name: string): Bone | undefined {
    let result: Bone | undefined
    armature.traverse((obj) => {
      if (result !== undefined || !(obj instanceof Bone)) return
      if (obj.name.toLowerCase() === name.toLowerCase()) result = obj
    })
    return result
  }
}
