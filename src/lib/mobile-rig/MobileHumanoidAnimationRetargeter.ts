import {
  Bone,
  Skeleton,
  type AnimationClip,
  type SkinnedMesh
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js'

import { RigConfig } from '../RigConfig.ts'
import { SkeletonType } from '../enums/SkeletonType.ts'
import { AnimationUtility } from '../processes/animations-listing/AnimationUtility.ts'
import type { TransformedAnimationClipPair } from '../processes/animations-listing/interfaces/TransformedAnimationClipPair.ts'

/**
 * Offline retargeting bridge between the stock animation rig and the clean
 * model-space mobile humanoid. The stock rig is loaded only as a hidden rest
 * reference; it is never bound to the user's mesh.
 */
export class MobileHumanoidAnimationRetargeter {
  private static sourceSkeletonPromise: Promise<Skeleton> | null = null
  private static readonly sourceLoader = new GLTFLoader()

  public static async retargetPairs (
    targetMesh: SkinnedMesh,
    pairs: TransformedAnimationClipPair[]
  ): Promise<TransformedAnimationClipPair[]> {
    if (pairs.length === 0) return pairs

    const sourceSkeleton = await this.sourceSkeleton()
    const targetSkeleton = targetMesh.skeleton
    const names: Record<string, string> = {}
    targetSkeleton.bones.forEach((bone) => { names[bone.name] = bone.name })

    const result: TransformedAnimationClipPair[] = []
    for (const pair of pairs) {
      sourceSkeleton.pose()
      targetSkeleton.pose()
      targetMesh.updateMatrixWorld(true)

      const retargeted = retargetClip(
        targetMesh,
        sourceSkeleton,
        pair.original_animation_clip,
        {
          names,
          hip: 'pelvis',
          fps: 30,
          preserveBoneMatrix: true,
          preserveBonePositions: true,
          useFirstFramePosition: false
        }
      )

      retargeted.name = pair.original_animation_clip.name

      // SkeletonUtils emits `.bones[name].quaternion`. The rest of this app's
      // animation tools (mirror, arm warp, pelvis scale) already understand the
      // original `name.quaternion` convention, so normalize the generated names.
      for (const track of retargeted.tracks) {
        track.name = track.name.replace(/^\.bones\[([^\]]+)\]\./, '$1.')
      }

      // `root` is intentionally an Object3D rather than a deform Bone. Preserve
      // the authored root tracks verbatim so root motion still drives that object.
      const rootTracks = pair.original_animation_clip.tracks
        .filter(track => this.isRootMotionTrack(track.name))
        .map(track => track.clone())
      retargeted.tracks.push(...rootTracks)

      result.push({
        original_animation_clip: retargeted,
        display_animation_clip: AnimationUtility.deep_clone_animation_clip(retargeted),
        metadata: { ...pair.metadata }
      })
    }

    targetSkeleton.pose()
    targetMesh.updateMatrixWorld(true)
    console.log(`Mobile Humanoid retargeted ${result.length} animation clip(s) at 30 FPS`)
    return result
  }

  private static isRootMotionTrack (trackName: string): boolean {
    const name = trackName.toLowerCase()
    return name.includes('root.quaternion') || name.includes('root.position')
  }

  private static async sourceSkeleton (): Promise<Skeleton> {
    if (this.sourceSkeletonPromise !== null) return await this.sourceSkeletonPromise

    this.sourceSkeletonPromise = new Promise<Skeleton>((resolve, reject) => {
      const rigPath = RigConfig.rig_file_for(SkeletonType.Human)
      if (rigPath === undefined) {
        reject(new Error('Human reference rig path is missing'))
        return
      }

      this.sourceLoader.load(
        rigPath,
        (gltf) => {
          let namedRoot: Bone | undefined
          let firstBone: Bone | undefined

          gltf.scene.traverse((object) => {
            if (!(object instanceof Bone)) return
            firstBone ??= object
            if (object.name.toLowerCase() === 'root') namedRoot = object
          })

          const root = namedRoot ?? firstBone
          if (root === undefined) {
            reject(new Error('Human reference rig contains no bones'))
            return
          }

          root.updateWorldMatrix(true, true)
          const bones: Bone[] = []
          root.traverse((object) => {
            if (object instanceof Bone) bones.push(object)
          })

          const skeleton = new Skeleton(bones)
          skeleton.calculateInverses()
          resolve(skeleton)
        },
        undefined,
        (error) => {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      )
    })

    return await this.sourceSkeletonPromise
  }
}
