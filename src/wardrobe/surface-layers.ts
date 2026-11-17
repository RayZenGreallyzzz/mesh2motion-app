import { BufferAttribute, BufferGeometry, Matrix4, Texture, Vector3, type Material, type Mesh } from 'three'
import { bakedGeometry } from './body.ts'
import type { Piece } from './garments.ts'

export type AlphaMode = 'opaque'|'blend'|'cutout'
export function setAlpha(material:Material,mode:AlphaMode,amount:number){
  material.transparent=mode==='blend'
  material.depthWrite=mode!=='blend'
  material.opacity=mode==='blend'?amount:1
  material.alphaTest=mode==='cutout'?amount:0
  material.needsUpdate=true
}

export function getAlpha(material?:Material):AlphaMode{
  return material?.transparent?'blend':material?.alphaTest?'cutout':'opaque'
}

export function offsetPiece(mesh:Mesh,name:string,distance:number,region?:number):Piece{
  mesh.updateWorldMatrix(true,false)
  const geometry=bakedGeometry(mesh,new Matrix4())
  const position=geometry.attributes.position, normal=geometry.attributes.normal
  const point=new Vector3(), direction=new Vector3()
  for(let i=0;i<position.count;i++){
    point.fromBufferAttribute(position,i)
    direction.fromBufferAttribute(normal,i).normalize()
    point.addScaledVector(direction,distance)
    position.setXYZ(i,point.x,point.y,point.z)
  }
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material]
  const clone=(material:Material)=>{
    const result=material.clone()
    for(const key of Object.keys(material)){
      const value=(material as unknown as Record<string,unknown>)[key]
      if(value instanceof Texture)(result as unknown as Record<string,unknown>)[key]=value.clone()
    }
    return result
  }
  const material=region===undefined?materials.map(clone):[clone(materials[region])]
  if(region!==undefined&&geometry.groups.length){
    const selected=geometry.groups.filter(group=>group.materialIndex===region)
    const indices=selected.flatMap(group=>Array.from({length:group.count},(_,i)=>geometry.index?.getX(group.start+i)??group.start+i))
    geometry.setIndex(indices)
    geometry.clearGroups()
  }
  geometry.computeBoundingBox();geometry.computeBoundingSphere()
  return {name,geometry,material:material.length===1?material[0]:material}
}

/** Close a thin cut panel with a back and edges. Positions and UVs are retained on each face. */
export function thicken(geometry:BufferGeometry,thickness:number):BufferGeometry{
  if(thickness<=0)return geometry
  const position=geometry.attributes.position, uv=geometry.attributes.uv, normal=geometry.attributes.normal
  const index=geometry.index!, count=position.count
  const vertices:number[]=[], uvs:number[]=[], faces:number[]=[], edges=new Map<string,[number,number]>()
  const p=new Vector3(),n=new Vector3()
  for(let i=0;i<count;i++){
    vertices.push(...p.fromBufferAttribute(position,i).toArray())
    uvs.push(uv.getX(i),uv.getY(i))
  }
  for(let i=0;i<count;i++){
    p.fromBufferAttribute(position,i)
    p.addScaledVector(n.fromBufferAttribute(normal,i),-thickness)
    vertices.push(...p.toArray())
    uvs.push(uv.getX(i),uv.getY(i))
  }
  for(let i=0;i<index.count;i+=3){
    const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2)
    faces.push(a,b,c,a+count,c+count,b+count)
    for(const [u,v] of [[a,b],[b,c],[c,a]]){
      const key=Math.min(u,v)+':'+Math.max(u,v)
      if(edges.has(key))edges.delete(key)
      else edges.set(key,[u,v])
    }
  }
  for(const [a,b] of edges.values()){
    const corner=vertices.length/3
    for(const i of [a,b,b+count,a+count]){
      vertices.push(vertices[i*3],vertices[i*3+1],vertices[i*3+2])
      uvs.push(uvs[i*2],uvs[i*2+1])
    }
    faces.push(corner,corner+2,corner+1,corner,corner+3,corner+2)
  }
  geometry.setIndex(faces)
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(vertices),3))
  geometry.setAttribute('uv',new BufferAttribute(new Float32Array(uvs),2))
  geometry.deleteAttribute('normal')
  geometry.computeVertexNormals()
  return geometry
}
