import { AnimationClip, Quaternion, Vector3, type KeyframeTrack, type QuaternionKeyframeTrack } from 'three'
import type { TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair'

export class AnimationUtility {
  // when we scaled the skeleton itself near the beginning, we kept track of that
  // this scaling will affect position keyframes since they expect the original skeleton scale
  // this will fix any issues with position keyframes not matching the current skeleton scale
  static apply_skeleton_scale_to_position_keyframes (animation_clips: AnimationClip[], scaleAmount: number): void {
    animation_clips.forEach((animation_clip: AnimationClip) => {
      animation_clip.tracks.forEach((track: KeyframeTrack) => {
        if (track.name.includes('.position')) {
          const values = track.values
          for (let i = 0; i < values.length; i += 3) {
            values[i] *= scaleAmount
            values[i + 1] *= scaleAmount
            values[i + 2] *= scaleAmount
          }
        }
      })
    })
  }

  // Scales the position keyframes of the rig's position tracking bone (e.g. pelvis/hips).
  // The authored keyframes assume the height of the base rig model, so taller model
  // variations need their hips raised to keep the feet from sinking below the ground.
  static apply_position_tracking_bone_scale (animation_clips: TransformedAnimationClipPair[],
    position_tracking_bone_name: string | undefined, scale_amount: number): void {
    if (position_tracking_bone_name === undefined || scale_amount === 1.0) {
      return
    }

    const track_name_to_match: string = `${position_tracking_bone_name.toLowerCase()}.position`

    animation_clips.forEach((clip_pair: TransformedAnimationClipPair) => {
      clip_pair.display_animation_clip.tracks.forEach((track: KeyframeTrack) => {
        if (!track.name.toLowerCase().includes(track_name_to_match)) {
          return
        }

        const values = track.values
        for (let i = 0; i < values.length; i++) {
          values[i] *= scale_amount
        }
      })
    })
  }

  static deep_clone_animation_clip (clip: AnimationClip): AnimationClip {
    const tracks = clip.tracks.map((track: KeyframeTrack) => track.clone())
    return new AnimationClip(clip.name, clip.duration, tracks)
  }

  static deep_clone_animation_clips (animation_clips: AnimationClip[]): AnimationClip[] {
    return animation_clips.map((clip: AnimationClip) => {
      return this.deep_clone_animation_clip(clip)
    })
  }

  static create_mirrored_clip (source_clip: AnimationClip): AnimationClip {
    const mirrored_clip = AnimationUtility.deep_clone_animation_clip(source_clip)
    mirrored_clip.name = `${mirrored_clip.name}_mirror`

    AnimationUtility.apply_animation_mirroring([
      {
        original_animation_clip: AnimationUtility.deep_clone_animation_clip(mirrored_clip),
        display_animation_clip: mirrored_clip,
        metadata: { source_type: 'default-library', tags: [] }
      }
    ])

    return mirrored_clip
  }

  /// Removes position tracks from animation clips, keeping only rotation tracks.
  /// @param animation_clips - The animation clips to modify.
  /// @param preserve_root_position - Whether to keep the root position track.
  static clean_track_data (animation_clips: AnimationClip[], position_tracking_bone_name: string | undefined): void {
  
    animation_clips.forEach((animation_clip: AnimationClip) => {
      
      // does the animation clip name include "RM". This indicates a root motion clip and we can keep the root position track
      const preserve_root_position: boolean = animation_clip.name.toLowerCase().endsWith('rm')
      
      // remove all position nodes except root and the position tracking bone (e.g. pelvis for human)
      animation_clip.tracks = animation_clip.tracks.filter((track: KeyframeTrack) =>
        AnimationUtility.is_rotation_or_position_tracking_track(track, position_tracking_bone_name) ||
        (preserve_root_position && track.name.toLowerCase().includes('root.position')))
    })
  }

  private static is_rotation_or_position_tracking_track (track: KeyframeTrack,
    position_tracking_bone_name: string | undefined): boolean {
    return track.name.includes('quaternion') ||
      track.name.toLowerCase().includes(position_tracking_bone_name + '.position')
  }

  static apply_arm_extension_warp (animation_clips: TransformedAnimationClipPair[], percentage: number): void {
    // loop through each animation clip to update the tracks
    animation_clips.forEach((warped_clip: TransformedAnimationClipPair) => {
      warped_clip.display_animation_clip.tracks.forEach((track: KeyframeTrack) => {
        // if our name does not contain 'quaternion', we need to exit
        // since we are only modifying the quaternion tracks (e.g. L_Arm.quaternion )
        if (!track.name.includes('quaternion')) {
          return
        }

        const quaterion_track: QuaternionKeyframeTrack = track

        // if the track is an upper arm bone, then modify that
        const is_right_arm_track_match: boolean = quaterion_track.name.includes('upperarm_l')
        const is_left_arm_track_match: boolean = quaterion_track.name.includes('upperarm_r')

        if (is_right_arm_track_match || is_left_arm_track_match) {
          const new_track_values: Float32Array = quaterion_track.values.slice() // clone array

          const track_count: number = quaterion_track.values.length / 4
          for (let i = 0; i < track_count; i++) {
            // get correct value since it is a quaternion
            const units_in_quaternions: number = 4
            const quaternion: Quaternion = new Quaternion()

            // rotate the upper arms in opposite directions to rise/lower arms
            if (is_right_arm_track_match) {
              quaternion.setFromAxisAngle(new Vector3(0, 0, -1), percentage / 100)
            }
            if (is_left_arm_track_match) {
              quaternion.setFromAxisAngle(new Vector3(0, 0, 1), percentage / 100)
            }

            // get the existing quaternion
            const existing_quaternion: Quaternion = new Quaternion(
              new_track_values[i * units_in_quaternions + 0],
              new_track_values[i * units_in_quaternions + 1],
              new_track_values[i * units_in_quaternions + 2],
              new_track_values[i * units_in_quaternions + 3]
            )

            // multiply the existing quaternion by the new quaternion
            existing_quaternion.multiply(quaternion)

            // this should change the first quaternion component of the track
            new_track_values[i * units_in_quaternions + 0] = existing_quaternion.x
            new_track_values[i * units_in_quaternions + 1] = existing_quaternion.y
            new_track_values[i * units_in_quaternions + 2] = existing_quaternion.z
            new_track_values[i * units_in_quaternions + 3] = existing_quaternion.w
          }

          track.values = new_track_values
        }
      })
    })
  }

  /**
   * Mirrors animations by swapping left and right bone tracks.
   * This swaps tracks that end with 'L' or 'R' to create mirrored animations.
   */
  static apply_animation_mirroring (animation_clips: TransformedAnimationClipPair[]): void {
    for (const pair of animation_clips) {
      const source = pair.display_animation_clip.tracks
      const names = new Map(source.map(track => [track.name.toLowerCase(), track]))
      pair.display_animation_clip.tracks = source.map(track => {
        const opposite = track.name.toLowerCase().replace(/_([lr])(?=\.(?:quaternion|position|scale)$)/,
          (_, side: string) => side === 'l' ? '_r' : '_l')
        const mirrored = (names.get(opposite) ?? track).clone()
        mirrored.name = track.name
        if (track.name.endsWith('.quaternion')) {
          for (let i = 0; i < mirrored.values.length; i += 4) {
            mirrored.values[i + 1] *= -1
            mirrored.values[i + 2] *= -1
          }
        } else if (track.name.endsWith('.position')) {
          for (let i = 0; i < mirrored.values.length; i += 3) mirrored.values[i] *= -1
        }
        return mirrored
      })
    }
  }
}
