import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type AnimationClip, Group, type Skeleton } from 'three'
import { RetargetUtils, type BoneRestTransform } from '../../../retarget/RetargetUtils.ts'
import { Retargeter } from '../../../retarget/human-retargeting/Retargeter.ts'
import { Rig } from '../../../retarget/human-retargeting/Rig.ts'
import { HumanChainConfig } from '../../../retarget/human-retargeting/HumanChainConfig.ts'
import { RigConfig } from '../../RigConfig.ts'
import { SkeletonType } from '../../enums/SkeletonType.ts'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'
import { AnimationUtility } from './AnimationUtility.ts'

/**
 * Production retarget path for Mobile Female.
 *
 * The editable skeleton can have different local rest rotations/proportions from
 * the stock Human rig. Copying Human quaternion tracks directly (or applying a
 * local quaternion delta) is therefore not sufficient. This bridge uses the
 * project's chain-based swing/twist retargeter so motion is transferred in rig
 * space and then baked back into target-bone tracks.
 */
export class MobileFemaleAnimationRetargeter {
  private static source_armature_promise: Promise<Group> | null = null

  public static async retarget_pairs (
    animation_pairs: TransformedAnimationClipPair[],
    target_skeleton: Skeleton
  ): Promise<TransformedAnimationClipPair[]> {
    const source_armature = await this.load_source_armature()
    const target_rest = RetargetUtils.capture_bone_rest_transforms(target_skeleton)
    const mapping = this.create_identity_mapping(source_armature, target_skeleton)

    if (mapping.size === 0) {
      throw new Error('Mobile Female retargeting found no common Human bones')
    }

    return animation_pairs.map((pair) => {
      const retargeted = this.retarget_clip(
        pair.original_animation_clip,
        source_armature,
        target_skeleton,
        target_rest,
        mapping
      )

      return {
        original_animation_clip: retargeted,
        display_animation_clip: AnimationUtility.deep_clone_animation_clip(retargeted),
        metadata: pair.metadata
      }
    })
  }

  private static async load_source_armature (): Promise<Group> {
    if (this.source_armature_promise !== null) {
      return await this.source_armature_promise
    }

    this.source_armature_promise = (async () => {
      const rig_file = RigConfig.rig_file_for(SkeletonType.Human)
      if (rig_file === undefined) {
        throw new Error('Human rig file is not configured')
      }

      const loader = new GLTFLoader()
      const gltf = await loader.loadAsync(rig_file)
      return gltf.scene
    })()

    return await this.source_armature_promise
  }

  private static create_identity_mapping (
    source_armature: Group,
    target_skeleton: Skeleton
  ): Map<string, string> {
    const source_names = new Set<string>()

    source_armature.traverse((child) => {
      if (child.type === 'Bone') source_names.add(child.name)
    })

    // AnimationRetargetService convention: target bone -> source bone.
    const mapping = new Map<string, string>()
    target_skeleton.bones.forEach((bone) => {
      if (source_names.has(bone.name)) {
        mapping.set(bone.name, bone.name)
      }
    })

    return mapping
  }

  private static retarget_clip (
    source_clip: AnimationClip,
    source_armature: Group,
    target_skeleton: Skeleton,
    target_rest: BoneRestTransform[],
    mapping: Map<string, string>
  ): AnimationClip {
    // A fresh source skeleton per clip avoids animation state leaking from one
    // baked clip into the next.
    const source_skeleton = RetargetUtils.create_skeleton_from_group_object(source_armature)
    if (source_skeleton === null) {
      throw new Error('Could not create source Human skeleton for retargeting')
    }

    // Work on a detached target copy restored to the exact user-edited rest pose.
    const detached_target = RetargetUtils.clone_skeleton(target_skeleton, target_rest)

    const source_rig = new Rig(source_skeleton)
    const target_rig = new Rig(detached_target)

    const source_config = HumanChainConfig.build_custom_source_config(mapping)
    const target_config = HumanChainConfig.build_custom_target_config(source_config, mapping)

    source_rig.fromConfig(source_config)
    target_rig.fromConfig(target_config)

    const retargeter = new Retargeter(source_rig, target_rig, source_clip)
    retargeter.update(0.001)

    const tracks = retargeter.bake_animation_to_tracks(30)
    return new AnimationClip(source_clip.name, source_clip.duration, tracks)
  }
}
