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

it('keeps the skull rigid when a shoulder is closer than the head axis', () => {
 const root = new Group(), neck = new Bone(), head = new Bone(), tip = new Bone(), arm = new Bone(), elbow = new Bone()
 const bones = [neck, head, tip, arm, elbow]
 bones.forEach((bone, i) => { bone.name = ['neck_01', 'head', 'head_leaf', 'upperarm_l', 'lowerarm_l'][i] })
 root.add(neck, arm); neck.add(head); head.add(tip); arm.add(elbow)
 neck.position.set(0, .9, 0); head.position.y = .06; tip.position.y = .3
 arm.position.set(.22, .97, 0); elbow.position.set(.2, 0, 0)
 root.updateMatrixWorld(true)
 const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([.13, 1.025, 0], 3))
 const indices = [3, 0, 0, 0], weights = [1, 0, 0, 0]
 protect_humanoid_head(geometry, bones, indices, weights)
 expect(indices[0]).toBe(1)
 expect(weights[0]).toBeCloseTo(1, 6)
})

it('blends the centre of the neck into the chest without assigning the shoulder to the neck', () => {
 const root = new Group(), chest = new Bone(), neck = new Bone(), head = new Bone(), tip = new Bone(), arm = new Bone(), elbow = new Bone()
 const bones = [chest, neck, head, tip, arm, elbow]
 bones.forEach((bone, i) => { bone.name = ['spine_03', 'neck_01', 'head', 'head_leaf', 'upperarm_l', 'lowerarm_l'][i] })
 root.add(chest); chest.add(neck, arm); neck.add(head); head.add(tip); arm.add(elbow)
 chest.position.y = .8; neck.position.y = .1; head.position.y = .08; tip.position.y = .25
 arm.position.set(.18, .09, 0); elbow.position.set(.23, -.1, 0)
 root.updateMatrixWorld(true)
 const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, .92, .04, .18, .89, 0], 3))
 const indices = [4, 0, 0, 0, 4, 0, 0, 0], weights = [1, 0, 0, 0, 1, 0, 0, 0]
 protect_humanoid_head(geometry, bones, indices, weights, true)
 const weightOf = (vertex: number, bone: number) => weights.slice(vertex * 4, vertex * 4 + 4).reduce(
   (sum, weight, slot) => sum + (indices[vertex * 4 + slot] === bone ? weight : 0), 0)
 expect(weightOf(0, 0)).toBeGreaterThan(0)
 expect(weightOf(0, 1)).toBeGreaterThan(.5)
 expect(weightOf(0, 4)).toBeCloseTo(0)
 expect(weightOf(1, 4)).toBe(1)
})

it('keeps the lower face rigid while applying the full-rig neck correction', () => {
 const root = new Group(), chest = new Bone(), neck = new Bone(), head = new Bone(), tip = new Bone(), arm = new Bone(), elbow = new Bone()
 const bones = [chest, neck, head, tip, arm, elbow]
 bones.forEach((bone, i) => { bone.name = ['spine_03', 'neck_01', 'head', 'head_leaf', 'upperarm_l', 'lowerarm_l'][i] })
 root.add(chest); chest.add(neck, arm); neck.add(head); head.add(tip); arm.add(elbow)
 chest.position.y = .8; neck.position.y = .1; head.position.y = .08; tip.position.y = .25
 arm.position.set(.18, .2, 0); elbow.position.set(.23, -.1, 0)
 root.updateMatrixWorld(true)
 const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([.09, .99, 0, .09, 1.03, 0], 3))
 const indices = [2, 0, 0, 0, 2, 0, 0, 0], weights = [1, 0, 0, 0, 1, 0, 0, 0]
 protect_humanoid_head(geometry, bones, indices, weights, true)
 expect(weights[0]).toBeCloseTo(1, 6)
 expect(weights[4]).toBeCloseTo(1, 6)
 expect(indices[0]).toBe(2)
 expect(indices[4]).toBe(2)
})

it('keeps a compact skull rigid near shoulder armour and preserves a raised hand inside the skull region', () => {
 const root = new Group()
 const [pelvis, chest, neck, head, tip, upper, lower, hand, finger] = [
  'pelvis', 'spine_03', 'neck_01', 'head', 'head_leaf', 'upperarm_l', 'lowerarm_l', 'hand_l', 'index_01_l'
 ].map(name => { const bone = new Bone(); bone.name = name; return bone })
 const bones = [pelvis, chest, neck, head, tip, upper, lower, hand, finger]
 root.add(pelvis); pelvis.add(chest); chest.add(neck, upper); neck.add(head); head.add(tip)
 upper.add(lower); lower.add(hand); hand.add(finger)
 pelvis.position.y = .4; chest.position.y = .42; neck.position.y = .1
 head.position.y = .06; tip.position.y = .2
 upper.position.set(.13, .14, 0); lower.position.set(.24, 0, 0); hand.position.x = .24; finger.position.x = .03
 root.updateMatrixWorld(true)
 const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([.076, 1.027, 0], 3))
 const indices = [5, 0, 0, 0], weights = [1, 0, 0, 0]
 protect_humanoid_head(geometry, bones, indices, weights, true)
 expect(indices[0]).toBe(3)
 expect(weights[0]).toBeCloseTo(1, 6)

 lower.position.set(.18, .03, 0); hand.position.set(-.24, .037, 0); finger.position.set(0, .04, 0)
 root.updateMatrixWorld(true)
 geometry.setAttribute('position', new Float32BufferAttribute([.07, 1.047, 0], 3))
 indices.splice(0, 4, 7, 0, 0, 0); weights.splice(0, 4, 1, 0, 0, 0)
 protect_humanoid_head(geometry, bones, indices, weights, true)
 expect(indices).toEqual([7, 0, 0, 0])
 expect(weights).toEqual([1, 0, 0, 0])
})
