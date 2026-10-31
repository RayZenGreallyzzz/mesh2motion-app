// @vitest-environment node
import { it,expect } from 'vitest'
import { Bone,BufferGeometry,Float32BufferAttribute,Group,Matrix4,Quaternion,Vector3 } from 'three'
import { protect_humanoid_head } from '../src/lib/solvers/HumanoidHeadWeights.ts'

function fixture(){
 const root=new Group(),neck=new Bone(),head=new Bone(),tip=new Bone(),upper=new Bone(),lower=new Bone(),hand=new Bone(),finger=new Bone()
 const bones=[neck,head,tip,upper,lower,hand,finger]
 bones.forEach((b,i)=>b.name=['neck_01','head','head_leaf','upperarm_l','lowerarm_l','hand_l','index_01_l'][i])
 neck.position.set(0,.9,0);head.position.set(0,.1,0);tip.position.set(0,.2,0)
 root.add(neck,upper);neck.add(head);head.add(tip)
 upper.position.set(.3,.8,0);lower.position.set(0,.2,0);hand.position.set(-.16,.1,.04);finger.position.set(0,.04,0)
 upper.add(lower);lower.add(hand);hand.add(finger);root.updateMatrixWorld(true)
 const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute([-.04,1.1,.04, .14,1.1,.04, 0,.83,0],3))
 const ids=[0,1,0,0, 5,0,0,0, 0,1,0,0],weights=[.9,.1,0,0, 1,0,0,0, 1,0,0,0]
 return{root,head,bones,geometry,ids,weights}
}
it('keeps a hand next to the face and the torso out of the skull region at rotated/scaled frames',()=>{
 for(const scale of [.2,1,5]){
  const f=fixture(),matrix=new Matrix4().compose(new Vector3(3,-2,1),new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),1.1),new Vector3(scale,scale,scale))
  f.root.applyMatrix4(matrix);f.root.updateMatrixWorld(true);f.geometry.applyMatrix4(matrix)
  protect_humanoid_head(f.geometry,f.bones,f.ids,f.weights)
  expect(f.ids[0]).toBe(1);expect(f.weights[0]).toBeCloseTo(1,6)
  expect(f.ids.slice(4)).toEqual([5,0,0,0,0,1,0,0]);expect(f.weights.slice(4)).toEqual([1,0,0,0,1,0,0,0])
 }
})
it('leaves facial and unrelated skeletons unchanged',()=>{
 for(const kind of ['facial','other']){
  const f=fixture(),ii=f.ids.slice(),ww=f.weights.slice()
  if(kind==='facial'){const jaw=new Bone();jaw.name='jaw';f.head.add(jaw);f.bones.push(jaw)}else f.head.name='creature_head'
  expect(protect_humanoid_head(f.geometry,f.bones,f.ids,f.weights)).toBe(0)
  expect(f.ids).toEqual(ii);expect(f.weights).toEqual(ww)
 }
})
