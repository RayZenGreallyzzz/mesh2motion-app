import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { AnimationMixer, Vector3, type AnimationClip, type SkinnedMesh } from 'three'
import { export_rig_asset, load_rig_asset } from '../src/my-rigs/RigAssetLoader.ts'
import { dispose_rig_scene, restore_rig_pose, type RigAsset } from '../src/my-rigs/RigAsset.ts'
import { inspect_transfer, suggest_mapping, transfer_clips } from '../src/my-rigs/RigMotionTransfer.ts'
import { inspect_skin_weights } from '../src/my-rigs/RigSkinDiagnostics.ts'

const targetPath=process.env.RIG_TEST_MODEL??'../rig74-input/exportedдемон-model.glb'
function parts(bytes:ArrayBuffer){const v=new DataView(bytes),n=v.getUint32(12,true);return {doc:JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,n))),binary:new Uint8Array(bytes,28+n,v.getUint32(20+n,true))}}
function noTextures(bytes:ArrayBuffer):ArrayBuffer{
 const {doc,binary}=parts(bytes);delete doc.images;delete doc.textures;delete doc.materials;delete doc.samplers
 for(const m of doc.meshes??[])for(const p of m.primitives)delete p.material
 doc.extensionsRequired=doc.extensionsRequired?.filter((e:string)=>e!=='EXT_texture_webp')
 const j=new TextEncoder().encode(JSON.stringify(doc)),n=Math.ceil(j.length/4)*4,out=new ArrayBuffer(28+n+binary.length),v=new DataView(out),u=new Uint8Array(out)
 v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,out.byteLength,true);v.setUint32(12,n,true);v.setUint32(16,0x4e4f534a,true);u.fill(32,20,20+n);u.set(j,20);v.setUint32(20+n,binary.length,true);v.setUint32(24+n,0x004e4942,true);u.set(binary,28+n);return out
}
function array(b:Buffer){return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer}
async function load(path:string){const bytes=array(fs.readFileSync(path)),asset=await load_rig_asset(noTextures(bytes),path);asset.source_bytes=bytes;return asset}
function hashSkin(a:RigAsset){const h=createHash('sha256');a.scene.traverse(o=>{const m=o as SkinnedMesh;if(!m.isSkinnedMesh)return;for(const key of ['position','skinIndex','skinWeight']){const a=m.geometry.getAttribute(key).array;h.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength))}h.update(JSON.stringify(m.skeleton.boneInverses.map(x=>x.toArray())))});return h.digest('hex')}
const assets:RigAsset[]=[];let target:RigAsset,ual:RigAsset,monster:RigAsset
const result:Record<string,unknown>={}

describe.skipIf(!fs.existsSync(targetPath))('Uploaded demon: real library retarget and GLB roundtrip',()=>{
 beforeAll(async()=>{target=await load(targetPath);ual=await load('baseline/packs/phoenix/ual2-standard.glb');monster=await load('baseline/packs/phoenix/monsters/demon.glb');assets.push(target,ual,monster);result.input={bones:[...target.nodes.values()].filter(n=>n.is_joint).length,clips:target.clips.map(c=>c.name)}})
 afterAll(()=>{fs.mkdirSync('checks',{recursive:true});fs.writeFileSync('checks/real-model.json',JSON.stringify(result,null,2));assets.forEach(a=>dispose_rig_scene(a.scene))})
 it('imports the four existing clips and generates finite poses from two different donor rigs',()=>{
  expect([...target.nodes.values()].filter(n=>n.is_joint)).toHaveLength(60);expect(target.clips).toHaveLength(4)
  const hash=hashSkin(target), reports=[]
  for(const source of [ual,monster]){
   const indices=[...new Set([/run|dash/i,/walk/i,/attack|sword/i,/idle/i].map(pattern=>source.clips.findIndex(c=>pattern.test(c.name))).filter(i=>i>=0))]
   expect(indices.length).toBeGreaterThan(0)
   const mapping=suggest_mapping(source,target),report=inspect_transfer(source,target,mapping,indices),clips=transfer_clips(source,target,mapping,indices)
   expect(report.mapped_bones).toBeGreaterThan(15)
   const bounds=[]
   for(const clip of clips){
    for(const fraction of [0,.2,.5,.8,.99]){
     restore_rig_pose(target);const mixer=new AnimationMixer(target.scene),action=mixer.clipAction(clip);action.play();action.time=clip.duration*fraction;mixer.update(0);target.scene.updateMatrixWorld(true)
     for(const n of target.nodes.values()){
      expect([...n.object.position.toArray(),...n.object.quaternion.toArray(),...n.object.scale.toArray()].every(Number.isFinite)).toBe(true)
      if(n.is_joint&&!['root','mixamorigHips'].includes(n.name))expect(n.object.position.distanceTo(n.position),n.name).toBeLessThan(1e-6)
     }
     let max=0;target.scene.traverse(o=>{const m=o as SkinnedMesh;if(!m.isSkinnedMesh)return;m.skeleton.update();const pos=m.geometry.getAttribute('position');for(let i=0;i<pos.count;i+=Math.max(1,Math.floor(pos.count/300))){const p=m.getVertexPosition(i,new Vector3());expect(p.toArray().every(Number.isFinite)).toBe(true);max=Math.max(max,p.length())}})
     bounds.push(max);mixer.stopAllAction();mixer.uncacheRoot(target.scene)
    }
   }
   reports.push({source:source.name,report,clips:clips.map(c=>c.name),maxSampledRadius:Math.max(...bounds)})
  }
  expect(hashSkin(target)).toBe(hash);expect(target.clips).toHaveLength(4);result.transfers=reports
 })
 it('detects arm/leg weight contamination in the original demon without changing its skin',()=>{
  const before=hashSkin(target),report=inspect_skin_weights(target)
  expect(report.cross_limb_vertices).toBeGreaterThan(0);expect(report.checked_vertices).toBe(874773);expect(hashSkin(target)).toBe(before)
  result.skinDiagnostics=report
 })
 it('exports added animation without changing any original nodes, skins, texture bytes or weights',async()=>{
  const before=parts(target.source_bytes),hash=hashSkin(target),source=ual,map=suggest_mapping(source,target)
  const clip=transfer_clips(source,target,map,[0])[0];target.clips.push(clip);target.dirty=true
  const bytes=await export_rig_asset(target),after=parts(bytes)
  expect(after.doc.nodes).toEqual(before.doc.nodes);expect(after.doc.skins).toEqual(before.doc.skins);expect(after.doc.meshes).toEqual(before.doc.meshes);expect(after.doc.images).toEqual(before.doc.images);expect(after.doc.materials).toEqual(before.doc.materials)
  const oldLength=before.doc.buffers[0].byteLength;expect(Buffer.compare(Buffer.from(after.binary.subarray(0,oldLength)),Buffer.from(before.binary.subarray(0,oldLength)))).toBe(0)
  expect(hashSkin(target)).toBe(hash)
  const reopened=await load_rig_asset(noTextures(bytes),'Roundtrip');assets.push(reopened);expect(reopened.clips).toHaveLength(5);expect(hashSkin(reopened)).toBe(hash)
  const original=target.clips[4],returned=reopened.clips[4];expect(returned.name).toBe(original.name);expect(returned.duration).toBeCloseTo(original.duration,5);expect(returned.tracks.map(t=>Array.from(t.values))).toEqual(original.tracks.map(t=>Array.from(t.values)))
  result.export={bytes:bytes.byteLength,originalBytes:target.source_bytes.byteLength,bones:60,clips:reopened.clips.length,preservedBinaryPrefix:true,skinHash:hash}
 })
 it('handles a torso named Hips and detached feet on a baked creature rig',()=>{
  const mapping=suggest_mapping(ual,monster),pelvis=[...ual.nodes.values()].find(n=>n.name==='pelvis')!,body=[...monster.nodes.values()].find(n=>n.name==='Body')!
  expect(mapping[pelvis.id]).toBe(body.id)
  const index=ual.clips.findIndex(c=>/walk/i.test(c.name)),before=hashSkin(monster)
  restore_rig_pose(monster);monster.scene.updateMatrixWorld(true);const restPositions=new Map([...monster.nodes.values()].map(n=>[n.id,n.object.getWorldPosition(new Vector3())]));const report=inspect_transfer(ual,monster,mapping,[index]),clip=transfer_clips(ual,monster,mapping,[index])[0]
  expect(report.mapped_bones).toBeGreaterThan(20)
  for(const fraction of [0,.2,.5,.9]){
   restore_rig_pose(monster);const mixer=new AnimationMixer(monster.scene),action=mixer.clipAction(clip);action.play();action.time=clip.duration*fraction;mixer.update(0)
   for(const n of monster.nodes.values()){
    expect(n.object.quaternion.toArray().every(Number.isFinite)).toBe(true)
    if(n.is_joint&&!['Body','Root','FootL','FootR'].includes(n.name))expect(n.object.position.distanceTo(n.position),n.name).toBeLessThan(1e-6)
   }
   for(const side of ['L','R']){
    const foot=[...monster.nodes.values()].find(n=>n.name==='Foot'+side)!,calf=[...monster.nodes.values()].find(n=>n.name==='LowerLeg'+side)!
    expect(foot.object.getWorldPosition(new Vector3()).distanceTo(calf.object.getWorldPosition(new Vector3()))).toBeCloseTo(restPositions.get(foot.id)!.distanceTo(restPositions.get(calf.id)!),5)
   }
   mixer.stopAllAction();mixer.uncacheRoot(monster.scene)
  }
  expect(hashSkin(monster)).toBe(before);result.creaturePelvis={source:'pelvis',target:'Body',mapped:report.mapped_bones}
 })
 it('exports a model with zero selected animations as a valid animation-free GLB',async()=>{
  const bytes=await export_rig_asset(target,[]),doc=parts(bytes).doc;expect(doc.animations).toBeUndefined();const reopened=await load_rig_asset(noTextures(bytes),'No clips');assets.push(reopened);expect(reopened.clips).toHaveLength(0)
 })
})
