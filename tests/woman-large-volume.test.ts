// @vitest-environment node
import fs from 'node:fs'
import {it,expect} from 'vitest'
import {Vector3} from 'three'
import {woman_fixture} from './woman-fixtures.ts'
import {fit_humanoid_rig} from '../src/lib/processes/edit-skeleton/HumanoidAutoFit.ts'
import {ChestWeightGuard,default_chest_guard} from '../src/lib/solvers/ChestWeightGuard.ts'
it('covers the anterior breast surface of the descending-arm large model',async()=>{
 const f=await woman_fixture('../upload/tripo_pbr_model_91da88a4-4f8c-4fe6-b9f3-c463ccfa016f_meshopt (1).glb');fit_humanoid_rig(f.model,f.skeleton,null,()=>{},'woman')
 const guard=new ChestWeightGuard(f.bones,f.geometries,{...default_chest_guard(),enabled:true,anchor_to_chest:true}),p=f.geometries[0].getAttribute('position'),v=new Vector3(),points=[];let count=0,min=1,average=0,below=0,armCount=0,maxArmMask=0
 for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);const mask=guard.mask(v);if(v.y>1.28&&v.y<1.49&&Math.abs(v.x)<.29&&v.z>.09){count++;min=Math.min(min,mask);average+=mask;if(mask<.99)below++}if(Math.abs(v.x)>.32&&v.y>1.06&&v.y<1.3&&v.z<-.055){armCount++;maxArmMask=Math.max(maxArmMask,mask)}if(i%23===0&&v.y>1.15&&v.y<1.7)points.push([...v.toArray(),mask])}
 fs.writeFileSync('checks/woman-c-mask-study.json',JSON.stringify({count,min,average:average/count,below,armCount,maxArmMask,points}))
 expect(count).toBeGreaterThan(10000);expect(min).toBeGreaterThan(.999);expect(below).toBe(0);expect(armCount).toBeGreaterThan(1000);expect(maxArmMask).toBeLessThan(.01)
},60000)
