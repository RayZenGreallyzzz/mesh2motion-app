import { Bone, Box3, BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, Quaternion, Skeleton, SkinnedMesh, Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { fit_humanoid_rig } from '../lib/processes/edit-skeleton/HumanoidAutoFit.ts'
import { fit_humanoid_head, fit_humanoid_head_surface } from '../lib/processes/edit-skeleton/HumanoidHeadFit.ts'
import { joint_fit_surface, refine_humanoid_joints, type LimbChain } from '../lib/processes/edit-skeleton/HumanoidJointFit.ts'
import { capture_hand_shape, place_hand_shape } from '../lib/processes/edit-skeleton/HandPose.ts'
import SkinningAlgorithm from '../lib/solvers/SkinningAlgorithm.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
import { solve_packed_weights, type PackedWeightJob, type PackedWeights } from '../lib/solvers/CharacterWeightJob.ts'
import { restore_rig_pose, type RigAsset, type RigNode } from './RigAsset.ts'
import { suggest_mapping, transfer_clips_async } from './RigMotionTransfer.ts'
import { write_humanoid65_glb } from './Humanoid65Writer.ts'
import { HumanoidHeadReviewRequired, validate_head_landmarks, type HeadLandmarks } from './HumanoidHeadReview.ts'

export interface HumanoidMesh { source: Mesh, source_node: number, primitive: number, world: Matrix4, indices: Uint16Array, weights: Float32Array }
export interface Humanoid65Options { template: ArrayBuffer, profile?: 'human' | 'woman', signal?: AbortSignal, progress?(message: string): void, direct_solver?: boolean, head_landmarks?: HeadLandmarks, review_head?: boolean }
export interface Humanoid65Result { bytes: ArrayBuffer, report: { bones: number, vertices: number, animations: number, body_landmarks_retained: boolean, head_fitted: boolean, head_fit_source: 'vertices' | 'surface' | 'manual', joints: Array<{name: string, evidence: unknown}>, finger_bones: number } }
const check = (signal?: AbortSignal): void => { if (signal?.aborted) throw new Error('Расчёт отменён. Исходный персонаж сохранён.') }
const world = (bone: Bone): Vector3 => bone.getWorldPosition(new Vector3())
function place(bone: Bone, point: Vector3): void { bone.parent?.updateWorldMatrix(true, false); bone.position.copy(bone.parent ? bone.parent.worldToLocal(point.clone()) : point); bone.updateWorldMatrix(true, true) }
export function humanoid_world_geometry(mesh:Mesh):BufferGeometry {
  const geometry=new BufferGeometry(),source=mesh.geometry.getAttribute('position'),positions=new Float32Array(source.count*3),point=new Vector3()
  for(let i=0;i<source.count;i++){point.fromBufferAttribute(source,i).applyMatrix4(mesh.matrixWorld);point.toArray(positions,i*3)}
  geometry.setAttribute('position',new BufferAttribute(positions,3))
  geometry.setIndex(mesh.geometry.index)
  return geometry
}
function snapshot(scene: Group, bones: Bone[], source: RigAsset): RigAsset {
  const nodes = new Map<string, RigNode>(), ids = new Map<Object3D,string>(), joints = new Set<Object3D>(bones)
  scene.traverse(o => ids.set(o, 'rig-' + ids.size))
  scene.updateWorldMatrix(true,true)
  for (const [object,id] of ids) nodes.set(id,{id,name:object.name,parent_id:object.parent ? ids.get(object.parent) ?? null : null,object,position:object.position.clone(),rotation:object.quaternion.clone(),scale:object.scale.clone(),world_rotation:object.getWorldQuaternion(new Quaternion()),parent_rotation:object.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion(),world_scale:object.getWorldScale(new Vector3()),is_joint:joints.has(object),is_mesh:false})
  return {name:source.name,scene,nodes,clips:[],source_bytes:source.source_bytes,signature:JSON.stringify([...nodes.values()].map(n=>[n.name,n.parent_id,n.position.toArray(),n.rotation.toArray()])),skeleton_count:1,vertex_count:source.vertex_count,dirty:true}
}
async function weights(job: PackedWeightJob, {signal,direct_solver,progress}: Humanoid65Options): Promise<PackedWeights> {
  check(signal)
  if (direct_solver || typeof Worker === 'undefined') return solve_packed_weights(job,progress)
  const worker = new Worker(new URL('../lib/solvers/CharacterWeightWorker.ts', import.meta.url), {type:'module'})
  let abort: (() => void) | undefined
  try { return await new Promise<PackedWeights>((resolve,reject)=>{
    abort=()=>reject(new Error('Расчёт отменён. Исходный персонаж сохранён.'))
    signal?.addEventListener('abort',abort,{once:true})
    worker.onmessage=({data})=>{
      if (data.progress) progress?.(data.progress)
      else if (data.error) reject(new Error(data.error))
      else resolve(data.weights)
    }
    worker.onerror=event=>reject(new Error(event.message))
    worker.onmessageerror=()=>reject(new Error('Не удалось получить рассчитанные веса'))
    worker.postMessage(job,[job.positions.buffer,job.triangles.buffer])
  }) } finally {
    if (abort) signal?.removeEventListener('abort',abort)
    worker.terminate()
  }
}

/** Rebuild only by an explicit humanoid action or when completing NEW native output.
 * Imported rigs remain untouched until this function successfully returns. */
export async function build_humanoid65(asset: RigAsset, options: Humanoid65Options): Promise<Humanoid65Result> {
  check(options.signal); restore_rig_pose(asset)
  const report = async (text:string):Promise<void>=>{
    options.progress?.(text)
    // Let the WebView paint the next stage and handle a pending cancellation.
    if(options.progress&&!options.direct_solver)await new Promise(resolve=>setTimeout(resolve,0))
    check(options.signal)
  }
  await report('Загружаю полный шаблон тела и пальцев…')
  const template=await new GLTFLoader().parseAsync(options.template,''); const scene=template.scene
  const originalBones:Bone[]=[];scene.traverse(o=>{if((o as Bone).isBone)originalBones.push(o as Bone)})
  const get=(name:string):Bone=>{const bone=originalBones.find(b=>b.name===name);if(!bone)throw new Error('Неполный человеческий шаблон: '+name);return bone}
  if(originalBones.length!==66)throw new Error('Нужен полный исходный шаблон тела с пальцами')
  const meshes:Array<Omit<HumanoidMesh,'indices'|'weights'>&{vertexCount:number}>=[];const points:Vector3[]=[];const geometries:BufferGeometry[]=[]
  asset.scene.updateWorldMatrix(true,true)
  try {
    await report('Подготавливаю геометрию персонажа…')
    for(const node of asset.nodes.values()) {
      const mesh=node.object as Mesh;if(!mesh.isMesh)continue
      const match=/^n(\d+)(?:\/p(\d+))?$/.exec(node.id);if(!match)throw new Error('Не удалось связать геометрию с исходным GLB')
      const geometry=humanoid_world_geometry(mesh);geometries.push(geometry)
      if((mesh as SkinnedMesh).isSkinnedMesh){
        const skinned=mesh as SkinnedMesh,raw=mesh.geometry.getAttribute('position'),p=new Vector3(),q=new Vector3();skinned.skeleton.update();geometry.computeBoundingBox()
        const tolerance=Math.max(geometry.boundingBox!.getSize(new Vector3()).length()*1e-5,1e-6)
        for(let i=0;i<raw.count;i++){p.fromBufferAttribute(raw,i);q.copy(p).applyMatrix4(mesh.matrixWorld);skinned.applyBoneTransform(i,p).applyMatrix4(mesh.matrixWorld);if(p.distanceTo(q)>tolerance)throw new Error('Для пересборки нужна исходная T- или A-поза привязки. Текущая сохранённая поза кожи отличается; персонаж сохранён без изменений.')}
      }
      const pos=geometry.getAttribute('position');for(let i=0;i<pos.count;i++)points.push(new Vector3().fromBufferAttribute(pos,i))
      meshes.push({source:mesh,source_node:Number(match[1]),primitive:Number(match[2]??0),world:mesh.matrixWorld.clone(),vertexCount:pos.count})
    }
    const vertexCount=points.length
    if(vertexCount<32)throw new Error('В модели недостаточно геометрии для подгонки человека')
    const elbowFractions = new Map((['l','r'] as const).map(side => {const a=world(get('upperarm_'+side)),b=world(get('lowerarm_'+side)),c=world(get('hand_'+side));return [side,a.distanceTo(b)/(a.distanceTo(b)+b.distanceTo(c))]}))
    await report('Подгоняю полный скелет под геометрию…')
    if(!fit_humanoid_rig(asset.scene,new Skeleton(originalBones),null,()=>{},options.profile??'human'))throw new Error('Не удалось подогнать человеческий шаблон. Нужна исходная T- или A-поза.')
    let bottom=Infinity,top=-Infinity;for(const p of points){bottom=Math.min(bottom,p.y);top=Math.max(top,p.y)}
    const hints=new Map([...asset.nodes.values()].filter(n=>n.is_joint).map(n=>[n.name,n.object.getWorldPosition(new Vector3())]))
    const bodyNames=['pelvis','spine_01','spine_02','spine_03','neck_01','head','clavicle_l','upperarm_l','lowerarm_l','hand_l','clavicle_r','upperarm_r','lowerarm_r','hand_r','thigh_l','calf_l','foot_l','ball_l','thigh_r','calf_r','foot_r','ball_r']
    const retainBody=bodyNames.every(name=>hints.has(name))&&hints.size<=24
    if(retainBody){
      const shapes=new Map((['l','r'] as const).map(s=>[s,capture_hand_shape(get('hand_'+s),get('lowerarm_'+s))]))
      for(const bone of originalBones){const hint=hints.get(bone.name);if(hint)place(bone,hint)}
      const span=top-bottom
      for(const side of ['l','r']) {
        const hand=get('hand_'+side),arm=get('lowerarm_'+side),origin=world(hand),direction=origin.clone().sub(world(arm)).normalize(),shape=shapes.get(side as 'l'|'r')!
        const reach=points.map(p=>{const d=p.clone().sub(origin),along=d.dot(direction);return{along,radial:d.addScaledVector(direction,-along).length()}}).filter(p=>p.along>0&&p.along<span*.16&&p.radial<span*.055).map(p=>p.along).sort((a,b)=>a-b)
        const length=reach[Math.floor(reach.length*.98)]
        if(!Number.isFinite(length)||length<span*.015)throw new Error('Не удалось определить длину кисти. Проверьте исходную позу рук.')
        place_hand_shape(hand,shape,direction,Math.max(.4,Math.min(2.5,length/shape.length)))
      }
      const p=world(get('head'));place(get('head_leaf'),new Vector3(p.x,top,p.z))
    }
    check(options.signal)
    await report('Уточняю шею и голову…')
    const shoulder=(world(get('upperarm_l')).y+world(get('upperarm_r')).y)*.5
    let headFitted=false,headSource:Humanoid65Result['report']['head_fit_source']='vertices'
    if(options.head_landmarks){
      validate_head_landmarks(options.head_landmarks,new Box3().setFromPoints(points))
      place(get('neck_01'),new Vector3(...options.head_landmarks.neck));place(get('head'),new Vector3(...options.head_landmarks.head));place(get('head_leaf'),new Vector3(...options.head_landmarks.head_end))
      headFitted=true;headSource='manual'
    }else{
      headFitted=fit_humanoid_head_surface(joint_fit_surface(asset.scene,null,Infinity),originalBones,null,(shoulder-bottom)/.79)
      if(headFitted)headSource='surface'
      else headFitted=fit_humanoid_head(points,originalBones,null,(shoulder-bottom)/.79)
      if(!headFitted||options.review_head)throw new HumanoidHeadReviewRequired({neck:world(get('neck_01')).toArray(),head:world(get('head')).toArray(),head_end:world(get('head_leaf')).toArray()})
    }
    points.length=0
    await report('Уточняю локти и колени…')
    for (const side of ['l','r'] as const) {const wrist=world(get('hand_'+side));place(get('lowerarm_'+side),world(get('upperarm_'+side)).lerp(wrist,elbowFractions.get(side)!));place(get('hand_'+side),wrist)}
    const chains:LimbChain[]=(['l','r'] as const).flatMap(s=>[{start:get('upperarm_'+s),joint:get('lowerarm_'+s),end:get('hand_'+s),kind:'elbow' as const},{start:get('thigh_'+s),joint:get('calf_'+s),end:get('foot_'+s),kind:'knee' as const}])
    refine_humanoid_joints(asset.scene,chains,null,world(get('pelvis')).x,{elbow:{max_fraction:.70,max_shift:.18}})
    // The template has an extra non-deforming scene driver. Preserve its TRS
    // as a Group; the 65 anatomical joints (including finger tips) remain bones.
    const root=get('root'),frame=new Group();frame.copy(root,false);root.parent?.add(frame);frame.add(get('pelvis'));root.removeFromParent();scene.updateWorldMatrix(true,true)
    const bones:Bone[]=[];scene.traverse(o=>{if((o as Bone).isBone)bones.push(o as Bone)})
    if(bones.length!==65)throw new Error('Полный человеческий скелет должен содержать 65 костей')
    await report('Подготавливаю расчёт весов…')
    const solver=new SkinningAlgorithm(scene,SkeletonType.Human)
    const positions=new Float32Array(vertexCount*3)
    const triangles=new Uint32Array(geometries.reduce((n,g)=>n+(g.index?.count??g.getAttribute('position').count),0))
    let vertexOffset=0,triangleOffset=0
    for(const g of geometries){
      const attr=g.getAttribute('position'),count=g.index?.count??attr.count
      positions.set(attr.array,vertexOffset*3)
      for(let i=0;i<count;i++)triangles[triangleOffset+i]=vertexOffset+(g.index?.getX(i)??i)
      vertexOffset+=attr.count;triangleOffset+=count
    }
    geometries.forEach(g=>g.dispose())
    geometries.length=0
    const [indices,skinWeights]=await weights({...solver.worker_config(),packed:true,positions,triangles},options)
    if(indices.length!==vertexCount*4||skinWeights.length!==indices.length)throw new Error('Веса не соответствуют вершинам модели')
    let offset=0
    const weightedMeshes=meshes.map(({vertexCount,...mesh})=>{
      const end=offset+vertexCount*4
      const result={...mesh,indices:indices.subarray(offset,end),weights:skinWeights.subarray(offset,end)}
      offset=end;return result
    })
    check(options.signal)
    const target=snapshot(scene,bones,asset)
    if(asset.clips.length){
      await report('Переношу сохранённые движения на полный скелет…')
      target.clips=await transfer_clips_async(asset,target,suggest_mapping(asset,target),asset.clips.map((_,i)=>i),{match_pose:true,anchor_motion:false},undefined,options.signal)
    }
    // Morph channels still target exactly the same original mesh geometry.
    asset.clips.forEach((clip,i)=>target.clips[i]?.tracks.push(...clip.tracks.filter(t=>t.name.endsWith('.morphTargetInfluences')).map(t=>t.clone())))
    await report('Сохраняю полный риг и проверяю структуру GLB…')
    const bytes=write_humanoid65_glb(asset,scene,bones,weightedMeshes,target.clips)
    return{bytes,report:{bones:bones.length,vertices:vertexCount,animations:target.clips.length,body_landmarks_retained:retainBody,head_fitted:headFitted,head_fit_source:headSource,joints:chains.map(c=>({name:c.joint.name,evidence:c.joint.userData.rigJointFit})),finger_bones:bones.filter(b=>/^(thumb|index|middle|ring|pinky)_/.test(b.name)).length}}
  } finally {geometries.forEach(g=>g.dispose())}
}
