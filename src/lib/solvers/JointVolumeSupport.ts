import {
  type AnimationClip, Bone, type BufferGeometry, InterpolateDiscrete,
  type Interpolant, type KeyframeTrack, Quaternion, QuaternionKeyframeTrack, Skeleton, Vector3
} from 'three'

interface SupportData {
  version: number
  source: string
  rest: number[]
}

/** Four ordinary deform bones keep the elbow/knee cross-section at half bend.
 * Unlike a renderer-only skinning shader, these weights and animation tracks
 * survive GLB/FBX export. The editable rig and original bone indices stay intact.
 */
export class JointVolumeSupport {
  public static isSupportBone (bone: Bone): boolean {
    const data = bone.userData.rigJointVolume as SupportData | undefined
    return data?.version === 1 && typeof data.source === 'string' && data.rest?.length === 4
  }

  public static addToSkeleton (skeleton: Skeleton): Skeleton {
    const bones = [...skeleton.bones]
    for (const child of skeleton.bones) {
      const parent = child.parent as Bone | null
      if (!parent?.isBone) continue
      const name_lower = child.name.toLowerCase()
      const parent_lower = parent.name.toLowerCase()
      const human = /^(lowerarm|forearm)_[lr]$/.test(name_lower) && /^upperarm_[lr]$/.test(parent_lower) ||
        /^(calf|shin)_[lr]$/.test(name_lower) && /^thigh_[lr]$/.test(parent_lower)
      const animal = /leg/.test(parent_lower) && /leg.*lower|lowerleg|leg.*ankle|ankleleg|^(front|back)_ankle|^leg_[a-d]_[23]/.test(name_lower)
      if (!human && !animal) continue
      const name = `rig_volume_${child.name}`
      if (bones.some(bone => bone.name === name)) continue
      const support = new Bone()
      support.name = name
      support.position.copy(child.position)
      support.quaternion.copy(child.quaternion)
      support.userData.rigJointVolume = {
        version: 1, source: child.name, rest: child.quaternion.toArray()
      } satisfies SupportData
      parent.add(support)
      support.updateWorldMatrix(true, false)
      bones.push(support)
    }
    if (bones.length === skeleton.bones.length) return skeleton
    return new Skeleton(bones)
  }

  public static applyWeights (
    geometry: BufferGeometry, skeleton: Skeleton, indices: number[], weights: number[]
  ): void {
    const positions = geometry.getAttribute('position')
    const point = new Vector3()
    for (const support of skeleton.bones.filter(bone => this.isSupportBone(bone))) {
      const data = support.userData.rigJointVolume as SupportData
      const child = skeleton.bones.find(bone => bone.name === data.source)
      const parent = support.parent as Bone
      const tip = child?.children.find(bone => bone instanceof Bone && !this.isSupportBone(bone))
      if (child === undefined || tip === undefined) continue
      const parent_index = skeleton.bones.indexOf(parent)
      const child_index = skeleton.bones.indexOf(child)
      const support_index = skeleton.bones.indexOf(support)
      const joint = child.getWorldPosition(new Vector3())
      const incoming = joint.clone().sub(parent.getWorldPosition(new Vector3()))
      const outgoing = tip.getWorldPosition(new Vector3()).sub(joint)
      const length = Math.min(incoming.length(), outgoing.length())
      if (length < 1e-5) continue
      const axis = incoming.normalize().add(outgoing.normalize()).normalize()
      if (axis.lengthSq() < 0.5) continue

      for (let vertex = 0; vertex < positions.count; vertex++) {
        const offset = vertex * 4
        let parent_slot = -1
        let child_slot = -1
        for (let slot = 0; slot < 4; slot++) {
          if (indices[offset + slot] === parent_index && weights[offset + slot] > 0) parent_slot = slot
          if (indices[offset + slot] === child_index && weights[offset + slot] > 0) child_slot = slot
        }
        if (parent_slot < 0 || child_slot < 0) continue
        const parent_weight = weights[offset + parent_slot]
        const child_weight = weights[offset + child_slot]
        const total = parent_weight + child_weight
        // Do not pull torso, adjacent limbs or manually rigid-painted vertices
        // into the joint. Only redistribute an already dominant adjacent pair.
        if (total <= 0.5) continue
        point.fromBufferAttribute(positions, vertex).sub(joint)
        const axial = point.dot(axis)
        const radial = Math.sqrt(Math.max(0, point.lengthSq() - axial * axial))
        const falloff = this.fade(Math.abs(axial) / (length * 0.35)) *
          this.fade(Math.max(0, radial / length - 0.45) / 0.3)
        const fraction = child_weight / total
        // Fade confidence continuously: a hard 75% cutoff would give two
        // neighboring vertices very different support at a deep bend.
        const confidence = 1 - this.fade((total - 0.5) / 0.35)
        const amount = 4 * fraction * (1 - fraction) * falloff * confidence
        if (amount < 0.001) continue
        const entries = [
          ...Array.from({ length: 4 }, (_, slot) => ({
            index: indices[offset + slot],
            weight: weights[offset + slot] * (slot === parent_slot || slot === child_slot ? 1 - amount : 1)
          })),
          { index: support_index, weight: total * amount }
        ].sort((a, b) => b.weight - a.weight).slice(0, 4)
        const sum = entries.reduce((value, entry) => value + entry.weight, 0)
        for (let slot = 0; slot < 4; slot++) {
          indices[offset + slot] = entries[slot].index
          weights[offset + slot] = entries[slot].weight / sum
        }
      }
    }
  }

  /** Rebuild after rest rebasing, mirroring and arm warps, before playback or export. */
  public static updateClip (clip: AnimationClip, skeleton: Skeleton): void {
    const supports = skeleton.bones.filter(bone => this.isSupportBone(bone))
    const names = new Set(supports.map(bone => bone.name))
    clip.tracks = clip.tracks.filter(track => !names.has(this.trackBone(track.name) ?? ''))
    for (const support of supports) {
      const data = support.userData.rigJointVolume as SupportData
      const rotation = clip.tracks.find(track =>
        this.trackBone(track.name) === data.source && track.name.endsWith('.quaternion'))
      if (rotation === undefined) continue
      const rest = new Quaternion().fromArray(data.rest).normalize()
      const value = new Quaternion()
      const animated = new Quaternion()
      const values: number[] = []
      // Evaluate through the source interpolant (also handles glTF cubic
      // tracks). Add samples across sparse keys; no per-frame CPU deformation.
      const times = [...rotation.times]
      const last_time = times[times.length - 1]
      const discrete = rotation.getInterpolation() === InterpolateDiscrete
      if (!discrete) {
        for (let time = times[0]; time < last_time; time += 1 / 30) times.push(time)
        times.sort((a, b) => a - b)
      }
      const unique_times = times.filter((time, index) => index === 0 || time - times[index - 1] > 1e-6)
      // Three exposes this factory at runtime, including GLTFLoader's cubic
      // override, but @types/three omits it from KeyframeTrack.
      const sampler = (rotation as KeyframeTrack & { createInterpolant: () => Interpolant }).createInterpolant()
      for (const time of unique_times) {
        animated.fromArray(sampler.evaluate(time)).normalize()
        value.copy(rest).slerp(animated, 0.5)
        values.push(value.x, value.y, value.z, value.w)
      }
      clip.tracks.push(new QuaternionKeyframeTrack(
        `${support.name}.quaternion`, unique_times, values,
        discrete ? InterpolateDiscrete : undefined
      ))
      const position = clip.tracks.find(track =>
        this.trackBone(track.name) === data.source && track.name.endsWith('.position'))
      if (position !== undefined) {
        const track = position.clone()
        track.name = `${support.name}.position`
        clip.tracks.push(track)
      }
    }
  }

  private static trackBone (name: string): string | null {
    return /\.bones\[([^\]]+)\]\.(?:quaternion|position|scale)$/.exec(name)?.[1] ??
      /^([^.]+)\.(?:quaternion|position|scale)$/.exec(name)?.[1] ?? null
  }

  private static fade (value: number): number {
    const t = Math.max(0, Math.min(1, value))
    return 1 - t * t * (3 - 2 * t)
  }
}
