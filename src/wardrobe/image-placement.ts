import {
  BufferAttribute, BufferGeometry, Matrix3, Triangle, Vector3,
  type Matrix4
} from 'three'

export interface PrintAnchor {
  triangle: [number, number, number]
  point: Vector3
  up: Vector3
  side: number
}

export interface PrintFrame {
  width: number
  aspect: number
  angle: number
  padding: [number, number]
  lift: number
}

export function anchorPrint(geometry: BufferGeometry, matrix: Matrix4,
  triangle: PrintAnchor['triangle'], worldPoint: Vector3, worldUp: Vector3, worldView: Vector3): PrintAnchor | undefined {
  const p = geometry.getAttribute('position')
  const [a,b,c] = triangle.map(index => new Vector3().fromBufferAttribute(p,index).applyMatrix4(matrix))
  const face = new Triangle(a,b,c)
  const barycentric = face.getBarycoord(worldPoint,new Vector3())
  if(!barycentric)return
  return {
    triangle,
    point:barycentric,
    up: worldUp.clone().transformDirection(matrix.clone().invert()),
    side:face.getNormal(new Vector3()).dot(worldView)>=0?1:-1
  }
}

/** Print complete source triangles with projected UVs and a transparent
 * texture border. Keeping the original vertices also keeps their exact skin
 * weights at bends, including across very coarse triangles. */
export function projectPrint(geometry: BufferGeometry, model: Matrix4, anchor: PrintAnchor,
  options: PrintFrame, skin?: BufferGeometry): BufferGeometry | undefined {
  const p=geometry.getAttribute('position'), norm=geometry.getAttribute('normal'), index=geometry.index
  if(anchor.triangle.some(id=>id<0||id>=p.count))return
  const [a,b,c]=anchor.triangle.map(id=>new Vector3().fromBufferAttribute(p,id).applyMatrix4(model))
  const normal=new Triangle(a,b,c).getNormal(new Vector3()).multiplyScalar(anchor.side)
  if(normal.lengthSq()<.5)return
  const center=a.clone().multiplyScalar(anchor.point.x).addScaledVector(b,anchor.point.y).addScaledVector(c,anchor.point.z)
  const vertical=anchor.up.clone().transformDirection(model)
  vertical.addScaledVector(normal,-vertical.dot(normal))
  if(vertical.lengthSq()<1e-6){
    vertical.set(0,1,0)
    if(Math.abs(normal.y)>.95)vertical.set(0,0,-1)
    vertical.addScaledVector(normal,-vertical.dot(normal))
  }
  vertical.normalize().applyAxisAngle(normal,options.angle*Math.PI/180)
  const horizontal=new Vector3().crossVectors(vertical,normal).normalize()
  const halfX=options.width*.5, halfY=Math.min(options.width*7,options.width/options.aspect)*.5
  if(!(halfX>0&&halfY>0))return
  const depth=Math.min(halfX,halfY)*.56
  const frame=new Float32Array(p.count*3), point=new Vector3()
  for(let i=0;i<p.count;i++){
    point.fromBufferAttribute(p,i).applyMatrix4(model).sub(center)
    frame[i*3]=point.dot(horizontal)
    frame[i*3+1]=point.dot(vertical)
    frame[i*3+2]=point.dot(normal)
  }
  const positions:number[]=[], normals:number[]=[], uv:number[]=[], joints:number[]=[], weights:number[]=[]
  const ni=skin?.getAttribute('skinIndex'), nw=skin?.getAttribute('skinWeight')
  const normalMatrix=new Matrix3().getNormalMatrix(model)
  const edge1=new Vector3(),edge2=new Vector3(),face=new Vector3(), vNormal=new Vector3()
  const corner=(id:number,out:Vector3)=>out.fromBufferAttribute(p,id).applyMatrix4(model)
  const padU=options.padding[0],padV=options.padding[1]
  for(let offset=0, count=index?.count??p.count;offset+2<count;offset+=3){
    const first=index?.getX(offset)??offset,second=index?.getX(offset+1)??offset+1,third=index?.getX(offset+2)??offset+2
    if(!overlap(frame,first,second,third,0,halfX)||!overlap(frame,first,second,third,1,halfY)||
      !overlap(frame,first,second,third,2,depth))continue
    corner(first,point);corner(second,edge1).sub(point);corner(third,edge2).sub(point)
    face.crossVectors(edge1,edge2).normalize().multiplyScalar(anchor.side)
    if(face.dot(normal)<.24)continue
    const ids=anchor.side>0?[first,second,third]:[first,third,second]
    for(const id of ids){
      corner(id,point)
      if(norm)vNormal.fromBufferAttribute(norm,id).applyNormalMatrix(normalMatrix)
      else vNormal.copy(face)
      if(vNormal.dot(face)<0)vNormal.negate()
      point.addScaledVector(vNormal,options.lift)
      positions.push(point.x,point.y,point.z)
      normals.push(vNormal.x,vNormal.y,vNormal.z)
      uv.push(padU+(frame[id*3]/(2*halfX)+.5)*(1-2*padU),padV+(frame[id*3+1]/(2*halfY)+.5)*(1-2*padV))
      if(ni&&nw)for(let c=0;c<4;c++){
        joints.push(ni.getComponent(id,c));weights.push(nw.getComponent(id,c))
      }
    }
  }
  if(!positions.length)return
  const result=new BufferGeometry()
  result.setAttribute('position',new BufferAttribute(Float32Array.from(positions),3))
  result.setAttribute('normal',new BufferAttribute(Float32Array.from(normals),3))
  result.setAttribute('uv',new BufferAttribute(Float32Array.from(uv),2))
  if(ni&&nw){
    result.setAttribute('skinIndex',new BufferAttribute(Uint16Array.from(joints),4))
    result.setAttribute('skinWeight',new BufferAttribute(Float32Array.from(weights),4))
  }
  return result
}

function overlap(frame:Float32Array,a:number,b:number,c:number,axis:number,extent:number):boolean {
  const x=frame[3*a+axis],y=frame[3*b+axis],z=frame[3*c+axis]
  return Math.min(x,y,z)<=extent&&Math.max(x,y,z)>=-extent
}
