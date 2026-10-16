import {
  type Bone,
  Vector3,
  BufferGeometry,
  type Object3D
} from 'three'

import { type WeightConfig } from './CharacterWeightJob.ts'
import { Utility } from '../Utilities.js'
import { SkeletonType } from '../enums/SkeletonType.js'
import { is_humanoid_skeleton_type } from '../HumanoidSkeleton.js'
import { HeadWeightCorrector } from './HeadWeightCorrector.js'
import { WeightNormalizer } from './WeightNormalizer.js'
import { SurfaceGeodesicWeightCalculator } from './SurfaceGeodesicWeightCalculator.js'

/** Surface/geodesic skinning shared by humanoids and animal templates. */
export default class SkinningAlgorithm {
  private bones_master_data: Bone[] = []
  private geometry: BufferGeometry = new BufferGeometry()
  private skeleton_type: SkeletonType | null = null

  private use_head_weight_correction: boolean = false
  private preview_plane_height: number = 1.4
  private use_arm_plane_correction: boolean = false
  private arm_plane_offset: number = 0.0

  constructor (bone_hier: Object3D, skeleton_type: SkeletonType) {
    this.skeleton_type = skeleton_type
    this.bones_master_data = Utility.bone_list_from_hierarchy(bone_hier)
  }

  public cache_key (): string {
    this.bones_master_data.forEach(bone => bone.updateWorldMatrix(true, false))
    return JSON.stringify([this.skeleton_type, this.use_head_weight_correction, this.preview_plane_height,
      this.bones_master_data.map(bone => [bone.name, bone.matrixWorld.elements])])
  }

  public worker_config (): WeightConfig {
    return {
      type: this.skeleton_type!, head: this.use_head_weight_correction, height: this.preview_plane_height,
      bones: this.bones_master_data.map(bone => ({ name: bone.name,
        parent: this.bones_master_data.indexOf(bone.parent as Bone),
        position: bone.getWorldPosition(new Vector3()).toArray() }))
    }
  }

  public set_geometry (geom: BufferGeometry): void {
    this.geometry = geom
  }

  public set_head_weight_correction_enabled (enabled: boolean): void {
    this.use_head_weight_correction = enabled
  }

  public set_preview_plane_height (height: number): void {
    this.preview_plane_height = height
  }

  public set_arm_plane_correction_enabled (enabled: boolean): void {
    this.use_arm_plane_correction = enabled
  }

  public set_arm_plane_offset (offset: number): void {
    this.arm_plane_offset = offset
  }

  public calculate_indexes_and_weights (): number[][] {
    const skin_indices: number[] = []
    const skin_weights: number[] = []

    // Surface Fit is topological, not humanoid-specific. Use the same
    // geodesic path for quadrupeds, birds, dragons, insects, snakes and fish.
    // The anatomy-dependent head override below is still humanoid only.
    {
      const surface_calculator = new SurfaceGeodesicWeightCalculator(this.bones_master_data, this.geometry)
      surface_calculator.calculate(skin_indices, skin_weights)

      const weight_normalizer = new WeightNormalizer(this.geometry)
      weight_normalizer.normalize_weights(skin_weights)

      // Keep the optional head divider as a user-requested override. The old arm
      // plane correction is deliberately not applied: surface propagation already
      // prevents arm influences from teleporting across empty space into the torso.
      if (is_humanoid_skeleton_type(this.skeleton_type) && this.use_head_weight_correction) {
        const head_weight_corrector = new HeadWeightCorrector(
          this.geometry,
          this.bones_master_data,
          this.preview_plane_height
        )
        head_weight_corrector.apply_head_weight_correction(skin_indices, skin_weights)
        weight_normalizer.normalize_weights(skin_weights)
      }

      return [skin_indices, skin_weights]
    }

  }
}
