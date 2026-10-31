// @vitest-environment node
import fs from 'node:fs'
import { it,expect } from 'vitest'
import { AnimationMixer,Vector3,SkinnedMesh,Box3 } from 'three'
import { load_without_textures } from './chest-fixtures.ts'
it('audits the side and underarm transition on the exported dense woman model',async()=>{
 const gltf=await load_without_textures('checks/woman-c-manual-roundtrip.glb');let mesh!:SkinnedMesh;gltf.scene.traverse(o=>{if((o as SkinnedMesh).isSkinnedMesh)mesh=o as SkinnedMesh})
 const g=mesh.geometry,p=g.getAttribute('position'),ii=g.getAttribute('skinIndex'),ww=g.getAttribute('skinWeight'),box=new Box3().setFromBufferAttribute(p as any),h=box.max.y-box.min.y
 const mixer=new AnimationMixer(gltf.scene),clip=gltf.animations.find(c=>/Cheering/i.test(c.name))!,action=mixer.clipAction(clip).play();action.time=clip.duration*.99;mixer.update(0);gltf.scene.updateMatrixWorld(true)
 const side:any[]=[],underarm:any[]=[],v=new Vector3(),q=new Vector3();let invalid=0,waistCount=0,maxWaistArm=0
 const item=(i:number,w:number)=>({i,arm:w,rest:v.clone().divideScalar(h).toArray(),posed:q.clone().divideScalar(h).toArray(),weights:Array.from({length:4},(_,k)=>[mesh.skeleton.bones[ii.getComponent(i,k)].name,ww.getComponent(i,k)])})
 for(let i=0;i<p.count;i++){
  v.fromBufferAttribute(p,i);const y=(v.y-box.min.y)/h,x=Math.abs(v.x)/h
  if(y<.50||y>.80||x<.055||x>.11)continue
  mesh.applyBoneTransform(i,q.copy(v));if(!Number.isFinite(q.lengthSq()))invalid++
  let arm=0;for(let k=0;k<4;k++)if(/arm|hand|clavicle/.test(mesh.skeleton.bones[ii.getComponent(i,k)].name))arm+=ww.getComponent(i,k)
  if(y>.57&&y<.62&&x>.085&&x<.105&&v.z/h>-.02&&v.z/h<.02){waistCount++;maxWaistArm=Math.max(maxWaistArm,arm)}
  const out=y<.65?side:underarm
  if(out.length<20||arm>out[out.length-1].arm){out.push(item(i,arm));out.sort((a,b)=>b.arm-a.arm);out.length=Math.min(out.length,20)}
 }
 const edges:any[]=[],index=g.index!,a=new Vector3(),b=new Vector3(),pa=new Vector3(),pb=new Vector3();for(let i=0;i<index.count;i+=3){for(let k=0;k<3;k++){const ai=index.getX(i+k),bi=index.getX(i+(k+1)%3);a.fromBufferAttribute(p,ai);b.fromBufferAttribute(p,bi);const mid=a.clone().add(b).multiplyScalar(.5/h);if(mid.y<.51||mid.y>.76||Math.abs(mid.x)<.055||Math.abs(mid.x)>.11)continue;const len=a.distanceTo(b);if(len<h*.00005)continue;mesh.applyBoneTransform(ai,pa.copy(a));mesh.applyBoneTransform(bi,pb.copy(b));const stretch=pa.distanceTo(pb)/len;if(edges.length<12||stretch>edges[edges.length-1].stretch){v.copy(a);q.copy(pa);edges.push({stretch,a:item(ai,0),b:bi,mid:mid.toArray()});edges.sort((a,b)=>b.stretch-a.stretch);edges.length=Math.min(edges.length,12)}}}
 // This neighbouring pair formed the visible waist fin in the supplied mesh:
 // the old nonzero fourth-slot swap stretched its edge by 74.6 times.
 const ai=679288,bi=679286;a.fromBufferAttribute(p,ai);b.fromBufferAttribute(p,bi);mesh.applyBoneTransform(ai,pa.copy(a));mesh.applyBoneTransform(bi,pb.copy(b));const waistEdgeStretch=pa.distanceTo(pb)/a.distanceTo(b)
 fs.writeFileSync('checks/v80-c-transition-audit.json',JSON.stringify({h,waistCount,maxWaistArm,waistEdgeStretch,side,underarm,edges,invalid},null,2));expect(invalid).toBe(0)
 expect(waistCount).toBeGreaterThan(100);expect(maxWaistArm).toBeLessThan(.01);expect(waistEdgeStretch).toBeLessThan(2.5)
},60000)
