// @vitest-environment node
import { expect, it } from 'vitest'
import { AnimationMixer, Quaternion, Vector3, InterpolateLinear } from 'three'
import { asset_from_motion, type MotionDocument } from '../src/my-rigs/MotionDocument.ts'
import { inspect_transfer, suggest_mapping, transfer_clips } from '../src/my-rigs/RigMotionTransfer.ts'

function creature (size = 1, extra = false) {
 const names=['Root','Body','Lid','Tip',...(extra?['Decoration']:[])]
 const doc:MotionDocument={version:1,format:'fbx',name:'Creature',warnings:[],nodes:names.map((name,i)=>({name,joint:true,parent:i?i-1:-1,position:[0,i?size:0,0],rotation:[0,0,0,1],scale:[1,1,1]})),clips:[{name:'Squash and jump',duration:1,tracks:[
  {node:0,property:'position',times:new Float32Array([0,.5,1]),values:new Float32Array([0,0,0,0,2,1,0,0,2]),interpolation:InterpolateLinear},
  {node:1,property:'scale',times:new Float32Array([0,.5,1]),values:new Float32Array([1,1,1,1.5,.5,1.5,1,1,1]),interpolation:InterpolateLinear},
  {node:2,property:'position',times:new Float32Array([0,.5,1]),values:new Float32Array([0,size,0,0,size*1.5,0,0,size,0]),interpolation:InterpolateLinear},
  {node:2,property:'quaternion',times:new Float32Array([0,.5,1]),values:new Float32Array([0,0,0,1,...new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.8).toArray(),0,0,0,1]),interpolation:InterpolateLinear}
 ]}]}
 return asset_from_motion(doc)
}
it('transfers squash, jump and a lid from four to five bones without editing the target rest data',()=>{
 const source=creature(),target=creature(2,true),map=suggest_mapping(source,target),before=target.signature
 const clip=transfer_clips(source,target,map,[0],{deformation:true,in_place:true})[0]
 const mixer=new AnimationMixer(target.scene),action=mixer.clipAction(clip).play();action.time=.5;mixer.update(0)
 expect(target.nodes.get('n1')!.object.scale.toArray()).toEqual([1.5,.5,1.5])
 expect(target.nodes.get('n2')!.object.position.y).toBeCloseTo(3)
 expect(target.nodes.get('n2')!.object.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.8))).toBeLessThan(.0001)
 expect(target.nodes.get('n0')!.object.position.y).toBeCloseTo(4)
 expect(target.nodes.get('n0')!.object.position.z).toBeCloseTo(0)
 expect(target.nodes.get('n4')!.object.scale.toArray()).toEqual([1,1,1])
 expect(target.signature).toBe(before);expect(target.nodes.get('n2')!.position.y).toBe(2)
 mixer.stopAllAction()
})
it('keeps stretch opt-in and rejects incompatible axes, missing moving joints and nonpositive scales atomically',()=>{
 const source=creature(),target=creature(2,true),map=suggest_mapping(source,target)
 const normal=transfer_clips(source,target,map,[0])[0]
 expect(normal.tracks.some(t=>t.name.endsWith('.scale'))).toBe(false)
 expect(inspect_transfer(source,target,map,[0]).warnings.join(' ')).toContain('Деформация')
 const missing={...map};delete missing.n1
 expect(()=>transfer_clips(source,target,missing,[0],{deformation:true})).toThrow()
 target.nodes.get('n2')!.rotation.setFromAxisAngle(new Vector3(0,1,0),.5)
 expect(()=>transfer_clips(source,target,map,[0],{deformation:true})).toThrow(/осей/)
 target.nodes.get('n2')!.rotation.identity()
 source.clips[0].tracks.find(t=>t.name.endsWith('.scale'))!.values[4]=-1
 expect(()=>transfer_clips(source,target,map,[0],{deformation:true})).toThrow(/масштаб/)
 expect(target.clips).toHaveLength(1)
})
it('preserves named wing branches even when sibling traversal order changes',()=>{
 const a=creature(),b=creature(2,true)
 const names=['Root','Wing_A.L','Wing_A2.L','Wing_B.L']
 for(let i=0;i<4;i++){a.nodes.get('n'+i)!.name=names[i];b.nodes.get('n'+i)!.name=names[i]}
 b.nodes=new Map([...b.nodes].reverse())
 const map=suggest_mapping(a,b)
 for(let i=0;i<4;i++)expect(map['n'+i]).toBe('n'+i)
})
it('leaves duplicated unknown joint names for manual mapping instead of guessing the first branch',()=>{
 const source=creature(),target=creature(2,true)
 source.nodes.get('n1')!.name='Antenna';source.nodes.get('n2')!.name='Antenna'
 target.nodes.get('n1')!.name='Antenna';target.nodes.get('n2')!.name='DifferentTip'
 const map=suggest_mapping(source,target)
 expect(map.n1).toBeUndefined();expect(map.n2).toBeUndefined()
})
