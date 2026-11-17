// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { AnimationMixer, Matrix4, Mesh, Vector2, Vector3, type MeshStandardMaterial, type SkinnedMesh } from 'three'
import { expect, it } from 'vitest'
import { wardrobeTestEnvironment } from './wardrobe-fixtures.ts'
import { library_asset } from './library-fixtures.ts'
import { FittingBody } from '../src/wardrobe/body.ts'
import { bakeCloth } from '../src/wardrobe/cloth-bake.ts'
import { ClothMotion } from '../src/wardrobe/cloth-motion.ts'
import { cutPanel, panelGeometry, type CutShape } from '../src/wardrobe/cut-panel.ts'
import { fashionCatalogue, fashionTemplate } from '../src/wardrobe/fashion.ts'
import { combineGlb, encodeGarments } from '../src/wardrobe/glb.ts'
import { offsetPiece, setAlpha } from '../src/wardrobe/surface-layers.ts'
import { inspect_glb } from '../src/my-rigs/GlbEnvelope.ts'
import { BoneSlot } from '../src/retarget/bone-automap/BoneTypes.ts'

wardrobeTestEnvironment()
const demo='static/animations/human-base-animations.glb'
const shape:CutShape={
  points:[[.2,.2],[.76,.2],[.77,.78],[.53,.60],[.2,.78]].map(([x,y])=>new Vector2(x,y)),
  aspect:1.7,width:26,angle:0,height:15,thickness:3,name:'Полотно'
}

it('cuts a concave fabric panel, stores textile UVs, and exports independent opacity with the rig',async()=>{
  const body=new FittingBody(await library_asset(demo))
  const thick=cutPanel(body,shape)
  const thin=cutPanel(body,{...shape,thickness:0})
  expect(thick.geometry.attributes.position.count).toBeGreaterThan(thin.geometry.attributes.position.count*2)
  const uv=thin.geometry.attributes.uv
  expect(uv.getX(0)).toBeGreaterThanOrEqual(.199)
  expect(uv.getX(0)).toBeLessThanOrEqual(.771)
  expect(uv.getY(0)).toBeGreaterThanOrEqual(.219)
  const source=new Mesh(thin.geometry,thin.material);source.position.y=.2
  const lining=offsetPiece(source,'Подкладка',-body.height*.009)
  expect(lining.material).not.toBe(source.material)
  setAlpha(lining.material as MeshStandardMaterial,'blend',.54)
  expect((source.material as MeshStandardMaterial).opacity).toBe(1)
  expect((lining.material as MeshStandardMaterial).depthWrite).toBe(false)
  setAlpha(thick.material as MeshStandardMaterial,'cutout',.43)
  ;[lining,thick].forEach(piece=>body.weights(piece.geometry))
  const output=inspect_glb(await encodeGarments(body,[lining,thick])) as unknown as {materials:{alphaMode:string,alphaCutoff?:number}[]}
  expect(output.materials.map(item=>item.alphaMode)).toEqual(['BLEND','MASK'])
  expect(output.materials[1].alphaCutoff).toBeCloseTo(.43)
  const crossing={...shape,points:[[0,0],[1,1],[1,0],[0,1]].map(([x,y])=>new Vector2(x,y))}
  expect(()=>panelGeometry(crossing,(x,y)=>new Vector3(x,y,0))).toThrow(/пересекаются/)
},30000)

it('keeps fitted templates from each catalogue group and numerical geometry',async()=>{
  const body=new FittingBody(await library_asset(demo))
  const variants=Object.values(fashionCatalogue).flat()
  expect(variants).toHaveLength(14)
  for(const [id] of variants)for(const piece of fashionTemplate(body,id)){
    expect(piece.geometry.groups.length).toBeGreaterThan(1)
    expect([...piece.geometry.attributes.position.array].every(Number.isFinite)).toBe(true)
    if(piece.joint!==undefined)expect(body.bones[piece.joint]).toBeDefined()
  }
})

it('leaves the top pinned and bakes cloth movement into one existing clip',async()=>{
  const body=new FittingBody(await library_asset(demo))
  const piece=cutPanel(body,{...shape,thickness:0})
  body.weights(piece.geometry)
  const motion=new ClothMotion(piece.geometry,body.height)
  const highest=motion.rest.reduce((best,p,i)=>p.y>motion.rest[best].y?i:best,0)
  const lowest=motion.rest.reduce((best,p,i)=>p.y<motion.rest[best].y?i:best,0)
  motion.step(0,new Matrix4(),[])
  const step=new Matrix4().makeTranslation(.23,0,0)
  motion.step(1/60,step,[])
  expect(motion.position[highest].x).toBeCloseTo(motion.rest[highest].x+.23,6)
  expect(motion.position[lowest].x).toBeLessThan(motion.rest[lowest].x+.20)
  const clip=body.asset.clips.findIndex(c=>c.name==='Walk')
  expect(clip).toBeGreaterThanOrEqual(0)
  const bone=body.slots.findIndex(role=>role?.slot===BoneSlot.Spine)
  const baked=await bakeCloth(body,[piece],[{piece:0,bone,decals:[]}],clip)
  expect(baked.positions.get(0)?.length).toBe(baked.times.length)
  expect(baked.positions.get(0)!.at(-1)!.array.some(n=>Math.abs(n)>.001)).toBe(true)
  const original=inspect_glb(body.asset.source_bytes)
  const bytes=combineGlb(body.asset.source_bytes,await encodeGarments(body,[piece],baked),clip)
  const next=inspect_glb(bytes)
  for(const [i,animation] of original.animations!.entries()){
    if(i!==clip)expect(next.animations![i]).toEqual(animation)
    else{
      expect(next.animations![i].channels.slice(0,animation.channels.length)).toEqual(animation.channels)
      expect(next.animations![i].channels.at(-1)?.target.path).toBe('weights')
    }
  }
  const dir=mkdtempSync('.wardrobe-motion-')
  try{
    const file=dir+'/baked.glb'
    writeFileSync(file,new Uint8Array(bytes))
    const reload=await library_asset(file)
    const garment=[...reload.nodes.values()].find(node=>node.object.userData.wardrobeClothing)?.object as SkinnedMesh
    expect(garment.morphTargetInfluences!.length).toBe(baked.times.length)
    const mixer=new AnimationMixer(reload.scene)
    mixer.clipAction(reload.clips[clip]).play()
    mixer.setTime(baked.times[3])
    expect(garment.morphTargetInfluences![3]).toBeCloseTo(1)
  }finally{rmSync(dir,{recursive:true,force:true})}
},45000)
