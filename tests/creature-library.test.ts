// @vitest-environment node
import fs from 'node:fs'
import { afterAll, expect, it } from 'vitest'
import { AnimationMixer, Vector3, type SkinnedMesh } from 'three'
import packs from '../src/library/phoenix-packs.json'
import { library_asset } from './library-fixtures.ts'
import { dispose_rig_scene, restore_rig_pose } from '../src/my-rigs/RigAsset.ts'
import { inspect_transfer, suggest_mapping, transfer_clips } from '../src/my-rigs/RigMotionTransfer.ts'
const reports:unknown[]=[]
afterAll(()=>fs.writeFileSync('checks/v80-creature-library.json',JSON.stringify(reports,null,2)))
for(const pack of packs)it('validates every native clip of '+pack.title,async()=>{
 const asset=await library_asset('static/'+pack.path)
 try {
  expect(asset.clips.length).toBe(pack.clips)
  expect([...asset.nodes.values()].filter(n=>n.is_joint).length).toBe(pack.bones)
  const meshes:SkinnedMesh[]=[];asset.scene.traverse(o=>{if((o as SkinnedMesh).isSkinnedMesh)meshes.push(o as SkinnedMesh)})
  let maxWeightError=0,invalid=0,samples=0
  for(const m of meshes){const w=m.geometry.getAttribute('skinWeight'),ids=m.geometry.getAttribute('skinIndex');for(let i=0;i<w.count;i++){let sum=0;for(let k=0;k<4;k++){const v=w.getComponent(i,k),j=ids.getComponent(i,k);sum+=v;if(!Number.isFinite(v)||v<0||!Number.isInteger(j)||j<0||j>=m.skeleton.bones.length)invalid++}maxWeightError=Math.max(maxWeightError,Math.abs(sum-1))}}
  expect(invalid).toBe(0);expect(maxWeightError).toBeLessThan(.001)
  const mixer=new AnimationMixer(asset.scene),p=new Vector3(),map=suggest_mapping(asset,asset)
  for(let i=0;i<asset.clips.length;i++){
   const source=asset.clips[i],copy=transfer_clips(asset,asset,map,[i])[0]
   expect(copy.tracks.map(t=>[Array.from(t.times),Array.from(t.values),t.getInterpolation()])).toEqual(source.tracks.map(t=>[Array.from(t.times),Array.from(t.values),t.getInterpolation()]))
   const action=mixer.clipAction(copy).play()
   for(const f of [0,.17,.53,.89]){action.time=source.duration*f;mixer.update(0);asset.scene.updateMatrixWorld(true)
    for(const n of asset.nodes.values())if(!n.object.matrixWorld.elements.every(Number.isFinite))invalid++
    for(const m of meshes){m.skeleton.update();const count=m.geometry.getAttribute('position').count;for(let j=0;j<count;j+=Math.max(1,Math.ceil(count/120))){m.getVertexPosition(j,p);if(!Number.isFinite(p.lengthSq()))invalid++;samples++}}
   }
   mixer.stopAllAction();mixer.uncacheClip(copy);restore_rig_pose(asset)
  }
  expect(invalid).toBe(0)
  reports.push({id:pack.id,category:pack.category,bones:pack.bones,clips:asset.clips.length,vertexSamples:samples,maxWeightError,exactTracksPreserved:true})
 }finally{dispose_rig_scene(asset.scene)}
},60000)
for(const [from,to] of [['wolf','fox'],['bull','cow'],['dragon','dragon_evolved'],['greenblob','pinkblob'],['demon','bluedemon']])it('audits cross-creature transfer '+from+' → '+to,async()=>{
 const source=await library_asset('static/packs/phoenix/monsters/'+from+'.glb'),target=await library_asset('static/packs/phoenix/monsters/'+to+'.glb')
 try{
  const map=suggest_mapping(source,target),report=inspect_transfer(source,target,map,[0]),clips=transfer_clips(source,target,map,[0]),mixer=new AnimationMixer(target.scene)
  const action=mixer.clipAction(clips[0]).play();for(const f of [0,.2,.5,.9]){action.time=clips[0].duration*f;mixer.update(0);target.scene.updateMatrixWorld(true);expect([...target.nodes.values()].every(n=>n.object.matrixWorld.elements.every(Number.isFinite))).toBe(true)}
  mixer.stopAllAction();reports.push({from,to,...report})
 }finally{dispose_rig_scene(source.scene);dispose_rig_scene(target.scene)}
})

it('retains squash and stretch in all nine real slime clips on a compatible second slime rig',async()=>{
 const source=await library_asset('static/packs/phoenix/monsters/greenblob.glb'),target=await library_asset('static/packs/phoenix/monsters/pinkblob.glb')
 try{
  const map=suggest_mapping(source,target),clips=transfer_clips(source,target,map,source.clips.map((_,i)=>i),{deformation:true}),mixer=new AnimationMixer(target.scene)
  expect(clips).toHaveLength(9);let scales=0
  for(let i=0;i<clips.length;i++){
   const expected=source.clips[i].tracks.filter(t=>t.name.endsWith('.scale'));scales+=expected.length
   expect(clips[i].tracks.filter(t=>t.name.endsWith('.scale'))).toHaveLength(expected.length)
   const action=mixer.clipAction(clips[i]).play()
   for(const f of [0,.17,.53,.89]){action.time=clips[i].duration*f;mixer.update(0);target.scene.updateMatrixWorld(true);expect([...target.nodes.values()].every(n=>n.object.matrixWorld.elements.every(Number.isFinite)&&n.object.scale.toArray().every(v=>v>0))).toBe(true)}
   mixer.stopAllAction();restore_rig_pose(target)
  }
  expect(scales).toBeGreaterThan(0);reports.push({from:'greenblob',to:'pinkblob',mode:'deformation',clips:clips.length,scaleTracks:scales})
 }finally{dispose_rig_scene(source.scene);dispose_rig_scene(target.scene)}
})
