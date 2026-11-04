import { type AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three'

export interface HumanoidRestJoint {
  position: Vector3
  quaternion: Quaternion
  parent_name?: string
}

/**
 * Match anatomical segment directions after the user edits joint positions.
 * The editor deliberately preserves authored Bone rotations. The child offset
 * is therefore the real segment axis; rest quaternions alone cannot describe an
 * A/T change. C maps the fitted local axis back to the library local axis.
 * Qtarget = inverse(Cparent) * Qsource * Cbone. This is constant per key, not a
 * per-frame IK solver. It keeps the fitted lengths and source motion directions.
 */
export class HumanoidClipCalibration {
  private readonly corrections = new Map<string, Quaternion>()
  private readonly rest_rotations = new Map<string, { left: Quaternion, right: Quaternion }>()
  private readonly has_authored_rotations: boolean
  private readonly motion_scale: number

  public constructor (
    private readonly source: ReadonlyMap<string, HumanoidRestJoint>,
    private readonly target: ReadonlyMap<string, HumanoidRestJoint>
  ) {
    this.has_authored_rotations = [...source].some(([name, joint]) => {
      const fitted = target.get(name)
      return fitted !== undefined && 1 - Math.abs(joint.quaternion.dot(fitted.quaternion)) > 1e-8
    })
    if (this.has_authored_rotations) {
      const source_world = rest_world_rotations(source)
      const target_world = rest_world_rotations(target)
      for (const [name, fitted] of target) {
        const original = source.get(name)
        if (!original) continue
        const left = (target_world.get(fitted.parent_name ?? '')?.clone() ?? new Quaternion()).invert()
          .multiply(source_world.get(original.parent_name ?? '') ?? new Quaternion())
        const right = source_world.get(name)!.clone().invert().multiply(target_world.get(name)!)
        this.rest_rotations.set(name, { left, right })
      }
    }
    for (const name of this.has_authored_rotations ? [] : target.keys()) {
      const children = [...source.entries()].filter(([child, rest]) => rest.parent_name === name && target.has(child))
      const preferred = children.find(([child]) => /^(spine_01|neck|middle_01_[lr])$/.test(child))
        ?? children.find(([child]) => !/clavicle|thumb|thigh/.test(child)) ?? children[0]
      const correction = new Quaternion()
      if (name !== 'root' && preferred) {
        const from = preferred[1].position
        const to = target.get(preferred[0])!.position
        if (from.lengthSq() > 1e-10 && to.lengthSq() > 1e-10) {
          correction.setFromUnitVectors(to.clone().normalize(), from.clone().normalize())
        }
      }
      this.corrections.set(name, correction)
    }
    const leg_length = (rest: ReadonlyMap<string, HumanoidRestJoint>): number =>
      ['calf_l', 'foot_l', 'calf_r', 'foot_r'].reduce((sum, name) => sum + (rest.get(name)?.position.length() ?? 0), 0)
    const source_leg = leg_length(source), target_leg = leg_length(target)
    this.motion_scale = source_leg > 1e-5 && target_leg > 1e-5 ? target_leg / source_leg : 1
  }

  public apply (clip: AnimationClip, skeleton_scale: number): void {
    const animated = new Set<string>()
    const rotation_value = new Quaternion(), position_value = new Vector3()
    for (const track of clip.tracks) {
      const match = track.name.match(/^(?:.*\.bones\[([^\]]+)\]|([^.]+))\.(quaternion|position)$/)
      if (!match) continue
      const name = match[1] ?? match[2], property = match[3]
      const source = this.source.get(name), target = this.target.get(name)
      if (!source || !target) continue
      const rest_rotation = this.rest_rotations.get(name)
      const left = rest_rotation?.left ?? this.parent_correction(name).invert()
      const right = rest_rotation?.right ?? this.corrections.get(name) ?? new Quaternion()
      const stride = property === 'quaternion' ? 4 : 3
      const cubic = track.values.length === track.times.length * stride * 3
      if (property === 'quaternion') animated.add(name)
      for (let i = 0; i < track.values.length; i += stride) {
        const tangent = cubic && (i / stride) % 3 !== 1
        if (property === 'quaternion') {
          const value = rotation_value.fromArray(track.values, i).premultiply(left).multiply(right)
          if (!tangent) value.normalize()
          value.toArray(track.values, i)
        } else {
          const value = position_value.fromArray(track.values, i)
          if (!tangent) value.addScaledVector(source.position, -skeleton_scale)
          value.applyQuaternion(left).multiplyScalar(this.motion_scale / Math.max(skeleton_scale, 1e-8))
          if (!tangent) value.add(target.position)
          value.toArray(track.values, i)
        }
      }
    }
    if (this.has_authored_rotations) return
    // An unanimated child still needs its parent's basis change cancelled.
    // Otherwise fixing an upper arm rotates the wrist/fingers a second time.
    for (const [name, target] of this.target) {
      if (animated.has(name)) continue
      const source = this.source.get(name)
      if (!source) continue
      const rotation = source.quaternion.clone().premultiply(this.parent_correction(name).invert())
        .multiply(this.corrections.get(name) ?? new Quaternion()).normalize()
      if (rotation.angleTo(target.quaternion) > 1e-6) {
        clip.tracks.push(new QuaternionKeyframeTrack(name + '.quaternion', [0], rotation.toArray()))
      }
    }
  }

  private parent_correction (name: string): Quaternion {
    return this.corrections.get(this.source.get(name)?.parent_name ?? '')?.clone() ?? new Quaternion()
  }
}

// Transfer each animated change in world rest space while preserving the target's bone roll.
function rest_world_rotations (rest: ReadonlyMap<string, HumanoidRestJoint>): Map<string, Quaternion> {
  const rotations = new Map<string, Quaternion>()
  const visit = (name: string): Quaternion => {
    const cached = rotations.get(name)
    if (cached) return cached
    const joint = rest.get(name)!
    const world = joint.parent_name && rest.has(joint.parent_name)
      ? visit(joint.parent_name).clone().multiply(joint.quaternion)
      : joint.quaternion.clone()
    rotations.set(name, world)
    return world
  }
  for (const name of rest.keys()) visit(name)
  return rotations
}
