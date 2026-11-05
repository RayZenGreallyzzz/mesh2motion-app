import { Vector3, type Bone, type BufferGeometry } from 'three'
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

  public apply (skinIndices: number[], skinWeights: number[]): void {
    const pairs = this.build_joint_pairs()
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

  private build_joint_pairs (): JointPair[] {
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
        result.push({ parentIndex, childIndex, joint, parentPoint, childPoint,
          halfWidth: reference * 0.18, radius: reference * 0.42 })
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
