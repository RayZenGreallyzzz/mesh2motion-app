import {
  type AnimationClip, type Bone, Matrix4, type Object3D, Quaternion,
  QuaternionKeyframeTrack, type Skeleton, Vector3
} from 'three'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'
import { AnimationUtility } from './AnimationUtility.ts'

export interface AnimationRestTransform {
  quaternion: Quaternion
  position: Vector3
  world_quaternion: Quaternion
  world_position: Vector3
  parent_name: string | null
}

interface BoneFrame {
  rotation: Quaternion
  parent_rotation_inverse: Quaternion
  swing: Quaternion
}

/**
 * Convert stock Human clips into the fitted skeleton's coordinate frames once,
 * before playback. No sampling, skeleton cloning or per-frame retargeting.
 *
 * Moving a joint changes its parent's segment direction without necessarily
 * changing that parent's quaternion (AutoRig does exactly this). Consequently
 * targetRest * inverse(sourceRest) * key is insufficient even when the names
 * and rest quaternions match. The outgoing segment must be taken into account.
 */
export class RestPoseAnimationBridge {
  public static apply_to_mobile_female (
    animation_pairs: TransformedAnimationClipPair[],
    target_skeleton: Skeleton,
    skeleton_scale: number = 1
  ): void {
    const target_rest_pose = this.capture_rest_pose(target_skeleton.bones)
    const frame_cache = new Map<ReadonlyMap<string, AnimationRestTransform>, Map<string, BoneFrame>>()

    for (const pair of animation_pairs) {
      // Each GLB carries its own bind skeleton. In particular human-base has
      // different shoulder/forearm frames from rig-human and the other packs.
      const source_rest_pose = pair.source_rest_pose
      if (source_rest_pose === undefined || source_rest_pose.size === 0) {
        throw new Error(`Missing source skeleton for animation: ${pair.original_animation_clip.name}`)
      }
      let frames = frame_cache.get(source_rest_pose)
      if (frames === undefined) {
        frames = this.build_bone_frames(source_rest_pose, target_rest_pose)
        frame_cache.set(source_rest_pose, frames)
      }
      this.convert_clip(pair.original_animation_clip, source_rest_pose, target_rest_pose, frames, skeleton_scale)
      // The display copy has not been warped yet. Copy the corrected original
      // so preview, reset, mirroring and export all start from the same keys.
      pair.display_animation_clip = AnimationUtility.deep_clone_animation_clip(pair.original_animation_clip)
    }
  }

  public static capture_scene_rest_pose (scene: Object3D): Map<string, AnimationRestTransform> {
    const bones: Bone[] = []
    scene.traverse(object => {
      if ((object as Bone).isBone) bones.push(object as Bone)
    })
    return this.capture_rest_pose(bones)
  }

  /** Capture in armature space, excluding viewport placement/rotation/scale. */
  public static capture_rest_pose (bones: readonly Bone[]): Map<string, AnimationRestTransform> {
    const result = new Map<string, AnimationRestTransform>()
    const bone_set = new Set(bones)
    const root = bones.find(bone => !bone_set.has(bone.parent as Bone))
    if (root === undefined) return result
    root.updateWorldMatrix(true, true)
    const armature_inverse = root.parent?.matrixWorld.clone().invert() ?? new Matrix4()
    const world_matrix = new Matrix4()
    const scale = new Vector3()

    for (const bone of bones) {
      world_matrix.multiplyMatrices(armature_inverse, bone.matrixWorld)
      const world_position = new Vector3()
      const world_quaternion = new Quaternion()
      world_matrix.decompose(world_position, world_quaternion, scale)
      result.set(bone.name, {
        quaternion: bone.quaternion.clone().normalize(),
        position: bone.position.clone(),
        world_quaternion: world_quaternion.normalize(),
        world_position,
        parent_name: bone_set.has(bone.parent as Bone) ? bone.parent!.name : null
      })
    }
    return result
  }

  /** Public entry point for a single clip and for asset regression tests. */
  public static rebase_clip_to_rest_pose (
    clip: AnimationClip,
    source_rest_pose: ReadonlyMap<string, AnimationRestTransform>,
    target_rest_pose: ReadonlyMap<string, AnimationRestTransform>,
    skeleton_scale: number = 1
  ): void {
    const frames = this.build_bone_frames(source_rest_pose, target_rest_pose)
    this.convert_clip(clip, source_rest_pose, target_rest_pose, frames, skeleton_scale)
  }

  private static build_bone_frames (
    source: ReadonlyMap<string, AnimationRestTransform>,
    target: ReadonlyMap<string, AnimationRestTransform>
  ): Map<string, BoneFrame> {
    const frames = new Map<string, BoneFrame>()
    const visiting = new Set<string>()

    const visit = (name: string): BoneFrame | undefined => {
      const existing = frames.get(name)
      if (existing !== undefined) return existing
      const s = source.get(name)
      const t = target.get(name)
      if (s === undefined || t === undefined) return undefined
      if (visiting.has(name)) throw new Error(`Cyclic animation hierarchy: ${name}`)
      visiting.add(name)
      if (s.parent_name !== t.parent_name) {
        throw new Error(`Animation parent mismatch for ${name}: ${s.parent_name} / ${t.parent_name}`)
      }
      const parent = t.parent_name === null ? undefined : visit(t.parent_name)
      if (t.parent_name !== null && parent === undefined) {
        throw new Error(`Missing animation parent for ${name}: ${t.parent_name}`)
      }

      // Prefer the child along the source bone's authored +Y axis. This selects
      // spine at pelvis/chest and middle finger at hand, not a side branch.
      let child_name: string | undefined
      let best_alignment = -Infinity
      const authored_axis = new Vector3(0, 1, 0).applyQuaternion(s.world_quaternion)
      for (const [candidate, child] of target) {
        const source_child = source.get(candidate)
        if (child.parent_name !== name || source_child?.parent_name !== name) continue
        const direction = source_child.world_position.clone().sub(s.world_position)
        const target_direction = child.world_position.clone().sub(t.world_position)
        if (direction.lengthSq() < 1e-12 || target_direction.lengthSq() < 1e-12) continue
        const alignment = direction.normalize().dot(authored_axis)
        if (alignment > best_alignment) {
          best_alignment = alignment
          child_name = candidate
        }
      }

      // Leaves inherit the parent's pose correction; the coordinate-system root
      // is never aimed at pelvis, since pelvis translation is not a root axis.
      const swing = parent?.swing.clone() ?? new Quaternion()
      if (t.parent_name === null) {
        swing.identity()
      } else if (child_name !== undefined) {
        const source_direction = source.get(child_name)!.world_position.clone().sub(s.world_position).normalize()
        const target_direction = target.get(child_name)!.world_position.clone().sub(t.world_position).normalize()
        swing.setFromUnitVectors(target_direction, source_direction)
      }

      // QtargetWorld(t) = QsourceWorld(t) * Rbone
      // QtargetLocal(t) = inverse(Rparent) * QsourceLocal(t) * Rbone
      // R maps the fitted segment (including A/T pose and edited local axes)
      // into the source segment. Both parent and child bases are necessary.
      const rotation = s.world_quaternion.clone().invert().multiply(swing).multiply(t.world_quaternion).normalize()
      const frame: BoneFrame = {
        rotation,
        parent_rotation_inverse: parent?.rotation.clone().invert() ?? new Quaternion(),
        swing
      }
      frames.set(name, frame)
      visiting.delete(name)
      return frame
    }

    for (const name of target.keys()) visit(name)
    return frames
  }

  private static convert_clip (
    clip: AnimationClip,
    source: ReadonlyMap<string, AnimationRestTransform>,
    target: ReadonlyMap<string, AnimationRestTransform>,
    frames: ReadonlyMap<string, BoneFrame>,
    skeleton_scale: number
  ): void {
    const q = new Quaternion()
    const p = new Vector3()
    const animated_rotations = new Set<string>()

    for (const track of clip.tracks) {
      const rotation = track.name.endsWith('.quaternion')
      const position = track.name.endsWith('.position')
      if (!rotation && !position) continue
      const bone_name = this.bone_name_from_track(track.name)
      if (bone_name === null) continue
      const s = source.get(bone_name)
      const t = target.get(bone_name)
      const frame = frames.get(bone_name)
      if (s === undefined || t === undefined || frame === undefined) continue
      if (rotation) {
        animated_rotations.add(bone_name)
        for (let i = 0; i < track.values.length; i += 4) {
          q.fromArray(track.values, i).normalize()
          q.premultiply(frame.parent_rotation_inverse).multiply(frame.rotation).normalize()
          q.toArray(track.values, i)
        }
      } else {
        // Loader already scales translations; rotate only the motion delta and
        // keep the user's pelvis/root placement as the translation origin.
        for (let i = 0; i < track.values.length; i += 3) {
          p.fromArray(track.values, i).addScaledVector(s.position, -skeleton_scale)
            .applyQuaternion(frame.parent_rotation_inverse).add(t.position)
          p.toArray(track.values, i)
        }
      }
    }

    // A clip can omit a constant parent rotation. Its source-rest value still
    // needs conversion; leaving the fitted bind value would invalidate every
    // descendant's frame (and make clip switching depend on the last clip).
    for (const [name, frame] of frames) {
      if (animated_rotations.has(name)) continue
      q.copy(source.get(name)!.quaternion)
        .premultiply(frame.parent_rotation_inverse).multiply(frame.rotation).normalize()
      if (q.angleTo(target.get(name)!.quaternion) > 1e-6) {
        clip.tracks.push(new QuaternionKeyframeTrack(`${name}.quaternion`, [0], q.toArray()))
      }
    }
  }

  private static bone_name_from_track (track_name: string): string | null {
    const bones_match = track_name.match(/\.bones\[([^\]]+)\]\.(?:quaternion|position)$/)
    if (bones_match !== null) return bones_match[1]
    const simple_match = track_name.match(/^([^.]+)\.(?:quaternion|position)$/)
    return simple_match?.[1] ?? null
  }
}
