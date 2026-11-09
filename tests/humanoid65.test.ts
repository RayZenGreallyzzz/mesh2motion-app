// @vitest-environment node
import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {AnimationClip,Quaternion,QuaternionKeyframeTrack,BufferGeometry,Uint16BufferAttribute,type SkinnedMesh,Vector3,Mesh,LatheGeometry,Vector2} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {read_glb} from '../src/test/GlbFixture.ts'
import {build_rig_asset} from '../src/my-rigs/RigAsset.ts'
import {inspect_glb} from '../src/my-rigs/GlbEnvelope.ts'
import {build_humanoid65,humanoid_world_geometry} from '../src/my-rigs/Humanoid65Builder.ts'
import {HumanoidHeadReviewRequired} from '../src/my-rigs/HumanoidHeadReview.ts'
import {validate_humanoid65} from '../src/my-rigs/NativeRigValidation.ts'
import {estimate_limb_joint,joint_fit_surface} from '../src/lib/processes/edit-skeleton/HumanoidJointFit.ts'
const file=(path:string):ArrayBuffer=>{const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer}
async function parse(bytes:ArrayBuffer){const v=new DataView(bytes),len=v.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,len))),clean=structuredClone(doc);delete clean.images;delete clean.textures;delete clean.materials;for(const m of clean.meshes??[])for(const p of m.primitives)delete p.material;const j=new TextEncoder().encode(JSON.stringify(clean)),n=Math.ceil(j.length/4)*4,bin=new Uint8Array(bytes,20+len),out=new Uint8Array(20+n+bin.length),view=new DataView(out.buffer);out.set(new Uint8Array(bytes,0,12));view.setUint32(8,out.length,true);view.setUint32(12,n,true);view.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+n);out.set(j,20);out.set(bin,20+n);const gltf=await new GLTFLoader().parseAsync(out.buffer,'');return build_rig_asset(gltf,inspect_glb(bytes),bytes,'Test human')}
describe('complete humanoid binding',()=>{
 it('decodes normalized integer positions into float world coordinates without truncation',()=>{
  const g=new BufferGeometry();g.setAttribute('position',new Uint16BufferAttribute([0,0,0,65535,65535,65535],3,true));const mesh=new Mesh(g);mesh.position.x=-1;mesh.scale.setScalar(2);mesh.updateMatrixWorld(true)
  const world=humanoid_world_geometry(mesh);expect(Array.from(world.attributes.position.array)).toEqual([-1,0,0,1,2,2]);expect(Array.from(g.attributes.position.array)).toEqual([0,0,0,65535,65535,65535]);world.dispose();g.dispose()
 })
 it.each(['human','woman'] as const)('creates %s with 65 real joints, weighted fingers and unchanged binary geometry',async profile=>{
  const bytes=file('static/models/model-human.glb'),original=new Uint8Array(bytes).slice(),source=build_rig_asset(await read_glb('static/models/model-human.glb'),inspect_glb(bytes),bytes,'Human')
  const result=await build_humanoid65(source,{template:file('static/rigs/rig-human.glb'),profile,direct_solver:true}),asset=await parse(result.bytes)
  validate_humanoid65(asset);expect(result.report.bones).toBe(65);expect(result.report.finger_bones).toBe(40)
  expect(new Uint8Array(bytes)).toEqual(original)
  const a=new DataView(bytes),b=new DataView(result.bytes),prefix=new Uint8Array(bytes,28+a.getUint32(12,true),inspect_glb(bytes).buffers![0].byteLength)
  expect(new Uint8Array(result.bytes,28+b.getUint32(12,true),prefix.length)).toEqual(prefix)
  let bindError=0,fingerWeight=0
  asset.scene.traverse(o=>{const m=o as SkinnedMesh;if(!m.isSkinnedMesh)return;m.skeleton.update();const p=m.geometry.attributes.position,si=m.geometry.attributes.skinIndex,sw=m!.geometry.attributes.skinWeight
   for(let i=0;i<p.count;i++){const v=new Vector3().fromBufferAttribute(p,i);bindError=Math.max(bindError,v.clone().applyMatrix4(m.matrixWorld).distanceTo(m.applyBoneTransform(i,v.clone()).applyMatrix4(m.matrixWorld)));let total=0;for(let c=0;c<4;c++){const w=sw.getComponent(i,c);total+=w;if(/^(thumb|index|middle|ring|pinky)_/.test(m.skeleton.bones[si.getComponent(i,c)].name))fingerWeight+=w}expect(total).toBeCloseTo(1,5)}
  });expect(bindError).toBeLessThan(.00002);expect(fingerWeight).toBeGreaterThan(1)
  let m:SkinnedMesh|undefined,testVertex=-1,best=Infinity
  asset.scene.traverse(o=>{const mesh=o as SkinnedMesh;if(!mesh.isSkinnedMesh)return;const head=mesh.skeleton.bones.find(b=>b.name==='head')!,tip=mesh.skeleton.bones.find(b=>b.name==='head_leaf')!,center=head.getWorldPosition(new Vector3()).lerp(tip.getWorldPosition(new Vector3()),.5),pos=mesh.geometry.attributes.position,indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight,headIndex=mesh.skeleton.bones.indexOf(head)
    for(let i=0;i<pos.count;i++){let own=0;for(let c=0;c<4;c++)if(indices.getComponent(i,c)===headIndex)own+=weights.getComponent(i,c);const d=new Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld).distanceToSquared(center);if(own>.99&&d<best){best=d;m=mesh;testVertex=i}}
  })
  expect(testVertex).toBeGreaterThanOrEqual(0)
  const si=m!.geometry.attributes.skinIndex,sw=m!.geometry.attributes.skinWeight,oldI=[0,1,2,3].map(c=>si.getComponent(testVertex,c)),oldW=[0,1,2,3].map(c=>sw.getComponent(testVertex,c)),shoulder=m!.skeleton.bones.findIndex(b=>b.name==='clavicle_l')
  si.setXYZW(testVertex,shoulder,0,0,0);sw.setXYZW(testVertex,1,0,0,0)
  expect(()=>validate_humanoid65(asset)).toThrow('головы')
  si.setXYZW(testVertex,...oldI as [number,number,number,number]);sw.setXYZW(testVertex,...oldW as [number,number,number,number])
  // Rebinding a saved rig also retains its animation as a real target track.
  const head=[...asset.nodes.values()].find(n=>n.name==='head')!;asset.clips=[new AnimationClip('Head test',1,[new QuaternionKeyframeTrack(head.object.uuid+'.quaternion',[0,1],[...head.rotation.toArray(),...head.rotation.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.5)).toArray()])])]
  const again=await build_humanoid65(asset,{template:file('static/rigs/rig-human.glb'),profile,direct_solver:true});const reloaded=await parse(again.bytes);expect(reloaded.clips).toHaveLength(1);expect(reloaded.clips[0].name).toBe('Head test');expect(reloaded.clips[0].tracks.length).toBeGreaterThan(0)
 },30000)
 it('resumes a reviewed head with real weights and preserves source bytes',async()=>{
  const bytes=file('static/models/model-human.glb'),original=new Uint8Array(bytes).slice(),source=build_rig_asset(await read_glb('static/models/model-human.glb'),inspect_glb(bytes),bytes,'Human'),template=file('static/rigs/rig-human.glb')
  let review:HumanoidHeadReviewRequired|undefined
  try{await build_humanoid65(source,{template,review_head:true,direct_solver:true})}catch(error){if(error instanceof HumanoidHeadReviewRequired)review=error;else throw error}
  expect(review).toBeInstanceOf(HumanoidHeadReviewRequired);expect(source.dirty).toBe(false);expect(new Uint8Array(bytes)).toEqual(original)
  const result=await build_humanoid65(source,{template,head_landmarks:review!.points,direct_solver:true})
  expect(result.report.head_fit_source).toBe('manual');validate_humanoid65(await parse(result.bytes));expect(new Uint8Array(bytes)).toEqual(original)
 },30000)
 it('cancels before modifying the source and rejects an incomplete hand template',async()=>{
  const bytes=file('static/models/model-human.glb'),source=build_rig_asset(await read_glb('static/models/model-human.glb'),inspect_glb(bytes),bytes,'Human'),abort=new AbortController();abort.abort()
  await expect(build_humanoid65(source,{template:file('static/rigs/rig-human.glb'),signal:abort.signal,direct_solver:true})).rejects.toThrow('отменён');expect(source.dirty).toBe(false)
 })
 it('does not mistake a distal cuff for the elbow in the humanoid completion profile',()=>{
  const mesh=new Mesh(new LatheGeometry([new Vector2(.08,0),new Vector2(.11,.3),new Vector2(.055,.5),new Vector2(.1,.64),new Vector2(.018,.86),new Vector2(.06,1)],24));mesh.position.x=.3;mesh.updateMatrixWorld(true)
  const e=estimate_limb_joint(joint_fit_surface(mesh,null),new Vector3(.3,0,0),new Vector3(.3,1,0),new Vector3(.3,.5,0),0,'elbow',{max_fraction:.70,max_shift:.18})
  expect(e).not.toBeNull();expect(e!.point.y).toBeCloseTo(.5,1)
 })
})
