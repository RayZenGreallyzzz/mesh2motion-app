// @vitest-environment node
import fs from 'node:fs'
import {it,expect} from 'vitest'
import {SkinnedMesh,Vector3} from 'three'
import {load_without_textures} from './chest-fixtures.ts'
it('reopens the UI-exported GLB with finite normalized weights and animation tracks',async()=>{
 const gltf=await load_without_textures('checks/chest-protected-roundtrip.glb'),meshes:SkinnedMesh[]=[];gltf.scene.updateMatrixWorld(true);gltf.scene.traverse(o=>{if((o as SkinnedMesh).isSkinnedMesh)meshes.push(o as SkinnedMesh)})
 let vertices=0,invalid=0,maxSumError=0,maxRestError=0;const p=new Vector3(),q=new Vector3()
 for(const mesh of meshes){const g=mesh.geometry,pos=g.getAttribute('position'),ii=g.getAttribute('skinIndex'),ww=g.getAttribute('skinWeight');vertices+=pos.count;for(let i=0;i<pos.count;i++){let sum=0;for(let k=0;k<4;k++){const id=ii.array[i*4+k],w=ww.array[i*4+k];if(!Number.isInteger(id)||id<0||id>=mesh.skeleton.bones.length||!Number.isFinite(w)||w<0||w>1)invalid++;sum+=w}maxSumError=Math.max(maxSumError,Math.abs(sum-1));if(i%137===0){p.fromBufferAttribute(pos,i);q.copy(p);mesh.applyBoneTransform(i,q);maxRestError=Math.max(maxRestError,p.distanceTo(q))}}}
 for(const clip of gltf.animations)for(const track of clip.tracks)for(const value of track.values)if(!Number.isFinite(value))invalid++
 expect(vertices).toBe(984977);expect(meshes).toHaveLength(1);expect(gltf.animations.length).toBeGreaterThan(0);expect(invalid).toBe(0);expect(maxSumError).toBeLessThan(1e-6);expect(maxRestError).toBeLessThan(1e-5)
 fs.writeFileSync('checks/chest-export.json',JSON.stringify({vertices,bones:meshes[0].skeleton.bones.length,animations:gltf.animations.map(c=>c.name),invalid,maxSumError,maxRestError},null,2))
})
