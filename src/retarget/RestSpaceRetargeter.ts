import { AnimationClip, Object3D, Quaternion, Vector3, type KeyframeTrack } from 'three'

export interface BoneRestSpace {
  position: Vector3
  scale: Vector3
  world_rotation: Quaternion
  parent_rotation: Quaternion
}

/** Rest-relative rotations for non-human chains. Does not infer missing anatomy. */
export class RestSpaceRetargeter {
  public static capture (root: Object3D): Map<string, BoneRestSpace> {
    root.updateWorldMatrix(true, true)
    const result = new Map<string, BoneRestSpace>()
    root.traverse(object => {
      if (!object.name) return
      result.set(object.name, {
        position: object.position.clone(), scale: object.scale.clone(),
        world_rotation: object.getWorldQuaternion(new Quaternion()).normalize(),
        parent_rotation: object.parent?.getWorldQuaternion(new Quaternion()).normalize() ?? new Quaternion()
      })
    })
    return result
  }

  public static retarget (clip: AnimationClip, source: ReadonlyMap<string, BoneRestSpace>,
    target: ReadonlyMap<string, BoneRestSpace>, target_to_source: ReadonlyMap<string, string>): AnimationClip {
    const ratios: number[] = []
    for (const [to, from] of target_to_source) {
      const a = source.get(from)?.position.length() ?? 0
      const b = target.get(to)?.position.length() ?? 0
      if (a > 1e-5 && b > 1e-5) ratios.push(b / a)
    }
    ratios.sort((a, b) => a - b)
    const motion_scale = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1
    const tracks: KeyframeTrack[] = []
    for (const track of clip.tracks) {
      const match = track.name.match(/^(?:.*\.bones\[([^\]]+)\]|([^.]+))\.(quaternion|position|scale)$/)
      if (!match) continue
      const from = match[1] ?? match[2]
      const property = match[3]
      const a = source.get(from)
      if (!a) continue
      for (const [to, mapped] of target_to_source) {
        const b = target.get(to)
        if (mapped !== from || !b) continue
        const output = track.clone()
        output.name = `${to}.${property}`
        const stride = property === 'quaternion' ? 4 : 3
        const cubic = output.values.length === output.times.length * stride * 3
        const parent_change = b.parent_rotation.clone().invert().multiply(a.parent_rotation)
        const right = a.world_rotation.clone().invert().multiply(b.world_rotation)
        for (let i = 0; i < output.values.length; i += stride) {
          const tangent = cubic && (i / stride) % 3 !== 1
          if (property === 'quaternion') {
            const q = new Quaternion().fromArray(output.values, i).premultiply(parent_change).multiply(right)
            if (!tangent) q.normalize()
            q.toArray(output.values, i)
          } else {
            const p = new Vector3().fromArray(output.values, i)
            if (property === 'position') {
              if (!tangent) p.sub(a.position)
              p.applyQuaternion(parent_change).multiplyScalar(motion_scale)
              if (!tangent) p.add(b.position)
            } else {
              p.multiply(b.scale).divide(a.scale)
            }
            p.toArray(output.values, i)
          }
        }
        tracks.push(output)
      }
    }
    return new AnimationClip(clip.name, clip.duration, tracks, clip.blendMode)
  }
}
