import { Matrix4, Quaternion, Vector3, type Bone, type Object3D } from 'three'
import { CreatureVolume } from './CreatureVolume.ts'

/** Repair unsupported pivots on the actual body before estimating limb bends.
 * Keep the template's orientation basis and the positions of downstream bones. */
export function fit_humanoid_body_volume (
  model: Object3D, bones: Bone[], frame: Object3D | null, height: number
): CreatureVolume {
  const inverse = frame?.matrixWorld.clone().invert() ?? new Matrix4()
  const volume = new CreatureVolume(model, frame, new Quaternion(), [], 144)
  const get = (name: string) => bones.find(bone => bone.name === name)!
  const at = (bone: Bone) => bone.getWorldPosition(new Vector3()).applyMatrix4(inverse)
  const move = (bone: Bone, fitted: Vector3) => {
    const children = bone.children.map(child => ({ child, position: child.getWorldPosition(new Vector3()) }))
    const point = frame ? fitted.clone().applyMatrix4(frame.matrixWorld) : fitted.clone()
    bone.position.copy(bone.parent ? bone.parent.worldToLocal(point) : point)
    bone.updateWorldMatrix(true, true)
    for (const { child, position } of children) child.position.copy(bone.worldToLocal(position))
    bone.updateWorldMatrix(true, true)
  }
  const pelvis = get('pelvis'), midline = at(pelvis).x
  const repair = (
    bone: Bone, seed: Vector3, minClearance: number, range: Vector3, centre = false,
    accept: (point: Vector3) => boolean = () => true
  ) => {
    if (volume.clearance(at(bone)) >= minClearance) return
    const id = volume.select((p, clearance) => {
      if (clearance < minClearance || Math.abs(p.x - seed.x) > range.x ||
        Math.abs(p.y - seed.y) > range.y || Math.abs(p.z - seed.z) > range.z || !accept(p)) return -Infinity
      if (!centre) return -p.distanceToSquared(seed)
      return Math.min(clearance, height * .04) - Math.hypot(p.x - seed.x, p.y - seed.y, (p.z - seed.z) * .4)
    })
    if (id >= 0) move(bone, volume.point(id))
  }
  const step = volume.step
  repair(pelvis, at(pelvis), step * 3, new Vector3(step * .51, height * .075, height * .20), true)
  for (const name of ['spine_01', 'spine_02', 'spine_03']) {
    const bone = get(name)
    repair(bone, at(bone), step * 3, new Vector3(step * .51, step * .51, height * .17), true)
  }
  for (const side of ['l', 'r']) {
    const thigh = get('thigh_' + side), shoulder = get('upperarm_' + side)
    repair(thigh, at(thigh), step * 3, new Vector3(height * .021, height * .025, height * .15), true)
    const seed = at(shoulder)
    if (volume.clearance(seed) >= step) continue

    // Find the lateral edge of the torso in the section under the arm.
    // Only the span linked to the centre counts; an arm, sleeve or hair
    // separated from the torso by air cannot extend this span.
    const elbow = at(get('lowerarm_' + side)), sign = Math.sign(elbow.x - midline)
    const torsoY = Math.min(seed.y, elbow.y + height * .035) - height * .062
    let edge = 0
    for (let x = step * .5; x < Math.abs(elbow.x - midline) * .65; x += step) {
      const sample = new Vector3(midline + x * sign, torsoY, seed.z)
      const occupied = [0, -1, 1, -2, 2].some(offset => {
        sample.z = seed.z + offset * step
        return volume.clearance(sample) >= step * 2
      })
      if (!occupied) break
      edge = x
    }
    const reach = Math.abs(seed.x - midline)
    const lateral = Math.min(edge + step, reach + height * .040, Math.abs(elbow.x - midline) - height * .075)
    if (lateral > reach) seed.x = midline + sign * lateral
    repair(shoulder, seed, step * 2, new Vector3(height * .026, height * .054, height * .10), false,
      p => (p.x - midline) * sign >= reach - step * .5)
  }
  return volume
}
