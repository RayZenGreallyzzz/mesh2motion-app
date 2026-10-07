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
 * Refines humanoid shoulder and elbow deformation after surface/geodesic skinning.
 *
 * The surface solver is excellent at keeping influence on the correct connected
 * surface, but its exponential distance field can make a joint transition too
 * abrupt. This pass does NOT invent new arm influence on torso/clothing. It only
 * redistributes the weight that the two bones in a real parent->child pair already
 * own, inside a compact capsule around the joint.
 *
 * That gives predictable shoulder/elbow gradients while preserving geodesic
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
      const upperIndex = this.find_bone_index('upperarm', side)
      const lowerIndex = this.find_bone_index('lowerarm', side)

      if (upperIndex >= 0 && lowerIndex >= 0) {
        const upper = this.bones[upperIndex]
        const lower = this.bones[lowerIndex]
        const hand = this.first_deform_child(lower)

        if (hand !== null) {
          const shoulder = Utility.world_position_from_object(upper)
          const elbow = Utility.world_position_from_object(lower)
          const wrist = Utility.world_position_from_object(hand)

          const upperLength = shoulder.distanceTo(elbow)
          const lowerLength = elbow.distanceTo(wrist)
          const reference = Math.max(0.001, Math.min(upperLength, lowerLength))

          result.push({
            parentIndex: upperIndex,
            childIndex: lowerIndex,
            joint: elbow,
            parentPoint: shoulder,
            childPoint: wrist,
            halfWidth: reference * 0.18,
            radius: reference * 0.42
          })
        }
      }

      // The actual shoulder transition is clavicle/shoulder -> upperarm.
      // Prefer the real Bone parent so custom naming still follows hierarchy.
      if (upperIndex >= 0) {
        const upper = this.bones[upperIndex]
        const parent = upper.parent instanceof Object && (upper.parent as any).isBone === true
          ? upper.parent as Bone
          : null

        if (parent !== null) {
          const parentIndex = this.bones.indexOf(parent)
          const lower = this.first_deform_child(upper)

          if (parentIndex >= 0 && lower !== null) {
            const parentPoint = Utility.world_position_from_object(parent)
            const shoulder = Utility.world_position_from_object(upper)
            const elbow = Utility.world_position_from_object(lower)

            const clavicleLength = Math.max(0.001, parentPoint.distanceTo(shoulder))
            const upperLength = Math.max(0.001, shoulder.distanceTo(elbow))
            const reference = Math.min(Math.max(clavicleLength, upperLength * 0.35), upperLength)

            result.push({
              parentIndex,
              childIndex: upperIndex,
              joint: shoulder,
              parentPoint,
              childPoint: elbow,
              halfWidth: Math.max(upperLength * 0.11, reference * 0.22),
              radius: Math.max(upperLength * 0.30, reference * 0.55)
            })
          }
        }
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

    const desiredParent = pairWeight * (1 - t)
    const desiredChild = pairWeight * t

    // Ensure both slots exist while keeping all unrelated influences untouched.
    if (parentSlot < 0) {
      parentSlot = this.find_reusable_slot(offset, pair.childIndex, skinIndices, skinWeights)
      if (parentSlot < 0) return
      skinIndices[offset + parentSlot] = pair.parentIndex
    }

    if (childSlot < 0) {
      childSlot = this.find_reusable_slot(offset, pair.parentIndex, skinIndices, skinWeights)
      if (childSlot < 0) return
      skinIndices[offset + childSlot] = pair.childIndex
    }

    skinWeights[offset + parentSlot] = desiredParent
    skinWeights[offset + childSlot] = desiredChild

    this.normalize_vertex(offset, skinWeights)
  }

  private find_reusable_slot (
    offset: number,
    protectedBone: number,
    skinIndices: number[],
    skinWeights: number[]
  ): number {
    for (let slot = 0; slot < 4; slot++) {
      if ((skinWeights[offset + slot] ?? 0) <= 1e-6) return slot
    }

    let smallestSlot = -1
    let smallestWeight = Infinity

    for (let slot = 0; slot < 4; slot++) {
      if (skinIndices[offset + slot] === protectedBone) continue
      const weight = skinWeights[offset + slot] ?? 0
      if (weight < smallestWeight && weight < 0.08) {
        smallestWeight = weight
        smallestSlot = slot
      }
    }

    return smallestSlot
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

  private find_bone_index (role: 'upperarm' | 'lowerarm', side: 'l' | 'r'): number {
    const aliases: Record<typeof role, Record<typeof side, string[]>> = {
      upperarm: {
        l: ['upperarm_l', 'leftarm', 'leftupperarm', 'mixamorigleftarm'],
        r: ['upperarm_r', 'rightarm', 'rightupperarm', 'mixamorigrightarm']
      },
      lowerarm: {
        l: ['lowerarm_l', 'forearm_l', 'leftforearm', 'leftlowerarm', 'mixamorigleftforearm'],
        r: ['lowerarm_r', 'forearm_r', 'rightforearm', 'rightlowerarm', 'mixamorigrightforearm']
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
