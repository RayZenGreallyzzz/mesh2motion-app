import { Vector3, type Bone, type BufferGeometry } from 'three'
import { continuous_skin_weights } from './ContinuousSkinWeights.ts'
import { Utility } from '../Utilities.js'

interface JointPair {
  parentIndex: number
  childIndex: number
  joint: Vector3
  parentPoint: Vector3
  childPoint: Vector3
  halfWidth: number
  radius: number
}

/**
 * Refines humanoid elbow and knee deformation after surface/geodesic skinning.
 *
 * The surface solver is excellent at keeping influence on the correct connected
 * surface, but its exponential distance field can make a joint transition too
 * abrupt. This pass does NOT invent new arm influence on torso/clothing. It only
 * redistributes the weight that the two bones in a real parent->child pair already
 * own, inside a compact capsule around the joint.
 *
 * That gives predictable elbow/knee gradients while preserving geodesic
 * separation, accessories, manual paint, and all unrelated influences.
 */
export class HumanoidJointWeightCorrector {
  private readonly bones: Bone[]
  private readonly geometry: BufferGeometry

  constructor (geometry: BufferGeometry, bones: Bone[]) {
    this.geometry = geometry
    this.bones = bones
  }

  public apply (skinIndices: number[], skinWeights: number[], soften = false): void {
    const pairs = this.build_joint_pairs(soften)
    if (pairs.length === 0) return

    const positions = this.geometry.getAttribute('position')
    if (positions === undefined) return

    const point = new Vector3()

    for (let vertex = 0; vertex < positions.count; vertex++) {
      point.fromBufferAttribute(positions, vertex)

      for (const pair of pairs) {
        this.refine_vertex_pair(vertex, point, pair, skinIndices, skinWeights)
      }
    }
  }

  public blend_shoulders (indices: number[], weights: number[]): void {
    const at = (name: string) => this.bones.find(bone => bone.name === name)
    const chest = at('spine_03'), left = at('upperarm_l'), right = at('upperarm_r')
    if (!chest || !left || !right) return
    const span = Utility.world_position_from_object(left).distanceTo(Utility.world_position_from_object(right))
    const positions = this.geometry.getAttribute('position')
    if (!positions || span < 1e-6) return
    const point = new Vector3(), local = new Vector3()
    for (const side of ['l', 'r']) {
      const upper = at('upperarm_' + side), lower = at('lowerarm_' + side), clavicle = at('clavicle_' + side)
      if (!upper || !lower || !clavicle || upper.parent !== clavicle || lower.parent !== upper) continue
      const joint = Utility.world_position_from_object(upper)
      const axis = Utility.world_position_from_object(lower).sub(joint)
      const length = axis.length()
      if (length < span * .1) continue
      axis.divideScalar(length)
      const ids = [chest, clavicle, upper].map(bone => this.bones.indexOf(bone))
      const radius = Math.min(span * .39, length * .65)
      for (let vertex = 0; vertex < positions.count; vertex++) {
        local.copy(point.fromBufferAttribute(positions, vertex)).sub(joint)
        const along = local.dot(axis)
        const radial = Math.sqrt(Math.max(0, local.lengthSq() - along * along))
        const mask = (1 - this.smoothstep(radius * .83, radius * 1.55, radial)) *
          this.smoothstep(-length * .65, -length * .30, along) *
          (1 - this.smoothstep(length * .26, length * .68, along))
        if (mask < 1e-6) continue
        const base = vertex * 4
        let owned = 0
        for (let slot = 0; slot < 4; slot++) {
          if (ids.includes(indices[base + slot])) owned += weights[base + slot]
        }
        // Keep the original ownership of the region and all nearby neck/head
        // influences. Only replace the split between these three bones.
        if (owned < 1e-6) continue
        const arm = this.smoothstep(-length * .27, length * .38, along)
        const collar = this.smoothstep(-length * .48, length * .06, along)
        const portions = [(1-arm)*(1-collar), (1-arm)*collar, arm]
        const protectedWeights: Array<[number, number]> = []
        const mixed = ids.map((id, i): [number, number] => [id, owned * mask * portions[i]])
        for (let slot = 0; slot < 4; slot++) {
          const id = indices[base + slot]
          const weight = weights[base + slot]
          if (weight <= 0) continue
          const localSlot = ids.indexOf(id)
          if (localSlot >= 0) mixed[localSlot][1] += weight * (1-mask)
          else protectedWeights.push([id, weight])
        }
        // The four-slot limit applies to the blend, including when it adds a
        // third local bone. Never let that new entry displace the neck or head.
        const available = 4 - protectedWeights.length
        if (available < 2) continue
        const localWeights = continuous_skin_weights(mixed, available)
        const sorted = protectedWeights.concat(localWeights.map(([id, ratio]) => [id, owned * ratio]))
          .sort((a, b) => b[1] - a[1])
        for (let slot = 0; slot < 4; slot++) {
          indices[base + slot] = sorted[slot]?.[0] ?? 0
          weights[base + slot] = sorted[slot]?.[1] ?? 0
        }
      }
    }
  }

  private build_joint_pairs (soften: boolean): JointPair[] {
    const result: JointPair[] = []

    for (const side of ['l', 'r'] as const) {
      for (const [parentRole, childRole] of [['upperarm', 'lowerarm'], ['thigh', 'calf']] as const) {
        const parentIndex = this.find_bone_index(parentRole, side)
        const childIndex = this.find_bone_index(childRole, side)
        if (parentIndex < 0 || childIndex < 0) continue
        const parent = this.bones[parentIndex], child = this.bones[childIndex]
        const tip = this.first_deform_child(child)
        if (child.parent !== parent || tip === null) continue
        const parentPoint = Utility.world_position_from_object(parent)
        const joint = Utility.world_position_from_object(child)
        const childPoint = Utility.world_position_from_object(tip)
        const reference = Math.min(parentPoint.distanceTo(joint), joint.distanceTo(childPoint))
        if (reference <= 1e-5) continue
        // The wider full-rig gradient reaches the outside of the arm and calf
        // while keeping the split local to the same two bones.
        result.push({ parentIndex, childIndex, joint, parentPoint, childPoint,
          halfWidth: reference * (soften ? 0.22 : 0.18),
          radius: reference * (soften ? 0.50 : 0.42) })
      }
    }

    return result
  }

  private refine_vertex_pair (
    vertex: number,
    point: Vector3,
    pair: JointPair,
    skinIndices: number[],
    skinWeights: number[]
  ): void {
    const offset = vertex * 4

    let parentSlot = -1
    let childSlot = -1
    let parentWeight = 0
    let childWeight = 0

    for (let slot = 0; slot < 4; slot++) {
      const bone = skinIndices[offset + slot]
      const weight = skinWeights[offset + slot] ?? 0

      if (bone === pair.parentIndex && weight > 0) {
        parentSlot = slot
        parentWeight += weight
      } else if (bone === pair.childIndex && weight > 0) {
        childSlot = slot
        childWeight += weight
      }
    }

    // Never create a torso->arm assignment out of nothing. At least one member
    // of this real joint pair must already own a meaningful amount of the vertex.
    const pairWeight = parentWeight + childWeight
    if (pairWeight < 0.12) return

    const incoming = pair.joint.clone().sub(pair.parentPoint)
    const outgoing = pair.childPoint.clone().sub(pair.joint)
    if (incoming.lengthSq() <= 1e-10 || outgoing.lengthSq() <= 1e-10) return

    incoming.normalize()
    outgoing.normalize()

    // Bisector gives a stable joint axis for both straight T-pose arms and bent
    // A-pose arms. If the two segments nearly cancel, use the outgoing segment.
    const axis = incoming.clone().add(outgoing)
    if (axis.lengthSq() <= 1e-8) axis.copy(outgoing)
    axis.normalize()

    const rel = point.clone().sub(pair.joint)
    const signed = rel.dot(axis)

    // Work only near the physical joint. This avoids flattening the whole limb.
    if (Math.abs(signed) > pair.halfWidth * 1.6) return

    const radial = rel.clone().addScaledVector(axis, -signed).length()
    if (radial > pair.radius) return

    // Smoothstep from parent side -> child side.
    const t = this.smoothstep(
      -pair.halfWidth,
      pair.halfWidth,
      signed
    )

    const strength = (1 - this.smoothstep(pair.halfWidth, pair.halfWidth * 1.6, Math.abs(signed))) *
      (1 - this.smoothstep(pair.radius * 0.75, pair.radius, radial))
    const desiredParent = parentWeight + (pairWeight * (1 - t) - parentWeight) * strength
    const desiredChild = pairWeight - desiredParent
    if (Math.abs(desiredParent - parentWeight) < 1e-8) return

    // Ensure both slots exist while keeping all unrelated influences untouched.
    if (parentSlot < 0) {
      parentSlot = this.find_reusable_slot(offset, skinWeights)
      if (parentSlot < 0) return
      skinIndices[offset + parentSlot] = pair.parentIndex
    }

    if (childSlot < 0) {
      childSlot = this.find_reusable_slot(offset, skinWeights)
      if (childSlot < 0) return
      skinIndices[offset + childSlot] = pair.childIndex
    }

    skinWeights[offset + parentSlot] = desiredParent
    skinWeights[offset + childSlot] = desiredChild

    this.normalize_vertex(offset, skinWeights)
  }

  private find_reusable_slot (
    offset: number,
    skinWeights: number[]
  ): number {
    for (let slot = 0; slot < 4; slot++) {
      if ((skinWeights[offset + slot] ?? 0) <= 1e-6) return slot
    }

    return -1
  }

  private normalize_vertex (offset: number, skinWeights: number[]): void {
    let total = 0
    for (let slot = 0; slot < 4; slot++) total += skinWeights[offset + slot] ?? 0
    if (total <= 1e-8) return
    for (let slot = 0; slot < 4; slot++) skinWeights[offset + slot] /= total
  }

  private first_deform_child (bone: Bone): Bone | null {
    return (bone.children.find((child) =>
      (child as any).isBone === true && !Utility.is_leaf_bone(child as Bone)
    ) as Bone | undefined) ?? null
  }

  private find_bone_index (role: 'upperarm' | 'lowerarm' | 'thigh' | 'calf', side: 'l' | 'r'): number {
    const aliases: Record<typeof role, Record<typeof side, string[]>> = {
      upperarm: {
        l: ['upperarm_l', 'leftarm', 'leftupperarm', 'mixamorigleftarm'],
        r: ['upperarm_r', 'rightarm', 'rightupperarm', 'mixamorigrightarm']
      },
      lowerarm: {
        l: ['lowerarm_l', 'forearm_l', 'leftforearm', 'leftlowerarm', 'mixamorigleftforearm'],
        r: ['lowerarm_r', 'forearm_r', 'rightforearm', 'rightlowerarm', 'mixamorigrightforearm']
      },
      thigh: {
        l: ['thigh_l', 'leftupleg', 'leftupperleg', 'mixamorigleftupleg'],
        r: ['thigh_r', 'rightupleg', 'rightupperleg', 'mixamorigrightupleg']
      },
      calf: {
        l: ['calf_l', 'shin_l', 'leftleg', 'leftlowerleg', 'mixamorigleftleg'],
        r: ['calf_r', 'shin_r', 'rightleg', 'rightlowerleg', 'mixamorigrightleg']
      }
    }

    const wanted = new Set(aliases[role][side].map((name) => this.normalize_name(name)))

    return this.bones.findIndex((bone) => {
      const normalized = this.normalize_name(bone.name)
      return wanted.has(normalized) ||
        [...wanted].some((alias) => normalized.endsWith(alias))
    })
  }

  private normalize_name (name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  private smoothstep (edge0: number, edge1: number, value: number): number {
    if (edge1 <= edge0) return value >= edge1 ? 1 : 0
    const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
    return x * x * (3 - 2 * x)
  }
}
