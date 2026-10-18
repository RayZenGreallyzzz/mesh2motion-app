import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type AnimationClip, type Bone, Quaternion, type Skeleton, Vector3 } from 'three'
import { RigConfig } from '../../RigConfig.ts'
import { SkeletonType } from '../../enums/SkeletonType.ts'
import { is_humanoid_skeleton_type } from '../../HumanoidSkeleton.ts'
import { HumanoidClipCalibration } from './HumanoidClipCalibration.ts'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'

export interface AnimationRestTransform {
  quaternion: Quaternion
  position: Vector3
  parent_name?: string
}

/**
 * Adapt each bundled animation library to its user-edited skeleton.
 *
 * Humanoid edits change the anatomical axes as well as the joint positions,
 * so calibrate those axes from child offsets. Other creature rigs keep their
 * own source rest frames and use the existing rest-relative conversion.
 *
 * This is a one-time conversion of the loaded clip values. The 178-library
 * playback still uses the lightweight AnimationMixer, with no per-frame bake.
 */
export class RestPoseAnimationBridge {
  // Each creature has its own source reference rig, including animals and
  // non-humanoid topologies. Do not reuse the Human rest pose for a fish/fox!
  private static readonly source_rest_pose_cache =
    new Map<string, Promise<Map<string, AnimationRestTransform>>>()

  public static async apply_to_skeleton_type (
    animation_pairs: TransformedAnimationClipPair[],
    target_skeleton: Skeleton,
    skeleton_type: SkeletonType,
    skeleton_scale: number = 1
  ): Promise<void> {
    // Target rest is authoritative regardless of manual or automatic fitting.
    const source_rest_pose = await this.load_source_rest_pose(skeleton_type)
    const target_rest_pose = this.capture_rest_pose(target_skeleton)

    const common = [...source_rest_pose.keys()]
      .filter(name => target_rest_pose.has(name))
    if (common.length === 0) {
      throw new Error(
        'Animation source and target rigs share no bone names for ' + skeleton_type
      )
    }

    const humanoid = is_humanoid_skeleton_type(skeleton_type)
      ? new HumanoidClipCalibration(source_rest_pose, target_rest_pose) : null

    for (const pair of animation_pairs) {
      if (humanoid) {
        humanoid.apply(pair.original_animation_clip, skeleton_scale)
        humanoid.apply(pair.display_animation_clip, skeleton_scale)
        continue
      }
      // Run this once per clip pair. Both original and display tracks must be
      // rebased to avoid subsequent mirror/speed changes recreating bad poses.
      this.rebase_clip_to_rest_pose(
        pair.original_animation_clip, source_rest_pose,
        target_rest_pose, skeleton_scale
      )
      this.rebase_clip_to_rest_pose(
        pair.display_animation_clip, source_rest_pose,
        target_rest_pose, skeleton_scale
      )
    }
  }

  // Keep the existing Mobile Female API for backwards compatibility.
  public static async apply_to_mobile_female (
    animation_pairs: TransformedAnimationClipPair[],
    target_skeleton: Skeleton,
    skeleton_scale: number = 1
  ): Promise<void> {
    await this.apply_to_skeleton_type(
      animation_pairs, target_skeleton, SkeletonType.MobileFemale, skeleton_scale
    )
  }

  private static async load_source_rest_pose (
    skeleton_type: SkeletonType
  ): Promise<Map<string, AnimationRestTransform>> {
    const rig_file = RigConfig.rig_file_for(skeleton_type)
    if (rig_file === undefined) {
      throw new Error('No animation reference rig configured for ' + skeleton_type)
    }
    let loading = this.source_rest_pose_cache.get(rig_file)
    if (loading === undefined) {
      loading = (async () => {
        const gltf = await new GLTFLoader().loadAsync(rig_file)
        const poses = new Map<string, AnimationRestTransform>()
        gltf.scene.traverse(object => {
          if (object.type !== 'Bone') return
          const bone = object as Bone
          poses.set(bone.name, {
            quaternion: bone.quaternion.clone(),
            position: bone.position.clone(),
            parent_name: bone.parent?.type === 'Bone' ? bone.parent.name : undefined
          })
        })
        if (poses.size === 0) {
          throw new Error('Reference rig contains no bones: ' + rig_file)
        }
        return poses
      })()
      this.source_rest_pose_cache.set(rig_file, loading)
    }
    try {
      return await loading
    } catch (error) {
      // A missing/offline rig should not poison all future imports.
      this.source_rest_pose_cache.delete(rig_file)
      throw error
    }
  }

  private static capture_rest_pose (skeleton: Skeleton): Map<string, AnimationRestTransform> {
    const result = new Map<string, AnimationRestTransform>()
    skeleton.bones.forEach((bone) => {
      result.set(bone.name, {
        quaternion: bone.quaternion.clone(),
        position: bone.position.clone(),
        parent_name: bone.parent?.type === 'Bone' ? bone.parent.name : undefined
      })
    })
    return result
  }

  /**
   * For rotation: targetQ = targetRestQ * inverse(sourceRestQ) * sourceQ.
   * For translation: targetP = targetRestP + (sourceP - scaledSourceRestP).
   * Both formulas guarantee that a source-rest key reproduces target bind pose.
   *
   * No positions are introduced for bones that have no position track.
   */
  public static rebase_clip_to_rest_pose (
    clip: AnimationClip,
    source_rest_pose: ReadonlyMap<string, AnimationRestTransform>,
    target_rest_pose: ReadonlyMap<string, AnimationRestTransform>,
    skeleton_scale: number = 1
  ): void {
    const source_inverse = new Quaternion()
    const source_animation = new Quaternion()
    const target_animation = new Quaternion()

    for (const track of clip.tracks) {
      const rotation = track.name.endsWith('.quaternion')
      const position = track.name.endsWith('.position')
      if (!rotation && !position) continue

      const bone_name = this.bone_name_from_track(track.name)
      if (bone_name === null) continue
      const source_rest = source_rest_pose.get(bone_name)
      const target_rest = target_rest_pose.get(bone_name)
      if (source_rest === undefined || target_rest === undefined) continue

      const stride = rotation ? 4 : 3
      const cubic = track.values.length === track.times.length * stride * 3
      if (rotation) {
        source_inverse.copy(source_rest.quaternion).invert()
        for (let i = 0; i < track.values.length; i += 4) {
          source_animation.set(
            track.values[i], track.values[i + 1],
            track.values[i + 2], track.values[i + 3]
          )
          target_animation
            .copy(target_rest.quaternion)
            .multiply(source_inverse)
            .multiply(source_animation)
          if (!cubic || (i / 4) % 3 === 1) target_animation.normalize()
          track.values[i] = target_animation.x
          track.values[i + 1] = target_animation.y
          track.values[i + 2] = target_animation.z
          track.values[i + 3] = target_animation.w
        }
      } else {
        for (let i = 0; i < track.values.length; i += 3) {
          if (cubic && (i / 3) % 3 !== 1) continue
          track.values[i] = target_rest.position.x + track.values[i] - source_rest.position.x * skeleton_scale
          track.values[i + 1] = target_rest.position.y + track.values[i + 1] - source_rest.position.y * skeleton_scale
          track.values[i + 2] = target_rest.position.z + track.values[i + 2] - source_rest.position.z * skeleton_scale
        }
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
