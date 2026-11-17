// @vitest-environment node
import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three'
import { expect, it } from 'vitest'
import { anchorPrint, projectPrint } from '../src/wardrobe/image-placement.ts'
import { ensureFabricUv } from '../src/wardrobe/fabric-image.ts'

function garment(){
  const clothing=new BufferGeometry()
  clothing.setAttribute('position',new BufferAttribute(new Float32Array([
    -1,-1,0, 1,-1,0, 1,1,0, -1,1,0,
    -1,-1,-.01, 1,-1,-.01, 1,1,-.01, -1,1,-.01
  ]),3))
  clothing.setIndex([0,1,2,0,2,3,4,6,5,4,7,6]);clothing.computeVertexNormals()
  clothing.setAttribute('skinIndex',new BufferAttribute(new Uint16Array([
    1,3,0,0, 2,3,0,0, 1,2,3,0, 1,3,0,0, 8,0,0,0, 8,0,0,0, 8,0,0,0, 8,0,0,0
  ]),4))
  clothing.setAttribute('skinWeight',new BufferAttribute(new Float32Array([
    .9,.1,0,0, .7,.3,0,0, .2,.2,.6,0, .6,.4,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0
  ]),4))
  return clothing
}
const frame={width:.7,aspect:1.3,angle:0,padding:[.05,.08] as [number,number],lift:.001}
const world=new Matrix4()
const up=new Vector3(0,1,0), towards=new Vector3(0,0,1)

it('prints the visible side and retains the exact skin weights of every garment vertex',()=>{
  const clothing=garment()
  const anchor=anchorPrint(clothing,world,[0,1,2],new Vector3(.1,0,0),up,towards)!
  const result=projectPrint(clothing,world,anchor,frame,clothing)!
  expect(result.attributes.position.count).toBe(6)
  const lookup=[0,1,2,0,2,3]
  for(const [i,src] of lookup.entries()){
    expect(result.attributes.position.getZ(i)).toBeCloseTo(.001)
    for(let j=0;j<4;j++){
      expect(result.attributes.skinIndex.getComponent(i,j)).toBe(clothing.attributes.skinIndex.getComponent(src,j))
      expect(result.attributes.skinWeight.getComponent(i,j)).toBe(clothing.attributes.skinWeight.getComponent(src,j))
    }
  }
  expect(result.attributes.uv.getX(0)).toBeLessThan(0)
  expect(result.attributes.uv.getX(1)).toBeGreaterThan(1)
})

it('anchors a design when the garment moves and rotates the print around its center',()=>{
  const cloth=garment()
  const anchor=anchorPrint(cloth,world,[0,1,2],new Vector3(0,0,0),up,towards)!
  const shifted=new Matrix4().makeTranslation(5,-3,2)
  const a=projectPrint(cloth,world,anchor,frame)!
  const b=projectPrint(cloth,shifted,anchor,frame)!
  expect(Array.from(a.attributes.uv.array)).toEqual(Array.from(b.attributes.uv.array))
  expect(b.attributes.position.getX(0)-a.attributes.position.getX(0)).toBeCloseTo(5)
  expect(b.attributes.position.getY(0)-a.attributes.position.getY(0)).toBeCloseTo(-3)
  const c=projectPrint(cloth,shifted,anchor,{...frame,angle:90})!
  expect(c.attributes.uv.getX(0)).toBeCloseTo(a.attributes.uv.getX(0))
  expect(c.attributes.uv.getY(0)).toBeGreaterThan(1)
})

it('adds usable planar UVs to imported geometry without overwriting its authored UVs',()=>{
  const geometry=garment()
  expect(ensureFabricUv(geometry)).toBe(true)
  const uv=geometry.attributes.uv
  expect([uv.getX(0),uv.getY(0),uv.getX(2),uv.getY(2)]).toEqual([0,0,1,1])
  expect(ensureFabricUv(geometry)).toBe(false)
  expect(geometry.attributes.uv).toBe(uv)
})
