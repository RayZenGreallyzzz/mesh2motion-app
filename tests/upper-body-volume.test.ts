// @vitest-environment node
import fs from 'node:fs'
import { expect, it } from 'vitest'
import { Matrix3, Matrix4, Quaternion, Vector3, SkinnedMesh, Uint16BufferAttribute, Float32BufferAttribute, AnimationClip, QuaternionKeyframeTrack, AnimationMixer } from 'three'
import { woman_files, woman_fixture } from './woman-fixtures.ts'
import { fit_humanoid_rig } from '../src/lib/processes/edit-skeleton/HumanoidAutoFit.ts'
import SkinningAlgorithm from '../src/lib/solvers/SkinningAlgorithm.ts'
import { SkeletonType } from '../src/lib/enums/SkeletonType.ts'
import { JointVolumeSupport } from '../src/lib/solvers/JointVolumeSupport.ts'
import { ChestWeightGuard, default_chest_guard } from '../src/lib/solvers/ChestWeightGuard.ts'

for(const file of woman_files)it('preserves '+file.id+' face shape and improves shoulder volume at deep raises',async()=>{
 const f=await woman_fixture(file.file);fit_humanoid_rig(f.model,f.skeleton,null,()=>{},'woman')
 const g=f.geometries[0],p=g.getAttribute('position'),solver=new SkinningAlgorithm(f.rig,SkeletonType.Woman);solver.set_geometry(g)
 const [ids,weights]=solver.calculate_indexes_and_weights()
 const skeleton=JointVolumeSupport.addToSkeleton(f.skeleton);skeleton.calculateInverses()
 expect(skeleton.bones.length-f.bones.length).toBe(6)
 expect(JointVolumeSupport.addToSkeleton(skeleton)).toBe(skeleton)
 new ChestWeightGuard(skeleton.bones,[g],{...default_chest_guard(),enabled:true,anchor_to_chest:true}).apply(g,ids,weights,false)
 const fixedIds=ids.slice(),fixedWeights=weights.slice();JointVolumeSupport.applyWeights(g,skeleton,fixedIds,fixedWeights)
 const make=(ii:number[],ww:number[])=>{const m=new SkinnedMesh(g.clone());m.geometry.setAttribute('skinIndex',new Uint16BufferAttribute(ii,4));m.geometry.setAttribute('skinWeight',new Float32BufferAttribute(ww,4));m.bind(skeleton);return m}
 const mesh=make(fixedIds,fixedWeights),rest=skeleton.bones.map(b=>b.quaternion.clone()),head=skeleton.bones.findIndex(b=>b.name==='head')
 const neck=skeleton.bones.findIndex(b=>b.name==='neck_01'),headRest=skeleton.bones[head].getWorldPosition(new Vector3())
 const shoulders=['l','r'].map(side=>skeleton.bones.findIndex(b=>b.name==='upperarm_'+side)),centers=shoulders.map(i=>skeleton.bones[i].getWorldPosition(new Vector3()))
 let invalid=0,maxSum=0,restError=0,faceCount=0,minFaceHeadWeight=1
 const face=(v:Vector3)=>v.y>Math.max(headRest.y+.025,1.74)&&v.y<1.92&&Math.abs(v.x)<.085&&v.z>-.005
 const v=new Vector3(),a=new Vector3(),e=new Vector3()
 for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);let sum=0,hw=0;for(let k=0;k<4;k++){const j=fixedIds[i*4+k],w=fixedWeights[i*4+k];sum+=w;if(j===head)hw+=w;if(!Number.isInteger(j)||j<0||j>=skeleton.bones.length||!Number.isFinite(w)||w<0)invalid++}maxSum=Math.max(maxSum,Math.abs(sum-1));if(face(v)){faceCount++;minFaceHeadWeight=Math.min(minFaceHeadWeight,hw)}if(i%101===0)restError=Math.max(restError,mesh.applyBoneTransform(i,a.copy(v)).distanceTo(v))}
 expect(invalid).toBe(0);expect(maxSum).toBeLessThan(1e-6);expect(restError).toBeLessThan(1e-6);expect(faceCount).toBeGreaterThan(1000);expect(minFaceHeadWeight).toBeGreaterThan(.999)
 const results=[]
 for(const degrees of [60,100,140]){
  const tracks=[...shoulders,head,neck].map(i=>{const q=rest[i].clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),degrees*Math.PI/180*(i===head?.4:i===neck?-.25:skeleton.bones[i].name.endsWith('_l')?1:-1)));return new QuaternionKeyframeTrack(skeleton.bones[i].name+'.quaternion',[0,1],[...rest[i].toArray(),...q.toArray()])})
  const clip=new AnimationClip('raise',1,tracks);JointVolumeSupport.updateClip(clip,skeleton)
  expect(clip.tracks.filter(t=>/^rig_volume_upperarm_[lr]\.quaternion$/.test(t.name))).toHaveLength(2)
  const mixer=new AnimationMixer(f.rig),action=mixer.clipAction(clip);action.play();mixer.setTime(.999);f.rig.updateMatrixWorld(true)
  const matrices=skeleton.bones.map((b,i)=>new Matrix4().multiplyMatrices(b.matrixWorld,skeleton.boneInverses[i]));let faceError=0,lossBefore=0,lossAfter=0,n=0
  const determinant=(ii:number[],ww:number[],i:number)=>{const blend=new Matrix4();blend.elements.fill(0);for(let k=0;k<4;k++){const mm=matrices[ii[i*4+k]].elements,w=ww[i*4+k];for(let x=0;x<16;x++)blend.elements[x]+=mm[x]*w}return new Matrix3().setFromMatrix4(blend).determinant()}
  for(let i=0;i<p.count;i+=7){v.fromBufferAttribute(p,i);mesh.applyBoneTransform(i,a.copy(v));expect(Number.isFinite(a.lengthSq())).toBe(true);if(face(v)){e.copy(v).applyMatrix4(matrices[head]);faceError=Math.max(faceError,a.distanceTo(e))}if(centers.some(c=>c.distanceTo(v)<.09)){lossBefore+=Math.max(0,1-determinant(ids,weights,i));lossAfter+=Math.max(0,1-determinant(fixedIds,fixedWeights,i));n++}}
  results.push({degrees,faceError,shoulderSamples:n,volumeLossBefore:lossBefore/n,volumeLossAfter:lossAfter/n})
  expect(faceError).toBeLessThan(1e-5);expect(n).toBeGreaterThan(200);expect(lossAfter).toBeLessThan(lossBefore*.8)
  mixer.stopAllAction();skeleton.bones.forEach((b,i)=>b.quaternion.copy(rest[i]));f.rig.updateMatrixWorld(true)
 }
 fs.writeFileSync('checks/'+file.id+'-upper-body.json',JSON.stringify({vertices:p.count,bones:skeleton.bones.length,invalid,maxSum,restError,faceCount,minFaceHeadWeight,poses:results},null,2))
},180000)
