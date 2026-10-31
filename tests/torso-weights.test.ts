// @vitest-environment node
import { expect,it } from 'vitest'
import { Bone,BufferGeometry,Float32BufferAttribute,Group,Quaternion,Vector3 } from 'three'
import { protect_humanoid_torso } from '../src/lib/solvers/HumanoidTorsoWeights.ts'

it('removes distant arm leakage from the waist but preserves descending arms, shoulders, legs and arbitrary model orientation',()=>{
 const group=new Group(),bones:Bone[]=[]
 const add=(name:string,parent:Bone|null,p:number[])=>{const b=new Bone();b.name=name;b.position.fromArray(p);(parent??group).add(b);bones.push(b);return b}
 const pelvis=add('pelvis',null,[0,1,0]),spine=add('spine_03',pelvis,[0,.6,0])
 for(const side of [-1,1]){const suffix=side===1?'_l':'_r',arm=add('upperarm'+suffix,spine,[side*.2,0,0]),elbow=add('lowerarm'+suffix,arm,[side*.1,-.3,0]);add('hand'+suffix,elbow,[side*.2,-.2,0])}
 const points=[[.15,1.2,0],[.25,1.45,0],[.2,1.6,0],[.1,.8,0]],arm=bones.findIndex(b=>b.name==='upperarm_l'),core=bones.indexOf(spine)
 const run=()=>{group.updateMatrixWorld(true);const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(points.flatMap(p=>group.localToWorld(new Vector3().fromArray(p)).toArray()),3)),ids=points.flatMap(()=>[core,arm,0,0]),weights=points.flatMap(()=>[.8,.2,0,0]);protect_humanoid_torso(geometry,bones,ids,weights);return weights}
 const normal=run();expect(normal[1]).toBeLessThan(1e-8);expect(normal[0]).toBeCloseTo(1);for(const i of [1,2,3])expect(normal.slice(i*4,i*4+4)).toEqual([.8,.2,0,0])
 group.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),1.2));group.position.set(3,-2,5);group.scale.setScalar(4)
 const rotated=run();rotated.forEach((w,i)=>expect(w).toBeCloseTo(normal[i],6))
})
