import { type Bone, Quaternion, Vector3 } from 'three'

export interface HandShape {
  direction: Vector3
  offsets: Map<Bone, Vector3>
  length: number
}

/** Keep the complete palm/digit shape when the elbow or wrist is repositioned. */
export function capture_hand_shape (hand: Bone, forearm: Bone): HandShape {
  hand.updateWorldMatrix(true, true)
  const origin = hand.getWorldPosition(new Vector3())
  const direction = origin.clone().sub(forearm.getWorldPosition(new Vector3())).normalize()
  const offsets = new Map<Bone, Vector3>()
  let length = 0
  hand.traverse(object => {
    if (object === hand || object.type !== 'Bone') return
    const offset = object.getWorldPosition(new Vector3()).sub(origin)
    offsets.set(object as Bone, offset)
    length = Math.max(length, offset.dot(direction))
  })
  return { direction, offsets, length }
}

export function place_hand_shape (hand: Bone, shape: HandShape, direction: Vector3, scale = 1): void {
  if (direction.lengthSq() < 1e-10 || shape.direction.lengthSq() < 1e-10) return
  const swing = new Quaternion().setFromUnitVectors(shape.direction, direction.clone().normalize())
  const origin = hand.getWorldPosition(new Vector3())
  // Traversal order is parent first. Every target is calculated from the saved
  // shape, not the already-moved parent, so repeated A/T changes cannot drift.
  for (const [bone, offset] of shape.offsets) {
    if (bone.parent === null) continue
    bone.parent.updateWorldMatrix(true, false)
    const target = offset.clone().multiplyScalar(scale).applyQuaternion(swing).add(origin)
    bone.position.copy(bone.parent.worldToLocal(target))
    bone.updateWorldMatrix(false, false)
  }
  hand.updateWorldMatrix(true, true)
}
