// @vitest-environment node
import { BufferGeometry, Float32BufferAttribute, Matrix4, ShapeUtils, Vector2 } from 'three'
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

it('cuts a half pixel through both sides of a millimetre bridge without removing nearby original vertices', () => {
  const mesh = joined()
  const before=Array.from(mesh.attributes.position.array)
  const selection = new Map([2, 3, 8, 9, 1, 4, 7, 10].map(i => [i,1]))
  const {geometry,open,cut} = knife_cut(mesh,selection,{matrix:new Matrix4(),width:1000,height:1000},[500,495],[500,505],.5,true)
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
  }
})

it('keeps a finite blade from removing material beyond the endpoints', () => {
  const source = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([-1,-1,0,1,-1,0,0,1,0],3))
  const selection = new Map([0,1,2].map(i=>[i,1]))
  const {geometry, open} = knife_cut(source,selection,{matrix:new Matrix4(),width:100,height:100},[50,46],[50,54],2,true)
  const attr = geometry.attributes.position, index = geometry.index!
  let kept_area=0
  for(let i=0; i<index.count;i+=3){
    const p=[0,1,2].map(k=>new Vector2(attr.getX(index.getX(i+k)),attr.getY(index.getX(i+k))))
    kept_area+=Math.abs(ShapeUtils.area(p))
  }
  expect(open).toBe(true)
  expect(kept_area).toBeCloseTo(2-.04*.16,6)
})
