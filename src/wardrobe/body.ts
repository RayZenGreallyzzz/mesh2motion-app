import { Bone, Box3, BufferAttribute, Matrix3, Matrix4, Mesh, Skeleton, SkinnedMesh, Vector3, type BufferGeometry } from 'three'
import { restore_rig_pose, type RigAsset } from '../my-rigs/RigAsset.ts'
import { joint_roles } from '../my-rigs/RigBoneMapping.ts'
import { BoneSide, BoneSlot } from '../retarget/bone-automap/BoneTypes.ts'

const point = new Vector3()
const normal = new Vector3()

type Sample = { p: Vector3, n: Vector3, joints: number[], weights: number[] }
type Neighbor = { sample: Sample, distance: number }

export class FittingBody {
  readonly bounds = new Box3()
  readonly bones: Bone[]
  readonly slots: Array<{ slot: BoneSlot | 'root', side: BoneSide } | undefined>
  readonly nodes: number[]
  readonly rest: Matrix4[]
  readonly center = new Vector3()
  readonly height: number
  readonly up = new Vector3(0, 1, 0)
  readonly across = new Vector3(1, 0, 0)
  readonly forward = new Vector3(0, 0, 1)
  readonly mesh: SkinnedMesh
  private readonly cells = new Map<string, Sample[]>()
  private readonly samples: Sample[] = []
  private readonly step: number

  constructor (readonly asset: RigAsset) {
    restore_rig_pose(asset)
    const skin = (object: unknown): object is SkinnedMesh => (object as SkinnedMesh).isSkinnedMesh === true
    const meshes = [...asset.nodes.values()].map(node => node.object).filter(skin)
      .filter(mesh => mesh.geometry.hasAttribute('skinIndex') && mesh.geometry.hasAttribute('skinWeight'))
    meshes.sort((a,b) => b.skeleton.bones.length - a.skeleton.bones.length ||
      b.geometry.attributes.position.count - a.geometry.attributes.position.count)
    const mesh = meshes[0]
    if (!mesh) throw new Error('Откройте GLB персонажа с привязанным скелетом.')
    this.mesh = mesh
    this.bones = mesh.skeleton.bones
    this.rest = this.bones.map(bone => bone.matrixWorld.clone())
    const ids = new Map([...asset.nodes.values()].map(node => [node.object, node.id]))
    const roles = joint_roles(asset)
    this.slots = this.bones.map(bone => roles.get(ids.get(bone) ?? ''))
    this.nodes = this.bones.map(bone => {
      const address = /^n(\d+)$/.exec(ids.get(bone) ?? '')
      if (!address) throw new Error('Кость не связана с исходным GLB.')
      return Number(address[1])
    })
    const bone_indices = new Map(this.bones.map((bone,i) => [bone,i]))
    const sources = meshes.filter(item => item.skeleton.bones.every(bone => bone_indices.has(bone)))
    for (const source of sources) {
      const g = source.geometry, p = g.attributes.position, lo = new Box3()
      for (let i=0;i<p.count;i++) lo.expandByPoint(point.fromBufferAttribute(p,i).applyMatrix4(source.matrixWorld))
      this.bounds.union(lo)
    }
    this.bounds.getCenter(this.center)
    this.height = this.bounds.max.y-this.bounds.min.y
    if (!Number.isFinite(this.height) || this.height <= 0) throw new Error('Не удалось измерить модель.')
    this.step = this.height*.022
    const left = this.joint(BoneSlot.UpperArm, BoneSide.Left), right = this.joint(BoneSlot.UpperArm, BoneSide.Right)
    if (left && right) this.across.copy(left).sub(right).setY(0).normalize()
    if (this.across.lengthSq() < .01) this.across.set(1,0,0)
    this.forward.crossVectors(this.across,this.up)
    const stride = Math.max(1, Math.ceil(sources.reduce((n,item) => n+item.geometry.attributes.position.count,0)/115000))
    for (const source of sources) {
      const g = source.geometry, { position, skinIndex, skinWeight } = g.attributes
      const remap = source.skeleton.bones.map(bone => bone_indices.get(bone)!)
      const normal_matrix = new Matrix3().getNormalMatrix(source.matrixWorld)
      for (let i=0;i<position.count;i+=stride) {
        const p = new Vector3().fromBufferAttribute(position,i).applyMatrix4(source.matrixWorld)
        const n = g.attributes.normal ? new Vector3().fromBufferAttribute(g.attributes.normal,i).applyNormalMatrix(normal_matrix) : new Vector3()
        const joints: number[] = [], weights: number[] = []
        for (let axis=0; axis<4; axis++) {
          const weight = skinWeight.getComponent(i,axis)
          const joint = remap[skinIndex.getComponent(i,axis)]
          if (weight>0 && Number.isInteger(joint)) { joints.push(joint); weights.push(weight) }
        }
        if (!weights.length) continue
        const sample = { p,n,joints,weights }
        const key = this.key(this.cell(p.x),this.cell(p.y),this.cell(p.z))
        const cell = this.cells.get(key)
        if (cell) cell.push(sample)
        else this.cells.set(key,[sample])
        this.samples.push(sample)
      }
    }
    if (!this.samples.length) throw new Error('Модель не содержит пригодных весов костей.')
  }

  private cell (x: number): number { return Math.floor(x/this.step) }
  private key (x: number,y: number,z: number): string { return x+','+y+','+z }

  joint (slot: BoneSlot, side?: BoneSide): Vector3 | undefined {
    const i = this.slots.findIndex(item => item?.slot===slot && (side===undefined || item.side===side))
    return i<0 ? undefined : new Vector3().setFromMatrixPosition(this.rest[i])
  }

  /** Pick nearby surface samples. Back-facing surfaces contribute less when nearby limbs overlap. */
  nearest (p: Vector3, n?: Vector3, count=5): Neighbor[] {
    const x=this.cell(p.x), y=this.cell(p.y), z=this.cell(p.z)
    const best: Neighbor[] = []
    const visit = (sample: Sample) => {
      const distance = p.distanceToSquared(sample.p)*(n && n.dot(sample.n)<-.18 ? 2.25 : 1)
      if (best.length===count && distance>=best[count-1].distance) return
      const index = best.findIndex(previous => distance<previous.distance)
      if (index===-1) best.push({sample,distance})
      else best.splice(index,0,{sample,distance})
      if (best.length>count) best.pop()
    }
    for (let radius=0;radius<=5;radius++) {
      for (let dx=-radius;dx<=radius;dx++) for (let dy=-radius;dy<=radius;dy++) for (let dz=-radius;dz<=radius;dz++) {
        if (Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dz))!==radius) continue
        this.cells.get(this.key(x+dx,y+dy,z+dz))?.forEach(visit)
      }
      if (best.length===count && best[count-1].distance<Math.max(0,radius-1)**2*this.step**2) break
    }
    return best
  }

  nearestJoint (p: Vector3): number {
    let closest = 0, distance = Infinity
    for (let i=0;i<this.rest.length;i++) {
      const at = point.setFromMatrixPosition(this.rest[i]).distanceToSquared(p)
      if (at<distance) { distance=at; closest=i }
    }
    return closest
  }

  weights (g: BufferGeometry, rigid?: number): void {
    const p=g.attributes.position, n=g.attributes.normal
    const indices=new Uint16Array(p.count*4), weights=new Float32Array(p.count*4)
    const candidate=new Map<number,number>()
    for (let i=0;i<p.count;i++) {
      const at=i*4
      if (rigid!==undefined) { indices[at]=rigid; weights[at]=1; continue }
      const v=new Vector3().fromBufferAttribute(p,i)
      const linked=this.nearest(v,n ? normal.fromBufferAttribute(n,i).normalize() : undefined)
      candidate.clear()
      for (const {sample,distance} of linked) {
        const strength=1/(distance+this.step**2*.07)
        sample.joints.forEach((joint,k)=>candidate.set(joint,(candidate.get(joint)??0)+sample.weights[k]*strength))
      }
      const pairs=[...candidate].sort((a,b)=>b[1]-a[1]).slice(0,4)
      if (!pairs.length) { indices[at]=this.nearestJoint(v);weights[at]=1;continue }
      const total=pairs.reduce((sum,pair)=>sum+pair[1],0)
      pairs.forEach(([joint,w],slot)=>{indices[at+slot]=joint;weights[at+slot]=w/total})
    }
    g.setAttribute('skinIndex',new BufferAttribute(indices,4))
    g.setAttribute('skinWeight',new BufferAttribute(weights,4))
  }

  /** Measure a local body section in the axes of the clothing panel. */
  section (at: Vector3, u: Vector3, v: Vector3, axis: Vector3, span: number, radius: number): [number,number] {
    const sizes: [number,number] = [0,0]
    for (const s of this.samples) {
      const delta=point.copy(s.p).sub(at)
      if (Math.abs(delta.dot(axis))>span || delta.lengthSq()>radius*radius) continue
      sizes[0]=Math.max(sizes[0],Math.abs(delta.dot(u)))
      sizes[1]=Math.max(sizes[1],Math.abs(delta.dot(v)))
    }
    return sizes
  }

  canonicalSkin (bones=this.bones): Skeleton {
    return new Skeleton(bones,this.rest.map(matrix=>matrix.clone().invert()))
  }
}

export function bakedGeometry (mesh: Mesh, placement: Matrix4): BufferGeometry {
  const g=mesh.geometry.clone()
  for(const name of ['position','normal','tangent']){
    const attribute=g.attributes[name]
    if(!attribute||attribute.array instanceof Float32Array)continue
    const data=new Float32Array(attribute.count*attribute.itemSize)
    for(let row=0;row<attribute.count;row++)for(let column=0;column<attribute.itemSize;column++)
      data[row*attribute.itemSize+column]=attribute.getComponent(row,column)
    g.setAttribute(name,new BufferAttribute(data,attribute.itemSize))
  }
  g.applyMatrix4(placement.clone().multiply(mesh.matrixWorld))
  g.deleteAttribute('skinIndex');g.deleteAttribute('skinWeight')
  g.morphAttributes={}
  if(!g.attributes.normal)g.computeVertexNormals()
  return g
}
