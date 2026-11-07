import { Matrix4, type AnimationClip, type Bone, type Group, type KeyframeTrack } from 'three'
import type { RigAsset } from './RigAsset.ts'
import type { HumanoidMesh } from './Humanoid65Builder.ts'
import { inspect_glb, MAX_GLB_BYTES } from './GlbEnvelope.ts'

/** Replace the binding while preserving the original geometry/image BIN prefix. */
export function write_humanoid65_glb(source: RigAsset, rig: Group, bones: Bone[], meshes: HumanoidMesh[], clips: AnimationClip[]): ArrayBuffer {
  const original=source.source_bytes,view=new DataView(original),jsonLength=view.getUint32(12,true)
  inspect_glb(original)
  const doc=JSON.parse(new TextDecoder().decode(new Uint8Array(original,20,jsonLength)))
  if(!doc.buffers?.length||doc.buffers[0].uri)throw new Error('Для пересборки нужен GLB со встроенной геометрией')
  const binAt=20+jsonLength,binSize=view.getUint32(binAt,true)
  if(view.getUint32(binAt+4,true)!==0x004e4942||binSize<doc.buffers[0].byteLength)throw new Error('В GLB отсутствует бинарная геометрия')
  const prefix=new Uint8Array(original,binAt+8,doc.buffers[0].byteLength),parts:Array<{offset:number,bytes:Uint8Array}>=[{offset:0,bytes:prefix}]
  let length=Math.ceil(prefix.length/4)*4
  doc.accessors??=[];doc.bufferViews??=[]
  const add=(values:ArrayLike<number>,width:number,type:string,integer=false,times=false):number=>{
    if(!values.length||values.length%width)throw new Error('Неверный размер данных нового рига')
    const array=integer?new Uint16Array(values.length):new Float32Array(values.length)
    for(let i=0;i<values.length;i++){const n=values[i];if(!Number.isFinite(n)||(integer&&(!Number.isInteger(n)||n<0||n>65535)))throw new Error('Неверное значение нового рига');array[i]=n}
    const bytes=new Uint8Array(array.buffer),bv=doc.bufferViews.length
    doc.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length});parts.push({offset:length,bytes});length=Math.ceil((length+bytes.length)/4)*4
    const accessor:any={bufferView:bv,componentType:integer?5123:5126,count:values.length/width,type}
    if(times){accessor.min=[values[0]];accessor.max=[values[values.length-1]]}
    doc.accessors.push(accessor);return doc.accessors.length-1
  }
  const oldJoints=new Set<number>((doc.skins??[]).flatMap((s:any)=>s.joints)),scene=doc.scenes?.[doc.scene??0]
  let roots:number[]=(scene?.nodes??[]).filter((i:number)=>!oldJoints.has(i))
  const meshNodes=new Set(meshes.map(m=>m.source_node))
  // Detach replaced joints and converted meshes first, so each mesh is emitted
  // once with its original WORLD transform even if it lived under an old bone.
  for(let i=0;i<doc.nodes.length;i++){
    const n=doc.nodes[i]
    if(n.children)n.children=n.children.filter((child:number)=>!oldJoints.has(child)&&!meshNodes.has(child))
    if(oldJoints.has(i))n.name='source_'+(n.name??i)
  }
  roots=roots.filter(i=>!meshNodes.has(i));roots.push(...meshNodes)
  const objectNode=new Map<string,number>()
  const append=(object:typeof rig|Bone):number=>{
    const index=doc.nodes.length;objectNode.set(object.uuid,index)
    const n:any={name:object.name,translation:object.position.toArray(),rotation:object.quaternion.toArray(),scale:object.scale.toArray()}
    doc.nodes.push(n);if(object.children.length)n.children=object.children.map(o=>append(o as Bone));return index
  }
  for(const child of rig.children)roots.push(append(child as Bone))
  const jointNodes=bones.map(b=>objectNode.get(b.uuid)!),boneSet=new Set(jointNodes)
  if(boneSet.size!==65||jointNodes.some(i=>i===undefined))throw new Error('Не удалось сохранить все 65 костей')
  doc.skins=[]
  for(const nodeIndex of meshNodes){
    const items=meshes.filter(m=>m.source_node===nodeIndex),node=doc.nodes[nodeIndex],oldMesh=doc.meshes?.[node.mesh]
    if(!oldMesh||items.length!==oldMesh.primitives.length)throw new Error('Не все части модели получили новые веса')
    const copy=structuredClone(oldMesh)
    for(const item of items){
      const primitive=copy.primitives[item.primitive]
      if(!primitive||doc.accessors[primitive.attributes.POSITION].count*4!==item.weights.length)throw new Error('Веса не соответствуют вершинам модели')
      for(const key of Object.keys(primitive.attributes))if(/^(JOINTS|WEIGHTS)_\d+$/.test(key))delete primitive.attributes[key]
      const draco=primitive.extensions?.KHR_draco_mesh_compression?.attributes
      if(draco)for(const key of Object.keys(draco))if(/^(JOINTS|WEIGHTS)_\d+$/.test(key))delete draco[key]
      primitive.attributes.JOINTS_0=add(item.indices,4,'VEC4',true);primitive.attributes.WEIGHTS_0=add(item.weights,4,'VEC4')
      objectNode.set(item.source.uuid,nodeIndex)
    }
    const transform=items[0].world;if(items.some(m=>!m.world.equals(transform)))throw new Error('Части одного узла имеют разные матрицы')
    delete node.translation;delete node.rotation;delete node.scale;node.matrix=transform.toArray()
    const inverseBind=bones.flatMap(b=>new Matrix4().copy(b.matrixWorld).invert().multiply(transform).toArray())
    node.mesh=doc.meshes.length;doc.meshes.push(copy);node.skin=doc.skins.length
    doc.skins.push({name:'Rig Studio Humanoid 65',joints:jointNodes,skeleton:jointNodes.find(i=>doc.nodes[i].name==='pelvis'),inverseBindMatrices:add(inverseBind,16,'MAT4')})
  }
  doc.animations=clips.map(clip=>{
    const samplers:any[]=[],channels:any[]=[]
    for(const track of clip.tracks){
      const dot=track.name.lastIndexOf('.'),node=objectNode.get(track.name.slice(0,dot)),property=track.name.slice(dot+1)
      const path=({quaternion:'rotation',position:'translation',scale:'scale',morphTargetInfluences:'weights'} as Record<string,string>)[property]
      if(node===undefined||!path)throw new Error('Не найдена цель анимации при сохранении полного рига')
      const width=path==='rotation'?4:path==='weights'?1:3
      const factory=(track as KeyframeTrack & {createInterpolant:{isInterpolantFactoryMethodGLTFCubicSpline?:boolean}}).createInterpolant
      const interpolation=factory.isInterpolantFactoryMethodGLTFCubicSpline?'CUBICSPLINE':track.getInterpolation()===2300?'STEP':'LINEAR'
      channels.push({sampler:samplers.length,target:{node,path}});samplers.push({input:add(track.times,1,'SCALAR',false,true),output:add(track.values,width,width===4?'VEC4':width===3?'VEC3':'SCALAR'),interpolation})
    }
    return{name:clip.name,samplers,channels}
  })
  if(!doc.animations.length)delete doc.animations
  doc.scenes=[{name:scene?.name??source.name,nodes:[...new Set(roots)]}];doc.scene=0;doc.buffers[0].byteLength=length
  const json=new TextEncoder().encode(JSON.stringify(doc)),padded=Math.ceil(json.length/4)*4,total=28+padded+length
  if(total>MAX_GLB_BYTES)throw new Error('После пересборки GLB больше 128 МБ')
  const out=new ArrayBuffer(total),v=new DataView(out),bytes=new Uint8Array(out)
  v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,total,true);v.setUint32(12,padded,true);v.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+padded);bytes.set(json,20)
  v.setUint32(20+padded,length,true);v.setUint32(24+padded,0x004e4942,true);parts.forEach(p=>bytes.set(p.bytes,28+padded+p.offset))
  inspect_glb(out);return out
}
