import {
  Bone,
  Group,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3
} from 'three'

/**
 * Builds the runtime deform skeleton from the joints the user actually placed
 * on the character. The legacy human GLB is only an editing/animation reference;
 * it is never reused as the final deform hierarchy.
 *
 * The technical `root` becomes a normal Object3D, not a Bone. This keeps root
 * motion available to AnimationMixer while preventing the root from receiving
 * skin weights or appearing as a giant helper bone to the pelvis.
 */
export class CleanMobileHumanoidRig {
  private static readonly fingerPrefixes = [
    'thumb_',
    'index_',
    'middle_',
    'ring_',
    'pinky_'
  ]

  private static readonly removedExactNames = new Set([
    'head_leaf',
    'ball_leaf_l',
    'ball_leaf_r'
  ])

  public static build (editedArmature: Object3D): Group {
    editedArmature.updateWorldMatrix(true, true)

    const sourceBones: Bone[] = []
    editedArmature.traverse((object) => {
      if (object instanceof Bone) sourceBones.push(object)
    })

    const sourceRoot = sourceBones.find(bone => bone.name.toLowerCase() === 'root') ?? sourceBones[0]
    if (sourceRoot === undefined) {
      throw new Error('Clean Mobile Humanoid Rig: edited armature has no bones')
    }

    const deformSources = sourceBones.filter(bone => this.isDeformBone(bone))
    const deformSet = new Set(deformSources)

    const armature = new Group()
    armature.name = 'Clean Mobile Humanoid Armature'

    // Root motion is intentionally NOT a Bone. Animation tracks can still find
    // an Object3D named `root`, but skinning and SkeletonHelper will ignore it.
    const motionRoot = new Object3D()
    motionRoot.name = 'root'
    armature.add(motionRoot)

    const rootPosition = new Vector3()
    const rootQuaternion = new Quaternion()
    sourceRoot.getWorldPosition(rootPosition)
    sourceRoot.getWorldQuaternion(rootQuaternion)
    motionRoot.position.copy(rootPosition)
    motionRoot.quaternion.copy(rootQuaternion)
    motionRoot.scale.set(1, 1, 1)
    motionRoot.updateWorldMatrix(true, false)

    const targetBySource = new Map<Bone, Bone>()
    for (const sourceBone of deformSources) {
      const targetBone = new Bone()
      targetBone.name = sourceBone.name
      targetBone.scale.set(1, 1, 1)
      targetBySource.set(sourceBone, targetBone)
    }

    // Recreate only the deform hierarchy. If an excluded technical/finger node
    // sat between two useful bones, walk upward until the nearest kept parent.
    for (const sourceBone of deformSources) {
      const targetBone = targetBySource.get(sourceBone)!
      let sourceParent: Object3D | null = sourceBone.parent
      let targetParent: Object3D = motionRoot

      while (sourceParent !== null) {
        if (sourceParent instanceof Bone) {
          const mappedParent = targetBySource.get(sourceParent)
          if (mappedParent !== undefined) {
            targetParent = mappedParent
            break
          }
          if (sourceParent === sourceRoot) break
        }
        sourceParent = sourceParent.parent
      }

      targetParent.add(targetBone)
    }

    // The target bones are aligned to the real joint-to-joint direction while
    // retaining as much of the source twist as possible. This gives us a sane
    // rest frame for retargeting instead of inheriting the stock mannequin axes.
    for (const sourceBone of deformSources) {
      const targetBone = targetBySource.get(sourceBone)!
      const parent = targetBone.parent
      if (parent === null) continue

      parent.updateWorldMatrix(true, false)

      const desiredPosition = new Vector3()
      sourceBone.getWorldPosition(desiredPosition)
      const desiredQuaternion = this.alignedWorldQuaternion(sourceBone, deformSet)

      const desiredWorld = new Matrix4().compose(
        desiredPosition,
        desiredQuaternion,
        new Vector3(1, 1, 1)
      )
      const localMatrix = new Matrix4().copy(parent.matrixWorld).invert().multiply(desiredWorld)
      localMatrix.decompose(targetBone.position, targetBone.quaternion, targetBone.scale)
      targetBone.scale.set(1, 1, 1)
      targetBone.updateWorldMatrix(true, false)
    }

    armature.userData.cleanMobileHumanoidRig = true
    armature.userData.motionRootName = 'root'
    armature.updateWorldMatrix(true, true)

    const boneCount = deformSources.length
    console.log(`Clean Mobile Humanoid Rig: ${boneCount} deform bones + root-motion object`)
    return armature
  }

  private static isDeformBone (bone: Bone): boolean {
    const name = bone.name.toLowerCase()
    if (name === 'root') return false
    if (this.removedExactNames.has(name)) return false
    if (name.includes('leaf') || name.includes('tip')) return false
    if (this.fingerPrefixes.some(prefix => name.startsWith(prefix))) return false
    return true
  }

  private static alignedWorldQuaternion (bone: Bone, deformSet: Set<Bone>): Quaternion {
    const sourceQuaternion = new Quaternion()
    bone.getWorldQuaternion(sourceQuaternion)

    const child = this.preferredDeformChild(bone, deformSet)
    if (child === undefined) return sourceQuaternion

    const start = new Vector3()
    const end = new Vector3()
    bone.getWorldPosition(start)
    child.getWorldPosition(end)
    const desiredDirection = end.sub(start)
    if (desiredDirection.lengthSq() < 1e-10) return sourceQuaternion
    desiredDirection.normalize()

    // Three humanoid bones are authored along local +Y. Rotate that axis onto
    // the actual segment with the shortest possible delta, preserving twist.
    const currentAxis = new Vector3(0, 1, 0).applyQuaternion(sourceQuaternion).normalize()
    const alignment = new Quaternion().setFromUnitVectors(currentAxis, desiredDirection)
    return alignment.multiply(sourceQuaternion).normalize()
  }

  private static preferredDeformChild (bone: Bone, deformSet: Set<Bone>): Bone | undefined {
    const children = bone.children.filter((child): child is Bone => child instanceof Bone && deformSet.has(child))
    if (children.length <= 1) return children[0]

    const parentName = this.normalizeName(bone.name)
    const rank = (candidate: Bone): number => {
      const name = this.normalizeName(candidate.name)

      if (parentName.includes('pelvis') || parentName.includes('hips')) {
        if (name.includes('spine')) return 0
        if (name.includes('thigh') || name.includes('upleg')) return 5
      }
      if (parentName.includes('spine') || parentName.includes('chest')) {
        if (name.includes('spine') || name.includes('chest') || name.includes('neck')) return 0
        if (name.includes('shoulder') || name.includes('clavicle')) return 5
      }
      if (parentName.includes('shoulder') || parentName.includes('clavicle')) {
        if (name.includes('upperarm')) return 0
      }
      if (parentName.includes('foot')) {
        if (name.includes('ball') || name.includes('toe')) return 0
      }
      return 10
    }

    return [...children].sort((a, b) => rank(a) - rank(b))[0]
  }

  private static normalizeName (value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '')
  }
}
