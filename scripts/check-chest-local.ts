/** Offline regression/repair for an owner-supplied GLB. No asset is uploaded. */
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs'
import {dirname} from 'node:path'
import {createHash} from 'node:crypto'
import {AnimationMixer,Float32BufferAttribute,Quaternion,Uint16BufferAttribute,Vector3,type SkinnedMesh} from 'three'
import {load_without_textures} from '../tests/chest-fixtures.ts'
import {build_rig_asset,restore_rig_pose,type RigAsset} from '../src/my-rigs/RigAsset.ts'
import {inspect_glb} from '../src/my-rigs/GlbEnvelope.ts'
import {humanoid_world_geometry} from '../src/my-rigs/Humanoid65Builder.ts'
import {ChestWeightGuard,default_chest_guard} from '../src/lib/solvers/ChestWeightGuard.ts'
import {suggest_mapping,transfer_clips} from '../src/my-rigs/RigMotionTransfer.ts'
import {write_clips_glb} from '../src/my-rigs/GlbClipWriter.ts'
const read=(path:string)=>{const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer}
async function load(path:string){const b=read(path);return build_rig_asset(await load_without_textures(path),inspect_glb(b),b,path)}
const hash=(bytes:ArrayBuffer)=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
const [input,output,donor,clipName]=process.argv.slice(2)
if(!input||!output||!donor)throw Error('Usage: check-chest-local input.glb output.glb animations.glb [clip-name]')
const asset=await load(input),sourceHash=hash(asset.source_bytes),original=asset.source_bytes,view=new DataView(original),jsonLength=view.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(new Uint8Array(original,20,jsonLength))),prefix=new Uint8Array(original,28+jsonLength,doc.buffers[0].byteLength)
const chunks=[{at:0,bytes:prefix}];let size=Math.ceil(prefix.length/4)*4
function append(values:number[],integer=false){const a=integer?new Uint16Array(values):new Float32Array(values),bytes=new Uint8Array(a.buffer),bv=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:size,byteLength:bytes.length});chunks.push({at:size,bytes});size=Math.ceil((size+bytes.length)/4)*4;doc.accessors.push({bufferView:bv,componentType:integer?5123:5126,count:values.length/4,type:'VEC4'});return doc.accessors.length-1}
const meshes:Array<{mesh:SkinnedMesh,positions:ReturnType<typeof humanoid_world_geometry>,ids:number[],weights:number[],mask:Float32Array,guard:ChestWeightGuard}>=[]
let modified=0,coreBefore=0,coreAfter=0,core=0,untouched=0,maxSumError=0
for(const node of asset.nodes.values()){
 const mesh=node.object as SkinnedMesh;if(!mesh.isSkinnedMesh)continue
 const geometry=humanoid_world_geometry(mesh),si=mesh.geometry.attributes.skinIndex,sw=mesh.geometry.attributes.skinWeight,ids:number[]=[],weights:number[]=[]
 for(let i=0;i<si.count;i++)for(let k=0;k<4;k++){ids.push(si.getComponent(i,k));weights.push(sw.getComponent(i,k))}
 const oldIds=ids.slice(),oldWeights=weights.slice(),guard=new ChestWeightGuard(mesh.skeleton.bones,[geometry],{...default_chest_guard(),enabled:true,full_anterior:true}),mask=guard.apply(geometry,ids,weights,true)!
 if(!guard.stats.available)throw Error(guard.stats.reason)
 modified+=guard.stats.changed
 const arm=(id:number)=>/^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/.test(mesh.skeleton.bones[id].name)
 for(let i=0;i<si.count;i++){
  let sum=0;for(let k=0;k<4;k++){const at=i*4+k,w=weights[at];if(!Number.isFinite(w)||w<0||w>1||!Number.isInteger(ids[at])||ids[at]<0||ids[at]>=mesh.skeleton.bones.length)throw Error('Invalid repaired weight');sum+=w;if(mask[i]===0&&(w!==oldWeights[at]||ids[at]!==oldIds[at]))throw Error('Unselected vertex changed');if(mask[i]>.999999){if(arm(oldIds[at]))coreBefore+=oldWeights[at];if(arm(ids[at]))coreAfter+=w}}
  maxSumError=Math.max(maxSumError,Math.abs(sum-1));if(mask[i]===0)untouched++;if(mask[i]>.999999)core++
 }
 const match=/^n(\d+)(?:\/p(\d+))?$/.exec(node.id);if(!match)throw Error('Unassociated source mesh')
 const primitive=doc.meshes[doc.nodes[Number(match[1])].mesh].primitives[Number(match[2]??0)]
 primitive.attributes.JOINTS_0=append(ids,true);primitive.attributes.WEIGHTS_0=append(weights)
 meshes.push({mesh,positions:geometry,ids,weights,mask,guard})
}
if(!modified||coreAfter>coreBefore*.001||maxSumError>1e-6)throw Error('Chest repair regression')
doc.buffers[0].byteLength=size
const json=new TextEncoder().encode(JSON.stringify(doc)),padded=Math.ceil(json.length/4)*4,repaired=new Uint8Array(28+padded+size),out=new DataView(repaired.buffer)
out.setUint32(0,0x46546c67,true);out.setUint32(4,2,true);out.setUint32(8,repaired.length,true);out.setUint32(12,padded,true);out.setUint32(16,0x4e4f534a,true);repaired.fill(32,20,20+padded);repaired.set(json,20);out.setUint32(20+padded,size,true);out.setUint32(24+padded,0x004e4942,true);chunks.forEach(c=>repaired.set(c.bytes,28+padded+c.at))
mkdirSync(dirname(output),{recursive:true});const temp=output+'.weights.glb';writeFileSync(temp,repaired)
const saved=await load(temp),fixed=[...saved.nodes.values()].map(n=>n.object as SkinnedMesh).filter(m=>m.isSkinnedMesh),poses=[]
let bindMax=0
for(let m=0;m<fixed.length;m++){const mesh=fixed[m],raw=mesh.geometry.attributes.position;mesh.skeleton.update();for(let i=0;i<raw.count;i++){const p=new Vector3().fromBufferAttribute(raw,i);bindMax=Math.max(bindMax,mesh.applyBoneTransform(i,p.clone()).applyMatrix4(mesh.matrixWorld).distanceTo(p.applyMatrix4(mesh.matrixWorld)))}}
if(bindMax>2e-5)throw Error('Bind pose changed')
for(const degrees of [30,60,100]){
 for(const a of [asset,saved]){restore_rig_pose(a);for(const n of a.nodes.values())if(n.is_joint&&/^(clavicle|upperarm)_[lr]$/.test(n.name))n.object.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),(n.name.endsWith('_l')?1:-1)*degrees*Math.PI/180));a.scene.updateMatrixWorld(true)}
 let before=0,after=0,samples=0,armDifference=0
 for(let j=0;j<meshes.length;j++){const a=meshes[j].mesh,b=fixed[j],pos=a.geometry.attributes.position;a.skeleton.update();b.skeleton.update();for(let i=0;i<pos.count;i++){
  const raw=new Vector3().fromBufferAttribute(pos,i),pa=a.applyBoneTransform(i,raw.clone()).applyMatrix4(a.matrixWorld),pb=b.applyBoneTransform(i,raw.clone()).applyMatrix4(b.matrixWorld),rest=raw.applyMatrix4(a.matrixWorld)
  if(!pa.toArray().every(Number.isFinite)||!pb.toArray().every(Number.isFinite))throw Error('Nonfinite skin')
  if(meshes[j].mask[i]>.999999){before+=pa.distanceTo(rest);after+=pb.distanceTo(rest);samples++}
  if(Math.abs(rest.x)>.4 && rest.y>.45)armDifference=Math.max(armDifference,pa.distanceTo(pb))
 }}
 if(after>before*.005||armDifference>1e-6)throw Error('Arm pose regression')
 poses.push({degrees,samples,beforeMean:before/samples,afterMean:after/samples,farArmMaxDifference:armDifference})
}
restore_rig_pose(saved)
const donorAsset=await load(donor),index=clipName?donorAsset.clips.findIndex(c=>c.name===clipName):Math.max(0,donorAsset.clips.findIndex(c=>/cheer|hook|punch/i.test(c.name)))
if(index<0)throw Error('Animation name not found')
saved.clips=transfer_clips(donorAsset,saved,suggest_mapping(donorAsset,saved),[index]);const final=write_clips_glb(saved,[0]);if(!final)throw Error('Lossless clip writer unavailable')
writeFileSync(output+'.tmp',new Uint8Array(final));renameSync(output+'.tmp',output)
const reload=await load(output),mixer=new AnimationMixer(reload.scene),action=mixer.clipAction(reload.clips[0]).play();let checked=0
for(const fraction of [0,.25,.5,.75,.999]){action.time=reload.clips[0].duration*fraction;mixer.update(0);reload.scene.updateMatrixWorld(true);for(const n of reload.nodes.values()){const m=n.object as SkinnedMesh;if(!m.isSkinnedMesh)continue;m.skeleton.update();const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++){const point=m.applyBoneTransform(i,new Vector3().fromBufferAttribute(p,i));if(!point.toArray().every(Number.isFinite))throw Error('Nonfinite exported animation');checked++}}}
const n=new DataView(final).getUint32(12,true),finalPrefix=new Uint8Array(final,28+n,prefix.length)
if(prefix.some((v,i)=>v!==finalPrefix[i])||hash(read(input))!==sourceHash)throw Error('Source bytes changed')
const report={vertices:asset.vertex_count,bones:[...reload.nodes.values()].filter(n=>n.is_joint).length,modified,untouched,core,coreArmBefore:coreBefore/core,coreArmAfter:coreAfter/core,maxSumError,bindMax,poses,clip:{name:reload.clips[0].name,duration:reload.clips[0].duration,tracks:reload.clips[0].tracks.length,checkedVertexFrames:checked},originalBinaryPrefixPreserved:true,sourceSha256:sourceHash,outputSha256:hash(final),outputBytes:final.byteLength}
writeFileSync(output+'.report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
