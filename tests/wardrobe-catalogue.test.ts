// @vitest-environment node
import { Box3, MeshStandardMaterial, Vector3 } from 'three'
import { expect, it } from 'vitest'
import { library_asset } from './library-fixtures.ts'
import { wardrobeTestEnvironment } from './wardrobe-fixtures.ts'
import { FittingBody } from '../src/wardrobe/body.ts'
import { accessoryMesh, template } from '../src/wardrobe/garments.ts'
import { shirtPrintPlacement, shirtStyles, styleMaterials } from '../src/wardrobe/shirt-styles.ts'
import { projectPrint } from '../src/wardrobe/image-placement.ts'
import { combineGlb, encodeGarments } from '../src/wardrobe/glb.ts'
import { inspect_glb } from '../src/my-rigs/GlbEnvelope.ts'

wardrobeTestEnvironment()
const demo='static/animations/human-base-animations.glb'

it('fits a jersey with independent colors and a shared side seam, and exports it with the original rig',async()=>{
  const body=new FittingBody(await library_asset(demo))
  const pieces=template(body,'shirt',.013,1,1,'#efdecd')
  styleMaterials(pieces,{name:'Тест',panel:'#f1f1ed',back:'#212434',sleeve:'#ad5541'})
  const [torso,left,right]=pieces
  const [front,back]=torso.material as MeshStandardMaterial[]
  expect(torso.regions).toEqual(['Перед','Спинка'])
  expect(front.color.getHexString()).toBe('f1f1ed')
  expect(back.color.getHexString()).toBe('212434')
  expect(left.material).not.toBe(right.material)
  expect((left.material as MeshStandardMaterial).color.getHexString()).toBe('ad5541')
  front.color.set('#7799aa')
  expect(back.color.getHexString()).toBe('212434')
  const g=torso.geometry
  const frontPolygons=new Set(g.index!.array.slice(0,g.groups[0].count))
  const backPolygons=new Set(g.index!.array.slice(g.groups[1].start))
  expect([...frontPolygons].filter(v=>backPolygons.has(v)).length).toBeGreaterThan(2)
  expect(g.groups[0].count+g.groups[1].count).toBe(g.index!.count)
  const mesh=accessoryMesh(torso)
  const located=shirtPrintPlacement(body,mesh)
  expect(located).toBeDefined()
  const mark=projectPrint(g,mesh.matrixWorld,located!.anchor,{
    width:located!.size*body.height/100,aspect:1,angle:0,padding:[.04,.04],lift:0
  })
  expect(mark?.attributes.position.count).toBeGreaterThan(20)
  const outline=new Box3().setFromObject(mesh)
  expect(outline.getSize(new Vector3()).y).toBeGreaterThan(body.height*.1)
  for(const piece of pieces)body.weights(piece.geometry)
  const doc=inspect_glb(combineGlb(body.asset.source_bytes,await encodeGarments(body,pieces)))
  const before=inspect_glb(body.asset.source_bytes)
  expect(doc.animations).toEqual(before.animations)
  expect(doc.meshes![before.meshes!.length].primitives).toHaveLength(2)
  expect(doc.skins!.at(-1)!.joints).toEqual(body.nodes)
},30000)

it('provides hoodie and jogger fitting pieces and a variety of shirt designs',async()=>{
  const body=new FittingBody(await library_asset(demo))
  expect(shirtStyles).toHaveLength(9)
  const hoodie=template(body,'hoodie',.024,1,1,'#557ba1')
  expect(hoodie.map(p=>p.name)).toContain('Капюшон')
  expect(hoodie.map(p=>p.name)).toContain('Карман')
  expect(hoodie.filter(p=>p.name.startsWith('Манжета'))).toHaveLength(2)
  const joggers=template(body,'joggers',.018,1,1,'#59674b')
  expect(joggers.some(p=>p.name==='Эластичный пояс')).toBe(true)
  expect(joggers.filter(p=>p.name.startsWith('Манжета'))).toHaveLength(2)
  for(const piece of [...hoodie,...joggers])expect([...piece.geometry.attributes.position.array].every(Number.isFinite)).toBe(true)
})
