import { Matrix4, Mesh, Vector3, type Bone, type BufferGeometry, type SkinnedMesh } from 'three'
import { BoneSide, BoneSlot as B } from '../retarget/bone-automap/BoneTypes.ts'
import type { FittingBody } from './body.ts'

export type Capsule={a:Vector3,b:Vector3,radius:number}
export function clothColliders(body:FittingBody):Capsule[]{
  const result:Capsule[]=[]
  const bone=(slot:B,side:BoneSide)=>body.bones[body.slots.findIndex(role=>role?.slot===slot&&role.side===side)]
  for(const side of [BoneSide.Left,BoneSide.Right]){
    const thigh=bone(B.Thigh,side), knee=bone(B.Calf,side), foot=bone(B.Foot,side)
    for(const [a,b,radius] of [[thigh,knee,.043],[knee,foot,.028]] as const){
      if(!a||!b)continue
      result.push({a:new Vector3().setFromMatrixPosition(a.matrixWorld),
        b:new Vector3().setFromMatrixPosition(b.matrixWorld),radius:body.height*radius})
    }
  }
  return result
}

type Link={a:number,b:number,length:number}
export class ClothMotion {
  readonly vertices:number[]=[]
  readonly rest:Vector3[]=[]
  readonly position:Vector3[]=[]
  private readonly previous:Vector3[]=[]
  private readonly targets:Vector3[]=[]
  private readonly mobility:number[]=[]
  private readonly links:Link[]=[]
  private readonly reference=new Matrix4()
  private readonly vector=new Vector3()
  private readonly axis=new Vector3()
  private readonly closest=new Vector3()
  private readonly start=new Vector3()
  private readonly pull=new Vector3()
  private ready=false
  private debt=0
  frameTime=-1

  constructor(geometry:BufferGeometry,private readonly height:number){
    const p=geometry.attributes.position, lookup=new Map<string,number>()
    if(p.count>14000)throw new Error('Для движения ткани выберите отдельное полотно до 14 000 вершин.')
    geometry.computeBoundingBox()
    const bounds=geometry.boundingBox!, heightSpan=bounds.max.y-bounds.min.y
    if(heightSpan<height*.015)throw new Error('У выбранного полотна почти нет высоты для свободного края.')
    const grid=height*.00012
    for(let i=0;i<p.count;i++){
      const vector=new Vector3().fromBufferAttribute(p,i)
      const key=vector.toArray().map(n=>Math.round(n/grid)).join(':')
      let id=lookup.get(key)
      if(id===undefined){
        id=this.rest.length;lookup.set(key,id)
        const down=(bounds.max.y-vector.y)/heightSpan
        this.mobility.push(Math.max(0,Math.min(1,(down-.12)/.55)))
        this.rest.push(vector);this.position.push(vector.clone());this.previous.push(vector.clone());this.targets.push(vector.clone())
      }
      this.vertices.push(id)
    }
    const unique=new Set<string>()
    const add=(a:number,b:number)=>{
      const key=a<b?a+':'+b:b+':'+a
      const length=this.rest[a].distanceTo(this.rest[b])
      if(a===b||unique.has(key)||length<grid)return
      unique.add(key);this.links.push({a,b,length})
    }
    const triangles=geometry.index
    for(let i=0;i+2<(triangles?.count??p.count);i+=3){
      const [a,b,c]=[0,1,2].map(j=>this.vertices[triangles?.getX(i+j)??i+j])
      add(a,b);add(b,c);add(c,a)
    }
    const base=geometry.groups[0]
    if(base&&triangles){
      const primary=new Set<number>()
      for(let i=base.start;i<base.start+base.count;i++)primary.add(this.vertices[triangles.getX(i)])
      const anchorNodes=[...primary]
      for(let i=0;i<this.rest.length;i++){
        if(primary.has(i))continue
        let closest=-1, distance=(height*.019)**2
        for(const candidate of anchorNodes){
          const next=this.rest[i].distanceToSquared(this.rest[candidate])
          if(next<distance){closest=candidate;distance=next}
        }
        if(closest>=0)add(i,closest)
      }
    }
  }
  reset(){this.ready=false;this.debt=0;this.frameTime=-1}
  step(delta:number,ref:Matrix4,colliders:Capsule[]){
    this.reference.copy(ref)
    for(let i=0;i<this.rest.length;i++){
      const target=this.targets[i].copy(this.rest[i]).applyMatrix4(ref)
      if(!this.ready){this.position[i].copy(target);this.previous[i].copy(target)}
      else if(this.mobility[i]===0)this.position[i].copy(target)
    }
    if(!this.ready){this.ready=true;return}
    const dt=1/60
    this.debt=Math.min(this.debt+delta,dt*3)
    while(this.debt+1e-7>=dt){
      this.debt-=dt
      for(let i=0;i<this.rest.length;i++){
        const weight=this.mobility[i]
        if(!weight)continue
        const p=this.position[i],last=this.previous[i],target=this.targets[i]
        this.vector.copy(p).sub(last).multiplyScalar(.89)
        last.copy(p)
        p.add(this.vector)
        p.y-=this.height*1.40*dt*dt*weight
        this.pull.copy(target).sub(p)
        const limit=this.height*.065
        const drift=this.pull.length()
        p.addScaledVector(this.pull,.035+(drift>limit?(drift-limit)/drift*.15:0))
        if(weight<1)p.lerp(target,(1-weight)*.46)
      }
      for(let iteration=0;iteration<3;iteration++){
        for(const {a,b,length} of this.links){
          const pa=this.position[a],pb=this.position[b],wa=this.mobility[a],wb=this.mobility[b]
          if(wa+wb===0)continue
          const difference=this.vector.copy(pb).sub(pa), now=difference.length()
          if(now<1e-8)continue
          difference.multiplyScalar((now-length)/now*.63/(wa+wb))
          pa.addScaledVector(difference,wa);pb.addScaledVector(difference,-wb)
        }
        for(const cap of colliders){
          this.axis.subVectors(cap.b,cap.a)
          const length=this.axis.lengthSq()
          if(length<1e-12)continue
          for(let i=0;i<this.position.length;i++){
            if(this.mobility[i]===0)continue
            const p=this.position[i]
            const t=Math.max(0,Math.min(1,this.start.subVectors(p,cap.a).dot(this.axis)/length))
            this.closest.copy(cap.a).addScaledVector(this.axis,t)
            const outward=this.vector.subVectors(p,this.closest)
            const distance=outward.length()
            if(distance>1e-8&&distance<cap.radius)p.addScaledVector(outward,(cap.radius-distance)/distance)
          }
        }
      }
    }
  }

  write(geometry:BufferGeometry,sourceIds?:number[], sourcePositions?:BufferGeometry){
    const p=geometry.attributes.position,rest=sourcePositions?.attributes.position
    for(let i=0;i<p.count;i++){
      const id=this.vertices[sourceIds?.[i]??i]
      const v=this.position[id]
      if(rest&&sourceIds){
        this.vector.fromBufferAttribute(rest,i).sub(this.rest[id]).applyMatrix4(this.reference)
        this.start.setFromMatrixPosition(this.reference)
        this.vector.add(v).sub(this.start)
        p.setXYZ(i,this.vector.x,this.vector.y,this.vector.z)
      }else p.setXYZ(i,v.x,v.y,v.z)
    }
    p.needsUpdate=true
    geometry.computeVertexNormals()
  }
}
export type ClothDecal={source:SkinnedMesh,preview:Mesh,ids:number[]}
export class ClothPreview {
  private readonly solver:ClothMotion
  private readonly display:Mesh
  private readonly decals:ClothDecal[]
  private readonly frame=new Matrix4()
  private readonly inverse:Matrix4
  constructor(private readonly source:SkinnedMesh,decorations:SkinnedMesh[],private readonly bone:Bone,rest:Matrix4,height:number){
    this.solver=new ClothMotion(source.geometry,height)
    this.inverse=rest.clone().invert()
    const duplicate=(mesh:SkinnedMesh)=>{
      const preview=new Mesh(mesh.geometry.clone(),mesh.material)
      preview.frustumCulled=false
      preview.renderOrder=mesh.renderOrder
      mesh.parent!.add(preview);mesh.visible=false
      return preview
    }
    this.display=duplicate(source)
    this.decals=decorations.map(source=>({source,preview:duplicate(source),ids:source.geometry.userData.wardrobePrintVertices}))
  }
  step(delta:number,time:number,colliders:Capsule[]){
    if(time<this.solver.frameTime)this.solver.reset()
    this.solver.frameTime=time
    this.solver.step(delta,this.frame.multiplyMatrices(this.bone.matrixWorld,this.inverse),colliders)
    this.solver.write(this.display.geometry)
    for(const {source,preview,ids} of this.decals)this.solver.write(preview.geometry,ids,source.geometry)
  }
  reset(){this.solver.reset()}
  dispose(){
    for(const [original,copy] of [[this.source,this.display],...this.decals.map(({source,preview})=>[source,preview])] as [SkinnedMesh,Mesh][]){
      original.visible=true;copy.removeFromParent();copy.geometry.dispose()
    }
  }
}
