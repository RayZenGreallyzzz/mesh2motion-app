// @vitest-environment node
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, ShapeUtils, Vector2, Vector3 } from 'three'
import { expect, it } from 'vitest'
import { knife_cut } from '../src/my-rigs/MeshKnife.ts'

// Two long bodies joined by a 1 mm high solid bridge. Its back is offset in
// depth so a front-surface brush cannot remove the complete connection.
function joined () {
  const outline = [
    [-.3,-.25], [-.012,-.25], [-.012,-.0005], [.012,-.0005], [.012,-.25], [.3,-.25],
    [.3,.25], [.012,.25], [.012,.0005], [-.012,.0005], [-.012,.25], [-.3,.25]
  ]
  const n = outline.length, vertices = [-.13,.18].flatMap(z => outline.flatMap(([x,y]) => [x,y,z]))
  const faces: number[] = []
  const triangles = ShapeUtils.triangulateShape(outline.map(([x,y]) => new Vector2(x,y)), [])
  for (const [a,b,c] of triangles) faces.push(c,b,a,a+n,b+n,c+n)
  for (let i=0; i<n; i++){
    const j=(i+1)%n; faces.push(i,j,i+n,j,j+n,i+n)
  }
  const mesh = new BufferGeometry().setAttribute('position',new Float32BufferAttribute(vertices,3)).setIndex(faces)
  mesh.setAttribute('uv',new Float32BufferAttribute(vertices.filter((_,i)=>i%3!==2),2))
  mesh.setAttribute('skinIndex',new Float32BufferAttribute(Array.from({length:2*n},(_, i)=>[outline[i%n][0] < 0 ? 12 : 15,0,0,0]).flat(),4))
  mesh.setAttribute('skinWeight',new Float32BufferAttribute(Array.from({length:2*n},()=>[1,0,0,0]).flat(),4))
  return mesh
}

const plate = (center: Vector3, dimensions: Vector3, angle = 0) =>
  new Matrix4().compose(center, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle), dimensions).invert()

it('cuts a 1 mm slot through both sides of the bridge without removing nearby original vertices', () => {
  const mesh = joined()
  const before=Array.from(mesh.attributes.position.array)
  const {geometry,open,cut,seam} = knife_cut(mesh, plate(new Vector3(0, 0, .02), new Vector3(.001, .02, .4)), true)
  expect(seam).toBe(1)
  expect(cut).toBeGreaterThan(0)
  expect(open).toBe(false)
  const attr = geometry.attributes.position, index = geometry.index!
  expect(Math.min(...Array.from({length:attr.count},(_,i)=>Math.abs(attr.getX(i))))).toBeCloseTo(.0005,6)
  const keys = new Set(Array.from({length:attr.count},(_,i)=>[attr.getX(i),attr.getY(i),attr.getZ(i)].join()))
  for (let i=0;i<before.length;i+=3) expect(keys.has(before.slice(i,i+3).join())).toBe(true)
  const edges=new Map<string,number>(), signs=new Set<number>()
  for(let i=0;i<index.count;i+=3) {
    const [a,b,c]=[index.getX(i),index.getX(i+1),index.getX(i+2)]
    expect(Math.sign(attr.getX(a))).toBe(Math.sign(attr.getX(b)))
    expect(Math.sign(attr.getX(a))).toBe(Math.sign(attr.getX(c)))
    signs.add(Math.sign(attr.getX(a)))
    for(const [l,r] of [[a,b],[b,c],[c,a]]){
      const key=l<r?l+','+r:r+','+l; edges.set(key,(edges.get(key)??0)+1)
    }
  }
  expect(signs).toEqual(new Set([-1,1]))
  expect([...edges.values()].every(n=>n===2)).toBe(true)
  const weights=geometry.attributes.skinWeight, bones=geometry.attributes.skinIndex
  for(let i=0;i<weights.count;i++){
    expect(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)).toBeCloseTo(1,6)
    expect([12,15]).toContain(bones.getX(i))
    expect(geometry.attributes.uv.getX(i)).toBeCloseTo(attr.getX(i),6)
    if (Math.abs(Math.abs(attr.getX(i)) - .0005) < .00001) {
      const expected = attr.getX(i) < 0 ? 12 : 15
      expect(bones.getX(i)).toBe(expected)
      expect(weights.getX(i)).toBeCloseTo(1,6)
    }
  }
})

it('closes both rims in a scaled mesh with split UV-edge vertices', () => {
  const indexed = joined(), source = indexed.toNonIndexed()
  const matrix = new Matrix4().compose(new Vector3(.5,-.7,.4),new Quaternion(),new Vector3(.0001,.0001,.0001))
  source.applyMatrix4(matrix.clone().invert())
  const to_blade = plate(new Vector3(.000137,0,.02), new Vector3(.001,.02,.4)).multiply(matrix)
  const { geometry, open, seam } = knife_cut(source,to_blade,true)
  expect(open).toBe(false)
  expect(seam).toBe(1)
  const positions = geometry.attributes.position, weights = geometry.attributes.skinWeight, ids = geometry.attributes.skinIndex
  for (let i = 0; i < weights.count; i++) {
    const position = new Vector3().fromBufferAttribute(positions,i).applyMatrix4(matrix)
    if (Math.abs(Math.abs(position.x - .000137) - .0005) > .00001) continue
    expect(ids.getX(i)).toBe(position.x < .000137 ? 12 : 15)
    expect(weights.getX(i)).toBeCloseTo(1,6)
  }
})

it('keeps the cut inside the finite height and thickness of the glass', () => {
  const source = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([-1,-1,0,1,-1,0,0,1,0],3))
  const {geometry, open} = knife_cut(source, plate(new Vector3(),new Vector3(.04,.16,.35)), true)
  const attr = geometry.attributes.position, index = geometry.index!
  let kept_area=0
  for(let i=0; i<index.count;i+=3){
    const p=[0,1,2].map(k=>new Vector2(attr.getX(index.getX(i+k)),attr.getY(index.getX(i+k))))
    kept_area+=Math.abs(ShapeUtils.area(p))
  }
  expect(open).toBe(true)
  expect(kept_area).toBeCloseTo(2-.04*.16,6)
})

it('keeps all triangles of a body behind the rotated plate', () => {
  const a = new BoxGeometry(.3,.2,.06)
  const b = new BoxGeometry(.3,.2,.06).translate(0,0,.48)
  const vertices = [...a.attributes.position.array, ...b.attributes.position.array]
  const indices = [...a.index!.array, ...Array.from(b.index!.array,i => i + a.attributes.position.count)]
  const source = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices,3)).setIndex(indices)
  const {geometry, open} = knife_cut(source, plate(new Vector3(),new Vector3(.001,.3,.2), .35), true)
  expect(open).toBe(false)
  const faces = (geom: BufferGeometry) => {
    const p = geom.attributes.position, index = geom.index!
    const out: string[] = []
    for(let i=0; i<index.count;i+=3){
      const ids=[index.getX(i), index.getX(i+1), index.getX(i+2)]
      if(ids.every(id=>p.getZ(id)>.4))out.push(ids.map(id=>[p.getX(id),p.getY(id),p.getZ(id)].join()).join('|'))
    }
    return out
  }
  expect(faces(geometry)).toEqual(faces(source))
  expect(faces(geometry)).toHaveLength(12)
})
