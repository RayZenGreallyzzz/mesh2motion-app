// @vitest-environment node
import fs from 'node:fs'
import { afterAll,expect,it } from 'vitest'
import { Box3,Group,Mesh,Quaternion,Skeleton,SkinnedMesh,Float32BufferAttribute,Uint16BufferAttribute,Vector3 } from 'three'
import { load_without_textures } from './chest-fixtures.ts'
import { AnimalAutoFit } from '../src/lib/processes/edit-skeleton/AnimalAutoFit.ts'
import { RigConfig } from '../src/lib/RigConfig.ts'
import { is_humanoid_skeleton_type } from '../src/lib/HumanoidSkeleton.ts'
import { Utility } from '../src/lib/Utilities.ts'
import SkinningAlgorithm from '../src/lib/solvers/SkinningAlgorithm.ts'

const report:unknown[]=[]
afterAll(()=>fs.writeFileSync('checks/v80-animal-templates.json',JSON.stringify(report,null,2)))
for(const config of RigConfig.all.filter(c=>!c.pack_source&&!is_humanoid_skeleton_type(c.skeleton_type)))it('fits and weights the '+config.rig_display_name+' template without changing its joint topology',async()=>{
 const model=(await load_without_textures('baseline/'+config.model_file)).scene,rig=(await load_without_textures('baseline/'+config.rig_file)).scene
 const bones=Utility.bone_list_from_hierarchy(rig),skeleton=new Skeleton(bones),reference=AnimalAutoFit.reference(model,rig),parents=bones.map(b=>b.parent)
 // The editor's shared scene transform must not be folded into the fitting.
 const frame=new Group();frame.add(model,rig);frame.position.set(3,-1,5);frame.quaternion.setFromAxisAngle(new Vector3(1,2,3).normalize(),.7);frame.scale.setScalar(1.4)
 model.rotation.y=Math.PI/2;model.scale.set(1.07,1.10,.93);frame.updateMatrixWorld(true)
 let undo=0;expect(AnimalAutoFit.fit(model,skeleton,frame,reference,()=>undo++)).toBeTruthy()
 const first=bones.map(b=>b.getWorldPosition(new Vector3())),height=new Box3().setFromObject(model).getSize(new Vector3()).length()
 let maxFitError=0
 bones.forEach((b,i)=>{expect(b.parent).toBe(parents[i]);const expected=reference.joints.get(b.name)!.position.clone().multiply(model.scale).applyQuaternion(model.quaternion).applyMatrix4(frame.matrixWorld);maxFitError=Math.max(maxFitError,first[i].distanceTo(expected)/height)})
 expect(maxFitError).toBeLessThan(1e-5)
 AnimalAutoFit.fit(model,skeleton,frame,reference,()=>undo++);expect(undo).toBe(2);bones.forEach((b,i)=>expect(b.getWorldPosition(new Vector3()).distanceTo(first[i])).toBeLessThan(height*1e-6));skeleton.calculateInverses()
 let vertices=0,maxSum=0,restError=0
 const solver=new SkinningAlgorithm(rig,config.skeleton_type)
 model.traverse(o=>{if(!(o as Mesh).isMesh)return;const g=(o as Mesh).geometry.clone().applyMatrix4(o.matrixWorld);solver.set_geometry(g);const [ids,weights]=solver.calculate_indexes_and_weights();vertices+=g.getAttribute('position').count
  for(let i=0;i<weights.length;i+=4){let sum=0;for(let k=0;k<4;k++){expect(Number.isFinite(weights[i+k])&&weights[i+k]>=0).toBe(true);expect(Number.isInteger(ids[i+k])&&ids[i+k]>=0&&ids[i+k]<bones.length).toBe(true);sum+=weights[i+k]}maxSum=Math.max(maxSum,Math.abs(sum-1))}
  g.setAttribute('skinIndex',new Uint16BufferAttribute(ids,4));g.setAttribute('skinWeight',new Float32BufferAttribute(weights,4));const mesh=new SkinnedMesh(g);mesh.bind(skeleton);const p=new Vector3(),q=new Vector3(),pos=g.getAttribute('position');for(let i=0;i<pos.count;i+=Math.max(1,Math.floor(pos.count/100))){p.fromBufferAttribute(pos,i);restError=Math.max(restError,mesh.applyBoneTransform(i,q.copy(p)).distanceTo(p)/height)}g.dispose()
 })
 expect(vertices).toBeGreaterThan(30);expect(maxSum).toBeLessThan(1e-6);expect(restError).toBeLessThan(1e-6);report.push({type:config.skeleton_type,bones:bones.length,vertices,maxFitError,maxSum,restError,repeatedFitStable:true})
},180000)
