import { Bone, Vector3, type BufferGeometry, type Object3D } from 'three'
import { parse_bone_name } from '../../retarget/bone-automap/BoneNameTokenizer.ts'
import { resolve_slot } from '../../retarget/bone-automap/BoneSlotVocabulary.ts'
import { BoneSide, BoneSlot } from '../../retarget/bone-automap/BoneTypes.ts'
import { continuous_skin_weights } from './ContinuousSkinWeights.ts'

export interface ChestGuardOptions { enabled: boolean, strength: number, width: number, height: number, offset: number, anchor_to_chest?: boolean }
export interface ChestGuardStats { available: boolean, reason: string, region: number, changed: number, removed: number, target: string }
export const default_chest_guard = (): ChestGuardOptions => ({ enabled: false, strength: 1, width: 1, height: 1, offset: 0 })
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const smooth = (a: number, b: number, n: number) => { const t = clamp((n - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const quantile = (values: number[], q: number): number => { values.sort((a,b) => a-b); return values[Math.min(values.length - 1, Math.floor(q * values.length))] }
interface Capsule { a: Vector3, d: Vector3, lengthSq: number, radius: number }

/** A reversible, user-selected anatomical weight correction, not sex detection.
 * Runs on copies of the automatic field, before manual painting. It never edits
 * geometry, bones, bind transforms, animation tracks, or the cached base weights.
 */
export class ChestWeightGuard {
  readonly stats: ChestGuardStats = { available: false, reason: '', region: 0, changed: 0, removed: 0, target: '' }
  private readonly options: ChestGuardOptions
  private readonly arm = new Set<number>()
  private target = -1
  private origin = new Vector3()
  private side = new Vector3(1,0,0)
  private up = new Vector3(0,1,0)
  private front = new Vector3(0,0,1)
  private halfWidth = 0
  private torso = 0
  private centers: Vector3[] = []
  private radii = new Vector3()
  private capsules: Capsule[] = []
  private readonly point = new Vector3()
  private readonly local = new Vector3()

  constructor (bones: Bone[], geometries: BufferGeometry[], options: ChestGuardOptions) {
    this.options = { enabled: options.enabled, strength: clamp(options.strength,0,1), width: clamp(options.width,.6,1.6), height: clamp(options.height,.6,1.6), offset: clamp(options.offset,-.3,.3), anchor_to_chest: options.anchor_to_chest === true }
    const fail = (reason: string) => { this.stats.reason = reason }
    const roles = bones.map(bone => { const name = parse_bone_name(bone.name); return { slot: resolve_slot(name, name.side), side: name.side, leaf: name.is_leaf } })
    const find = (slot: BoneSlot, side?: BoneSide) => bones.find((bone, i) => !bone.userData.rigNonDeforming && !bone.name.startsWith('rig_volume_') && !roles[i].leaf && roles[i].slot === slot && (side === undefined || roles[i].side === side))
    const left = find(BoneSlot.UpperArm,BoneSide.Left), right = find(BoneSlot.UpperArm,BoneSide.Right), pelvis = find(BoneSlot.Pelvis)
    if (!left || !right || !pelvis) { fail('Нужны распознанные таз и обе руки. Для этого скелета защита не применяется.'); return }
    const ancestors = (bone: Object3D) => { const out: Object3D[] = []; for (let p = bone.parent; p; p = p.parent) out.push(p); return out }
    const opposite = new Set(ancestors(right)), chest = ancestors(left).find(b => opposite.has(b) && roles[bones.indexOf(b as Bone)]?.slot === BoneSlot.Spine) as Bone | undefined
    if (!chest) { fail('Не найден общий грудной отдел над обеими руками. Проверьте скелет.'); return }
    bones.forEach(b => b.updateWorldMatrix(true,false))
    const lp = left.getWorldPosition(new Vector3()), rp = right.getWorldPosition(new Vector3()), pp = pelvis.getWorldPosition(new Vector3())
    this.target = bones.indexOf(chest); this.stats.target = chest.name
    this.origin.copy(lp).add(rp).multiplyScalar(.5); this.side.copy(lp).sub(rp); this.halfWidth = this.side.length() * .5; this.side.normalize()
    this.up.copy(this.origin).sub(pp).addScaledVector(this.side, -this.origin.clone().sub(pp).dot(this.side)); this.torso = this.up.length(); this.up.normalize(); this.front.crossVectors(this.side,this.up).normalize()
    if (this.halfWidth < 1e-6 || this.torso < 1e-6 || this.halfWidth / this.torso > 2 || this.halfWidth / this.torso < .08) { fail('Проверьте положение плеч и таза перед защитой груди.'); return }
    for (const upper of [left,right]) {
      let branch: Object3D = upper
      for (let p = upper.parent; p && p !== chest; p = p.parent) if (roles[bones.indexOf(p as Bone)]?.slot === BoneSlot.Clavicle) branch = p
      branch.traverse(b => { const i = bones.indexOf(b as Bone); if (i >= 0) this.arm.add(i) })
      const elbow = upper.children.find(b => roles[bones.indexOf(b as Bone)]?.slot === BoneSlot.LowerArm)
      const a = upper.getWorldPosition(new Vector3()), d = (elbow?.getWorldPosition(new Vector3()) ?? a.clone()).sub(a)
      this.capsules.push({ a, d, lengthSq: d.lengthSq(), radius: this.halfWidth * .27 + d.length() * .03 })
    }
    // Sample every mesh in the same anatomical frame. A capped sample avoids
    // building another surface graph for a million-vertex model.
    const samples: Vector3[] = [], total = geometries.reduce((n,g) => n + (g.getAttribute('position')?.count ?? 0), 0), stride = Math.max(1, Math.ceil(total / 24000))
    for (const g of geometries) {
      const pos = g.getAttribute('position'); if (!pos) continue
      for (let i = 0; i < pos.count; i += stride) {
        this.toLocal(this.point.fromBufferAttribute(pos,i),this.local)
        const p = this.local
        if (Math.abs(p.x) < this.halfWidth * 1.05 && p.y < -this.torso * .08 && p.y > -this.torso * .70 && p.z > this.halfWidth * .06) samples.push(p.clone())
      }
    }
    if (samples.length < 12) { fail('Передняя область груди не найдена. Проверьте поворот модели лицом вперёд.'); return }
    const tip = quantile(samples.map(p=>p.z),.97), threshold = quantile(samples.map(p=>p.z),.75)
    const apex = samples.filter(p => p.z >= threshold)
    const centerY = clamp(quantile(apex.map(p=>p.y),.5),-.55*this.torso,-.18*this.torso) + this.options.offset * this.torso
    for (const sign of [-1,1]) {
      const half = apex.filter(p => p.x * sign > 0)
      const centerX = clamp(half.length ? quantile(half.map(p=>Math.abs(p.x)),.5) : this.halfWidth*.48,this.halfWidth*.25,this.halfWidth*.72)
      this.centers.push(new Vector3(sign * centerX,centerY,tip*.48))
    }
    this.radii.set(this.halfWidth*.82*this.options.width,this.torso*.35*this.options.height,Math.max(tip*.85,this.halfWidth*.5))
    this.stats.available = true
  }

  private toLocal (point: Vector3, out: Vector3): Vector3 {
    const dx=point.x-this.origin.x,dy=point.y-this.origin.y,dz=point.z-this.origin.z
    return out.set(dx*this.side.x+dy*this.side.y+dz*this.side.z,dx*this.up.x+dy*this.up.y+dz*this.up.z,dx*this.front.x+dy*this.front.y+dz*this.front.z)
  }

  /** Strength is separate so the diagnostic area remains visible at zero gain. */
  mask (point: Vector3): number {
    if (!this.stats.available) return 0
    const p = this.toLocal(point,this.local)
    let region = 0
    for (const c of this.centers) {
      const r = Math.sqrt(((p.x-c.x)/this.radii.x)**2+((p.y-c.y)/this.radii.y)**2+((p.z-c.z)/this.radii.z)**2)
      region = Math.max(region,1-smooth(.65,1.12,r))
      // The front surface of a large breast lies near the ellipsoid boundary,
      // not its centre. A narrow plateau left 10–80% arm influence on that
      // surface and produced spikes when the arms rose. Woman keeps the whole
      // anterior volume rigid, then blends at its attachment to the torso.
      // Keep the original mask for other profiles; capsules still exclude arms.
      if (this.options.anchor_to_chest) {
        const anterior = smooth(this.halfWidth*.12,this.halfWidth*.50,p.z)
        region = Math.max(region,(1-smooth(1.05,1.38,r))*anterior)
      }
    }
    region *= smooth(-this.halfWidth*.08,this.halfWidth*.14,p.z) * (1-smooth(-this.torso*.10,this.torso*.015,p.y))
    if (!region) return 0
    for (const c of this.capsules) {
      const dx=point.x-c.a.x,dy=point.y-c.a.y,dz=point.z-c.a.z, t=c.lengthSq>1e-12?clamp((dx*c.d.x+dy*c.d.y+dz*c.d.z)/c.lengthSq,0,1):0
      const distance=Math.hypot(dx-t*c.d.x,dy-t*c.d.y,dz-t*c.d.z)
      region *= smooth(c.radius,c.radius*1.5,distance)
    }
    return region
  }

  apply (geometry: BufferGeometry, indices: number[], weights: number[], preview: boolean): Float32Array | undefined {
    const pos=geometry.getAttribute('position'), mask=preview?new Float32Array(pos.count):undefined
    if (!this.options.enabled || !this.stats.available) return mask
    // Woman anchors the anterior volume as well as removing arm influence.
    // The smooth mask and arm capsules keep the attachment transition mobile.
    const redirect = (id: number) => this.arm.has(id) || (this.options.anchor_to_chest === true && id !== this.target)
    for(let i=0;i<pos.count;i++) {
      const area=this.mask(this.point.fromBufferAttribute(pos,i)); if(mask)mask[i]=area
      if(area>.01)this.stats.region++
      const amount=area*this.options.strength; if(amount<=1e-8)continue
      const base=i*4;let removed=0
      for(let j=0;j<4;j++)if(redirect(indices[base+j]))removed+=weights[base+j]*amount
      if(removed<=1e-8)continue
      const values=new Map<number,number>()
      for(let j=0;j<4;j++){const id=indices[base+j],weight=weights[base+j]*(redirect(id)?1-amount:1);if(weight>0)values.set(id,(values.get(id)??0)+weight)}
      values.set(this.target,(values.get(this.target)??0)+removed)
      const top=continuous_skin_weights([...values]),sum=top.reduce((n,[,w])=>n+w,0)
      for(let j=0;j<4;j++){indices[base+j]=top[j]?.[0]??0;weights[base+j]=(top[j]?.[1]??0)/sum}
      this.stats.changed++;this.stats.removed+=removed
    }
    return mask
  }
}
