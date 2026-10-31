// @vitest-environment node
import fs from 'node:fs'
import { it,expect } from 'vitest'
import { AnimationMixer,SkinnedMesh,Vector3,Box3,Quaternion } from 'three'
import { load_without_textures } from './chest-fixtures.ts'
for(const [id,count] of [['woman-a',230688],['woman-b',232886]] as const)it('reopens '+id+' with preserved skin, finite clips, stable lengths and chest volume',async()=>{
 const gltf=await load_without_textures('checks/'+id+'-roundtrip.glb'),meshes:SkinnedMesh[]=[]
 gltf.scene.updateMatrixWorld(true);gltf.scene.traverse(o=>{if((o as SkinnedMesh).isSkinnedMesh)meshes.push(o as SkinnedMesh)})
 expect(meshes).toHaveLength(1);expect(gltf.animations).toHaveLength(4)
 const mesh=meshes[0],g=mesh.geometry,pos=g.getAttribute('position'),ii=g.getAttribute('skinIndex'),ww=g.getAttribute('skinWeight'),bones=mesh.skeleton.bones
 expect(pos.count).toBe(count);expect(bones).toHaveLength(62)
 const source=new Vector3(),actual=new Vector3(),expected=new Vector3(),other=new Vector3(),box=new Box3().setFromBufferAttribute(pos as any),height=box.max.y-box.min.y
 const chestROI=(p:Vector3)=>Math.abs(p.x)/height>.0175&&Math.abs(p.x)/height<.1025&&(p.y-box.min.y)/height>.695&&(p.y-box.min.y)/height<.775&&p.z/height>.0325
 const faceROI=(p:Vector3)=>Math.abs(p.x)/height<.04&&(p.y-box.min.y)/height>.875&&(p.y-box.min.y)/height<.96&&p.z/height>.01
 let invalid=0,maxSumError=0,maxRestError=0,chestVertices=0;const chestInfluences:Record<string,number>={}
 for(let i=0;i<pos.count;i++){
  source.fromBufferAttribute(pos,i);const inChest=chestROI(source);if(inChest)chestVertices++
  let sum=0;for(let k=0;k<4;k++){const index=ii.array[i*4+k],w=ww.array[i*4+k];if(!Number.isInteger(index)||index<0||index>=bones.length||!Number.isFinite(w)||w<0||w>1)invalid++;sum+=w;if(inChest)chestInfluences[bones[index].name]=(chestInfluences[bones[index].name]??0)+w}
  maxSumError=Math.max(maxSumError,Math.abs(sum-1));if(i%137===0)maxRestError=Math.max(maxRestError,mesh.applyBoneTransform(i,actual.copy(source)).distanceTo(source))
 }
 for(const c of gltf.animations)for(const t of c.tracks)for(const v of t.values)if(!Number.isFinite(v))invalid++
 expect(invalid).toBe(0);expect(maxSumError).toBeLessThan(1e-6);expect(maxRestError).toBeLessThan(1e-5)
 const rest=bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone(),s:b.scale.clone(),length:b.parent?b.getWorldPosition(new Vector3()).distanceTo(b.parent.getWorldPosition(new Vector3())):0}))
 const mixer=new AnimationMixer(gltf.scene),chest=bones.findIndex(b=>b.name==='spine_03'),poses=[];expect(chest).toBeGreaterThanOrEqual(0)
 const head=bones.findIndex(b=>b.name==='head'),supports=bones.filter(b=>/^rig_volume_upperarm_[lr]$/.test(b.name));expect(supports).toHaveLength(2)
 for(const clip of gltf.animations){
  for(const b of supports)expect(clip.tracks.some(t=>t.name===b.name+'.quaternion')).toBe(true)
  const action=mixer.clipAction(clip).reset().play()
  for(const ratio of [0,.2,.4,.6,.8,.99]){
   action.time=clip.duration*ratio;mixer.update(0);gltf.scene.updateMatrixWorld(true)
   let lengthError=0,chestError=0,chestN=0,maxPosition=0,faceError=0,faceN=0,supportAngleError=0
   for(const b of supports){const child=bones.find(c=>c.name===b.userData.rigJointVolume.source)!;const expectedQ=new Quaternion().fromArray(b.userData.rigJointVolume.rest).slerp(child.quaternion,.5);supportAngleError=Math.max(supportAngleError,b.quaternion.angleTo(expectedQ))}
   for(let i=0;i<bones.length;i++)if(bones[i].parent?.type==='Bone'&&!/^(root|pelvis)$/.test(bones[i].name))lengthError=Math.max(lengthError,Math.abs(bones[i].getWorldPosition(actual).distanceTo(bones[i].parent!.getWorldPosition(other))-rest[i].length))
   for(let i=0;i<pos.count;i+=37){source.fromBufferAttribute(pos,i);mesh.applyBoneTransform(i,actual.copy(source));if(!Number.isFinite(actual.x+actual.y+actual.z))throw Error('Nonfinite animated skin');maxPosition=Math.max(maxPosition,actual.length());if(chestROI(source)){expected.copy(source).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[chest]).applyMatrix4(bones[chest].matrixWorld).applyMatrix4(mesh.bindMatrixInverse);chestError+=actual.distanceTo(expected)/height;chestN++}if(faceROI(source)){expected.copy(source).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[head]).applyMatrix4(bones[head].matrixWorld).applyMatrix4(mesh.bindMatrixInverse);faceError=Math.max(faceError,actual.distanceTo(expected)/height);faceN++}}
   const stretches:number[]=[],index=g.index
   if(index)for(let j=0;j+1<index.count;j+=97*3){const a=index.getX(j),b=index.getX(j+1);source.fromBufferAttribute(pos,a);other.fromBufferAttribute(pos,b);const length=source.distanceTo(other);if(length<height*1e-5)continue;mesh.applyBoneTransform(a,actual.copy(source));mesh.applyBoneTransform(b,expected.copy(other));stretches.push(actual.distanceTo(expected)/length)}
   stretches.sort((a,b)=>a-b);poses.push({clip:clip.name,ratio,lengthError,chestSamples:chestN,chestRelativeError:chestError/chestN,faceSamples:faceN,faceError,supportAngleError,maxPosition,edgeStretchP99:stretches[Math.floor(stretches.length*.99)]})
   expect(lengthError).toBeLessThan(1e-5);expect(chestN).toBeGreaterThan(50);expect(maxPosition).toBeLessThan(height*10)
   expect(faceN).toBeGreaterThan(50);expect(faceError).toBeLessThan(1e-5);expect(supportAngleError).toBeLessThan(.02)
  }
  mixer.stopAllAction();bones.forEach((b,i)=>{b.position.copy(rest[i].p);b.quaternion.copy(rest[i].q);b.scale.copy(rest[i].s)});gltf.scene.updateMatrixWorld(true)
 }
 fs.writeFileSync('checks/'+id+'-export.json',JSON.stringify({vertices:pos.count,bones:bones.length,clips:gltf.animations.map(c=>c.name),invalid,maxSumError,maxRestError,chestVertices,chestInfluences:Object.fromEntries(Object.entries(chestInfluences).map(([k,v])=>[k,v/chestVertices])),poses},null,2))
 for(const p of poses){expect(p.chestRelativeError).toBeLessThan(.025);expect(p.edgeStretchP99).toBeLessThan(3)}
},60000)
