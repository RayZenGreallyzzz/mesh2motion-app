// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
import { AnimationMixer } from 'three'
import { library_asset } from './library-fixtures.ts'
import { dispose_rig_scene, restore_rig_pose } from '../src/my-rigs/RigAsset.ts'
import { suggest_mapping, transfer_clips, inspect_transfer } from '../src/my-rigs/RigMotionTransfer.ts'
import { parse_fbx_motion } from '../src/my-rigs/FbxMotionReader.ts'
import { asset_from_motion } from '../src/my-rigs/MotionDocument.ts'
const reports:unknown[]=[]
afterAll(()=>fs.writeFileSync('checks/v80-uploaded-library.json',JSON.stringify(reports,null,2)))
const directory='../rig80-samples/extracted/AnimationStudio_Mixamo_126_animations'
const files=fs.readdirSync(directory,{recursive:true}).map(String).filter(n=>n.endsWith('.glb'))
it('retargets every clip in the real 126-file Mixamo pack onto 41 and 60 bones',async()=>{
 expect(files).toHaveLength(126)
 const targets=await Promise.all(['../rig74-input/056_Зомби Атака.glb','../rig74-input/exportedдемон-model.glb'].map(library_asset))
 try{for(const file of files){const source=await library_asset(path.join(directory,file))
  try{for(const target of targets){const mapping=suggest_mapping(source,target),indices=source.clips.map((_,i)=>i),report=inspect_transfer(source,target,mapping,indices),clips=transfer_clips(source,target,mapping,indices),mixer=new AnimationMixer(target.scene);let invalid=0,frames=0
   expect(report.mapped_bones).toBeGreaterThan(15)
   for(const clip of clips){const action=mixer.clipAction(clip).play();for(let i=0;i<=Math.ceil(clip.duration*30);i++){action.time=Math.min(i/30,clip.duration-1e-6);mixer.update(0);target.scene.updateMatrixWorld(true);for(const n of target.nodes.values())if(!n.object.matrixWorld.elements.every(Number.isFinite))invalid++;frames++}mixer.stopAllAction();mixer.uncacheClip(clip);restore_rig_pose(target)}
   expect(invalid,file).toBe(0);reports.push({file,targetBones:report.target_bones,mapped:report.mapped_bones,clips:clips.length,frames,finite:true})
  }}finally{dispose_rig_scene(source.scene)}
 }}finally{targets.forEach(t=>dispose_rig_scene(t.scene))}
},180000)
for(const file of ['Running (2)(1).fbx','Zombie Stumbling(1).fbx'])it('imports and transfers multi-mesh Mixamo FBX '+file,async()=>{
 vi.stubGlobal('window',{URL:{createObjectURL:()=> 'data:application/octet-stream;base64,'}})
 const b=fs.readFileSync('../rig80-samples/'+file),doc=parse_fbx_motion(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),file),source=asset_from_motion(doc),target=await library_asset('../rig74-input/056_Зомби Атака.glb')
 try{const map=suggest_mapping(source,target),report=inspect_transfer(source,target,map,[0]),clip=transfer_clips(source,target,map,[0])[0];expect(report.mapped_bones).toBeGreaterThan(12);expect(doc.warnings.join(' ')).toContain('копии');expect(clip.tracks.every(t=>t.values.every(Number.isFinite))).toBe(true);reports.push({file,sourceBones:report.source_bones,mapped:report.mapped_bones,clips:source.clips.length,warnings:doc.warnings})}
 finally{dispose_rig_scene(source.scene);dispose_rig_scene(target.scene);vi.unstubAllGlobals()}
},60000)
for(const file of ['Mimic_and_Outlaw_Rigged_Animations/Mimic_Chest_Rigged_Animated.glb','Infernal_Wyrm_DragonRig_5Animations_Test/Infernal_Wyrm_DragonRig_5Anims_Smoothed.glb'])it('preserves all supplied creature tracks '+file,async()=>{
 const asset=await library_asset('../rig80-samples/extracted/'+file)
 try{const map=suggest_mapping(asset,asset),clips=transfer_clips(asset,asset,map,asset.clips.map((_,i)=>i));expect(clips.length).toBeGreaterThan(4);for(let i=0;i<clips.length;i++)expect(clips[i].tracks.map(t=>Array.from(t.values))).toEqual(asset.clips[i].tracks.map(t=>Array.from(t.values)));reports.push({file,bones:[...asset.nodes.values()].filter(n=>n.is_joint).length,clips:clips.length,allTracksPreserved:true})}finally{dispose_rig_scene(asset.scene)}
})
