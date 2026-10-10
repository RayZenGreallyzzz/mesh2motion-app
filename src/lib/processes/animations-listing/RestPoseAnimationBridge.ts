import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type AnimationClip, type Bone, Quaternion, type Skeleton, Vector3 } from 'three'
import { RigConfig } from '../../RigConfig.ts'
import { SkeletonType } from '../../enums/SkeletonType.ts'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'

export interface AnimationRestTransform {
  quaternion: Quaternion
  position: Vector3
}

/**
 * Convert stock Human animation tracks from the SOURCE bind/rest local frame
 * into the actual user-edited Mobile Female bind frame.
 *
 * The bones may have the same names but different local rest transforms:
 * playing stock absolute quaternion/position tracks directly replaces the
 * user's joint placement with the Human rig's values.
 *
 * This is a one-time conversion of the loaded clip values. The 178-library
 * playback still uses the lightweight AnimationMixer, with no per-frame bake.
 */
export class RestPoseAnimationBridge {
  private static source_rest_pose_promise: Promise<Map<string, AnimationRestTransform>> | null = null

  public static async apply_to_mobile_female (
    animation_pairs: TransformedAnimationClipPair[],
    target_skeleton: Skeleton,
    skeleton_scale: number = 1
  ): Promise<void> {
    const source_rest_pose = await this.load_human_source_rest_pose()
    const target_rest_pose = this.capture_rest_pose(target_skeleton)

    // AnimationLoader has already scaled POSITION keys by skeleton_scale.
    // Scale the source rest translation too, otherwise pelvis gets a false
    // offset even when the source and target skeletons agree.
    for (const pair of animation_pairs) {
      this.rebase_clip_to_rest_pose(pair.original_animation_clip, source_rest_pose, target_rest_pose, skeleton_scale)
      this.rebase_clip_to_rest_pose(pair.display_animation_clip, source_rest_pose, target_rest_pose, skeleton_scale)
    }
  }

  private static async load_human_source_rest_pose (): Promise<Map<string, AnimationRestTransform>> {
    if (this.source_rest_pose_promise !== null) return await this.source_rest_pose_promise

    this.source_rest_pose_promise = (async () => {
      const rig_file = RigConfig.rig_file_for(SkeletonType.Human)
      if (rig_file === undefined) throw new Error('Human rig file is not configured')

      const gltf = await new GLTFLoader().loadAsync(rig_file)
      const result = new Map<string, AnimationRestTransform>()
      gltf.scene.traverse((object) => {
        if (object.type !== 'Bone') return
        const bone = object as Bone
        result.set(bone.name, {
          quaternion: bone.quaternion.clone(),
          position: bone.position.clone()
        })
      })

      if (result.size === 0) throw new Error('Human source rig contains no bones')
      return result
    })()

    return await this.source_rest_pose_promise
  }

  private static capture_rest_pose (skeleton: Skeleton): Map<string, AnimationRestTransform> {
    const result = new Map<string, AnimationRestTransform>()
    skeleton.bones.forEach((bone) => {
      result.set(bone.name, {
        quaternion: bone.quaternion.clone(),
        position: bone.position.clone()
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

      if (rotation) {
        source_inverse.copy(source_rest.quaternion).invert()
        for (let i = 0; i < track.values.length; i += 4) {
          source_animation.set(
            track.values[i], track.values[i + 1],
            track.values[i + 2], track.values[i + 3]
          ).normalize()
          target_animation
            .copy(target_rest.quaternion)
            .multiply(source_inverse)
            .multiply(source_animation)
            .normalize()
          track.values[i] = target_animation.x
          track.values[i + 1] = target_animation.y
          track.values[i + 2] = target_animation.z
          track.values[i + 3] = target_animation.w
        }
      } else {
        for (let i = 0; i < track.values.length; i += 3) {
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
