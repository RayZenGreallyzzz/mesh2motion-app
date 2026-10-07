import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { retargetClip as threeRetargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js'
import {
  BufferGeometry,
  Group,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  type Skeleton,
  SkinnedMesh
} from 'three'
import { RetargetUtils, type BoneRestTransform } from '../../../retarget/RetargetUtils.ts'
import { RigConfig } from '../../RigConfig.ts'
import { SkeletonType } from '../../enums/SkeletonType.ts'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'
import { AnimationUtility } from './AnimationUtility.ts'

/**
 * Mobile Female v6.2
 *
 * Retarget stock Human clips using Three.js SkeletonUtils.retargetClip().
 * The target skeleton's user-edited pose at Bind time is the authoritative
 * rest/bind pose. Per-bone localOffsets are generated automatically from the
 * difference between source and target WORLD rest rotations:
 *
 *   offset = inverse(sourceRestWorld) * targetRestWorld
 *
 * SkeletonUtils then converts the corrected world rotation back into each
 * target bone's local parent space. This lets the user freely change joint
 * positions / bone lengths BEFORE Bind without requiring Human's local axes.
 */
export class MobileFemaleAnimationRetargeter {
  private static source_armature_promise: Promise<Group> | null = null
  private static readonly target_rest_cache = new WeakMap<Skeleton, BoneRestTransform[]>()

  public static remember_bind_pose (target_skeleton: Skeleton): void {
    this.target_rest_cache.set(
      target_skeleton,
      RetargetUtils.capture_bone_rest_transforms(target_skeleton)
    )
  }

  public static async retarget_pair (
    pair: TransformedAnimationClipPair,
    target_mesh: SkinnedMesh
  ): Promise<TransformedAnimationClipPair> {
    const source_armature = await this.load_source_armature()
    const source_skeleton = RetargetUtils.create_skeleton_from_group_object(source_armature)
    if (source_skeleton === null) {
      throw new Error('Could not create source Human skeleton for retargeting')
    }

    let target_rest = this.target_rest_cache.get(target_mesh.skeleton)
    if (target_rest === undefined) {
      target_rest = RetargetUtils.capture_bone_rest_transforms(target_mesh.skeleton)
      this.target_rest_cache.set(target_mesh.skeleton, target_rest)
    }

    // Detached target copy: baking a clip must never move the live preview rig.
    const target_skeleton = RetargetUtils.clone_skeleton(target_mesh.skeleton, target_rest)

    const source_proxy = this.create_skeleton_proxy(source_skeleton)
    const target_proxy = this.create_skeleton_proxy(target_skeleton)

    // SkeletonUtils.retarget() calls target.skeleton.pose() before every frame.
    // Our detached clone is already restored to the authoritative user-edited
    // bind pose, and native pose() is unsafe for rigs with a non-Bone armature
    // parent. Keep this exact pose instead.
    ;(target_skeleton as any).pose = (): void => {}

    source_proxy.updateMatrixWorld(true)
    target_proxy.updateMatrixWorld(true)

    const { names, localOffsets } = this.build_world_rest_offsets(
      source_skeleton,
      target_skeleton
    )

    if (Object.keys(names).length === 0) {
      throw new Error('Mobile Female retargeting found no common Human bones')
    }

    const retargeted = threeRetargetClip(
      target_proxy as any,
      source_proxy as any,
      pair.original_animation_clip,
      {
        hip: 'pelvis',
        names,
        localOffsets,
        preserveBoneMatrix: false,
        preserveBonePositions: true,
        useTargetMatrix: true,
        useFirstFramePosition: false,
        fps: 30,
        scale: 1
      } as any
    )

    retargeted.name = pair.original_animation_clip.name

    return {
      original_animation_clip: retargeted,
      display_animation_clip: AnimationUtility.deep_clone_animation_clip(retargeted),
      metadata: pair.metadata
    }
  }

  private static create_skeleton_proxy (skeleton: Skeleton): SkinnedMesh {
    const proxy = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial())
    proxy.name = 'Retarget Skeleton Proxy'
    proxy.skeleton = skeleton

    // RetargetUtils.clone_skeleton can preserve an armature Group above the first
    // Bone. Attach those detached parents to the proxy so matrixWorld reflects
    // the actual bind hierarchy. If there is no such parent, attach the root Bone.
    const attached = new Set<object>()
    skeleton.bones
      .filter((bone) => bone.parent === null || bone.parent.type !== 'Bone')
      .forEach((bone) => {
        const hierarchy_root = bone.parent !== null && bone.parent.type !== 'Bone'
          ? bone.parent
          : bone
        if (!attached.has(hierarchy_root)) {
          proxy.add(hierarchy_root)
          attached.add(hierarchy_root)
        }
      })

    proxy.updateMatrixWorld(true)
    return proxy
  }

  private static build_world_rest_offsets (
    source_skeleton: Skeleton,
    target_skeleton: Skeleton
  ): { names: Record<string, string>, localOffsets: Record<string, Matrix4> } {
    const names: Record<string, string> = {}
    const localOffsets: Record<string, Matrix4> = {}

    const source_by_name = new Map(
      source_skeleton.bones.map((bone) => [bone.name, bone] as const)
    )

    const source_world = new Quaternion()
    const target_world = new Quaternion()
    const offset = new Quaternion()

    target_skeleton.bones.forEach((target_bone) => {
      const source_bone = source_by_name.get(target_bone.name)
      if (source_bone === undefined) return

      names[target_bone.name] = source_bone.name

      source_bone.getWorldQuaternion(source_world)
      target_bone.getWorldQuaternion(target_world)

      // SkeletonUtils multiplies sourceWorld * localOffset. Choose the offset
      // that reconstructs targetRestWorld when the source is at rest.
      offset.copy(source_world).invert().multiply(target_world).normalize()
      localOffsets[target_bone.name] = new Matrix4().makeRotationFromQuaternion(offset)
    })

    return { names, localOffsets }
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
}
