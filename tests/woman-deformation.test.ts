// @vitest-environment node
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { it,expect } from 'vitest'
import { Vector3,Quaternion,SkinnedMesh,Uint16BufferAttribute,Float32BufferAttribute } from 'three'
import { woman_files,woman_fixture } from './woman-fixtures.ts'
import { fit_humanoid_rig } from '../src/lib/processes/edit-skeleton/HumanoidAutoFit.ts'
import SkinningAlgorithm from '../src/lib/solvers/SkinningAlgorithm.ts'
import { ChestWeightGuard,default_chest_guard } from '../src/lib/solvers/ChestWeightGuard.ts'
import { SkeletonType } from '../src/lib/enums/SkeletonType.ts'
for(const file of woman_files)it('keeps '+file.id+' chest stable and arms mobile using full production surface weights',async()=>{
 const f=await woman_fixture(file.file),g=f.geometries[0],pos=g.getAttribute('position')
 expect(f.geometries.length).toBe(1);fit_humanoid_rig(f.model,f.skeleton,null,()=>{},'woman');f.rig.updateMatrixWorld(true);f.skeleton.calculateInverses()
 const solver=new SkinningAlgorithm(f.rig,SkeletonType.Woman);solver.set_geometry(g)
 const t=performance.now(),[ids,weights]=solver.calculate_indexes_and_weights(),fixedIds=ids.slice(),fixedWeights=weights.slice()
 const guard=new ChestWeightGuard(f.bones,[g],{...default_chest_guard(),enabled:true,anchor_to_chest:true}),mask=guard.apply(g,fixedIds,fixedWeights,true)!
 expect(guard.stats.available).toBe(true)
 const make=(ii:number[],ww:number[])=>{const m=new SkinnedMesh(g.clone());m.geometry.setAttribute('skinIndex',new Uint16BufferAttribute(ii,4));m.geometry.setAttribute('skinWeight',new Float32BufferAttribute(ww,4));m.bind(f.skeleton);return m}
 const baseline=make(ids,weights),guarded=make(fixedIds,fixedWeights),source=new Vector3(),a=new Vector3(),b=new Vector3()
 const chest=(p:Vector3)=>Math.abs(p.x)>.035&&Math.abs(p.x)<.205&&p.y>1.39&&p.y<1.55&&p.z>.065
 const arm=(p:Vector3)=>Math.abs(p.x)>.35&&Math.abs(p.x)<.62&&p.y>1.45&&p.y<1.85&&p.z<0
 const armBone=(i:number)=>/arm|hand|clavicle|thumb|index|middle|ring|pinky/.test(f.bones[i]?.name??'')
 let maxSumError=0,restError=0,chestBefore=0,chestAfter=0,chestCount=0,untouched=0
 for(let i=0;i<pos.count;i++){
  source.fromBufferAttribute(pos,i);let sum=0;const inChest=chest(source);if(inChest)chestCount++;if(mask[i]===0)untouched++
  for(let k=0;k<4;k++){const at=i*4+k,id=fixedIds[at],w=fixedWeights[at];sum+=w
   if(!Number.isInteger(id)||id<0||id>=f.bones.length||!Number.isFinite(w)||w<0||w>1)throw Error('Invalid weight')
   if(mask[i]===0&&(id!==ids[at]||w!==weights[at]))throw Error('Unselected vertex changed')
   if(inChest){if(armBone(ids[at]))chestBefore+=weights[at];if(armBone(id))chestAfter+=w}
  }
  maxSumError=Math.max(maxSumError,Math.abs(sum-1));if(i%137===0)restError=Math.max(restError,guarded.applyBoneTransform(i,b.copy(source)).distanceTo(source))
 }
 expect(maxSumError).toBeLessThan(1e-6);expect(restError).toBeLessThan(1e-6);expect(chestCount).toBeGreaterThan(1000);expect(untouched).toBeGreaterThan(pos.count*.7)
 const rotations=f.bones.map(b=>b.quaternion.clone()),poses=[]
 for(const degrees of [30,60,100]){
  f.bones.forEach((b,i)=>b.quaternion.copy(rotations[i]));for(const bone of f.bones)if(/^(upperarm|clavicle)_[lr]$/.test(bone.name))bone.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),(bone.name.endsWith('_l')?1:-1)*degrees*Math.PI/180));f.rig.updateMatrixWorld(true)
  let before=0,after=0,n=0,armMovement=0,armDifference=0,armCount=0,maxMovement=0
  for(let i=0;i<pos.count;i+=11){source.fromBufferAttribute(pos,i);baseline.applyBoneTransform(i,a.copy(source));guarded.applyBoneTransform(i,b.copy(source));if(!Number.isFinite(b.x+b.y+b.z))throw Error('Nonfinite skin pose');maxMovement=Math.max(maxMovement,b.distanceTo(source));if(chest(source)){before+=a.distanceTo(source);after+=b.distanceTo(source);n++}if(arm(source)){armMovement+=b.distanceTo(source);armDifference=Math.max(armDifference,a.distanceTo(b));armCount++}}
  poses.push({degrees,beforeMean:before/n,afterMean:after/n,armMovement:armMovement/armCount,armDifference,maxMovement})
  expect(armMovement/armCount).toBeGreaterThan(.03);expect(armDifference).toBeLessThan(1e-7);expect(maxMovement).toBeLessThan(3);expect(after/n).toBeLessThan(.012)
 }
 f.bones.forEach((b,i)=>b.quaternion.copy(rotations[i]));f.rig.updateMatrixWorld(true)
 for(const options of [{...default_chest_guard(),anchor_to_chest:true},{...default_chest_guard(),enabled:true,anchor_to_chest:true,strength:0}]){const ii=ids.slice(),ww=weights.slice();new ChestWeightGuard(f.bones,[g],options).apply(g,ii,ww,false);expect(ii).toEqual(ids);expect(ww).toEqual(weights)}
 expect(chestAfter/chestCount).toBeLessThan(.04);expect(chestAfter).toBeLessThan(chestBefore*.3);expect(createHash('sha256').update(fs.readFileSync(file.file)).digest('hex')).toBe(f.hash)
 fs.writeFileSync('checks/'+file.id+'-deformation.json',JSON.stringify({vertices:pos.count,bones:f.bones.length,seconds:(performance.now()-t)/1000,guard:guard.stats,maxSumError,restError,untouched,chestCount,chestArmBefore:chestBefore/chestCount,chestArmAfter:chestAfter/chestCount,poses,sourceHash:f.hash},null,2))
},180000)
