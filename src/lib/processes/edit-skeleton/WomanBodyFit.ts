import { type Bone, type Object3D, Matrix4, Vector3, MathUtils } from 'three'
import { capture_hand_shape, place_hand_shape } from './HandPose.ts'

const quantile = (values: number[], q: number): number => {
  values.sort((a, b) => a - b)
  return values[Math.floor((values.length - 1) * q)]
}

/** Explicit Woman profile: locate the limb behind the anterior breast volume.
 * Preserve the human hierarchy and local rotation basis for existing motions.
 * Points and joint placement use the same editor setup frame.
 */
export function refine_woman_rig(points: readonly Vector3[], bones: Bone[], frame: Object3D | null): void {
  if (points.length < 32) return
  for (const bone of bones) delete bone.userData.rigFitWarning
  const inverse = frame?.matrixWorld.clone().invert() ?? new Matrix4()
  const at = (bone: Bone) => bone.getWorldPosition(new Vector3()).applyMatrix4(inverse)
  const byName = (name: string) => bones.find(b => b.name === name)
  const pelvis = byName('pelvis'), chest = byName('spine_03')
  const left = byName('upperarm_l'), right = byName('upperarm_r')
  if (!pelvis || !chest || !left || !right) return
  let minY = Infinity, maxY = -Infinity
  for (const p of points) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y) }
  const h = maxY - minY, cx = at(pelvis).x
  if (h < 1e-6) return
  const place = (bone: Bone, p: Vector3) => {
    bone.parent?.updateWorldMatrix(true, false)
    const world = frame ? p.clone().applyMatrix4(frame.matrixWorld) : p.clone()
    bone.position.copy(bone.parent ? bone.parent.worldToLocal(world) : world)
    bone.updateWorldMatrix(true, true)
  }
  // Cache descendants before repositioning their torso parents.
  const arms = ['l', 'r'].flatMap(side => {
    const upper = byName('upperarm_' + side), elbow = byName('lowerarm_' + side), hand = byName('hand_' + side), clavicle = byName('clavicle_' + side)
    if (!upper || !elbow || !hand || !clavicle) return []
    return [{ upper, elbow, hand, clavicle, shoulder: at(upper), fore: at(elbow), wrist: at(hand), shape: capture_hand_shape(hand, elbow) }]
  })
  const chestY = at(chest).y
  const neck = bones.find(b => /^neck(?:_\d+)?$/.test(b.name))
  const neckPosition = neck ? at(neck) : null
  const waist = points.filter(p => Math.abs(p.x - cx) < h * .07 && Math.abs(p.y - (chestY - h * .12)) < h * .025)
  const waistDepth = waist.length >= 12
    ? MathUtils.clamp(quantile(waist.map(p => p.z), .88) - quantile(waist.map(p => p.z), .12), h * .055, h * .12)
    : h * .085
  for (const bone of bones.filter(b => /^spine_\d+$/.test(b.name))) {
    const p = at(bone), slice = points.filter(v => Math.abs(v.x - cx) < h * .075 && Math.abs(v.y - p.y) < h * .02)
    if (slice.length < 12) continue
    const back = quantile(slice.map(v => v.z), .12), front = quantile(slice.map(v => v.z), .88)
    p.z = back + Math.min(front - back, waistDepth) * .5
    place(bone, p)
  }
  const chestPosition = at(chest)
  if (neck && neckPosition) place(neck, neckPosition)
  const rib = points.filter(p => Math.abs(p.y - (chestY - h * .025)) < h * .02 && Math.abs(p.x - cx) < h * .15)
  const backLimit = rib.length ? quantile(rib.map(p => p.z), .45) : chestPosition.z
  const backRib = rib.filter(p => p.z <= backLimit)
  const shoulderHalf = MathUtils.clamp((backRib.length >= 12 ? quantile(backRib.map(p => Math.abs(p.x - cx)), .90) : h * .09) + h * .015, h * .09, h * .135)
  for (const arm of arms) {
    const sign = Math.sign(arm.shoulder.x - cx) || 1
    const section = (x: number, fallback: Vector3, restrict: boolean): Vector3 => {
      let samples: Vector3[] = []
      for (const radius of [h * .012, h * .024]) {
        samples = points.filter(p => Math.abs(p.x - x) < radius && p.y > minY + h * .42 &&
          Math.abs(p.y - fallback.y) < h * .08 && (!restrict || Math.abs(p.z - fallback.z) < h * .055))
        if (samples.length >= 10) break
      }
      if (samples.length < 6) return new Vector3(x, fallback.y, fallback.z)
      const mid = (axis: 'y' | 'z') => (quantile(samples.map(p => p[axis]), .12) + quantile(samples.map(p => p[axis]), .88)) * .5
      return new Vector3(x, mid('y'), mid('z'))
    }
    const x0 = cx + sign * shoulderHalf
    const direction = arm.wrist.clone().sub(arm.shoulder)
    const guess = (x: number) => arm.shoulder.clone().addScaledVector(direction, (x - arm.shoulder.x) / (direction.x || sign * h * .1))
    const x1 = x0 + sign * h * .045, x2 = x0 + sign * h * .105
    const a = section(x1, guess(x1), false), b = section(x2, guess(x2), false)
    const axis = b.clone().sub(a)
    const shoulder = a.clone().addScaledVector(axis, (x0 - x1) / (x2 - x1))
    // Exclude the lower/front breast root from the shoulder socket sample.
    const nearby = points.filter(p => Math.abs(p.x - x0) < h * .014 && Math.abs(p.y - shoulder.y) < h * .035 && Math.abs(p.z - shoulder.z) < h * .045)
    if (nearby.length >= 10) {
      shoulder.y = (quantile(nearby.map(p => p.y), .12) + quantile(nearby.map(p => p.y), .88)) * .5
      shoulder.z = (quantile(nearby.map(p => p.z), .12) + quantile(nearby.map(p => p.z), .88)) * .5
    }
    const elbow = section(arm.fore.x, arm.fore.clone().setZ(a.z), true)
    const wrist = section(arm.wrist.x, arm.wrist.clone().setZ(b.z), true)
    // Steep A poses cross the rib slice with the arm. That slice estimates the
    // chest/arm outline, not the shoulder socket. Find the posterior shoulder
    // cap above it and centre the descending arm using horizontal sections.
    if (arm.wrist.y < chestY - h * .10 && shoulder.y < chestY + h * .035) {
      const cap = points.filter(p => {
        const x = sign * (p.x - cx)
        return x > h * .065 && x < h * .16 && p.y > chestY &&
          p.y < Math.min(minY + h * .85, neckPosition?.y ?? Infinity) &&
          p.z > chestPosition.z - waistDepth * .8 && p.z < chestPosition.z + waistDepth * .45
      })
      if (cap.length >= 16) {
        const top = quantile(cap.map(p => p.y), .94)
        const crown = cap.filter(p => p.y > top - h * .035)
        shoulder.set((quantile(crown.map(p => p.x), .2) + quantile(crown.map(p => p.x), .8)) * .5,
          top - h * .022, (quantile(crown.map(p => p.z), .12) + quantile(crown.map(p => p.z), .88)) * .5)
        const descending = (target: Vector3, original: Vector3, bone: Bone) => {
          const slice = points.filter(p => Math.abs(p.y - original.y) < h * .012 &&
            Math.abs(p.x - original.x) < h * .07 && sign * (p.x - cx) > h * .08 && Math.abs(p.z - shoulder.z) < h * .065)
          if (slice.length < 8) { bone.userData.rigFitWarning = true; return }
          const lo = quantile(slice.map(p => p.x), .12), hi = quantile(slice.map(p => p.x), .88)
          if (hi - lo > h * .14) { bone.userData.rigFitWarning = true; return }
          target.set((lo + hi) * .5, original.y, (quantile(slice.map(p => p.z), .12) + quantile(slice.map(p => p.z), .88)) * .5)
        }
        descending(elbow, elbow.clone(), arm.elbow); descending(wrist, wrist.clone(), arm.hand)
      } else arm.upper.userData.rigFitWarning = true
    }
    place(arm.clavicle, new Vector3(cx + (shoulder.x - cx) * .55, shoulder.y, chestPosition.z * .45 + shoulder.z * .55))
    place(arm.upper, shoulder); place(arm.elbow, elbow); place(arm.hand, wrist)
    place_hand_shape(arm.hand, arm.shape, arm.hand.getWorldPosition(new Vector3()).sub(arm.elbow.getWorldPosition(new Vector3())))
  }
}
