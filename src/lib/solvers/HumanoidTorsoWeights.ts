import { Vector3, type Bone, type BufferGeometry } from 'three'
import { parse_bone_name } from '../../retarget/bone-automap/BoneNameTokenizer.ts'
import { resolve_slot } from '../../retarget/bone-automap/BoneSlotVocabulary.ts'
import { BoneSide, BoneSlot } from '../../retarget/bone-automap/BoneTypes.ts'
import { continuous_skin_weights } from './ContinuousSkinWeights.ts'

const smooth = (a: number, b: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value-a)/(b-a)))
  return t*t*(3-2*t)
}

/** Geodesic falloff can reach the waist from a descending arm. Remove that
 * distant influence only where the field already identifies a torso surface.
 * Keep a capsule around each arm, a soft armpit transition and the original
 * relative spine weights when those have meaningful support. Tiny spine seeds
 * must not be amplified into a different dominant joint on adjacent vertices.
 * Manual edits are applied later and remain authoritative.
 */
export function protect_humanoid_torso (geometry: BufferGeometry, bones: Bone[], indices: number[], weights: number[]): number {
  const roles = bones.map(b => { const name=parse_bone_name(b.name);return {slot:resolve_slot(name,name.side),side:name.side,leaf:name.is_leaf} })
  const find = (slot: BoneSlot, side?: BoneSide) => bones.find((b,i)=>!b.userData.rigNonDeforming&&!b.name.startsWith('rig_volume_')&&!roles[i].leaf&&roles[i].slot===slot&&(side===undefined||roles[i].side===side))
  const left=find(BoneSlot.UpperArm,BoneSide.Left),right=find(BoneSlot.UpperArm,BoneSide.Right),pelvis=find(BoneSlot.Pelvis)
  if(!left||!right||!pelvis)return 0
  bones.forEach(b=>b.updateWorldMatrix(true,false))
  const lp=left.getWorldPosition(new Vector3()),rp=right.getWorldPosition(new Vector3()),hip=pelvis.getWorldPosition(new Vector3())
  const origin=lp.clone().add(rp).multiplyScalar(.5),side=lp.clone().sub(rp),halfWidth=side.length()*.5
  side.normalize();const up=origin.clone().sub(hip);up.addScaledVector(side,-up.dot(side));const height=up.length();up.normalize()
  if(height<1e-6||halfWidth/height<.08||halfWidth/height>2)return 0
  const arm=new Set<number>(),core=new Set<number>(),capsules:Array<{a:Vector3,d:Vector3,lengthSq:number,radius:number}>=[]
  roles.forEach((r,i)=>{if(r.slot===BoneSlot.Spine||r.slot===BoneSlot.Pelvis)core.add(i)})
  const anchors=[...core].filter(i=>!roles[i].leaf&&!bones[i].userData.rigNonDeforming).map(i=>({id:i,height:bones[i].getWorldPosition(new Vector3()).sub(hip).dot(up)})).sort((a,b)=>a.height-b.height)
  if(!anchors.length)return 0
  for(const upper of [left,right]){
    upper.traverse(b=>{const i=bones.indexOf(b as Bone);if(i>=0)arm.add(i)})
    for(const start of [upper,find(BoneSlot.LowerArm,roles[bones.indexOf(upper)].side)]){
      if(!start)continue
      const end=start.children.find(b=>{const r=roles[bones.indexOf(b as Bone)];return r?.slot===(start===upper?BoneSlot.LowerArm:BoneSlot.Hand)&&!r.leaf})
      if(!end)continue
      const a=start.getWorldPosition(new Vector3()),d=end.getWorldPosition(new Vector3()).sub(a)
      capsules.push({a,d,lengthSq:d.lengthSq(),radius:halfWidth*(start===upper?.38:.30)+d.length()*.025})
    }
  }
  if(capsules.length<4)return 0
  const p=new Vector3(),local=new Vector3(),pos=geometry.getAttribute('position');let changed=0
  for(let i=0;i<pos.count;i++){
    const base=i*4;let armWeight=0,coreWeight=0
    for(let k=0;k<4;k++){if(arm.has(indices[base+k]))armWeight+=weights[base+k];if(core.has(indices[base+k]))coreWeight+=weights[base+k]}
    if(armWeight<=1e-8||coreWeight<=1e-8)continue
    p.fromBufferAttribute(pos,i);local.copy(p).sub(origin);const down=-local.dot(up),x=Math.abs(local.dot(side))
    let amount=smooth(height*.10,height*.28,down)*(1-smooth(height*.90,height*1.04,down))*(1-smooth(halfWidth*1.3,halfWidth*1.7,x))
    if(amount<=1e-8)continue
    for(const c of capsules){const dx=p.x-c.a.x,dy=p.y-c.a.y,dz=p.z-c.a.z,t=Math.max(0,Math.min(1,(dx*c.d.x+dy*c.d.y+dz*c.d.z)/(c.lengthSq||1)))
      amount*=smooth(c.radius,c.radius*1.7,Math.hypot(dx-t*c.d.x,dy-t*c.d.y,dz-t*c.d.z))
    }
    if(amount<=1e-8)continue
    const removed=armWeight*amount
    // Proportional transfer can turn a 0.1% accidental spine seed into 80%.
    // Where that amplification dominates, use a continuous geometric spine
    // field instead. Substantial original torso support is preserved.
    const stable=(1-smooth(.15,.55,coreWeight))*smooth(.25,1,removed/coreWeight)
    if(stable>1e-8){
      const y=p.clone().sub(hip).dot(up),field=new Map<number,number>()
      if(y<=anchors[0].height)field.set(anchors[0].id,1)
      else if(y>=anchors.at(-1)!.height)field.set(anchors.at(-1)!.id,1)
      else for(let j=1;j<anchors.length;j++)if(y<=anchors[j].height){const a=anchors[j-1],b=anchors[j],t=smooth(a.height,b.height,y);field.set(a.id,1-t);field.set(b.id,t);break}
      const entries=new Map<number,number>(),coreTotal=coreWeight+removed
      for(let k=0;k<4;k++){const id=indices[base+k],w=weights[base+k];entries.set(id,(entries.get(id)??0)+(arm.has(id)?w*(1-amount):core.has(id)?w*coreTotal/coreWeight*(1-stable):w))}
      for(const [id,w] of field)entries.set(id,(entries.get(id)??0)+coreTotal*stable*w)
      const sorted=continuous_skin_weights([...entries])
      for(let k=0;k<4;k++){indices[base+k]=sorted[k]?.[0]??0;weights[base+k]=sorted[k]?.[1]??0}
      changed++;continue
    }
    for(let k=0;k<4;k++){const id=indices[base+k];if(arm.has(id))weights[base+k]*=1-amount;else if(core.has(id))weights[base+k]=Math.min(1,weights[base+k]+removed*weights[base+k]/coreWeight)}
    changed++
  }
  return changed
}
