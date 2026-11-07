// @vitest-environment node
import { expect,it } from 'vitest'
import { Bone,BufferGeometry,Float32BufferAttribute,Group,Quaternion,Vector3 } from 'three'
import { protect_humanoid_torso } from '../src/lib/solvers/HumanoidTorsoWeights.ts'

it('does not magnify different tiny spine seeds into an animated torso crease',()=>{
 const group=new Group(),bones:Bone[]=[]
 const add=(name:string,parent:Bone|null,p:number[])=>{const b=new Bone();b.name=name;b.position.fromArray(p);(parent??group).add(b);bones.push(b);return b}
 const pelvis=add('pelvis',null,[0,1,0]),low=add('spine_01',pelvis,[0,.2,0]),mid=add('spine_02',low,[0,.2,0]),top=add('spine_03',mid,[0,.2,0])
 for(const side of [-1,1]){const suffix=side===1?'_l':'_r',arm=add('upperarm'+suffix,top,[side*.2,0,0]),elbow=add('lowerarm'+suffix,arm,[side*.1,-.3,0]);add('hand'+suffix,elbow,[side*.2,-.2,0])}
 group.updateMatrixWorld(true)
 const points=[new Vector3(.13,1.22,-.07),new Vector3(.1301,1.2201,-.07)],geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(points.flatMap(p=>p.toArray()),3)),arm=bones.findIndex(b=>b.name==='upperarm_l'),a=bones.indexOf(low),b=bones.indexOf(top)
 for(const seed of [.001,.1]){
 const ids=[arm,a,0,0,arm,b,0,0],weights=[1-seed,seed,0,0,1-seed,seed,0,0]
 protect_humanoid_torso(geometry,bones,ids,weights)
 const field=(vertex:number)=>{const w=new Map<number,number>();for(let k=0;k<4;k++)w.set(ids[vertex*4+k],(w.get(ids[vertex*4+k])??0)+weights[vertex*4+k]);return w},left=field(0),right=field(1)
 const difference=bones.reduce((sum,_,i)=>sum+Math.abs((left.get(i)??0)-(right.get(i)??0)),0)
 expect(difference).toBeLessThan(.01)
 for(let i=0;i<2;i++)expect(weights.slice(i*4,i*4+4).reduce((s,w)=>s+w,0)).toBeCloseTo(1,6)
 }
 geometry.dispose()
})

it('removes distant arm leakage from the waist but preserves descending arms, shoulders, legs and arbitrary model orientation',()=>{
 const group=new Group(),bones:Bone[]=[]
 const add=(name:string,parent:Bone|null,p:number[])=>{const b=new Bone();b.name=name;b.position.fromArray(p);(parent??group).add(b);bones.push(b);return b}
 const pelvis=add('pelvis',null,[0,1,0]),spine=add('spine_03',pelvis,[0,.6,0])
 for(const side of [-1,1]){const suffix=side===1?'_l':'_r',arm=add('upperarm'+suffix,spine,[side*.2,0,0]),elbow=add('lowerarm'+suffix,arm,[side*.1,-.3,0]);add('hand'+suffix,elbow,[side*.2,-.2,0])}
 const points=[[.15,1.2,0],[.25,1.45,0],[.2,1.6,0],[.1,.8,0]],arm=bones.findIndex(b=>b.name==='upperarm_l'),core=bones.indexOf(spine)
 const run=()=>{group.updateMatrixWorld(true);const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(points.flatMap(p=>group.localToWorld(new Vector3().fromArray(p)).toArray()),3)),ids=points.flatMap(()=>[core,arm,0,0]),weights=points.flatMap(()=>[.8,.2,0,0]);protect_humanoid_torso(geometry,bones,ids,weights);return {weights,ids}}
 const normal=run();const armTotal=normal.weights.slice(0,4).reduce((sum,w,k)=>sum+(normal.ids[k]===arm?w:0),0);expect(armTotal).toBeLessThan(1e-8);expect(normal.weights.slice(0,4).reduce((a,b)=>a+b,0)).toBeCloseTo(1);for(const i of [1,2,3])expect(normal.weights.slice(i*4,i*4+4)).toEqual([.8,.2,0,0])
 group.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),1.2));group.position.set(3,-2,5);group.scale.setScalar(4)
 const rotated=run();rotated.weights.forEach((w,i)=>expect(w).toBeCloseTo(normal.weights[i],6));expect(rotated.ids).toEqual(normal.ids)
})
