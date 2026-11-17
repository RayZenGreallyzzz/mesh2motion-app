import {
  Box3, BoxGeometry, BufferAttribute, BufferGeometry, Color, DoubleSide, Matrix4, Mesh, MeshStandardMaterial,
  Vector3, type Material
} from 'three'
import { BoneSide, BoneSlot } from '../retarget/bone-automap/BoneTypes.ts'
import { T, type GarmentType } from './types.ts'
import type { FittingBody } from './body.ts'

export type Piece = { name: string, geometry: BufferGeometry, material: Material | Material[], joint?: number }
export type Ring = { at: Vector3, x: number, z: number }
type Frame = { x: Vector3, z: Vector3 }

export function fabric (color: string, metal = false): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(color), roughness: metal ? .34 : .83,
    metalness: metal ? .55 : .02, side: DoubleSide })
}

export function loft (rings: Ring[], frame: Frame, segments=40, closed=false): BufferGeometry {
  const vertices: number[] = [], indices: number[] = [], uv: number[] = []
  const stride=segments+1
  for (const [row,ring] of rings.entries()) {
    for (let column=0; column<=segments;column++) {
      const theta=column%segments/segments*Math.PI*2
      const position=ring.at.clone().addScaledVector(frame.x,ring.x*Math.cos(theta)).addScaledVector(frame.z,ring.z*Math.sin(theta))
      vertices.push(...position.toArray());uv.push(column/segments,row/(rings.length-1))
      if (row===0 || column===segments) continue
      const a=(row-1)*stride+column,b=a+stride
      indices.push(a,b,a+1,a+1,b,b+1)
    }
  }
  if (closed) {
    for (const [row,ring] of [[0,rings[0]],[rings.length-1,rings.at(-1)!]] as const) {
      const center=vertices.length/3;vertices.push(...ring.at.toArray());uv.push(.5,.5)
      for (let i=0;i<segments;i++) {
        const a=row*stride+i
        if (row===0) indices.push(center,a,a+1)
        else indices.push(center,a+1,a)
      }
    }
  }
  const g=new BufferGeometry()
  g.setAttribute('position',new BufferAttribute(new Float32Array(vertices),3))
  g.setAttribute('uv',new BufferAttribute(new Float32Array(uv),2))
  g.setIndex(indices);g.computeVertexNormals()
  const n=g.attributes.normal,p=g.attributes.position, a=new Vector3(),b=new Vector3()
  // Orient the principal surface normals outward in both ascending and descending lofts.
  const probe=Math.floor((rings.length-1)/2)*stride+Math.floor(segments/4)
  a.fromBufferAttribute(p,probe).sub(rings[Math.floor((rings.length-1)/2)].at)
  if (b.fromBufferAttribute(n,probe).dot(a)<0) {
    const index=g.index!
    for(let i=0;i<index.count;i+=3) { const second=index.getX(i+1);index.setX(i+1,index.getX(i+2));index.setX(i+2,second) }
    g.computeVertexNormals()
  }
  const fixed=g.attributes.normal
  for (let row=0;row<rings.length;row++) {
    const i=row*stride,j=i+segments
    a.fromBufferAttribute(fixed,i).add(b.fromBufferAttribute(fixed,j)).normalize()
    fixed.setXYZ(i,a.x,a.y,a.z);fixed.setXYZ(j,a.x,a.y,a.z)
  }
  return g
}

const frameFor = (axis: Vector3, prefer: Vector3): Frame => {
  const x=prefer.clone().addScaledVector(axis,-prefer.dot(axis)).normalize()
  if (x.lengthSq()<.01) x.set(0,0,1).addScaledVector(axis,-axis.z).normalize()
  return { x, z:new Vector3().crossVectors(x,axis).normalize() }
}

export function template (body: FittingBody, type: GarmentType, ease: number, width: number, length: number, color: string): Piece[] {
  const h=body.height, pelvis=body.joint(BoneSlot.Pelvis) ?? body.center.clone()
  const find=(slot: BoneSlot,side: BoneSide) => {
    const point=body.joint(slot,side)
    if(!point) throw new Error('Для этого шаблона нужны кости ' + slot + ' с обеих сторон. Можно загрузить готовую одежду.')
    return point
  }
  const gap=h*ease
  const torsoFrame={x:body.across,z:body.forward}
  const sides=[BoneSide.Left,BoneSide.Right]
  const result: Piece[]=[]
  const label=(s: BoneSide)=>s===BoneSide.Left?'лев.':'прав.'
  const add=(name:string,g:BufferGeometry,joint?:number) => result.push({name,geometry:g,material:fabric(color,type==='armor'),joint})
  const tube=(name:string,from:Vector3,to:Vector3, values: Array<[number,number,number]>, options: {closed?:boolean,joint?:number,max?:number}={})=>{
    const axis=to.clone().sub(from).normalize(), frame=frameFor(axis,body.forward)
    const rings=values.map(([t,extra,min])=>{
      const at=from.clone().lerp(to,t)
      const max=options.max ?? h*.095
      const [x,z]=body.section(at,frame.x,frame.z,axis,h*.017,max)
      return {at,x:(Math.max(x,min*h)+gap+extra*h)*width,z:(Math.max(z,min*h*.8)+gap+extra*h)*width}
    })
    add(name,loft(rings,frame,32,options.closed),options.joint)
  }
  if (type==='shirt' || type==='jacket' || type==='dress' || type==='armor') {
    const shoulders=sides.map(s=>find(BoneSlot.UpperArm,s))
    const shoulder=shoulders[0].clone().lerp(shoulders[1],.5)
    const neck=body.joint(BoneSlot.Neck)??shoulder.clone().addScaledVector(body.up,.025*h)
    const span=shoulders[0].distanceTo(shoulders[1])
    const rows=[0,.11,.35,.53,.69,.84,.94,1]
    const frontLimit=Math.max(span*.59,h*.10)
    const rings=rows.map((t,i)=>{
      const at=pelvis.clone().lerp(neck,t).addScaledVector(body.up, (i===0 ? -.035 : 0)*h*length)
      const [x,z]=body.section(at,body.across,body.forward,body.up,h*.019,frontLimit)
      const taper=i===rows.length-1?.36:i===rows.length-2?.75:1
      return {at,x:(Math.max(x,span*.31)*taper+gap)*width,z:(Math.max(z,span*.16)*taper+gap)*width}
    })
    if (type==='armor') {
      const selected=body.joint(BoneSlot.Spine)??shoulder
      const center=pelvis.clone().lerp(shoulder,.76).addScaledVector(body.forward,rings[4].z*.78+gap)
      const geometry=new BoxGeometry(span*.78*width,shoulder.distanceTo(pelvis)*.52,h*.028,5,5,2)
      const orientation=new Matrix4().makeBasis(body.across,body.up,body.forward).setPosition(center)
      geometry.applyMatrix4(orientation)
      add('Нагрудник',geometry,body.nearestJoint(selected))
      for(const [i,side] of sides.entries()) {
        const at=shoulders[i], g=new BoxGeometry(span*.25,span*.20,span*.27,3,3,3)
        g.applyMatrix4(new Matrix4().makeBasis(body.across,body.up,body.forward).setPosition(at))
        add('Наплечник '+label(side),g,body.nearestJoint(at))
      }
      return result
    }
    add(type==='dress'?'Лиф':'Корпус',loft(rings,torsoFrame))
    if(type==='dress'){
      const skirt=[0,.18,.4,.66,.86,1].map((t,i)=>{
        const at=pelvis.clone().addScaledVector(body.up,-h*.39*t*length)
        const flare=i===0?.90:1+t*.9
        return {at,x:rings[0].x*flare+gap,z:rings[0].z*flare+gap}
      })
      add('Юбка',loft(skirt,torsoFrame,56))
      return result
    }
    for(const [i,side] of sides.entries()) {
      const elbow=find(BoneSlot.LowerArm,side), wrist=find(BoneSlot.Hand,side)
      const arm=shoulders[i].clone().lerp(elbow,.14)
      const end=type==='shirt'?shoulders[i].clone().lerp(elbow,Math.min(.93,.68*length)):elbow.clone().lerp(wrist,Math.min(1,.9*length))
      tube('Рукав '+label(side),arm,end,[[0,0,.034],[.22,0,.031],[.5,0,.027],[.78,0,.025],[1,0,.020]],{max:h*.071})
    }
  }
  if (type==='pants' || type==='puffed') {
    const [x,z]=body.section(pelvis,body.across,body.forward,body.up,h*.034,h*.175)
    const waist=[-.11,-.075,-.02,.035].map((t,i)=>({at:pelvis.clone().addScaledVector(body.up,t*h),
      x:(Math.max(x,h*.077)+gap)*(i===3?.88:1)*width,z:(Math.max(z,h*.055)+gap)*(i===3?.86:1)*width}))
    add('Пояс и бёдра',loft(waist,torsoFrame))
    for(const side of sides) {
      const hip=find(BoneSlot.Thigh,side), knee=find(BoneSlot.Calf,side), ankle=find(BoneSlot.Foot,side)
      const from=hip.clone().lerp(knee,.16), end=knee.clone().lerp(ankle,Math.min(1,.86*length))
      const puff=type==='puffed'?.028:0
      tube('Штанина '+label(side),from,end,[[0,puff*.52,.038],[.18,puff,.034],[.37,puff,.027],[.56,puff*.8,.022],[.77,puff*.61,.018],[.89,puff*.24,.017],[1,0,.017]],{max:h*.105})
    }
  }
  if (type==='bracers' || type==='gloves' || type==='boots') for (const side of sides) {
    if(type==='bracers'){
      const elbow=find(BoneSlot.LowerArm,side), wrist=find(BoneSlot.Hand,side)
      tube('Нарукавник '+label(side),elbow.clone().lerp(wrist,.18),elbow.clone().lerp(wrist,Math.min(1,.95*length)),
        [[0,.002,.027],[.34,.005,.027],[.73,.005,.020],[1,.001,.016]],{max:h*.06})
    } else if (type==='boots') {
      const ankle=find(BoneSlot.Foot,side), calf=find(BoneSlot.Calf,side)
      const toe=body.joint(BoneSlot.Ball,side)??ankle.clone().addScaledVector(body.forward,h*.083)
      const heel=ankle.clone().lerp(toe,-.37)
      const front=ankle.clone().lerp(toe,1.35)
      tube('Стопа '+label(side),heel,front,[[0,.004,.027],[.22,.007,.041],[.58,.007,.041],[.84,.007,.036],[1,.003,.022]],
        {closed:true,max:h*.076})
      tube('Голенище '+label(side),ankle,ankle.clone().lerp(calf,Math.min(.94,.58*length)),
        [[0,0,.025],[.25,0,.03],[.63,0,.037],[.86,0,.037],[1,.004,.039]],{max:h*.081})
    } else {
      const hand=find(BoneSlot.Hand,side), elbow=find(BoneSlot.LowerArm,side)
      const palm=hand.clone().add(hand.clone().sub(elbow).normalize().multiplyScalar(h*.045*length))
      tube('Ладонь '+label(side),hand,palm,[[0,0,.014],[.35,0,.022],[.65,0,.023],[1,0,.020]],{closed:true,max:h*.037})
      for(const [index,role] of body.slots.entries()){
        if(role?.side!==side||!role.slot.startsWith('finger.')||/leaf|end|tip/i.test(body.bones[index].name))continue
        const next=body.bones.findIndex(b=>b.parent===body.bones[index])
        if(next<0)continue
        const at=new Vector3().setFromMatrixPosition(body.rest[index]), end=new Vector3().setFromMatrixPosition(body.rest[next])
        if(at.distanceTo(end)<h*.003)continue
        tube('Палец '+label(side),at,end,[[0,0,.0045],[.5,0,.004],[1,0,.0035]],{closed:true,max:h*.012})
      }
    }
  }
  if(!result.length) throw new Error('Шаблон недоступен.')
  return result
}

export function pieceBounds(pieces: Piece[]): Box3 {
  const bounds=new Box3()
  for(const {geometry} of pieces){geometry.computeBoundingBox();bounds.union(geometry.boundingBox!)}
  return bounds
}

export function accessoryMesh(piece: Piece): Mesh {
  const mesh=new Mesh(piece.geometry,piece.material)
  mesh.name=piece.name
  return mesh
}

export const templateName=(type:GarmentType) => T[type]
