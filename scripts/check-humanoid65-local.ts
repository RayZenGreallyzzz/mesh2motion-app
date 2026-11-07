import {readFileSync,writeFileSync} from 'node:fs'
import {AnimationClip,AnimationMixer,Quaternion,QuaternionKeyframeTrack,Vector3,type SkinnedMesh} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {build_rig_asset,restore_rig_pose} from '../src/my-rigs/RigAsset.ts'
import {build_humanoid65} from '../src/my-rigs/Humanoid65Builder.ts'
import {validate_humanoid65} from '../src/my-rigs/NativeRigValidation.ts'
import {inspect_glb} from '../src/my-rigs/GlbEnvelope.ts'
function parts(bytes:ArrayBuffer){const v=new DataView(bytes),n=v.getUint32(12,true);return{doc:JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,n))),bin:new Uint8Array(bytes,28+n)}}
function read(path:string):ArrayBuffer{const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer}
async function load(bytes:ArrayBuffer){const {doc,bin}=parts(bytes),clean=structuredClone(doc);delete clean.images;delete clean.textures;delete clean.materials;for(const m of clean.meshes??[])for(const p of m.primitives)delete p.material;const json=new TextEncoder().encode(JSON.stringify(clean)),n=Math.ceil(json.length/4)*4,b=new Uint8Array(28+n+bin.length),v=new DataView(b.buffer);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,b.length,true);v.setUint32(12,n,true);v.setUint32(16,0x4e4f534a,true);b.fill(32,20,20+n);b.set(json,20);v.setUint32(20+n,bin.length,true);v.setUint32(24+n,0x004e4942,true);b.set(bin,28+n);const gltf=await new GLTFLoader().parseAsync(b.buffer,'');return build_rig_asset(gltf,inspect_glb(bytes),bytes,'Humanoid65 local check')}
const [input,templatePath,output]=process.argv.slice(2);const source=read(input),template=read(templatePath),asset=await load(source)
const result=await build_humanoid65(asset,{template,direct_solver:true,progress:s=>console.error(s)})
const saved=await load(result.bytes),a=parts(source),b=parts(result.bytes);validate_humanoid65(saved)
if(a.bin.subarray(0,a.doc.buffers[0].byteLength).some((n,i)=>n!==b.bin[i]))throw new Error('Original binary prefix changed')
const bones=[...saved.nodes.values()].filter(n=>n.is_joint);if(bones.length!==65)throw new Error('Not 65 joints after reload')
const headNode=bones.find(n=>n.name==='head')!,neckNode=bones.find(n=>n.name==='neck_01')!,headPlane=headNode.object.getWorldPosition(new Vector3()).y+headNode.object.getWorldPosition(new Vector3()).distanceTo(neckNode.object.getWorldPosition(new Vector3()))*.5
const skinMeshes:SkinnedMesh[]=[];saved.scene.traverse(o=>{if((o as SkinnedMesh).isSkinnedMesh)skinMeshes.push(o as SkinnedMesh)})
let bindMax=0,headVerts=0,headShoulderInfluence=0,fingerWeights=0;const meshesReport=[]
for(const mesh of skinMeshes){mesh.skeleton.update();const pos=mesh.geometry.attributes.position,si=mesh.geometry.attributes.skinIndex,sw=mesh.geometry.attributes.skinWeight;const names=mesh.skeleton.bones.map(b=>b.name);const current=[]
for(let i=0;i<pos.count;i++){const p=new Vector3().fromBufferAttribute(pos,i),q=mesh.applyBoneTransform(i,p.clone());bindMax=Math.max(bindMax,p.distanceTo(q)*mesh.getWorldScale(new Vector3()).x);current.push(q.toArray());const world=p.applyMatrix4(mesh.matrixWorld);let sum=0
for(let c=0;c<4;c++){const w=sw.getComponent(i,c),name=names[si.getComponent(i,c)];sum+=w;if(world.y>headPlane&&/^(clavicle|upperarm|lowerarm|spine)/.test(name))headShoulderInfluence+=w;if(/^(thumb|index|middle|ring|pinky)/.test(name))fingerWeights+=w}if(Math.abs(sum-1)>.00001)throw new Error('Weights not normalized');if(world.y>headPlane)headVerts++}
meshesReport.push({mesh,rest:current,names})}
if(bindMax>.00002)throw new Error('Bind pose moves geometry: '+bindMax)
const motionChecks=[]
for(const name of ['clavicle_l','clavicle_r','head','lowerarm_l','lowerarm_r','calf_l','calf_r']){
 restore_rig_pose(saved);const node=bones.find(n=>n.name===name)!;const angle=name==='head'?Math.PI/4:Math.PI/2;const delta=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),angle),q=node.rotation.clone().multiply(delta);const clip=new AnimationClip('Probe '+name,1,[new QuaternionKeyframeTrack(node.object.uuid+'.quaternion',[0,1],[...node.rotation.toArray(),...q.toArray()])]);const mixer=new AnimationMixer(saved.scene);const action=mixer.clipAction(clip).play();action.time=1;mixer.update(0);saved.scene.updateWorldMatrix(true,true)
 let highMax=0,finite=true,moved=0
 for(const m of meshesReport){m.mesh.skeleton.update();const pos=m.mesh.geometry.attributes.position;for(let i=0;i<pos.count;i++){const p=m.mesh.applyBoneTransform(i,new Vector3().fromBufferAttribute(pos,i)).applyMatrix4(m.mesh.matrixWorld),base=new Vector3().fromArray(m.rest[i]).applyMatrix4(m.mesh.matrixWorld),dist=p.distanceTo(base);if(!p.toArray().every(Number.isFinite))finite=false;if(dist>.001)moved++;if(base.y>headPlane)highMax=Math.max(highMax,dist)}}
 if(!finite)throw new Error('Non-finite deformation: '+name);motionChecks.push({name,finite,moved,headMaxDisplacement:highMax});mixer.stopAllAction()
}
writeFileSync(output,new Uint8Array(result.bytes));console.log(JSON.stringify({...result.report,bindMax,headPlane,headVerts,headShoulderInfluence,fingerWeights,originalBinaryPrefixPreserved:true,motionChecks},null,2))
