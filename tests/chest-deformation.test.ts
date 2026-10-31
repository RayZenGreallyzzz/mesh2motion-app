// @vitest-environment node
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {it,expect} from 'vitest'
import {Mesh,Skeleton,Vector3,SkinnedMesh,Uint16BufferAttribute,Float32BufferAttribute,Quaternion} from 'three'
import {load_without_textures} from './chest-fixtures.ts'
import {fit_humanoid_rig} from '../src/lib/processes/edit-skeleton/HumanoidAutoFit.ts'
import {Utility} from '../src/lib/Utilities.ts'
import {ChestWeightGuard,default_chest_guard} from '../src/lib/solvers/ChestWeightGuard.ts'
import SkinningAlgorithm from '../src/lib/solvers/SkinningAlgorithm.ts'
import {SkeletonType} from '../src/lib/enums/SkeletonType.ts'
it('protects the complete uploaded mesh during arm movement and preserves unselected vertices',async()=>{
 const path='../rig76-input/tripo_pbr_model_91da88a4-4f8c-4fe6-b9f3-c463ccfa016f_meshopt (1).glb',hash=()=>createHash('sha256').update(fs.readFileSync(path)).digest('hex'),sourceHash=hash()
 const model=await load_without_textures(path),mesh=model.scene.children.find(o=>(o as Mesh).isMesh) as Mesh,g=mesh.geometry
 g.rotateY(-Math.PI/2);g.computeBoundingBox();const bounds=g.boundingBox!,scale=2/(bounds.max.y-bounds.min.y);g.translate(0,-bounds.min.y,0);g.scale(scale,scale,scale)
 const rig=await load_without_textures('baseline/rigs/rig-human.glb'),bones=Utility.bone_list_from_hierarchy(rig.scene),skeleton=new Skeleton(bones)
 fit_humanoid_rig(model.scene,skeleton,null,()=>{});rig.scene.updateMatrixWorld(true);skeleton.calculateInverses()
 const solver=new SkinningAlgorithm(rig.scene,SkeletonType.Human);solver.set_geometry(g)
 // The on-disk fixture must be invalidated when any solver changes, not only
 // when the model or joint positions change.
 const solverSource=fs.readdirSync('src/lib/solvers').filter(n=>n.endsWith('.ts')).sort().map(n=>fs.readFileSync('src/lib/solvers/'+n,'utf8')).join('\n')
 const cache='checks/chest-base-weights',key=createHash('sha256').update(sourceHash+solver.cache_key()+solverSource).digest('hex');let ids:number[],weights:number[];const start=performance.now()
 if(fs.existsSync(cache+'.json')&&JSON.parse(fs.readFileSync(cache+'.json','utf8')).key===key){const a=fs.readFileSync(cache+'-ids.bin'),b=fs.readFileSync(cache+'-weights.bin');ids=Array.from(new Uint16Array(a.buffer,a.byteOffset,a.byteLength/2));weights=Array.from(new Float64Array(b.buffer,b.byteOffset,b.byteLength/8))}
 else{[ids,weights]=solver.calculate_indexes_and_weights();fs.writeFileSync(cache+'-ids.bin',Buffer.from(new Uint16Array(ids).buffer));fs.writeFileSync(cache+'-weights.bin',Buffer.from(new Float64Array(weights).buffer));fs.writeFileSync(cache+'.json',JSON.stringify({key,solveSeconds:(performance.now()-start)/1000}))}
 const fixedIds=ids.slice(),fixedWeights=weights.slice(),guard=new ChestWeightGuard(bones,[g],{...default_chest_guard(),enabled:true}),mask=guard.apply(g,fixedIds,fixedWeights,true)!,pos=g.getAttribute('position')
 expect(guard.stats.available).toBe(true);expect(guard.stats.changed).toBeGreaterThan(1000)
 let untouched=0,core=0,coreArmBefore=0,coreArmAfter=0,maxNormalizationError=0,invalid=0
 const arm=(i:number)=>/arm|hand|clavicle|finger|thumb|index|middle|ring|pinky/.test(bones[i]?.name??'')
 for(let i=0;i<pos.count;i++){let sum=0;for(let j=0;j<4;j++){const k=i*4+j,w=fixedWeights[k];if(!Number.isFinite(w)||w<0||w>1||fixedIds[k]<0||fixedIds[k]>=bones.length)invalid++;sum+=w;if(mask[i]===0&&(ids[k]!==fixedIds[k]||weights[k]!==w))throw Error('Unselected vertex changed: '+i);if(mask[i]>.999){if(arm(ids[k]))coreArmBefore+=weights[k];if(arm(fixedIds[k]))coreArmAfter+=w}}maxNormalizationError=Math.max(maxNormalizationError,Math.abs(sum-1));if(mask[i]===0)untouched++;if(mask[i]>.999)core++}
 expect(invalid).toBe(0);expect(maxNormalizationError).toBeLessThan(1e-6);expect(untouched).toBeGreaterThan(pos.count*.7);expect(coreArmBefore).toBeGreaterThan(1);expect(coreArmAfter).toBeLessThan(coreArmBefore*.01)
 const baseline=new SkinnedMesh(g.clone()),protectedMesh=new SkinnedMesh(g.clone())
 for(const [m,ii,ww] of [[baseline,ids,weights],[protectedMesh,fixedIds,fixedWeights]] as const){m.geometry.setAttribute('skinIndex',new Uint16BufferAttribute(ii,4));m.geometry.setAttribute('skinWeight',new Float32BufferAttribute(ww,4));m.bind(skeleton)}
 let restError=0;const source=new Vector3(),a=new Vector3(),b=new Vector3()
 for(let i=0;i<pos.count;i+=137){source.fromBufferAttribute(pos,i);restError=Math.max(restError,protectedMesh.applyBoneTransform(i,a.copy(source)).distanceTo(source))}expect(restError).toBeLessThan(1e-6)
 const poses=bones.map(b=>b.quaternion.clone()),results=[]
 for(const degrees of [30,60,100]){bones.forEach((b,i)=>b.quaternion.copy(poses[i]));for(const bone of bones)if(/^(upperarm|clavicle)_[lr]$/.test(bone.name))bone.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),(bone.name.endsWith('_l')?1:-1)*degrees*Math.PI/180));rig.scene.updateMatrixWorld(true);let before=0,after=0,n=0,armDifference=0,armMovement=0,armSamples=0
  for(let i=0;i<pos.count;i+=11){source.fromBufferAttribute(pos,i);baseline.applyBoneTransform(i,a.copy(source));protectedMesh.applyBoneTransform(i,b.copy(source));if(mask[i]>.999){before+=a.distanceTo(source);after+=b.distanceTo(source);n++}if(Math.abs(source.x)>.36&&source.y>1&&source.y<1.6){armDifference=Math.max(armDifference,a.distanceTo(b));armMovement+=a.distanceTo(source);armSamples++}}
  results.push({degrees,coreSamples:n,beforeMean:before/n,afterMean:after/n,armDifference,armMeanMovement:armMovement/armSamples});expect(n).toBeGreaterThan(100);expect(before/n).toBeGreaterThan(.001);expect(after).toBeLessThan(before*.02);expect(armDifference).toBeLessThan(1e-7);expect(armMovement/armSamples).toBeGreaterThan(.01)
 }
 bones.forEach((b,i)=>b.quaternion.copy(poses[i]));rig.scene.updateMatrixWorld(true)
 for(const options of [default_chest_guard(),{...default_chest_guard(),enabled:true,strength:0}]){const ii=ids.slice(),ww=weights.slice();new ChestWeightGuard(bones,[g],options).apply(g,ii,ww,false);if(ii.some((v,i)=>v!==ids[i])||ww.some((v,i)=>v!==weights[i]))throw Error('Inactive guard changed weights')}
 const missing=new ChestWeightGuard([],[g],{...default_chest_guard(),enabled:true}),ii=[0,0,0,0],ww=[1,0,0,0];missing.apply(g,ii,ww,false);expect(missing.stats.available).toBe(false);expect(ww).toEqual([1,0,0,0]);expect(hash()).toBe(sourceHash)
 fs.writeFileSync('checks/chest-deformation.json',JSON.stringify({vertices:pos.count,bones:bones.length,guard:guard.stats,untouched,core,coreArmBefore:coreArmBefore/core,coreArmAfter:coreArmAfter/core,maxNormalizationError,restError,poses:results,sourceHash,sourceUnchanged:true},null,2))
},300000)
