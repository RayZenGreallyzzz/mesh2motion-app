// @vitest-environment node
import { wardrobeTestEnvironment } from './wardrobe-fixtures.ts'
import { AnimationMixer, Mesh, Matrix4, Uint16BufferAttribute, BufferGeometry, Vector3, type SkinnedMesh } from 'three'
import { expect, it } from 'vitest'
import { library_asset } from './library-fixtures.ts'
import { FittingBody, bakedGeometry } from '../src/wardrobe/body.ts'
import { fitPatch } from '../src/wardrobe/brush.ts'
import { template } from '../src/wardrobe/garments.ts'
import { T, type GarmentType } from '../src/wardrobe/types.ts'
import { parsePattern, sewPanels } from '../src/wardrobe/pattern.ts'
import { combineGlb, encodeGarments } from '../src/wardrobe/glb.ts'
import { inspect_glb } from '../src/my-rigs/GlbEnvelope.ts'

wardrobeTestEnvironment()
const demo='static/animations/human-base-animations.glb'

it('builds editable templates and dresses the existing rig without replacing its animations', async()=>{
  const body=new FittingBody(await library_asset(demo))
  for(const type of Object.keys(T) as GarmentType[]){
    const pieces=template(body,type,.013,1,1,'#73c5b1')
    expect(pieces.length).toBeGreaterThan(0)
    for(const piece of pieces){
      const p=piece.geometry.attributes.position
      expect(p.count).toBeGreaterThan(10)
      expect([...p.array].every(Number.isFinite)).toBe(true)
    }
  }
  const garments=template(body,'puffed',.013,1,1,'#73c5b1')
  const plate=template(body,'armor',.013,1,1,'#a8c5d2')[0]
  for(const p of garments)body.weights(p.geometry)
  body.weights(plate.geometry,plate.joint)
  expect(plate.geometry.attributes.skinWeight.getX(0)).toBe(1)
  const robe=await encodeGarments(body,[...garments,plate])
  const combined=combineGlb(body.asset.source_bytes,robe)
  const original=inspect_glb(body.asset.source_bytes), reloadedDoc=inspect_glb(combined)
  expect(reloadedDoc.animations).toEqual(original.animations)
  expect(reloadedDoc.nodes!.length).toBe(original.nodes!.length+garments.length+1)
  const skin=reloadedDoc.skins!.at(-1)!
  expect(skin.joints).toEqual(body.nodes)
  expect(new Uint8Array(combined,28+new DataView(combined).getUint32(12,true),original.buffers![0].byteLength))
    .toEqual(new Uint8Array(body.asset.source_bytes,28+new DataView(body.asset.source_bytes).getUint32(12,true),original.buffers![0].byteLength))
  const {writeFileSync,mkdtempSync,rmSync}=await import('node:fs')
  const dir=mkdtempSync('.wardrobe-test-')
  try{
    const file=dir+'/combined.glb';writeFileSync(file,new Uint8Array(combined))
    const loaded=await library_asset(file)
    const garment=[...loaded.nodes.values()].find(n=>n.object.userData.wardrobeClothing)!.object as SkinnedMesh
    expect(garment.isSkinnedMesh).toBe(true)
    const rest=garment.getVertexPosition(18,new Vector3()).applyMatrix4(garment.matrixWorld)
    const player=new AnimationMixer(loaded.scene)
    player.clipAction(loaded.clips.find(clip=>clip.name==='Walk')!).play()
    player.update(.36);loaded.scene.updateMatrixWorld(true);garment.skeleton.update()
    const posed=garment.getVertexPosition(18,new Vector3()).applyMatrix4(garment.matrixWorld)
    expect(posed.distanceTo(rest)).toBeGreaterThan(body.height*.002)
    expect(loaded.clips.length).toBe(body.asset.clips.length)
  }finally{rmSync(dir,{recursive:true,force:true})}
},30000)

it('takes separate SVG contours and welds the selected edges of the pattern',async()=>{
  const body=new FittingBody(await library_asset(demo))
  const panels=parsePattern('<svg xmlns="http://www.w3.org/2000/svg"><polygon points="0,0 95,0 94,110 4,110"/><polygon points="105,0 198,0 198,110 108,110"/></svg>')
  expect(panels).toHaveLength(2)
  const [open]=sewPanels(body,panels,[],35)
  const [closed]=sewPanels(body,panels,[{a:[0,1],b:[1,1],reverse:true}],35)
  expect(closed.geometry.attributes.position.count).toBe(open.geometry.attributes.position.count-7)
  expect(closed.geometry.index!.count).toBeGreaterThan(0)
})

it('keeps sub-unit positions when fitting quantized GLB geometry',()=>{
  const g=new BufferGeometry()
  g.setAttribute('position',new Uint16BufferAttribute([0,0,0,1024,0,0,0,2048,0],3))
  const mesh=new Mesh(g);mesh.scale.setScalar(.0001);mesh.updateMatrixWorld()
  const fitted=bakedGeometry(mesh,new Matrix4())
  expect(fitted.attributes.position.getX(1)).toBeCloseTo(.1024,7)
  expect(fitted.attributes.position.getY(2)).toBeCloseTo(.2048,7)
})

it('moves only the chosen cloth patch inward and then back outward',()=>{
  const geometry=new BufferGeometry()
  geometry.setAttribute('position',new Uint16BufferAttribute([0,0,0,1024,0,0,0,2048,0],3))
  const object=new Mesh(geometry);object.scale.setScalar(.001);object.updateMatrixWorld()
  const mesh=new Mesh(bakedGeometry(object,new Matrix4()))
  const point=new Vector3(), n=new Vector3(0,0,1)
  const body={height:1, nearest:()=>[{sample:{p:new Vector3(0,0,-.1),n},distance:.01}]} as unknown as FittingBody
  expect(fitPatch(body,mesh,point,n,.25,1,'tighten',true)).toBe(true)
  const lowered=mesh.geometry.attributes.position.getZ(0)
  expect(lowered).toBeLessThan(-.02)
  expect(mesh.geometry.attributes.position.getZ(1)).toBe(0)
  expect(fitPatch(body,mesh,new Vector3(0,0,lowered),n,.25,1,'loosen',true)).toBe(true)
  expect(mesh.geometry.attributes.position.getZ(0)).toBeGreaterThan(lowered)
  expect(mesh.geometry.attributes.position.getZ(1)).toBe(0)
})
