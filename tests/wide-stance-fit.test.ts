// @vitest-environment node
import fs from 'node:fs'
import { it, expect } from 'vitest'
import { Box3, Group, Vector3 } from 'three'
import { woman_fixture, joint_positions } from './woman-fixtures.ts'
import { fit_humanoid_rig } from '../src/lib/processes/edit-skeleton/HumanoidAutoFit.ts'

const file='../rig81-models/красноволосаямалышка.glb'
for(const profile of ['human','woman'] as const)it(profile+': wide-stance knees and hip sockets stay inside their own leg sections',async()=>{
 const f=await woman_fixture(file,0),hierarchy=f.bones.map(b=>[b.name,b.parent?.name,b.quaternion.toArray(),b.scale.toArray()])
 fit_humanoid_rig(f.model,f.skeleton,null,()=>{},profile)
 const joints=joint_positions(f.skeleton),box=new Box3().setFromObject(f.model),h=box.max.y-box.min.y
 expect(h).toBeCloseTo(2,5);expect(f.bones.map(b=>[b.name,b.parent?.name,b.quaternion.toArray(),b.scale.toArray()])).toEqual(hierarchy)
 const rows=[]
 for(const sign of [-1,1])for(const ratio of [.07,.285,.40,.46,.50]){
  const pts:Vector3[]=[]
  for(const g of f.geometries){const p=g.getAttribute('position');for(let i=0;i<p.count;i+=5){const v=new Vector3().fromBufferAttribute(p,i);if(Math.abs(v.y-box.min.y-h*ratio)<h*.012&&v.x*sign>h*.01)pts.push(v)}}
  const values=(axis:'x'|'z')=>pts.map(p=>p[axis]).sort((a,b)=>a-b)
  const x=values('x'),z=values('z'),q=(a:number[],t:number)=>a[Math.floor((a.length-1)*t)]
  rows.push({sign,ratio,count:pts.length,x:[q(x,.1),q(x,.5),q(x,.9)],z:[q(z,.1),q(z,.5),q(z,.9)]})
 }
 fs.writeFileSync('checks/v81-wide-stance-'+profile+'.json',JSON.stringify({box,joints,rows},null,2))
 for(const row of rows.filter(r=>r.ratio===.285||r.ratio===.50)){
  const name=(row.ratio===.285?'calf':'thigh')+(row.sign>0?'_l':'_r'),p=joints[name]
  expect(row.count).toBeGreaterThan(50)
  expect(p[0],name+' x').toBeGreaterThan(row.x[0]);expect(p[0],name+' x').toBeLessThan(row.x[2])
  expect(p[2],name+' z').toBeGreaterThan(row.z[0]-.01);expect(p[2],name+' z').toBeLessThan(row.z[2]+.01)
 }
 for(const side of ['l','r'])expect(Math.abs(joints['thigh_'+side][0])).toBeLessThan(.17)
 if(profile==='woman'){
  for(let i=0;i<3;i++)fit_humanoid_rig(f.model,f.skeleton,null,()=>{},profile)
  for(const b of f.bones)expect(b.getWorldPosition(new Vector3()).distanceTo(new Vector3().fromArray(joints[b.name]))).toBeLessThan(1e-6)
 }
},60000)

it('keeps the red model fit in the same coordinates after setup rotation, translation and scale',async()=>{
 const f=await woman_fixture(file,0);fit_humanoid_rig(f.model,f.skeleton,null,()=>{},'woman');const joints=joint_positions(f.skeleton)
 const small=await woman_fixture(file,0),frame=new Group()
 for(const g of small.geometries)g.scale(.49,.49,.49)
 frame.add(small.model,small.rig);frame.position.set(4,2,-3);frame.rotation.set(.2,.7,-.1);frame.scale.setScalar(1.7);frame.updateMatrixWorld(true)
 fit_humanoid_rig(small.model,small.skeleton,frame,()=>{},'woman')
 for(const b of small.bones)expect(frame.worldToLocal(b.getWorldPosition(new Vector3())).divideScalar(.49).distanceTo(new Vector3().fromArray(joints[b.name])),b.name).toBeLessThan(1e-5)
},60000)
