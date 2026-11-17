import { Bone, Matrix4, Scene, SkinnedMesh } from 'three'
import { inspect_glb, MAX_GLB_BYTES } from '../my-rigs/GlbEnvelope.ts'
import { export_plain_glb } from '../lib/processes/export-to-file/PlainGlbExporter.ts'
import { type FittingBody } from './body.ts'
import type { Piece } from './garments.ts'

type Json = Record<string, any>
const BIN=0x004e4942, JSON_CHUNK=0x4e4f534a
const align=(length:number)=>Math.ceil(length/4)*4
const jointKey='wardrobeSourceJoint'

function read (data: ArrayBuffer): {doc:Json,bin:Uint8Array,other:Uint8Array[]} {
  const doc=inspect_glb(data), view=new DataView(data)
  let bin=new Uint8Array(data,0,0)
  const other:Uint8Array[]=[]
  for(let p=20+view.getUint32(12,true);p<data.byteLength;){
    const length=view.getUint32(p,true),type=view.getUint32(p+4,true)
    if(type===BIN)bin=new Uint8Array(data,p+8,length)
    else other.push(new Uint8Array(data,p,length+8))
    p+=length+8
  }
  const buffer=doc.buffers?.[0]
  if(!buffer||buffer.uri||buffer.byteLength>bin.length)throw new Error('Нужен GLB со встроенным бинарным блоком.')
  return {doc,bin:bin.subarray(0,buffer.byteLength),other}
}

/** Attach a newly written garment to the original body joints and leave the
 * original vertex and animation BIN ranges exactly as they were. */
export function combineGlb (body: ArrayBuffer, clothes: ArrayBuffer): ArrayBuffer {
  const base=read(body), part=read(clothes), doc=base.doc, incoming=part.doc
  const keys=['accessors','bufferViews','images','samplers','textures','materials','meshes','skins','nodes'] as const
  const offsets=Object.fromEntries(keys.map(k=>[k,doc[k]?.length??0])) as Record<typeof keys[number],number>
  const offset=align(base.bin.length), binBytes=align(offset+part.bin.length)
  if(incoming.buffers?.length!==1||(incoming.animations??[]).length)throw new Error('Не удалось подготовить сетку одежды к объединению.')
  const shift=(entry:Json|undefined,key:string,by:number)=>{if(entry&&typeof entry[key]==='number')entry[key]+=by}
  const attrs=(entries:Json|undefined)=>{ for(const k of Object.keys(entries??{}))shift(entries,k,offsets.accessors) }
  const textures=(item:Json)=>{for(const [key,value] of Object.entries(item)){
    if(!value||typeof value!=='object'||key==='extras')continue
    if(key.endsWith('Texture')) shift(value,'index',offsets.textures)
    else textures(value)
  }}
  for(const view of incoming.bufferViews??[]){
    if(view.buffer!==0)throw new Error('Буфер одежды не встроен в GLB.')
    view.byteOffset=(view.byteOffset??0)+offset
  }
  for(const access of incoming.accessors??[]){
    shift(access,'bufferView',offsets.bufferViews);shift(access.sparse?.indices,'bufferView',offsets.bufferViews)
    shift(access.sparse?.values,'bufferView',offsets.bufferViews)
  }
  for(const image of incoming.images??[])shift(image,'bufferView',offsets.bufferViews)
  for(const texture of incoming.textures??[]){
    shift(texture,'sampler',offsets.samplers);shift(texture,'source',offsets.images)
    for(const ext of ['EXT_texture_webp','KHR_texture_basisu','EXT_texture_avif']) shift(texture.extensions?.[ext],'source',offsets.images)
  }
  for(const material of incoming.materials??[])textures(material)
  for(const mesh of incoming.meshes??[])for(const p of mesh.primitives){
    attrs(p.attributes);(p.targets??[]).forEach(attrs)
    shift(p,'indices',offsets.accessors);shift(p,'material',offsets.materials)
  }
  const jointSet=new Set<number>((doc.skins??[]).flatMap((skin:Json)=>skin.joints))
  for(const skin of incoming.skins??[]){
    skin.joints=skin.joints.map((id:number)=>{
      const joint=incoming.nodes[id]?.extras?.[jointKey]
      if(!jointSet.has(joint))throw new Error('Кость одежды отсутствует в исходном риге.')
      return joint
    })
    delete skin.skeleton
    shift(skin,'inverseBindMatrices',offsets.accessors)
  }
  const additions:Json[]=[]
  for(const id of incoming.scenes?.[incoming.scene??0]?.nodes??[]){
    const node=incoming.nodes[id]
    if(node.mesh===undefined)continue
    if(node.children?.length)throw new Error('У одежды осталась несохранённая иерархия.')
    shift(node,'mesh',offsets.meshes);shift(node,'skin',offsets.skins)
    node.extras={...node.extras,wardrobeClothing:true}
    additions.push(node)
  }
  if(!additions.length)throw new Error('Нет мешей одежды для экспорта.')
  incoming.nodes=additions
  const scene=doc.scenes[doc.scene??0]
  scene.nodes=[...(scene.nodes??[]),...additions.map((_,i)=>offsets.nodes+i)]
  for(const key of keys)if(incoming[key]?.length)doc[key]=[...(doc[key]??[]),...incoming[key]]
  for(const key of ['extensionsUsed','extensionsRequired']){
    const values=[...new Set([...(doc[key]??[]),...(incoming[key]??[])])]
    if(values.length)doc[key]=values
  }
  doc.buffers[0].byteLength=binBytes
  const json=new TextEncoder().encode(JSON.stringify(doc)), padded=align(json.length)
  const size=28+padded+binBytes+base.other.reduce((sum,item)=>sum+item.length,0)
  if(size>MAX_GLB_BYTES)throw new Error('Общий GLB больше 128 МБ. Сохраните одежду отдельно или уменьшите текстуры.')
  const output=new ArrayBuffer(size),view=new DataView(output),bytes=new Uint8Array(output)
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,size,true)
  view.setUint32(12,padded,true);view.setUint32(16,JSON_CHUNK,true)
  bytes.fill(32,20,20+padded);bytes.set(json,20)
  const binStart=20+padded
  view.setUint32(binStart,binBytes,true);view.setUint32(binStart+4,BIN,true)
  bytes.set(base.bin,binStart+8);bytes.set(part.bin,binStart+8+offset)
  let tail=binStart+8+binBytes
  for(const block of base.other){bytes.set(block,tail);tail+=block.length}
  inspect_glb(output)
  return output
}

export async function encodeGarments (body:FittingBody, pieces:Piece[]):Promise<ArrayBuffer> {
  const scene=new Scene()
  const bones=body.bones.map((source,i)=>{
    const b=new Bone();b.name=source.name;b.userData[jointKey]=body.nodes[i];return b
  })
  const original=new Map(body.bones.map((bone,i)=>[bone,i]))
  for(const [i,bone] of bones.entries()){
    const parent=original.get(body.bones[i].parent as Bone)
    const local=parent===undefined?body.rest[i]:body.rest[parent].clone().invert().multiply(body.rest[i])
    local.decompose(bone.position,bone.quaternion,bone.scale)
    if(parent===undefined)scene.add(bone)
    else bones[parent].add(bone)
  }
  const skeleton=body.canonicalSkin(bones)
  for(const piece of pieces){
    const mesh=new SkinnedMesh(piece.geometry,piece.material)
    mesh.name=piece.name;mesh.bind(skeleton,new Matrix4());scene.add(mesh)
  }
  scene.updateMatrixWorld(true)
  const result=await export_plain_glb(scene,{binary:true,onlyVisible:true,maxTextureSize:2048})
  inspect_glb(result)
  return result
}
