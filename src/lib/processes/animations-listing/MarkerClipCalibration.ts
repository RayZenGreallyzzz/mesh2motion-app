import { AnimationClip, Quaternion, Vector3 } from 'three'
import type { AnimationRestTransform } from './RestPoseAnimationBridge.ts'
/** Rest-relative rotations preserve the reviewed animal's segment axes.
 * Root motion remains; donor limb translations and scales cannot change lengths.
 */
export class MarkerClipCalibration {
  private axes = new Map<string, Quaternion>()
  private motionScale: number
  constructor (private source: ReadonlyMap<string, AnimationRestTransform>, private target: ReadonlyMap<string, AnimationRestTransform>) {
    for (const name of target.keys()) {
      const children = [...source.entries()].filter(([n, rest]) => rest.parent_name === name && target.has(n)), child = children.find(([n]) => !/feather|horn|ear|stomach|shoulder|collar|anchor/i.test(n)) ?? children[0], axis = new Quaternion()
      if (child && !/^(root|hips|body|pelvis)$/i.test(name)) { const a = child[1].position, b = target.get(child[0])!.position; if (a.lengthSq() > 1e-12 && b.lengthSq() > 1e-12) axis.setFromUnitVectors(a.clone().normalize(), b.clone().normalize()) }
      this.axes.set(name, axis)
    }
    const length = (poses: ReadonlyMap<string, AnimationRestTransform>): number => [...poses.entries()].filter(([name]) => /^(front_leg_lower_[lr]|front_leg_ankle_[lr]|front_ankle_[lr]|front_foot_[lr]|FrontLeg\.[LR]|FrontFoot\.[LR])$/i.test(name)).reduce((sum, [, rest]) => sum + rest.position.length(), 0)
    const a = length(source), b = length(target); this.motionScale = a > 1e-6 && b > 1e-6 ? b / a : 1
  }
  public apply (clip: AnimationClip, skeletonScale = 1): void {
    clip.tracks = clip.tracks.filter(track => {
      const match = track.name.match(/^(?:.*\.bones\[([^\]]+)\]|(.+))\.(quaternion|position|scale)$/)
      if (!match) return true
      const name = match[1] ?? match[2], property = match[3], source = this.source.get(name), target = this.target.get(name)
      if (!source || !target) return false
      const axis = this.axes.get(name)!, inverse = axis.clone().invert(), restInverse = source.quaternion.clone().invert(), stride = property === 'quaternion' ? 4 : 3, cubic = track.values.length === track.times.length * stride * 3, rootMotion = /^(root|hips|pelvis|body)$/i.test(name)
      for (let i = 0; i < track.values.length; i += stride) {
        const tangent = cubic && (i / stride) % 3 !== 1
        if (property === 'quaternion') { const q = new Quaternion().fromArray(track.values, i).premultiply(restInverse).premultiply(axis).multiply(inverse).premultiply(target.quaternion); if (!tangent) q.normalize(); q.toArray(track.values, i) }
        else if (property === 'position' && rootMotion) { const v = new Vector3().fromArray(track.values, i).divideScalar(Math.max(skeletonScale, 1e-8)); if (!tangent) v.sub(source.position); v.multiplyScalar(this.motionScale); if (!tangent) v.add(target.position); v.toArray(track.values, i) }
        else { const v = tangent ? new Vector3() : property === 'position' ? target.position : target.scale ?? new Vector3(1, 1, 1); v.toArray(track.values, i) }
      }
      return true
    })
  }
}
