// @vitest-environment node
import fs from 'node:fs'
import { it,expect } from 'vitest'
import { Group,Vector3 } from 'three'
import { woman_files,woman_fixture,joint_positions } from './woman-fixtures.ts'
import { fit_humanoid_rig } from '../src/lib/processes/edit-skeleton/HumanoidAutoFit.ts'
for(const file of woman_files)it('fits '+file.id+' stably in scaled/rotated frames with a neck/skull pivot and unchanged hierarchy/legs',async()=>{
 const f=await woman_fixture(file.file),human=await woman_fixture(file.file)
 const hierarchy=f.bones.map(b=>[b.name,b.parent?.name,b.quaternion.toArray(),b.scale.toArray()])
 fit_humanoid_rig(human.model,human.skeleton,null,()=>{});const original=joint_positions(human.skeleton)
 let undos=0;const pose=fit_humanoid_rig(f.model,f.skeleton,null,()=>undos++,'woman'),joints=joint_positions(f.skeleton)
 expect(pose).not.toBeNull();expect(undos).toBe(1)
 expect(f.bones.map(b=>[b.name,b.parent?.name,b.quaternion.toArray(),b.scale.toArray()])).toEqual(hierarchy)
 for(const [name,p] of Object.entries(original))if(/^(pelvis|thigh|calf|foot)/.test(name))expect(new Vector3().fromArray(joints[name]).distanceTo(new Vector3().fromArray(p)),name).toBeLessThan(1e-7)
 expect(joints.head[1]).toBeGreaterThan(1.68);expect(joints.head[1]).toBeLessThan(1.75)
 expect(joints.neck_01[1]).toBeLessThan(joints.head[1]-.035)
 expect(joints.head_leaf[1]).toBeGreaterThan(joints.head[1]+.1)
 for(const side of ['l','r']){
  expect(joints['upperarm_'+side][2]).toBeLessThan(-.04);expect(joints['lowerarm_'+side][2]).toBeLessThan(-.04)
  expect(Math.abs(joints['upperarm_'+side][0])).toBeGreaterThan(.17);expect(Math.abs(joints['upperarm_'+side][0])).toBeLessThan(.25)
 }
 const small=await woman_fixture(file.file),frame=new Group()
 for(const g of small.geometries)g.scale(.49,.49,.49)
 frame.add(small.model,small.rig);frame.position.set(4,2,-3);frame.rotation.set(.2,.7,-.1);frame.updateMatrixWorld(true)
 fit_humanoid_rig(small.model,small.skeleton,frame,()=>{},'woman')
 for(const b of small.bones)expect(frame.worldToLocal(b.getWorldPosition(new Vector3())).divideScalar(.49).distanceTo(new Vector3().fromArray(joints[b.name])),b.name).toBeLessThan(1e-5)
 for(let n=0;n<3;n++)fit_humanoid_rig(f.model,f.skeleton,null,()=>undos++,'woman')
 expect(undos).toBe(4)
 const repeated=joint_positions(f.skeleton),drift=Math.max(...Object.keys(joints).map(n=>new Vector3().fromArray(joints[n]).distanceTo(new Vector3().fromArray(repeated[n]))))
 expect(drift).toBeLessThan(1e-6)
 fs.writeFileSync('checks/'+file.id+'-fit.json',JSON.stringify({sourceHash:f.hash,pose,joints,repeatDrift:drift,neckSkullRefit:true,legsPreserved:true,scaleAndFrameInvariant:true},null,2))
})
