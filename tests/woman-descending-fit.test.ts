// @vitest-environment node
import fs from 'node:fs'
import { it, expect } from 'vitest'
import { Group, Vector3 } from 'three'
import { woman_fixture, joint_positions } from './woman-fixtures.ts'
import { fit_humanoid_rig } from '../src/lib/processes/edit-skeleton/HumanoidAutoFit.ts'
it('fits descending arms above the large chest without moving the leg rig', async()=>{
 const f=await woman_fixture('../upload/tripo_pbr_model_91da88a4-4f8c-4fe6-b9f3-c463ccfa016f_meshopt (1).glb')
 fit_humanoid_rig(f.model,f.skeleton,null,()=>{},'woman'); const joints=joint_positions(f.skeleton)
 const points:number[][]=[];for(const g of f.geometries){const p=g.getAttribute('position');for(let i=0;i<p.count;i+=23)points.push([p.getX(i),p.getY(i),p.getZ(i)])}
 fs.writeFileSync('checks/woman-c-fit-study.json',JSON.stringify({joints,points}))
 for(const side of ['l','r']){
  const s=joints['upperarm_'+side],e=joints['lowerarm_'+side],w=joints['hand_'+side]
  expect(s[1]).toBeGreaterThan(1.50);expect(s[1]).toBeLessThan(1.65)
  expect(Math.abs(s[0])).toBeLessThan(.24);expect(Math.abs(s[0])).toBeGreaterThan(.14)
  expect(s[1]).toBeGreaterThan(e[1]);expect(e[1]).toBeGreaterThan(w[1])
 }
 const small=await woman_fixture('../upload/tripo_pbr_model_91da88a4-4f8c-4fe6-b9f3-c463ccfa016f_meshopt (1).glb'),frame=new Group()
 for(const g of small.geometries)g.scale(.49,.49,.49)
 frame.add(small.model,small.rig);frame.position.set(4,2,-3);frame.rotation.set(.2,.7,-.1);frame.updateMatrixWorld(true)
 fit_humanoid_rig(small.model,small.skeleton,frame,()=>{},'woman')
 for(const b of small.bones)expect(frame.worldToLocal(b.getWorldPosition(new Vector3())).divideScalar(.49).distanceTo(new Vector3().fromArray(joints[b.name])),b.name).toBeLessThan(1e-5)
 fit_humanoid_rig(f.model,f.skeleton,null,()=>{},'woman')
 for(const b of f.bones)expect(b.getWorldPosition(new Vector3()).distanceTo(new Vector3().fromArray(joints[b.name]))).toBeLessThan(1e-6)
},60000)
