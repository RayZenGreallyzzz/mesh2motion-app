import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type AnimationClip, type Bone, Quaternion, type Skeleton } from 'three'
import { RigConfig } from '../../RigConfig.ts'
import { SkeletonType } from '../../enums/SkeletonType.ts'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'

/**
 * Re-bases stock Human quaternion tracks onto the edited Mobile Female rest pose.
 * Position tracks are intentionally left untouched; AnimationLoader already keeps
 * only root/pelvis translation where appropriate.
 */
export class RestPoseAnimationBridge {
  private static source_rest_pose_promise: Promise<Map<string, Quaternion>> | null = null

  public static async apply_to_mobile_female (
    animation_pairs: TransformedAnimationClipPair[],
    target_skeleton: Skeleton
  ): Promise<void> {
    const source_rest_pose = await this.load_human_source_rest_pose()
    const target_rest_pose = this.capture_rest_pose(target_skeleton)

    animation_pairs.forEach((pair) => {
      this.retarget_clip_quaternions(pair.original_animation_clip, source_rest_pose, target_rest_pose)
      this.retarget_clip_quaternions(pair.display_animation_clip, source_rest_pose, target_rest_pose)
    })
  }

  private static async load_human_source_rest_pose (): Promise<Map<string, Quaternion>> {
    if (this.source_rest_pose_promise !== null) {
      return await this.source_rest_pose_promise
    }

    this.source_rest_pose_promise = (async () => {
      const rig_file = RigConfig.rig_file_for(SkeletonType.Human)
      if (rig_file === undefined) throw new Error('Human rig file is not configured')

      const loader = new GLTFLoader()
      const gltf = await loader.loadAsync(rig_file)
      const result = new Map<string, Quaternion>()

      gltf.scene.traverse((child) => {
        if (child.type === 'Bone') {
          const bone = child as Bone
          result.set(bone.name, bone.quaternion.clone())
        }
      })

      if (result.size === 0) throw new Error('Human source rig contains no bones')
      return result
    })()

    return await this.source_rest_pose_promise
  }

  private static capture_rest_pose (skeleton: Skeleton): Map<string, Quaternion> {
    const result = new Map<string, Quaternion>()
    skeleton.bones.forEach((bone) => {
      result.set(bone.name, bone.quaternion.clone())
    })
    return result
  }

  private static retarget_clip_quaternions (
    clip: AnimationClip,
    source_rest_pose: Map<string, Quaternion>,
    target_rest_pose: Map<string, Quaternion>
  ): void {
    const source_rest_inverse = new Quaternion()
    const source_animation = new Quaternion()
    const delta = new Quaternion()
    const target_animation = new Quaternion()

    clip.tracks.forEach((track) => {
      if (!track.name.endsWith('.quaternion')) return

      const bone_name = this.bone_name_from_track(track.name)
      if (bone_name === null) return

      const source_rest = source_rest_pose.get(bone_name)
      const target_rest = target_rest_pose.get(bone_name)
      if (source_rest === undefined || target_rest === undefined) return

      source_rest_inverse.copy(source_rest).invert()

      for (let i = 0; i < track.values.length; i += 4) {
        source_animation.set(
          track.values[i],
          track.values[i + 1],
          track.values[i + 2],
          track.values[i + 3]
        ).normalize()

        // delta = inverse(sourceRest) * sourceAnimation
        delta.copy(source_rest_inverse).multiply(source_animation).normalize()

        // targetAnimation = targetRest * delta
        target_animation.copy(target_rest).multiply(delta).normalize()

        track.values[i] = target_animation.x
        track.values[i + 1] = target_animation.y
        track.values[i + 2] = target_animation.z
        track.values[i + 3] = target_animation.w
      }
    })
  }

  private static bone_name_from_track (track_name: string): string | null {
    const simple_match = track_name.match(/^([^.]+)\.quaternion$/)
    if (simple_match !== null) return simple_match[1]

    const bones_match = track_name.match(/\.bones\[([^\]]+)\]\.quaternion$/)
    if (bones_match !== null) return bones_match[1]

    return null
  }
}
