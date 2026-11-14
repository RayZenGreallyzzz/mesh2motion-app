import { type Bone, type BufferGeometry, Vector3 } from 'three'
import { continuous_skin_weights } from './ContinuousSkinWeights.ts'

const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t*t*(3-2*t) }
const distanceToSegment = (p: Vector3, a: Vector3, b: Vector3, v: Vector3, d: Vector3): number => {
  d.copy(b).sub(a); const length = d.lengthSq()
  const t = length > 1e-12 ? Math.max(0, Math.min(1, v.copy(p).sub(a).dot(d)/length)) : 0
  return v.copy(a).addScaledVector(d,t).distanceTo(p)
}

/** Skull and face are rigid in our body template, which has no facial rig.
 * Keep a soft transition on the neck and exclude nearby/raised arm surfaces.
 * Runs in the production Worker; own-rigs and facial skeletons are untouched.
 */
export function protect_humanoid_head(geometry: BufferGeometry, bones: Bone[], indices: number[], weights: number[], refineNeck = false): number {
  const headIndex = bones.findIndex(b=>b.name==='head'), neck = bones.find(b=>b.name==='neck_01')
  const head = bones[headIndex], tip = bones.find(b=>b.name==='head_leaf')
  if (!head || !neck || !tip || head.parent!==neck || tip.parent!==head || head.children.some(b=>b!==tip && (b as Bone).isBone)) return 0
  const base = head.getWorldPosition(new Vector3()), end = tip.getWorldPosition(new Vector3()), neckBase = neck.getWorldPosition(new Vector3())
  const length = base.distanceTo(end), neckLength = base.distanceTo(neckBase)
  if (length<1e-6 || neckLength<1e-6) return 0
  const pelvis = bones.find(b => b.name === 'pelvis')?.getWorldPosition(new Vector3())
  const torsoLength = pelvis ? neckBase.distanceTo(pelvis) : length
  const largeHead = !!pelvis && length > torsoLength * .8
  const coreStart = Math.max(neckLength * .5, length * .2)
  const axis = end.clone().sub(base).normalize(), segments: Array<{ a: Vector3, b: Vector3, radius: number }> = []
  const neckIndex = bones.indexOf(neck)
  const chestIndex = neck.parent ? bones.indexOf(neck.parent as Bone) : -1
  for (const b of bones) if (/^(?:upperarm|lowerarm|hand|thumb_\d+|index_\d+|middle_\d+|ring_\d+|pinky_\d+)_[lr]$/.test(b.name)) {
    const a = b.getWorldPosition(new Vector3())
    for (const c of b.children) if ((c as Bone).isBone) {
      const end = c.getWorldPosition(new Vector3())
      segments.push({ a, b: end, radius: torsoLength * .09 + a.distanceTo(end) * .12 })
    }
  }
  const pos = geometry.getAttribute('position'), p = new Vector3(), delta = new Vector3(), v = new Vector3(), d = new Vector3()
  let changed = 0
  for (let i=0;i<pos.count;i++) {
    p.fromBufferAttribute(pos,i);delta.copy(p).sub(base)
    const height=delta.dot(axis), radial=Math.sqrt(Math.max(0,delta.lengthSq()-height*height))
    let amount=smooth((height+neckLength*.65)/(neckLength*.65)) *
      (largeHead ? 1 : 1-smooth((radial/length-1.05)/.45)) * (1-smooth((height/length-1.65)/.55))
    const neckRegion = refineNeck && chestIndex >= 0 && height < 0
      ? smooth((height + neckLength * 1.65) / (neckLength * .65)) *
        // At the skull pivot, the neck correction must stop taking weight
        // from the lower face, including when the shoulder is close by.
        (1 - smooth((height + neckLength * .30) / (neckLength * .30))) *
        (1 - smooth((radial / neckLength - .85) / .65))
      : 0
    if (Math.max(amount, neckRegion)<1e-6) continue
    const headDistance=distanceToSegment(p,base,end,v,d)
    let armDistance=Infinity
    let armExclusion = 1
    for (const { a, b, radius } of segments) {
      const distance = distanceToSegment(p,a,b,v,d)
      armDistance=Math.min(armDistance,distance)
      armExclusion = Math.min(armExclusion, smooth((distance - radius) / Math.max(radius * .7, 1e-6)))
    }
    // Smooth spatial exclusion protects hands held next to the face as well as
    // high V-pose arms. No horizontal head plane can distinguish these alone.
    // With a large skull, a distant ear can be closer to a finger than to the
    // central head axis. That does not make it an arm. Only the local arm/hand
    // capsules exclude this head correction; raised hands stay protected.
    amount*=largeHead ? armExclusion : smooth((armDistance-headDistance)/(length*.30))
    // A lateral shoulder can be closer than the skull axis even at a vertex
    // inside the skull. Use distance to the actual arm surface corridor here.
    const skullCore = smooth((height - coreStart + length * .08) / (length * .08)) *
      (1 - smooth((radial / length - .45) / .15)) *
      (1 - smooth((height / length - 1.35) / .15))
    amount = Math.max(amount, skullCore * armExclusion)
    const neckBlend = neckRegion * armExclusion
    if (Math.max(amount, neckBlend)<1e-6) continue
    const at=i*4, entries=new Map<number,number>()
    const retained = 1 - Math.max(amount, neckBlend)
    for(let k=0;k<4;k++) entries.set(indices[at+k],(entries.get(indices[at+k])??0)+weights[at+k]*retained)
    const neckWeight = Math.max(0, neckBlend - amount)
    if (neckWeight > 0) {
      const lower = (1 - smooth((height + neckLength * 1.14) / (neckLength * .54))) * neckWeight
      entries.set(chestIndex, (entries.get(chestIndex) ?? 0) + lower)
      entries.set(neckIndex, (entries.get(neckIndex) ?? 0) + neckWeight - lower)
    }
    entries.set(headIndex,(entries.get(headIndex)??0)+amount)
    const sorted=continuous_skin_weights([...entries])
    const sum=sorted.reduce((n,[,w])=>n+w,0)
    for(let k=0;k<4;k++){indices[at+k]=sorted[k]?.[0]??0;weights[at+k]=(sorted[k]?.[1]??0)/sum}
    changed++
  }
  return changed
}
