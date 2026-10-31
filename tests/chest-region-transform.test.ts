// @vitest-environment node
import {it,expect} from 'vitest'
import {Bone,Group,BufferGeometry,Float32BufferAttribute,SphereGeometry,Vector3,Quaternion,Matrix4} from 'three'
import {ChestWeightGuard,default_chest_guard} from '../src/lib/solvers/ChestWeightGuard.ts'
it('keeps the anatomical region attached after rotation, translation and uniform scale',()=>{
 const root=new Group(),bones:Bone[]=[]
 const add=(name:string,parent:Group|Bone,x:number,y:number,z:number)=>{const b=new Bone();b.name=name;b.position.set(x,y,z);parent.add(b);bones.push(b);return b}
 const pelvis=add('pelvis',root,0,1,0),spine=add('spine_01',pelvis,0,.2,0),chest=add('spine_03',spine,0,.3,0)
 for(const [side,sign] of [['l',1],['r',-1]] as const){const clavicle=add('clavicle_'+side,chest,sign*.10,.05,0),upper=add('upperarm_'+side,clavicle,sign*.13,0,0);add('lowerarm_'+side,upper,sign*.17,-.2,0)}root.updateMatrixWorld(true)
 const positions:number[]=[];for(const sign of [-1,1]){const sphere=new SphereGeometry(.14,24,16).translate(sign*.12,1.34,.14);positions.push(...sphere.attributes.position.array);sphere.dispose()}
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));const options={...default_chest_guard(),enabled:true},a=new ChestWeightGuard(bones,[g],options),p=new Vector3(),reference=[]
 for(let i=0;i<positions.length/3;i++)reference.push(a.mask(p.fromBufferAttribute(g.getAttribute('position'),i)));expect(reference.filter(v=>v>.5).length).toBeGreaterThan(100)
 const rotation=new Quaternion().setFromAxisAngle(new Vector3(.4,.8,.2).normalize(),1.1),translation=new Vector3(7,-3,2),matrix=new Matrix4().compose(translation,rotation,new Vector3(3.7,3.7,3.7));root.position.copy(translation);root.quaternion.copy(rotation);root.scale.setScalar(3.7);root.updateMatrixWorld(true);g.applyMatrix4(matrix)
 const b=new ChestWeightGuard(bones,[g],options);expect(a.stats.available&&b.stats.available).toBe(true);let error=0;for(let i=0;i<reference.length;i++)error=Math.max(error,Math.abs(reference[i]-b.mask(p.fromBufferAttribute(g.getAttribute('position'),i))));expect(error).toBeLessThan(.0001)
})
