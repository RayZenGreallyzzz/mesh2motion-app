import { type Bone, Matrix4, Vector3 } from 'three'

/** Fit the whole hand subtree, including its palm roll, to the visible hand. */
export function fit_humanoid_hand (hand: Bone, forearm: Bone, points: readonly Vector3[], height: number): void {
  const fingers: Bone[] = []
  hand.traverse(object => { if ((object as Bone).isBone && object !== hand) fingers.push(object as Bone) })
  const middle = fingers.find(b => b.name.toLowerCase().includes('middle_01'))
  const index = fingers.find(b => b.name.toLowerCase().includes('index_01'))
  const pinky = fingers.find(b => b.name.toLowerCase().includes('pinky_01'))
  if (middle === undefined) return

  hand.updateWorldMatrix(true, true)
  const wrist = hand.getWorldPosition(new Vector3())
  const sourceLong = middle.getWorldPosition(new Vector3()).sub(wrist).normalize()
  const sourceAcross = index !== undefined && pinky !== undefined
    ? index.getWorldPosition(new Vector3()).sub(pinky.getWorldPosition(new Vector3()))
    : new Vector3(0, 0, 1)
  sourceAcross.addScaledVector(sourceLong, -sourceAcross.dot(sourceLong)).normalize()
  if (sourceAcross.lengthSq() < 1e-8) return

  const armDirection = wrist.clone().sub(forearm.getWorldPosition(new Vector3())).normalize()
  const distal: Array<{ point: Vector3, along: number }> = []
  const relative = new Vector3()
  let farthest = 0
  for (const point of points) {
    relative.copy(point).sub(wrist)
    const along = relative.dot(armDirection)
    if (along <= 0 || along > height * 0.2) continue
    if (relative.lengthSq() - along * along > (height * 0.06) ** 2) continue
    distal.push({ point, along })
    farthest = Math.max(farthest, along)
  }
  if (distal.length < 8 || farthest < height * 0.02) return
  const tip = new Vector3(); let tipCount = 0
  for (const sample of distal) {
    if (sample.along < farthest - height * 0.006) continue
    tip.add(sample.point); tipCount++
  }
  tip.multiplyScalar(1 / tipCount)
  const targetLong = tip.clone().sub(wrist).normalize()
  const targetLength = tip.distanceTo(wrist)

  // Palm width is the larger cross-sectional variance. Unlike using the old
  // T-pose fingers, this handles A-pose palms facing forward or toward the legs.
  const across = new Vector3(wrist.x > 0 ? -1 : 1, 0, 0)
  across.addScaledVector(targetLong, -across.dot(targetLong)).normalize()
  if (across.lengthSq() < 1e-8) across.set(0, 1, 0)
  const normal = new Vector3().crossVectors(targetLong, across).normalize()
  let aa = 0; let ab = 0; let bb = 0
  let sumA = 0; let sumB = 0; let count = 0
  for (const sample of distal) {
    relative.copy(sample.point).sub(wrist)
    const along = relative.dot(targetLong)
    if (along < targetLength * 0.2 || along > targetLength * 0.65) continue
    const a = relative.dot(across); const b = relative.dot(normal)
    aa += a * a; ab += a * b; bb += b * b
    sumA += a; sumB += b; count++
  }
  if (count >= 8) {
    aa -= sumA * sumA / count; ab -= sumA * sumB / count; bb -= sumB * sumB / count
    const angle = 0.5 * Math.atan2(2 * ab, aa - bb)
    across.multiplyScalar(Math.cos(angle)).addScaledVector(normal, Math.sin(angle)).normalize()
  }
  const sourceFrame = new Matrix4().makeBasis(sourceLong, sourceAcross, new Vector3().crossVectors(sourceLong, sourceAcross))
  const targetFrame = new Matrix4().makeBasis(targetLong, across, new Vector3().crossVectors(targetLong, across))
  const rotation = targetFrame.multiply(sourceFrame.invert())
  const offsets = fingers.map(b => b.getWorldPosition(new Vector3()).sub(wrist))
  const sourceLength = Math.max(...offsets.map(offset => offset.dot(sourceLong)))
  if (sourceLength <= 1e-8) return
  const scale = Math.max(0.25, Math.min(2, targetLength * 0.88 / sourceLength))
  const targets = offsets.map(offset => offset.applyMatrix4(rotation).multiplyScalar(scale).add(wrist))
  fingers.forEach((bone, index) => {
    if (bone.parent === null) return
    bone.parent.updateWorldMatrix(true, false)
    bone.position.copy(bone.parent.worldToLocal(targets[index]))
    bone.updateWorldMatrix(true, false)
  })
  hand.updateWorldMatrix(true, true)
}
