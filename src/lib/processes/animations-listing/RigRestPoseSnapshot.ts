import { type Object3D, type Skeleton, Quaternion, Vector3 } from 'three'

interface LocalPose {
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
}

interface SkeletonRestPose {
  localByObject: Map<Object3D, LocalPose>
}

/**
 * Captures exactly the editable bind/rest pose of any bone hierarchy.
 *
 * Three.js Skeleton.pose() reconstructs transforms from inverse bind matrices
 * and the current hierarchy. That is not safe to use as a rest reset after
 * arbitrary manual edits, a non-Bone armature root, or a rebuilt AutoRig.
 *
 * Manual and AutoRig now share this same saved local-pose reset.
 */
export class RigRestPoseSnapshot {
  private readonly snapshots = new WeakMap<Skeleton, SkeletonRestPose>()

  public remember (skeleton: Skeleton): void {
    const localByObject = new Map<Object3D, LocalPose>()
    const capture = (obj: Object3D): void => {
      if (!localByObject.has(obj)) {
        localByObject.set(obj, {
          position: obj.position.clone(),
          quaternion: obj.quaternion.clone(),
          scale: obj.scale.clone()
        })
      }
    }

    // Include non-Bone armature parents that can carry root motion, but not
    // the SkinnedMesh/scene transforms applied to the entire rig by the user.
    for (const bone of skeleton.bones) {
      capture(bone)
      let parent = bone.parent
      while (parent !== null && parent.type !== 'SkinnedMesh' &&
             parent.type !== 'Scene') {
        capture(parent)
        parent = parent.parent
      }
    }
    this.snapshots.set(skeleton, { localByObject })
  }

  public restore (skeleton: Skeleton): boolean {
    const snapshot = this.snapshots.get(skeleton)
    if (snapshot === undefined) return false

    for (const [obj, rest] of snapshot.localByObject) {
      obj.position.copy(rest.position)
      obj.quaternion.copy(rest.quaternion)
      obj.scale.copy(rest.scale)
      obj.updateMatrix()
    }

    const tracked = new Set(snapshot.localByObject.keys())
    for (const obj of tracked) {
      if (obj.parent === null || !tracked.has(obj.parent)) {
        obj.updateWorldMatrix(true, true)
      }
    }
    return true
  }
}
