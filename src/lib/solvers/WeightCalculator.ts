import {
  Vector3, Raycaster, type Bone, Mesh,
  MeshBasicMaterial, DoubleSide,
  type BufferGeometry
} from 'three'

import { Utility } from '../Utilities.js'
import { SkeletonType } from '../enums/SkeletonType.js'
import { RigConfig } from '../RigConfig.js'

/**
 * Handles the core bone-to-vertex weight calculation logic.
 * Determines which bone each vertex is closest to using midpoint-to-child distances,
 * with special handling for hip/pelvis regions.
 */
export class WeightCalculator {
  private readonly bones: Bone[]
  private readonly geometry: BufferGeometry
  private readonly skeleton_type: SkeletonType | null

  private cached_median_child_bone_positions: Vector3[] = []
  private readonly bone_object_to_index = new Map<Bone, number>()
  // World-space Y coordinate of the underside of the pelvis, not a distance.
  // Null means there was no reliable pelvis/leg landmark.
  private pelvis_bottom_y: number | null = null

  // each index will be a bone index. the value will be a list of vertex indices that belong to that bone
  private readonly bones_vertex_segmentation: number[][] = []

  // bone indices that should never receive vertex weights: the root (global
  // transform only) and leaf/orientation bones (finger/toe/tail tips, etc.)
  private readonly skipped_bone_indices = new Set<number>()

  constructor (bones: Bone[], geometry: BufferGeometry, skeleton_type: SkeletonType | null) {
    this.bones = bones
    this.geometry = geometry
    this.skeleton_type = skeleton_type
  }

  /**
   * Pre-computes cached values needed for weight calculations.
   * Must be called before calculate_median_bone_weights.
   */
  public initialize_caches (): void {
    this.cached_median_child_bone_positions = this.bones.map(b => Utility.bone_midpoint_to_child(b))
    this.bones.forEach((b, idx) => this.bone_object_to_index.set(b, idx))

    // The root bone is only for global transform changes, and leaf/orientation
    // bones exist only to orient their parent — neither should be assigned any
    // vertices. Compute the skip set once instead of checking names per vertex.
    this.bones.forEach((b, idx) => {
      if (b.name === 'root' || Utility.is_leaf_bone(b)) {
        this.skipped_bone_indices.add(idx)
      }
    })

    // This rule only applies to upright human rigs. Other rigs may track their
    // root motion from a hip/head bone but have completely different anatomy.
    this.pelvis_bottom_y = this.skeleton_type === SkeletonType.Human
      ? this.calculate_pelvis_bottom_y()
      : null
  }

  public get_cached_median_child_bone_positions (): Vector3[] {
    return this.cached_median_child_bone_positions
  }

  /**
   * Assigns the closest bone to each vertex.
   * Modifies the skin_indices and skin_weights arrays in place.
   */
  public calculate_median_bone_weights (skin_indices: number[], skin_weights: number[]): void {
    const vertex_count = this.geometry.attributes.position.array.length / 3

    for (let i = 0; i < vertex_count; i++) {
      const vertex_position: Vector3 = new Vector3().fromBufferAttribute(this.geometry.attributes.position, i)
      let closest_bone_distance: number = Infinity
      let closest_bone_index: number = 0

      this.bones.forEach((bone, idx) => {
        // Skip the root bone (global transform only) and leaf/orientation bones.
        // See skipped_bone_indices, computed once in initialize_caches.
        if (this.skipped_bone_indices.has(idx)) {
          return
        }

        // hip bones should have custom logic for distance. If the distance is too far away we should ignore it
        // This will help with hips when left/right legs could be closer than knee bones
        if (this.skeleton_type === SkeletonType.Human &&
          (bone.name.includes('hips') || bone.name.includes('pelvis'))) {
          // Both operands are *Y coordinates*, in the same geometry/bone space.
          // Vertices lower than the crotch should follow legs rather than pelvis.
          // An earlier version compared a distance to vertex.y (and reversed the
          // comparison), incorrectly rejecting pelvis for upper-body vertices.
          if (this.pelvis_bottom_y !== null && vertex_position.y < this.pelvis_bottom_y) {
            return
          }
        }

        const distance: number = this.cached_median_child_bone_positions[idx].distanceTo(vertex_position)
        if (distance < closest_bone_distance) {
          closest_bone_distance = distance
          closest_bone_index = idx
        }
      })

      this.bones_vertex_segmentation[closest_bone_index] ??= [] // Initialize the array if it doesn't exist
      this.bones_vertex_segmentation[closest_bone_index].push(i)

      // assign to final weights. closest bone is always 100% weight
      skin_indices.push(closest_bone_index, 0, 0, 0)
      skin_weights.push(1.0, 0, 0, 0)
    }
  }

  /**
   * Find the Y coordinate below which the pelvis must not influence vertices.
   * Raycasting the model can identify the crotch on closed meshes, but open or
   * separate clothing meshes often have no hit. Use the thigh joints as a
   * stable anatomical fallback. Never compare a scalar distance to vertex.y.
   */
  private calculate_pelvis_bottom_y (): number | null {
    const tracking_name = RigConfig.by_skeleton_type(SkeletonType.Human)?.position_tracking_bone_name ?? 'pelvis'
    const pelvis = this.bones.find(b => b.name.toLowerCase().includes(tracking_name.toLowerCase()))
    if (pelvis === undefined) return null

    const thigh_joints = this.bones
      .filter(b => /(?:upper.?leg|up.?leg|thigh)/i.test(b.name))
      .map(b => Utility.world_position_from_object(b).y)
      .filter(y => Number.isFinite(y))

    // A top-of-leg joint is a consistent boundary even with no watertight mesh.
    const thigh_y = thigh_joints.length > 0
      ? thigh_joints.reduce((a, b) => a + b, 0) / thigh_joints.length
      : null

    const pelvis_index = this.bones.indexOf(pelvis)
    const pelvis_center = this.cached_median_child_bone_positions[pelvis_index]
    const ray_hit = this.cast_intersection_ray_down_from_bone(pelvis)
    const hit_y = ray_hit !== null && ray_hit.y <= pelvis_center.y ? ray_hit.y : null

    // If raycasting hits a garment or a leg far below the actual crotch,
    // avoid extending the pelvis territory all the way down that surface.
    if (thigh_y !== null && hit_y !== null) {
      return Math.max(thigh_y, hit_y)
    }
    return thigh_y ?? hit_y
  }

  private cast_intersection_ray_down_from_bone (bone: Bone): Vector3 | null {
    const index = this.bones.indexOf(bone)
    const origin = this.cached_median_child_bone_positions[index]
    const raycaster = new Raycaster(origin, new Vector3(0, -1, 0))
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const mesh = new Mesh(this.geometry, material)
    mesh.updateMatrixWorld(true)

    const intersections = raycaster.intersectObject(mesh, false)
    material.dispose()
    return intersections.length > 0 ? intersections[0].point.clone() : null
  }
}
