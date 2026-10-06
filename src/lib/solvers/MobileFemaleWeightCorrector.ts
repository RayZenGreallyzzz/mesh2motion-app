import {
  Bone,
  Vector3,
  type BufferGeometry
} from 'three'

import { Utility } from '../Utilities.js'

interface ArmChain {
  upper_index: number
  lower_index: number
  hand_index: number
  arm_indices: Set<number>
  shoulder: Vector3
  elbow: Vector3
  wrist: Vector3
}

/**
 * Mobile Female skinning pass.
 *
 * The generic closest-bone solver is intentionally permissive because it must
 * support many creature rigs. Human characters with layered clothes need a
 * little more structure: torso vertices must not follow an arm that happens to
 * pass close to the ribs, elbows need a short blend zone, and the hand should
 * stay mostly attached to the hand bone without being made completely rigid.
 *
 * This corrector only edits vertices that the generic pass already assigned to
 * an arm chain. It therefore cannot steal arbitrary skirt/coat/body vertices
 * that were correctly assigned elsewhere.
 */
export class MobileFemaleWeightCorrector {
  private readonly bone_to_index = new Map<Bone, number>()
  private readonly torso_candidates: Array<{ index: number, midpoint: Vector3 }> = []

  constructor (
    private readonly geometry: BufferGeometry,
    private readonly bones: Bone[]
  ) {
    bones.forEach((bone, index) => this.bone_to_index.set(bone, index))
    this.build_torso_candidates()
  }

  public apply (skin_indices: number[], skin_weights: number[]): void {
    const chains = this.find_arm_chains()
    if (chains.length !== 2 || this.torso_candidates.length === 0) return

    const shoulder_center = chains[0].shoulder.clone().add(chains[1].shoulder).multiplyScalar(0.5)
    const lateral_axis = chains[1].shoulder.clone().sub(chains[0].shoulder)
    const shoulder_span = lateral_axis.length()
    if (shoulder_span <= 1e-6) return

    lateral_axis.normalize()
    const torso_half_width = shoulder_span * 0.36
    const vertex_count = this.geometry.attributes.position.count

    for (let vertex_index = 0; vertex_index < vertex_count; vertex_index++) {
      const offset = vertex_index * 4
      const primary_index = skin_indices[offset]
      const chain = chains.find(candidate => candidate.arm_indices.has(primary_index))
      if (chain === undefined) continue

      const vertex = new Vector3().fromBufferAttribute(this.geometry.attributes.position, vertex_index)
      const lateral_distance = Math.abs(vertex.clone().sub(shoulder_center).dot(lateral_axis))

      // Arm bones can run close to jackets, belts and the ribcage in A-pose.
      // If the generic solver gave an inboard torso vertex to the arm, return it
      // to the nearest torso/clavicle bone before smoothing.
      if (lateral_distance < torso_half_width) {
        this.assign_single_bone(
          skin_indices,
          skin_weights,
          offset,
          this.closest_torso_bone(vertex)
        )
        continue
      }

      if (primary_index === chain.upper_index) {
        const t = this.segment_parameter(vertex, chain.shoulder, chain.elbow)
        if (t > 0.72) {
          const lower_weight = this.smoothstep(0.72, 1.0, t) * 0.55
          this.assign_two_bones(
            skin_indices,
            skin_weights,
            offset,
            chain.upper_index,
            chain.lower_index,
            1.0 - lower_weight,
            lower_weight
          )
        }
        continue
      }

      if (primary_index === chain.lower_index) {
        const t = this.segment_parameter(vertex, chain.elbow, chain.wrist)

        if (t < 0.22) {
          const upper_weight = (1.0 - this.smoothstep(0.0, 0.22, t)) * 0.35
          this.assign_two_bones(
            skin_indices,
            skin_weights,
            offset,
            chain.lower_index,
            chain.upper_index,
            1.0 - upper_weight,
            upper_weight
          )
        } else if (t > 0.74) {
          const hand_weight = this.smoothstep(0.74, 1.0, t) * 0.45
          this.assign_two_bones(
            skin_indices,
            skin_weights,
            offset,
            chain.lower_index,
            chain.hand_index,
            1.0 - hand_weight,
            hand_weight
          )
        }
        continue
      }

      // Hand/finger-owned vertices remain hand-dominant, but unlike the old
      // rigid-lock experiment they keep a small forearm influence so animation
      // remains smooth at the wrist.
      if (this.is_hand_descendant(primary_index, chain.hand_index)) {
        this.assign_two_bones(
          skin_indices,
          skin_weights,
          offset,
          chain.hand_index,
          chain.lower_index,
          0.9,
          0.1
        )
      }
    }
  }

  private find_arm_chains (): ArmChain[] {
    const upper_bones = this.bones.filter(bone => bone.name.toLowerCase().includes('upperarm'))
    const chains: ArmChain[] = []

    for (const upper of upper_bones) {
      const lower = this.find_descendant(upper, ['lowerarm', 'forearm'])
      const hand = lower === undefined ? undefined : this.find_descendant(lower, ['hand'])
      if (lower === undefined || hand === undefined) continue

      const upper_index = this.bone_to_index.get(upper)
      const lower_index = this.bone_to_index.get(lower)
      const hand_index = this.bone_to_index.get(hand)
      if (upper_index === undefined || lower_index === undefined || hand_index === undefined) continue

      const arm_indices = new Set<number>()
      upper.traverse((object) => {
        if (!(object instanceof Bone)) return
        const index = this.bone_to_index.get(object)
        if (index !== undefined) arm_indices.add(index)
      })

      chains.push({
        upper_index,
        lower_index,
        hand_index,
        arm_indices,
        shoulder: Utility.world_position_from_object(upper),
        elbow: Utility.world_position_from_object(lower),
        wrist: Utility.world_position_from_object(hand)
      })
    }

    return chains.slice(0, 2)
  }

  private find_descendant (root: Bone, keywords: string[]): Bone | undefined {
    let result: Bone | undefined
    root.traverse((object) => {
      if (result !== undefined || !(object instanceof Bone) || object === root) return
      const name = object.name.toLowerCase()
      if (keywords.some(keyword => name.includes(keyword))) result = object
    })
    return result
  }

  private build_torso_candidates (): void {
    const torso_keywords = [
      'pelvis', 'hips', 'spine', 'chest', 'torso', 'clavicle', 'shoulder', 'collar'
    ]

    this.bones.forEach((bone, index) => {
      const name = bone.name.toLowerCase()
      if (!torso_keywords.some(keyword => name.includes(keyword))) return
      if (name.includes('upperarm') || name.includes('lowerarm') || name.includes('forearm')) return
      if (Utility.is_leaf_bone(bone)) return
      this.torso_candidates.push({ index, midpoint: Utility.bone_midpoint_to_child(bone) })
    })
  }

  private closest_torso_bone (vertex: Vector3): number {
    let best = this.torso_candidates[0]
    let best_distance = best.midpoint.distanceToSquared(vertex)

    for (let i = 1; i < this.torso_candidates.length; i++) {
      const candidate = this.torso_candidates[i]
      const distance = candidate.midpoint.distanceToSquared(vertex)
      if (distance < best_distance) {
        best = candidate
        best_distance = distance
      }
    }

    return best.index
  }

  private is_hand_descendant (bone_index: number, hand_index: number): boolean {
    if (bone_index === hand_index) return true

    let current = this.bones[bone_index]
    const hand = this.bones[hand_index]
    while (current?.parent instanceof Bone) {
      if (current.parent === hand) return true
      current = current.parent
    }
    return false
  }

  private segment_parameter (point: Vector3, start: Vector3, end: Vector3): number {
    const segment = end.clone().sub(start)
    const length_squared = segment.lengthSq()
    if (length_squared <= 1e-8) return 0
    const t = point.clone().sub(start).dot(segment) / length_squared
    return Math.max(0, Math.min(1, t))
  }

  private smoothstep (edge0: number, edge1: number, value: number): number {
    if (edge0 === edge1) return value < edge0 ? 0 : 1
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
  }

  private assign_single_bone (
    skin_indices: number[],
    skin_weights: number[],
    offset: number,
    bone_index: number
  ): void {
    skin_indices[offset] = bone_index
    skin_weights[offset] = 1
    for (let slot = 1; slot < 4; slot++) {
      skin_indices[offset + slot] = 0
      skin_weights[offset + slot] = 0
    }
  }

  private assign_two_bones (
    skin_indices: number[],
    skin_weights: number[],
    offset: number,
    primary_index: number,
    secondary_index: number,
    primary_weight: number,
    secondary_weight: number
  ): void {
    skin_indices[offset] = primary_index
    skin_indices[offset + 1] = secondary_index
    skin_indices[offset + 2] = 0
    skin_indices[offset + 3] = 0
    skin_weights[offset] = primary_weight
    skin_weights[offset + 1] = secondary_weight
    skin_weights[offset + 2] = 0
    skin_weights[offset + 3] = 0
  }
}
