import { type BufferGeometry, Vector3 } from 'three'
import { welded_surface_components } from '../solvers/WeldedSurfaceComponents.ts'

/** One compact spatial index per source geometry. UV seams are welded for
 * component selection. No full million-vertex scan on each pointer movement. */
export class SurfaceWeightBrush {
  private readonly heads=new Map<number,number>()
  private readonly next:Int32Array
  private readonly components:Int32Array
  private readonly coincident: Int32Array
  private readonly seams = new Map<number, number[]>()
  private readonly cell:number
  private readonly origin:Vector3
  private readonly nx:number
  private readonly ny:number
  private readonly nz:number
  constructor(readonly geometry:BufferGeometry){
    geometry.computeBoundingBox();const box=geometry.boundingBox!,size=box.getSize(new Vector3())
    this.cell=Math.max(size.y,size.length()*.1,1e-6)*.025
    this.origin=box.min.clone();this.nx=Math.ceil(size.x/this.cell)+1;this.ny=Math.ceil(size.y/this.cell)+1;this.nz=Math.ceil(size.z/this.cell)+1
    const p=geometry.getAttribute('position');this.next=new Int32Array(p.count);this.next.fill(-1)
    for(let i=0;i<p.count;i++){const x=Math.floor((p.getX(i)-this.origin.x)/this.cell),y=Math.floor((p.getY(i)-this.origin.y)/this.cell),z=Math.floor((p.getZ(i)-this.origin.z)/this.cell),key=this.key(x,y,z);this.next[i]=this.heads.get(key)??-1;this.heads.set(key,i)}
    this.coincident = new Int32Array(p.count)
    this.components = welded_surface_components(geometry, this.coincident).componentByVertex
    for (let i = 0; i < p.count; i++) {
      const first = this.coincident[i]
      if (first === i) continue
      const seam = this.seams.get(first)
      if (seam) seam.push(i)
      else this.seams.set(first, [first, i])
    }
  }
  private key(x:number,y:number,z:number){return (z*this.ny+y)*this.nx+x}
  /** Front facing normals + a shallow slab reject the far side and nearby
   * disconnected clothes. A visible side of a UV seam updates its duplicates
   * so both sides keep moving together when the bone is posed. */
  query(point:Vector3,radius:number,seed:number,view:Vector3,frontOnly=true,limit=Infinity):Map<number,number>{
    const out=new Map<number,number>(),p=this.geometry.getAttribute('position'),normal=this.geometry.getAttribute('normal'),r2=radius*radius,component=this.components[seed]
    const a=point.clone().subScalar(radius).sub(this.origin).divideScalar(this.cell).floor(),b=point.clone().addScalar(radius).sub(this.origin).divideScalar(this.cell).floor()
    const min=[Math.max(0,a.x),Math.max(0,a.y),Math.max(0,a.z)],max=[Math.min(this.nx-1,b.x),Math.min(this.ny-1,b.y),Math.min(this.nz-1,b.z)]
    for(let z=min[2];z<=max[2];z++)for(let y=min[1];y<=max[1];y++)for(let x=min[0];x<=max[0];x++){
      let i=this.heads.get(this.key(x,y,z))??-1
      for(;i!==-1;i=this.next[i]){
        if(this.components[i]!==component)continue
        const dx=p.getX(i)-point.x,dy=p.getY(i)-point.y,dz=p.getZ(i)-point.z,d2=dx*dx+dy*dy+dz*dz
        if(d2>=r2)continue
        if(frontOnly&&(Math.abs(dx*view.x+dy*view.y+dz*view.z)>radius*.35 || normal&&normal.getX(i)*view.x+normal.getY(i)*view.y+normal.getZ(i)*view.z<=.05))continue
        const t = 1 - Math.sqrt(d2) / radius
        const weight = t * t * (3 - 2 * t)
        const seam = this.seams.get(this.coincident[i])
        if (seam) {
          for (const vertex of seam) out.set(vertex, Math.max(weight, out.get(vertex) ?? 0))
        } else out.set(i, weight)
      }
    }
    // The smoothing neighborhood is bounded by distance, not grid order.
    return out.size <= limit ? out : new Map([...out].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit))
  }
}
