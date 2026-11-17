import { Matrix3, Mesh, Vector3 } from 'three'
import type { FittingBody } from './body.ts'

/** Edit the garment in world space so the brush size does not change with item scale. */
export function fitPatch(body:FittingBody,mesh:Mesh,center:Vector3,faceNormal:Vector3,
  radius:number,strength:number,mode:'tighten'|'loosen',soft:boolean):boolean {
  const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal
  const inverse=mesh.matrixWorld.clone().invert(), normalMatrix=new Matrix3().getNormalMatrix(mesh.matrixWorld)
  const targetNormal=faceNormal.clone().applyNormalMatrix(normalMatrix)
  const world=new Vector3(),delta=new Vector3(),norm=new Vector3()
  let changed=false
  for(let i=0;i<p.count;i++){
    world.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld)
    const distance=world.distanceTo(center)
    if(distance>=radius)continue
    norm.fromBufferAttribute(n,i).applyNormalMatrix(normalMatrix)
    if(norm.dot(targetNormal)<-.27)continue
    const falloff=(1-distance/radius)**2
    const surface=mode==='tighten'&&soft ? body.nearest(world,norm,1)[0]?.sample : undefined
    if(surface&&surface.p.distanceTo(world)<body.height*.19){
      if(surface.n.lengthSq())delta.copy(surface.n)
      else delta.copy(world).sub(surface.p).normalize()
      const gap=world.clone().sub(surface.p).dot(delta)
      const amount=(gap-body.height*.0025)*falloff*strength*.42
      if(Math.abs(amount)<body.height*.0001)continue
      world.addScaledVector(delta,-amount)
    }else world.addScaledVector(norm,radius*.16*falloff*strength*(mode==='loosen'?1:-1))
    world.applyMatrix4(inverse)
    p.setXYZ(i,world.x,world.y,world.z);changed=true
  }
  if(changed){
    p.needsUpdate=true;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere()
  }
  return changed
}
