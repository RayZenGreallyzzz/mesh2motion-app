import { describe, expect, it } from 'vitest'
import { AnimationClip, AnimationMixer, Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Quaternion, QuaternionKeyframeTrack, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, VectorKeyframeTrack } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { build_rig_asset, type RigAsset, restore_rig_pose } from '../src/my-rigs/RigAsset.ts'
import { inspect_transfer, suggest_mapping, transfer_clips, transfer_clips_async } from '../src/my-rigs/RigMotionTransfer.ts'

function fixture (target: boolean, count: number): RigAsset {
  const scene = new Group(), bones: Bone[] = [], ids = new Map<string, Bone>(), k = target ? 1.5 : 1
  const names: Record<string, string> = { pelvis:'Hips', spine1:'Spine', spine2:'Spine1', spine3:'Spine2', neck:'Neck', head:'Head', clavicle_l:'LeftShoulder', upperarm_l:'LeftArm', lowerarm_l:'LeftForeArm', hand_l:'LeftHand', clavicle_r:'RightShoulder', upperarm_r:'RightArm', lowerarm_r:'RightForeArm', hand_r:'RightHand', thigh_l:'LeftUpLeg', calf_l:'LeftLeg', foot_l:'LeftFoot', thigh_r:'RightUpLeg', calf_r:'RightLeg', foot_r:'RightFoot' }
  const add = (name: string, parent: string | undefined, p: number[], q?: Quaternion): Bone => {
    const bone = new Bone(); bone.name = target && names[name] ? 'mixamorig' + names[name] : name
    bone.position.fromArray(p); if (q) bone.quaternion.copy(q)
    ;(parent ? ids.get(parent)! : scene).add(bone); bones.push(bone); ids.set(name,bone); return bone
  }
  add('root',undefined,[0,0,0]);add('pelvis','root',[0,k,0]);add('spine1','pelvis',[0,.2*k,0])
  add('spine2','spine1',[0,.2*k,0]);if(target)add('spine3','spine2',[0,.1*k,0])
  const chest=target?'spine3':'spine2';add('neck',chest,[0,.2*k,0]);add('head','neck',[0,.15*k,0])
  for(const [side,sign] of [['l',1],['r',-1]] as const){
    add('clavicle_'+side,chest,[sign*.12*k,.05*k,0]);add('upperarm_'+side,'clavicle_'+side,[sign*.16*k,0,0],target?new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-sign*.5):undefined)
    add('lowerarm_'+side,'upperarm_'+side,[sign*.35*k,0,0]);add('hand_'+side,'lowerarm_'+side,[sign*.3*k,0,0])
    add('thigh_'+side,'pelvis',[sign*.15*k,0,0]);add('calf_'+side,'thigh_'+side,[0,-.5*k,0]);add('foot_'+side,'calf_'+side,[0,-.5*k,0])
    if(target){add('rig_volume_lowerarm_'+side,'upperarm_'+side,[sign*.35*k,0,0]);add('rig_volume_calf_'+side,'thigh_'+side,[0,-.5*k,0])}
  }
  while(bones.length<count)add((target?'extra_target_':'extra_source_')+bones.length,'hand_l',[.01,0,0])
  scene.updateMatrixWorld(true)
  const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute([0,1,0,.1,1,0,0,1.1,0],3));geo.setAttribute('skinIndex',new Uint16BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));geo.setAttribute('skinWeight',new Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4))
  const mesh=new SkinnedMesh(geo,new MeshBasicMaterial());mesh.name='Mesh';scene.add(mesh);mesh.bind(new Skeleton(bones));scene.updateMatrixWorld(true)
  const objects=[...bones,mesh],associations=new Map(objects.map((o,i)=>[o,{nodes:i}]))
  const parentIndices = objects.map(o=>({name:o.name,children:o.children.filter(c=>objects.includes(c as Bone)).map(c=>objects.indexOf(c as Bone))}))
  const gltf={scene,animations:[],parser:{associations}} as unknown as GLTF
  const asset=build_rig_asset(gltf,{asset:{version:'2.0'},nodes:parentIndices,skins:[{joints:bones.map((_,i)=>i)}]},new ArrayBuffer(0),target?'Target':'Source')
  if(!target){
    const tracks=[
      new QuaternionKeyframeTrack(ids.get('root')!.uuid+'.quaternion',[0,1],[0,0,0,1,0,Math.sin(.3),0,Math.cos(.3)]),
      new VectorKeyframeTrack(ids.get('root')!.uuid+'.position',[0,1],[0,0,0,0,.1,1]),
      new VectorKeyframeTrack(ids.get('pelvis')!.uuid+'.position',[0,1],[0,k,0,0,k+.2,.3]),
      new QuaternionKeyframeTrack(ids.get('spine2')!.uuid+'.quaternion',[0,1],[0,0,0,1,0,0,Math.sin(.1),Math.cos(.1)]),
      new QuaternionKeyframeTrack(ids.get('lowerarm_l')!.uuid+'.quaternion',[0,1],[0,0,0,1,0,0,Math.sin(.5),Math.cos(.5)]),
      new VectorKeyframeTrack(ids.get('lowerarm_l')!.uuid+'.position',[0,1],[.35,0,0,.35,0,0]),
      new VectorKeyframeTrack(ids.get('lowerarm_l')!.uuid+'.scale',[0,1],[1,1,1,1,1,1])
    ];asset.clips=[new AnimationClip('Motion',1,tracks)]
  }
  return asset
}
function joint(asset:RigAsset,name:string){return [...asset.nodes.values()].find(n=>n.name===name)!}
function skin(asset:RigAsset){const m=[...asset.nodes.values()].find(n=>n.is_mesh)!.object as SkinnedMesh;return {weights:Array.from(m.geometry.getAttribute('skinWeight').array),indices:Array.from(m.geometry.getAttribute('skinIndex').array),bind:m.bindMatrix.toArray(),inverses:m.skeleton.boneInverses.map(m=>m.toArray()),names:m.skeleton.bones.map(b=>b.name)}}
function pose(asset:RigAsset,clip:AnimationClip,time:number){restore_rig_pose(asset);const mixer=new AnimationMixer(asset.scene);const a=mixer.clipAction(clip);a.play();a.time=time;mixer.update(0);asset.scene.updateMatrixWorld(true);return mixer}

describe('Unequal-skeleton motion transfer',()=>{
 it('recognizes an animation-only humanoid GLB hierarchy without skin declarations',()=>{
  const original=fixture(false,41),objects=[...original.nodes.values()],associations=new Map(objects.map(n=>[n.object,{nodes:Number(n.id.slice(1))}]))
  const source=build_rig_asset({scene:original.scene,animations:original.clips,parser:{associations}} as unknown as GLTF,{asset:{version:'2.0'},nodes:objects.map(n=>({name:n.name}))},new ArrayBuffer(0),'Animation only')
  expect(source.inferred_skeleton).toBe(true)
  const target=fixture(true,60),map=suggest_mapping(source,target),before=skin(target)
  expect(inspect_transfer(source,target,map,[0]).mapped_bones).toBeGreaterThan(15)
  expect(transfer_clips(source,target,map,[0])[0].tracks.length).toBeGreaterThan(15)
  expect(skin(target)).toEqual(before)
 })
 it('does not infer bones from disconnected or ambiguous names or from an unanimated body',()=>{
  for(const mode of ['broken','unanimated','ambiguous']){
   const original=fixture(false,41),objects=[...original.nodes.values()],associations=new Map(objects.map(n=>[n.object,{nodes:Number(n.id.slice(1))}]))
   if(mode==='broken')original.scene.attach(joint(original,'calf_l').object)
   if(mode==='ambiguous')objects.find(n=>n.name.startsWith('extra_source_'))!.object.name='head'
   const source=build_rig_asset({scene:original.scene,animations:mode==='unanimated'?[]:original.clips,parser:{associations}} as unknown as GLTF,{asset:{version:'2.0'},nodes:objects.map(n=>({name:n.name}))},new ArrayBuffer(0),'Scene')
   expect(source.inferred_skeleton).toBe(false);expect([...source.nodes.values()].some(n=>n.is_joint)).toBe(false)
  }
 })
 it('transfers 41 to 60 bones while retaining hierarchy, weights, bind data and limb lengths',()=>{
  const source=fixture(false,41),target=fixture(true,60),map=suggest_mapping(source,target),before=skin(target)
  expect(inspect_transfer(source,target,map,[0]).mapped_bones).toBeGreaterThan(15)
  const clips=transfer_clips(source,target,map,[0]);expect(target.clips).toHaveLength(0);expect(skin(target)).toEqual(before)
  for(const time of [0,.13,.5,.9]){
   const mixer=pose(target,clips[0],time)
   for(const n of target.nodes.values()) if(n.is_joint&&!['root','mixamorigHips'].includes(n.name)) expect(n.object.position.distanceTo(n.position)).toBeLessThan(1e-7)
   expect(skin(target)).toEqual(before);mixer.stopAllAction()
  }
 })
 it('aligns A and T pose arm directions without changing the native bind pose',()=>{
  const source=fixture(false,41),target=fixture(true,60),clip=transfer_clips(source,target,suggest_mapping(source,target),[0])[0]
  pose(source,source.clips[0],.4);pose(target,clip,.4)
  const direction=(a:RigAsset,start:string,end:string)=>joint(a,end).object.getWorldPosition(new Vector3()).sub(joint(a,start).object.getWorldPosition(new Vector3())).normalize()
  expect(direction(source,'upperarm_l','lowerarm_l').dot(direction(target,'mixamorigLeftArm','mixamorigLeftForeArm'))).toBeGreaterThan(.99999)
  expect(direction(source,'lowerarm_l','hand_l').dot(direction(target,'mixamorigLeftForeArm','mixamorigLeftHand'))).toBeGreaterThan(.99999)
 })
 it('includes the motion of unmapped intermediate source bones',()=>{
  const source=fixture(false,41),target=fixture(true,60),map=suggest_mapping(source,target),spine=joint(source,'spine2');delete map[spine.id]
  const clip=transfer_clips(source,target,map,[0],{match_pose:false})[0];pose(source,source.clips[0],.5);pose(target,clip,.5)
  const sq=joint(source,'upperarm_r').object.getWorldQuaternion(new Quaternion()),tq=joint(target,'mixamorigRightArm').object.getWorldQuaternion(new Quaternion())
  const rest=joint(target,'mixamorigRightArm').world_rotation
  expect(tq.angleTo(sq.multiply(rest))).toBeLessThan(1e-4)
 })
 it('preserves extra target bones and drives the four volume helpers',()=>{
  const source=fixture(false,41),target=fixture(true,60),clip=transfer_clips(source,target,suggest_mapping(source,target),[0],{match_pose:false})[0]
  pose(target,clip,.5)
  const forearm=joint(target,'mixamorigLeftForeArm'),helper=joint(target,'rig_volume_lowerarm_l')
  expect(helper.object.quaternion.angleTo(new Quaternion().slerp(forearm.object.quaternion,.5))).toBeLessThan(1e-4)
  const extra=[...target.nodes.values()].find(n=>n.name.startsWith('extra_target_'))!;expect(extra.object.quaternion.angleTo(extra.rotation)).toBeLessThan(1e-7)
  expect(clip.tracks.filter(t=>[...target.nodes.values()].filter(n=>n.name.startsWith('rig_volume_')).some(n=>t.name===n.object.uuid+'.quaternion'))).toHaveLength(4)
 })
 it('scales root travel to leg length and keeps jumps when playing in place',()=>{
  const source=fixture(false,41),target=fixture(true,60),map=suggest_mapping(source,target)
  expect(inspect_transfer(source,target,map,[0]).scale).toBeCloseTo(1.5)
  const moving=transfer_clips(source,target,map,[0])[0];pose(target,moving,.5)
  expect(joint(target,'root').object.position.z).toBeCloseTo(.75)
  const inplace=transfer_clips(source,target,map,[0],{in_place:true})[0];pose(target,inplace,.5)
  expect(joint(target,'root').object.position.z).toBeCloseTo(0);expect(joint(target,'root').object.position.y).toBeGreaterThan(.05)
  expect(joint(target,'mixamorigHips').object.getWorldPosition(new Vector3()).z).toBeCloseTo(0)
 })
 it('anchors a foreign starting origin while retaining later travel and jump height',()=>{
  const source=fixture(false,41),target=fixture(true,60),root=joint(source,'root'),map=suggest_mapping(source,target)
  const track=source.clips[0].tracks.find(t=>t.name===root.object.uuid+'.position')!;track.values=new Float32Array([10,4,20,10,4.1,21])
  const clip=transfer_clips(source,target,map,[0])[0];pose(target,clip,0)
  expect(joint(target,'root').object.position.length()).toBeLessThan(1e-6)
  pose(target,clip,.5);expect(joint(target,'root').object.position.z).toBeCloseTo(.75);expect(joint(target,'root').object.position.y).toBeCloseTo(.075)
  const absolute=transfer_clips(source,target,map,[0],{anchor_motion:false})[0];pose(target,absolute,0);expect(joint(target,'root').object.position.z).toBeCloseTo(30)
 })
 it('does not modify a live target pose while baking and rejects duplicate or reversed mappings atomically',()=>{
  const source=fixture(false,41),target=fixture(true,60),map=suggest_mapping(source,target),bone=joint(target,'mixamorigLeftArm');bone.object.quaternion.setFromAxisAngle(new Vector3(1,0,0),.9)
  const before=bone.object.quaternion.clone();transfer_clips(source,target,map,[0]);expect(bone.object.quaternion.equals(before)).toBe(true)
  const a=joint(source,'upperarm_l'),b=joint(source,'lowerarm_l');expect(()=>transfer_clips(source,target,{...map,[a.id]:map[b.id]},[0])).toThrow()
  expect(target.clips).toHaveLength(0)
 })
 it('keeps exact-rig tracks, scale and interpolation unchanged',()=>{
  const source=fixture(false,41),target=fixture(false,41),clip=transfer_clips(source,target,suggest_mapping(source,target),[0])[0]
  expect(clip.tracks.length).toBe(source.clips[0].tracks.length);expect(clip.name).toBe('Motion (2)')
  clip.tracks.forEach((t,i)=>{expect(t.values).toEqual(source.clips[0].tracks[i].values);expect(t.times).toEqual(source.clips[0].tracks[i].times)})
 })
 it('supports a cancelled async transfer without appending partial clips',async()=>{
  const source=fixture(false,41),target=fixture(true,60),abort=new AbortController();abort.abort()
  await expect(transfer_clips_async(source,target,suggest_mapping(source,target),[0],{},()=>{},abort.signal)).rejects.toThrow(/отменён/);expect(target.clips).toHaveLength(0)
 })
})
