// @vitest-environment node
import fs from 'node:fs'
import { it, expect } from 'vitest'
import { Box3, Vector3, SkinnedMesh, Mesh, Skeleton } from 'three'
import { fit_humanoid_rig } from '../src/lib/processes/edit-skeleton/HumanoidAutoFit.ts'
import { ChestWeightGuard } from '../src/lib/solvers/ChestWeightGuard.ts'
import { Utility } from '../src/lib/Utilities.ts'

import { load_without_textures } from './chest-fixtures.ts'
it('analyzes the actual uploaded mesh and chest region without altering the source file',async()=>{
 const model=await load_without_textures('../rig76-input/tripo_pbr_model_91da88a4-4f8c-4fe6-b9f3-c463ccfa016f_meshopt (1).glb'),mesh=model.scene.children.find(o=>(o as Mesh).isMesh) as Mesh,position=mesh.geometry.getAttribute('position')
 const slices=[]
 for(const y of [-.43,-.35,.05,.12,.18,.24,.30,.35]) {let min=Infinity,max=-Infinity,count=0;for(let i=0;i<position.count;i++)if(Math.abs(position.getY(i)-y)<.02){min=Math.min(min,position.getX(i));max=Math.max(max,position.getX(i));count++}slices.push({y,min,max,count})}
 mesh.geometry.rotateY(-Math.PI/2);mesh.geometry.computeBoundingBox();const bounds=mesh.geometry.boundingBox!,height=bounds.max.y-bounds.min.y;mesh.geometry.translate(0,-bounds.min.y,0);mesh.geometry.scale(2/height,2/height,2/height)
 const rig=await load_without_textures('baseline/rigs/rig-human.glb'),bones=Utility.bone_list_from_hierarchy(rig.scene),skeleton=new Skeleton(bones)
 const pose=fit_humanoid_rig(model.scene,skeleton,null,()=>{}),guard=new ChestWeightGuard(bones,[mesh.geometry],{enabled:true,strength:1,width:1,height:1,offset:0})
 const cloud=[];let selected=0
 for(let i=0;i<position.count;i++){const p=new Vector3().fromBufferAttribute(position,i),mask=guard.mask(p);if(mask>.5)selected++;if(i%35===0)cloud.push([...p.toArray(),mask])}
 const report={vertices:position.count,slices,pose,selected,guard:guard.stats,bones:bones.map(b=>({name:b.name,position:b.getWorldPosition(new Vector3()).toArray()}))}
 fs.writeFileSync('checks/chest-model-audit.json',JSON.stringify(report,null,2));fs.writeFileSync('checks/chest-cloud.json',JSON.stringify(cloud));fs.writeFileSync('checks/chest-rig.json',JSON.stringify(bones.map(b=>({name:b.name,parent:bones.indexOf(b.parent as never),position:b.getWorldPosition(new Vector3()).toArray()}))))
 expect(guard.stats.available).toBe(true);expect(selected).toBeGreaterThan(1000)
},60000)
