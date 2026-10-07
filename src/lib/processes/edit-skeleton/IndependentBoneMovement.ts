import { Quaternion, Vector3, type Bone, type Skeleton } from 'three'

/*
 * IndependentBoneMovement
 * Encapsulates the "Move Bone Independently" feature for the Edit Skeleton step.
 *
 * When enabled, moving a bone will not drag its children along with it.  Instead,
 * each direct bone-child's world position is snapshotted at the start of a drag,
 * and then re-expressed in the (moving) parent's local frame every frame so that
 * the children appear stationary in world space.
 *
 * If mirror mode is also active the same behaviour is applied to the mirror bone's
 * children so that both sides of the skeleton stay in sync.
 */
export class IndependentBoneMovement {
  private _enabled: boolean = false
  private readonly _children_initial_world_positions: Map<string, Vector3> = new Map<string, Vector3>()
  private readonly _children_initial_world_rotations: Map<string, Quaternion> = new Map<string, Quaternion>()
  private readonly _rest_bone_world_positions: Map<string, Vector3> = new Map<string, Vector3>()
  private readonly _rest_bone_world_rotations: Map<string, Quaternion> = new Map<string, Quaternion>()

  public is_enabled (): boolean {
    return this._enabled
  }

  public set_enabled (value: boolean): void {
    this._enabled = value
  }

  /**
   * Capture the initial (rest) world-space transforms for all bones.
   * This should be called once when a fresh editable skeleton is created.
   */
  public set_rest_pose (skeleton: Skeleton): void {
    this._rest_bone_world_positions.clear()
    this._rest_bone_world_rotations.clear()

    skeleton.bones.forEach((bone) => {
      const world_pos = new Vector3()
      const world_rot = new Quaternion()
      bone.getWorldPosition(world_pos)
      bone.getWorldQuaternion(world_rot)
      this._rest_bone_world_positions.set(bone.uuid, world_pos.clone())
      this._rest_bone_world_rotations.set(bone.uuid, world_rot.clone())
    })
  }

  /**
   * Rebuild humanoid rest orientations from the joint positions the user actually
   * fitted on the model.
   *
   * Three.js Bones are transform nodes: moving a child joint changes the visible
   * segment direction, but does NOT rotate the parent Bone's local basis. Stock
   * animation quaternions then rotate around stale axes and arms/legs twist.
   *
   * This pass preserves every fitted joint WORLD position, derives each Bone's
   * swing from the original rig direction -> fitted direction, and keeps the
   * original rig's roll/twist as the reference. It is intentionally run just
   * before Bind, so AutoRig and manual placement share the exact same canonical
   * rest-pose finalization.
   */
  public rebuild_orientations_from_joint_positions (skeleton: Skeleton): void {
    if (skeleton.bones.length === 0 || this._rest_bone_world_positions.size === 0) {
      return
    }

    skeleton.bones[0]?.updateWorldMatrix(true, true)

    const desired_world_positions = new Map<string, Vector3>()
    skeleton.bones.forEach((bone) => {
      desired_world_positions.set(bone.uuid, bone.getWorldPosition(new Vector3()).clone())
    })

    const bone_set = new Set<Bone>(skeleton.bones)

    const visit = (bone: Bone): void => {
      const desired_position = desired_world_positions.get(bone.uuid)

      // Parent orientations may already have changed earlier in this traversal.
      // Re-express this joint's saved world position in the NEW parent frame so
      // no joint visually moves while we repair the axes.
      if (desired_position !== undefined && bone.parent !== null) {
        bone.parent.updateWorldMatrix(true, false)
        bone.position.copy(bone.parent.worldToLocal(desired_position.clone()))
      }

      const rest_world_rotation = this._rest_bone_world_rotations.get(bone.uuid)
      let target_world_rotation = rest_world_rotation?.clone()

      // The non-deforming root is a coordinate-system carrier. Keep its authored
      // orientation stable; otherwise moving the pelvis would rotate the entire rig.
      const is_root = bone.name.toLowerCase() === 'root'

      if (!is_root && rest_world_rotation !== undefined) {
        const primary_child = this._primary_child_from_rest_axis(bone)

        if (primary_child !== null) {
          const rest_bone_position = this._rest_bone_world_positions.get(bone.uuid)
          const rest_child_position = this._rest_bone_world_positions.get(primary_child.uuid)
          const desired_child_position = desired_world_positions.get(primary_child.uuid)

          if (
            rest_bone_position !== undefined &&
            rest_child_position !== undefined &&
            desired_position !== undefined &&
            desired_child_position !== undefined
          ) {
            const rest_direction = rest_child_position.clone().sub(rest_bone_position)
            const fitted_direction = desired_child_position.clone().sub(desired_position)

            if (rest_direction.lengthSq() > 1e-10 && fitted_direction.lengthSq() > 1e-10) {
              rest_direction.normalize()
              fitted_direction.normalize()

              // Minimal swing from authored long-axis direction to fitted segment.
              // Premultiplying preserves the source rig's roll around that axis.
              const swing = new Quaternion().setFromUnitVectors(rest_direction, fitted_direction)
              target_world_rotation = swing.multiply(rest_world_rotation.clone()).normalize()
            }
          }
        }
      }

      if (target_world_rotation !== undefined) {
        const parent_world_rotation = new Quaternion()

        if (bone.parent !== null) {
          bone.parent.getWorldQuaternion(parent_world_rotation)
        } else {
          parent_world_rotation.identity()
        }

        bone.quaternion.copy(
          parent_world_rotation.clone().invert().multiply(target_world_rotation).normalize()
        )
      }

      bone.updateWorldMatrix(true, false)

      bone.children.forEach((child) => {
        if (this._is_bone(child) && bone_set.has(child)) {
          visit(child)
        }
      })
    }

    const roots = skeleton.bones.filter((bone) =>
      bone.parent === null || !this._is_bone(bone.parent) || !bone_set.has(bone.parent)
    )

    roots.forEach(visit)
    roots.forEach((root) => root.updateWorldMatrix(true, true))
  }

  /**
   * Pick the child that represents the Bone's authored long axis.
   * Blender/glTF bone chains use local +Y for the head->tail direction. On
   * branching joints (pelvis, chest, hand) this avoids averaging unrelated
   * branches such as both thighs/shoulders/fingers.
   */
  private _primary_child_from_rest_axis (bone: Bone): Bone | null {
    const rest_bone_position = this._rest_bone_world_positions.get(bone.uuid)
    const rest_world_rotation = this._rest_bone_world_rotations.get(bone.uuid)
    if (rest_bone_position === undefined || rest_world_rotation === undefined) {
      return null
    }

    const children = bone.children.filter((child): child is Bone =>
      this._is_bone(child) && this._rest_bone_world_positions.has(child.uuid)
    )
    if (children.length === 0) return null
    if (children.length === 1) return children[0]

    const authored_long_axis = new Vector3(0, 1, 0)
      .applyQuaternion(rest_world_rotation)
      .normalize()

    let best_child: Bone | null = null
    let best_alignment = -Infinity

    children.forEach((child) => {
      const child_position = this._rest_bone_world_positions.get(child.uuid)
      if (child_position === undefined) return

      const direction = child_position.clone().sub(rest_bone_position)
      if (direction.lengthSq() <= 1e-10) return

      const alignment = direction.normalize().dot(authored_long_axis)
      if (alignment > best_alignment) {
        best_alignment = alignment
        best_child = child
      }
    })

    return best_child
  }

  /**
   * Snapshot the world-space position and rotation of each direct bone child
   * at drag start.  Clears any previously stored transforms first.
   * When mirror mode is also active, pass the mirror bone as the second argument
   * so its children are tracked in the same pass.
   */
  public record_drag_start (bone: Bone, mirror_bone?: Bone): void {
    this._children_initial_world_positions.clear()
    this._children_initial_world_rotations.clear()
    this._snapshot_direct_children(bone)
    if (mirror_bone !== undefined) {
      this._snapshot_direct_children(mirror_bone)
    }
  }

  /**
   * Re-pin the direct children of a bone to their snapshotted world transforms.
   * Call this every frame while the bone is being dragged.
   * When mirror mode is also active, pass the mirror bone as the second argument
   * so its children are pinned in the same call.
   */
  public apply (bone: Bone, mirror_bone?: Bone): void {
    this._apply_to_bone(bone)
    if (mirror_bone !== undefined) {
      this._apply_to_bone(mirror_bone)
    }
  }

  /**
   * At drag end, update rotation data for the moved bone AND its parent bone.
   *
   * When you translate a bone (e.g. elbow), two rotations change:
   *   1. The PARENT bone (e.g. upper arm) — because the direction from parent
   *      to the moved child has changed.
   *   2. The moved bone itself — because the direction from it to its own
   *      children has changed (children were pinned in place).
   *
   * After each rotation update the affected bone's children are re-pinned so
   * their world-space transforms are preserved.
   */
  public finalize_drop (bone: Bone, mirror_bone?: Bone): void {
    this._finalize_bone_with_parent(bone)

    if (mirror_bone !== undefined) {
      this._finalize_bone_with_parent(mirror_bone)
    }
  }

  private _finalize_bone_with_parent (bone: Bone): void {
    // Snapshot world transforms of the moved bone and its children
    // These are the "ground truth" we want to preserve through rotation updates
    const snapshot = new Map<string, { pos: Vector3, rot: Quaternion }>()
    this._snapshot_bone_and_children(bone, snapshot)

    // - Step 1: Update the PARENT bone's rotation --------------
    // The parent-to-child direction changed because the child was translated.
    const parent_bone = (bone.parent !== null && this._is_bone(bone.parent))
      ? bone.parent
      : null

    if (parent_bone !== null) {
      // Also snapshot siblings so they can be re-pinned after parent rotates
      parent_bone.children.forEach((sibling) => {
        if (sibling === bone || !this._is_bone(sibling)) { return }
        this._snapshot_bone_and_children(sibling, snapshot)
      })

      this._finalize_bone_rotation_from_rest_pose(parent_bone)

      // Re-pin ALL parent children (moved bone + siblings) to their snapshots
      this._repin_children_from_snapshot(parent_bone, snapshot)
    }

    // - Step 2: Update the MOVED bone's rotation ---------------
    // The bone-to-child direction changed because children were pinned in place.
    this._finalize_bone_rotation_from_rest_pose(bone)

    // Re-pin the moved bone's children to their snapshots
    this._repin_children_from_snapshot(bone, snapshot)
  }

  private _snapshot_bone_and_children (bone: Bone, out: Map<string, { pos: Vector3, rot: Quaternion }>): void {
    const pos = new Vector3()
    const rot = new Quaternion()
    bone.getWorldPosition(pos)
    bone.getWorldQuaternion(rot)
    out.set(bone.uuid, { pos: pos.clone(), rot: rot.clone() })

    bone.children.forEach((child) => {
      if (!this._is_bone(child)) { return }
      const child_pos = new Vector3()
      const child_rot = new Quaternion()
      child.getWorldPosition(child_pos)
      child.getWorldQuaternion(child_rot)
      out.set(child.uuid, { pos: child_pos.clone(), rot: child_rot.clone() })
    })
  }

  private _repin_children_from_snapshot (bone: Bone, snapshot: Map<string, { pos: Vector3, rot: Quaternion }>): void {
    const bone_world_rot = new Quaternion()
    bone.getWorldQuaternion(bone_world_rot)
    const inv_bone_world_rot = bone_world_rot.clone().invert()

    bone.children.forEach((child) => {
      if (!this._is_bone(child)) { return }
      const snap = snapshot.get(child.uuid)
      if (snap === undefined) { return }

      const local_pos = snap.pos.clone()
      bone.worldToLocal(local_pos)
      child.position.copy(local_pos)

      const local_rot = inv_bone_world_rot.clone().multiply(snap.rot)
      child.quaternion.copy(local_rot)

      child.updateWorldMatrix(true, true)
    })
  }

  private _snapshot_direct_children (bone: Bone): void {
    bone.children.forEach((child) => {
      if (!this._is_bone(child)) { return }

      const world_pos = new Vector3()
      const world_rot = new Quaternion()
      child.getWorldPosition(world_pos)
      child.getWorldQuaternion(world_rot)
      this._children_initial_world_positions.set(child.uuid, world_pos.clone())
      this._children_initial_world_rotations.set(child.uuid, world_rot.clone())
    })
  }

  private _apply_to_bone (bone: Bone): void {
    const parent_world_rotation = new Quaternion()
    bone.getWorldQuaternion(parent_world_rotation)
    const inverse_parent_world_rotation = parent_world_rotation.clone().invert()

    bone.children.forEach((child) => {
      if (!this._is_bone(child)) { return }
      const initial_world_pos = this._children_initial_world_positions.get(child.uuid)
      const initial_world_rot = this._children_initial_world_rotations.get(child.uuid)
      if (initial_world_pos === undefined) { return }
      const local_pos = initial_world_pos.clone()
      bone.worldToLocal(local_pos)
      child.position.copy(local_pos)

      if (initial_world_rot !== undefined) {
        const local_rot = inverse_parent_world_rotation.clone().multiply(initial_world_rot)
        child.quaternion.copy(local_rot)
      }

      // updateWorldMatrix(updateParents, updateChildren) - propagate changes up and down the hierarchy
      child.updateWorldMatrix(true, true)
    })
  }

  private _finalize_bone_rotation_from_rest_pose (bone: Bone): void {
    const rest_world_rotation = this._rest_bone_world_rotations.get(bone.uuid)
    const rest_direction = this._average_child_direction_from_rest_pose(bone)
    const current_direction = this._average_child_direction_from_current_pose(bone)

    if (rest_world_rotation === undefined || rest_direction === null || current_direction === null) {
      return
    }

    const world_rotation_delta = new Quaternion().setFromUnitVectors(rest_direction, current_direction)
    const target_world_rotation = world_rotation_delta.multiply(rest_world_rotation.clone())

    const parent_world_rotation = new Quaternion()
    if (bone.parent !== null && 'getWorldQuaternion' in bone.parent) {
      bone.parent.getWorldQuaternion(parent_world_rotation)
    } else {
      parent_world_rotation.identity()
    }

    const target_local_rotation = parent_world_rotation.clone().invert().multiply(target_world_rotation)
    bone.quaternion.copy(target_local_rotation)
    bone.updateWorldMatrix(true, true)
  }

  private _average_child_direction_from_rest_pose (bone: Bone): Vector3 | null {
    const bone_rest_world_position = this._rest_bone_world_positions.get(bone.uuid)
    if (bone_rest_world_position === undefined) {
      return null
    }

    const averaged_direction = new Vector3(0, 0, 0)
    let direction_count = 0

    bone.children.forEach((child) => {
      if (!this._is_bone(child)) { return }
      const child_rest_world_position = this._rest_bone_world_positions.get(child.uuid)
      if (child_rest_world_position === undefined) { return }

      const child_direction = child_rest_world_position.clone().sub(bone_rest_world_position)
      if (child_direction.lengthSq() < 1e-8) { return }

      child_direction.normalize()
      averaged_direction.add(child_direction)
      direction_count += 1
    })

    if (direction_count === 0 || averaged_direction.lengthSq() < 1e-8) {
      return null
    }

    return averaged_direction.normalize()
  }

  private _average_child_direction_from_current_pose (bone: Bone): Vector3 | null {
    const bone_world_position = new Vector3()
    bone.getWorldPosition(bone_world_position)

    const averaged_direction = new Vector3(0, 0, 0)
    let direction_count = 0

    bone.children.forEach((child) => {
      if (!this._is_bone(child)) { return }

      const child_world_position = new Vector3()
      child.getWorldPosition(child_world_position)

      const child_direction = child_world_position.sub(bone_world_position)
      if (child_direction.lengthSq() < 1e-8) { return }

      child_direction.normalize()
      averaged_direction.add(child_direction)
      direction_count += 1
    })

    if (direction_count === 0 || averaged_direction.lengthSq() < 1e-8) {
      return null
    }

    return averaged_direction.normalize()
  }

  private _is_bone (value: unknown): value is Bone {
    if (typeof value !== 'object' || value === null) {
      return false
    }

    if (!('isBone' in value)) {
      return false
    }

    return (value as { isBone?: boolean }).isBone === true
  }
}
