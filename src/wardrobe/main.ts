import { Box3, Color, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, RepeatWrapping, SkinnedMesh, Vector3,
  type BufferAttribute, type BufferGeometry, type Intersection, type Material } from 'three'
import { dispose_rig_scene, type RigAsset } from '../my-rigs/RigAsset.ts'
import { load_rig_asset } from '../my-rigs/RigAssetLoader.ts'
import { MAX_GLB_BYTES } from '../my-rigs/GlbEnvelope.ts'
import { ExportCancelledError, ExportFileSaver } from '../lib/processes/export-to-file/ExportFileSaver.ts'
import { BoneSide, BoneSlot } from '../retarget/bone-automap/BoneTypes.ts'
import { FittingBody, bakedGeometry } from './body.ts'
import { accessoryMesh, pieceBounds, template, templateName, type Piece } from './garments.ts'
import { T, type GarmentType } from './types.ts'
import { FittingView } from './viewer.ts'
import { combineGlb, encodeGarments } from './glb.ts'
import { fitPatch } from './brush.ts'
import { anchorPrint, projectPrint, type PrintAnchor } from './image-placement.ts'
import { drawImage, ensureFabricUv, openImage, type LoadedImage } from './fabric-image.ts'
import { shirtCard, shirtPrintPlacement, shirtStyles, sportCard, styleMaterials, stylePrint, type ShirtStyle } from './shirt-styles.ts'
import { editSvgPattern } from './pattern.ts'
import { connectResources, storeResource } from './resources.ts'
import { bakeCloth, type ClothTarget } from './cloth-bake.ts'
import { clothColliders, ClothPreview } from './cloth-motion.ts'
import { cutPanel, drawCut } from './cut-panel.ts'
import { fashionCatalogue, fashionTemplate, type FashionId } from './fashion.ts'
import { getAlpha, offsetPiece, setAlpha, type AlphaMode } from './surface-layers.ts'
import './style.css'

const $=<E extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as E
const button=(id:string)=>$<HTMLButtonElement>(id)
const input=(id:string)=>$<HTMLInputElement>(id)
const select=(id:string)=>$<HTMLSelectElement>(id)
const number=(id:string)=>Number(input(id).value)
const make=(label:string, action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.onclick=action;return b}
const hasColor=(material:Material):material is MeshStandardMaterial|MeshBasicMaterial=>
  material instanceof MeshStandardMaterial||material instanceof MeshBasicMaterial
type Snapshot={mesh:Mesh,positions:Float32Array}
type Print={name:string,material:MeshStandardMaterial,aspect:number,padding:[number,number],size:number,angle:number,
  piece:number,anchor?:PrintAnchor,preview?:Mesh,frame?:number}
type Garment={ name:string, group:Group, mesh:Mesh[], pieces:Piece[], worn:boolean, marks:boolean, dirty:boolean, source?:RigAsset,
  bound?:Piece[], display?:Group, type?:GarmentType, pattern:boolean, fashion?:FashionId, ease:number,width:number,length:number, color:string, undo:Snapshot[][],
  mode:'soft'|'rigid'|'template', printSources?:number[], rigid:Map<number,number>, joint?:number, prints:Print[], printPreview:Group, selectedPrint?:Print, surface?:string, cloth:Set<number>, effects:ClothPreview[] }
let body:FittingBody|undefined
const items:Garment[]=[]
let current:Garment|undefined
let index=-1
let busy=false, moving=false
let tool='move'
let stroke:Snapshot[]|undefined
let previousFrame={index:-1,time:0,paused:true}
let notice:number|undefined
const viewer=new FittingView($('viewport'))
const exportService=new ExportFileSaver()

function status(text:string,error=false){
  const box=$('message');box.hidden=false;box.textContent=text;box.classList.toggle('error',error)
  window.clearTimeout(notice)
  if(!busy)notice=window.setTimeout(()=>{box.hidden=true},error?8000:4300)
}

async function task<T>(description:string, transform:()=>Promise<T>):Promise<T|undefined> {
  if(busy)return
  busy=true;renderControls();status(description)
  await new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)))
  try{return await transform()}
  catch(error){status(error instanceof ExportCancelledError?'Сохранение отменено.':(error as Error).message,true)}
  finally{busy=false;renderControls();notice=window.setTimeout(()=>{$('message').hidden=true},5500)}
}

async function bytes(file:File){
  if(file.size>MAX_GLB_BYTES)throw new Error('GLB больше 128 МБ.')
  return file.arrayBuffer()
}
function fileInput(id:string,handle:(list:File[])=>Promise<unknown>){
  const picker=input(id)
  picker.onchange=()=>{const files=[...(picker.files??[])];picker.value='';if(files.length)void handle(files)}
}
function requestFile(buttonId:string,inputId:string){button(buttonId).onclick=()=>input(inputId).click()}

function stopCloth(item:Garment){
  item.effects.splice(0).forEach(effect=>effect.dispose())
}
function detachBound(item:Garment) {
  stopCloth(item)
  item.display?.removeFromParent();item.display=undefined
  item.bound?.forEach(piece=>piece.geometry.dispose());item.bound=undefined
}
function disposeItem(item:Garment){
  detachBound(item);item.group.removeFromParent()
  item.printPreview.removeFromParent();item.prints.forEach(disposePrint)
  item.mesh.forEach(mesh=>mesh.geometry.dispose())
  if(item.source)dispose_rig_scene(item.source.scene)
  const materials=new Set(item.mesh.flatMap(mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material]))
  materials.forEach(material=>{(material as MeshStandardMaterial).map?.dispose();material.dispose()})
}
function refreshVisibility(){
  items.forEach(item=>{
    item.group.visible=!moving&&(item.worn||item===current)
    item.printPreview.visible=item.group.visible
    if(item.display)item.display.visible=moving&&item.worn&&!item.dirty
  })
}
function mark(item:Garment){ item.dirty=true; if(item.display)item.display.visible=false }

function clearPrintPreview(print:Print){
  print.preview?.removeFromParent()
  print.preview?.geometry.dispose()
  print.preview=undefined
}

function disposePrint(print:Print){
  if(print.frame!==undefined)cancelAnimationFrame(print.frame)
  clearPrintPreview(print)
  print.material.map?.dispose()
  print.material.dispose()
}

function addPrint(item:Garment, name:string, source:LoadedImage){
  const {texture,aspect,padding}=drawImage(source,true)
  const material=new MeshStandardMaterial({map:texture,roughness:.86,metalness:0,transparent:true,
    depthWrite:false,alphaTest:.02,polygonOffset:true,polygonOffsetFactor:-1})
  const print:Print={name,material,aspect,padding,size:14,angle:0,piece:-1}
  item.prints.push(print);item.selectedPrint=print
  mark(item)
  return print
}

function printGeometry(item:Garment,print:Print,skin?:BufferGeometry){
  const mesh=item.mesh[print.piece]
  if(!body||!mesh||!print.anchor)return
  mesh.updateWorldMatrix(true,false)
  return projectPrint(mesh.geometry,mesh.matrixWorld,print.anchor,{
    width:print.size*body.height/100,aspect:print.aspect,angle:print.angle,padding:print.padding,
    lift:body.height*(.00018+.00007*item.prints.indexOf(print))
  },skin)
}

function refreshPrint(item:Garment,print:Print){
  if(print.frame!==undefined)return
  print.frame=requestAnimationFrame(()=>{
    print.frame=undefined
    const geometry=printGeometry(item,print)
    clearPrintPreview(print)
    if(!geometry)return
    const mesh=new Mesh(geometry,print.material)
    mesh.name=print.name;mesh.renderOrder=10+item.prints.indexOf(print)
    print.preview=mesh;item.printPreview.add(mesh)
  })
}

function placePrint(item:Garment, hit:Intersection<Mesh>){
  const print=item.selectedPrint
  if(!hit.face||!print||busy)return
  const mesh=hit.object
  const axes=viewer.printAxes(hit.point)
  const anchor=anchorPrint(mesh.geometry,mesh.matrixWorld,[hit.face.a,hit.face.b,hit.face.c],hit.point,axes.up,axes.towards)
  if(!anchor)return
  print.anchor=anchor;print.piece=item.mesh.indexOf(mesh)
  mark(item);refreshPrint(item,print)
}

function putMeshes(item:Garment,pieces:Piece[]){
  item.mesh.forEach(mesh=>{mesh.removeFromParent();mesh.geometry.dispose()})
  item.pieces=pieces;item.mesh=pieces.map(piece=>{
    const mesh=accessoryMesh(piece)
    if(item.fashion||item.pattern){
      piece.geometry.computeBoundingBox()
      mesh.position.copy(piece.geometry.boundingBox!.getCenter(new Vector3()))
      piece.geometry.translate(-mesh.position.x,-mesh.position.y,-mesh.position.z)
    }
    return mesh
  })
  item.group.add(...item.mesh);mark(item)
  item.prints.forEach(print=>refreshPrint(item,print))
}
function defaultEase(kind?:GarmentType){return kind==='hoodie'?2.4:kind==='joggers'?1.8:1.3}
function addItem(name:string,pieces:Piece[],kind?:GarmentType,source?:RigAsset,pattern=false,fashion?:FashionId){
  const group=new Group()
  const item:Garment={name,group,mesh:[],pieces:[],worn:false,marks:false,dirty:true,type:kind,source,pattern,fashion,ease:fashion?1.1:defaultEase(kind),width:100,length:100,color:'#3d9281',undo:[],
    mode:fashion?'template':kind==='armor'?'rigid':'soft',rigid:new Map(),prints:[],printPreview:new Group(),cloth:new Set(),effects:[]}
  if(kind||pattern||fashion){
    const center=pieceBounds(pieces).getCenter(new Vector3())
    pieces.forEach(piece=>piece.geometry.translate(-center.x,-center.y,-center.z));group.position.copy(center)
  }
  putMeshes(item,pieces);items.push(item);viewer.edited.add(item.group,item.printPreview)
  choose(item)
  return item
}
function choose(item:Garment|undefined) {
  if(moving&&item&&!item.worn)fitMode()
  current=item;index=-1;tool='move';renderControls();activateTool();refreshVisibility()
}
function setUiValue(id:string,value:number){input(id).value=String(value);$<HTMLOutputElement>(id+'-value').value=value+'%'}

function imageControls(item:Garment){
  const regions=materialRegions(item)
  const pickerRegions=select('fabric-region')
  $('fabric-region-row').hidden=regions.length<2
  if(!item.surface||!regions.some(region=>region.id===item.surface))item.surface=undefined
  pickerRegions.replaceChildren(new Option(index>=0?'Вся деталь':'Вся вещь',''),
    ...regions.map(region=>new Option(region.name,region.id)))
  pickerRegions.value=item.surface??''
  pickerRegions.disabled=busy
  const colored=[...chosenMaterials(item)].filter(hasColor)
  input('color').value=colored[0]?'#'+colored[0].color.getHexString():item.color
  const alpha=getAlpha(colored[0])
  select('alpha-mode').value=alpha
  select('alpha-mode').disabled=busy||!colored.length
  $('alpha-row').hidden=alpha==='opaque'
  $('alpha-label').textContent=alpha==='cutout'?'Порог выреза':'Непрозрачность'
  setUiValue('alpha',Math.round(100*(alpha==='cutout'?colored[0].alphaTest:colored[0]?.opacity??1)))
  input('alpha').disabled=busy
  const standard=colored.find(material=>material instanceof MeshStandardMaterial)
  $('roughness-row').hidden=!standard
  if(standard)setUiValue('roughness',Math.round(standard.roughness*100))
  input('roughness').disabled=busy
  const fabric=colored.find(material=>material.map)
  $('fabric-settings').hidden=!fabric
  if(fabric?.map){
    input('fabric-repeat').value=String(fabric.map.repeat.x)
    $<HTMLOutputElement>('fabric-repeat-value').value=input('fabric-repeat').value+'×'
  }
  input('fabric-repeat').disabled=busy
  const print=item.selectedPrint
  $('print-settings').hidden=!print
  $('print-instruction').hidden=tool!=='print'
  button('print-place').setAttribute('aria-pressed',String(tool==='print'))
  if(!print)return
  const picker=select('prints')
  picker.replaceChildren(...item.prints.map((value,i)=>new Option(value.name,String(i))))
  picker.value=String(item.prints.indexOf(print))
  for(const [id,value,unit] of [['print-width',print.size,'%'],['print-angle',print.angle,'°'],['print-opacity',Math.round(print.material.opacity*100),'%']] as const){
    input(id).value=String(value);input(id).disabled=busy
    $<HTMLOutputElement>(id+'-value').value=value+unit
  }
  for(const id of ['prints','print-place','print-delete','print-replace'])$<HTMLButtonElement|HTMLSelectElement>(id).disabled=busy
}

function renderControls(){
  for(const id of ['load-model','demo','resources-open'])button(id).disabled=busy
  for(const id of ['add-glb','add-pattern','add-template','catalogue-open','cut-open'])button(id).disabled=busy||!body||moving
  select('template').disabled=busy||!body||moving
  button('motion').disabled=busy||!body?.asset.clips.length||!items.some(item=>item.worn)
  button('motion').setAttribute('aria-pressed',String(moving))
  button('fitting').disabled=busy||!body
  button('fitting').setAttribute('aria-pressed',String(!moving))
  button('export').disabled=busy||!body||!items.length
  const entries=items.map(item=>{
    const row=document.createElement('div');row.className='outfit'
    const pick=make(item.name,()=>choose(item));pick.setAttribute('aria-pressed',String(item===current));pick.disabled=busy
    const state=make(item.worn?'Снять':'Надеть',()=>{
      if(busy)return
      item.worn=!item.worn
      if(moving&&item.worn&&item.dirty)fitMode()
      renderControls()
    })
    state.disabled=busy
    row.append(pick,state);return row
  })
  $('outfits').replaceChildren(...entries)
  $('details').hidden=!current
  if(!current)return
  const item=current
  $('item-name').textContent=item.name
  $('fit-tools').hidden=moving
  $('piece-row').hidden=item.mesh.length<2
  const pieces=[new Option('Вся вещь','-1'),...item.pieces.map((piece,i)=>new Option(piece.name,String(i)))]
  select('piece').replaceChildren(...pieces);select('piece').value=String(index);select('piece').disabled=busy||moving
  button('delete').disabled=busy;button('wear').disabled=busy;button('wear').textContent=moving
    ? item.worn?'Снять для правки':'Вернуться к подгонке'
    : item.worn?'Снять':'Надеть'
  button('bind').disabled=busy
  button('bind').textContent=item.dirty?'Рассчитать веса и примерить':'Одежда привязана · надеть'
  button('undo').disabled=busy||!item.undo.length
  const simulation=clothParts(item)
  const enabled=simulation.length>0&&simulation.every(i=>item.cloth.has(i))
  const clothButton=button('cloth-toggle')
  clothButton.disabled=busy||!simulation.length
  clothButton.setAttribute('aria-pressed',String(enabled))
  clothButton.textContent=enabled?'Ткань в движении ✓':'Ткань в движении'
  const resizable=!!(item.type||item.fashion)
  $('alignment').hidden=resizable||item.pattern
  $('reshape').hidden=!resizable
  for(const id of ['ease','width','length']){
    const v=id==='ease'?item.ease:id==='width'?item.width:item.length
    input(id).disabled=busy||!resizable
    setUiValue(id,v)
    input(id).closest('label')!.hidden=!resizable
  }
  imageControls(item)
  select('binding').options[0].hidden=!item.fashion&&item.mode!=='template'
  select('binding').options[0].disabled=!item.fashion&&item.mode!=='template'
  select('binding').value=item.mode
  const piece=index>=0?item.pieces[index]:undefined
  const rigid=index>=0?item.rigid.get(index)??piece?.joint:item.joint
  select('bone').value=rigid===undefined?'auto':String(rigid)
  $('bone-row').hidden=item.mode==='soft'||(item.mode==='template'&&index<0)
  for(const id of ['move','rotate','scale','orbit','tighten','loosen','raise','recess'])button(id).setAttribute('aria-pressed',String(tool===id))
  for(const id of ['color','texture','print-add','binding','bone','center','reshape','tighten','loosen','raise','recess','layer-open','texture-saved','decal-saved','move','rotate','scale','orbit','radius','strength'])
    $<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>(id).disabled=busy
  refreshVisibility()
}

async function openCharacter(data:ArrayBuffer,name:string){
  const next=await load_rig_asset(data,name)
  let layout:FittingBody
  try{layout=new FittingBody(next)}catch(error){dispose_rig_scene(next.scene);throw error}
  const prev=body
  for(const item of items)disposeItem(item)
  items.length=0;current=undefined;moving=false
  body=layout;viewer.setAsset(next,layout.bounds);viewer.paint();viewer.move()
  if(prev)dispose_rig_scene(prev.asset.scene)
  previousFrame={index:next.clips.findIndex(clip=>/^walk$/i.test(clip.name)),time:0,paused:false}
  if(previousFrame.index<0&&next.clips.length)previousFrame.index=0
  select('bone').replaceChildren(new Option('Подобрать ближайшую','auto'),...layout.bones.map((bone,i)=>new Option(bone.name,String(i))))
  select('clips').replaceChildren(...next.clips.map((clip,i)=>new Option(clip.name||'Движение '+(i+1),String(i))))
  $('character-state').textContent=next.name+' · '+layout.bones.length+' костей · '+next.clips.length+' движений'
  $('empty').hidden=true;document.querySelector<HTMLElement>('.stage-tools')!.hidden=false;$('playback').hidden=true
  status('Персонаж открыт. Добавьте GLB одежды или выберите шаблон.')
}
async function importGarments(files:File[]){
  for(const file of files){
    const source=await load_rig_asset(await bytes(file),file.name)
    source.scene.updateMatrixWorld(true)
    const pieces:Piece[]=[]
    const meshes=[...source.nodes.values()].filter(n=>n.is_mesh)
    if(!meshes.length){dispose_rig_scene(source.scene);throw new Error('В GLB нет сетки одежды.')}
    for(const [i,node] of meshes.entries()){
      const mesh=node.object as Mesh
      pieces.push({name:mesh.name||'Часть '+(i+1),geometry:bakedGeometry(mesh,new Matrix4()),
        material:Array.isArray(mesh.material)?mesh.material.map(material=>material.clone()):mesh.material.clone()})
    }
    const added=addItem(source.name,pieces,undefined,source)
    const bounds=pieceBounds(added.pieces)
    const extent=bounds.getSize(new Vector3()).length(), at=bounds.getCenter(new Vector3())
    if(extent>body!.height*2.4||extent<body!.height*.075){
      const ratio=body!.height*.49/extent
      if(Number.isFinite(ratio)){
        added.pieces.forEach(piece=>piece.geometry.translate(-at.x,-at.y,-at.z))
        added.group.scale.setScalar(ratio)
        added.group.position.copy(body!.joint(BoneSlot.Spine)??body!.center)
      }
    }
    added.group.updateMatrixWorld(true)
    if(!body!.bounds.clone().expandByScalar(body!.height*.18).containsPoint(new Box3().setFromObject(added.group).getCenter(new Vector3())))alignItem(added,'torso')
  }
  status('Деталь открыта. Подгоните форму и рассчитайте веса.')
}
function alignItem(item:Garment,target:string){
  if(!body)return
  const side=target==='left'?BoneSide.Left:BoneSide.Right
  const destination=target==='hips'?body.joint(BoneSlot.Pelvis):
    target==='feet'?body.joint(BoneSlot.Foot,BoneSide.Left)?.lerp(body.joint(BoneSlot.Foot,BoneSide.Right)??body.center,.5):
      target==='left'||target==='right'?body.joint(BoneSlot.Hand,side):body.joint(BoneSlot.Spine)
  item.group.position.add((destination??body.center).clone().sub(new Box3().setFromObject(item.group).getCenter(new Vector3())))
  item.prints.forEach(print=>refreshPrint(item,print))
  mark(item);activateTool();renderControls()
}

function strokeAt(hit:Intersection<Mesh>){
  if(busy||!body||!current||!stroke||!hit.face)return
  const mesh=hit.object,p=mesh.geometry.attributes.position
  const radius=body.height*number('radius')/100, strength=number('strength')/100
  const before=stroke.some(item=>item.mesh===mesh)?undefined:Float32Array.from({length:p.count*3},(_,i)=>p.getComponent(Math.floor(i/3),i%3))
  const mode=tool==='raise'||tool==='recess'||tool==='loosen'?tool:'tighten'
  if(!fitPatch(body,mesh,hit.point,hit.face.normal,radius,strength,mode,current.mode==='soft'))return
  if(before)stroke.push({mesh,positions:before})
  mark(current);current.marks=true
}
function endStroke(){
  if(!stroke?.length||!current){stroke=undefined;return}
  stroke.forEach(({mesh})=>mesh.geometry.computeVertexNormals())
  current.undo.push(stroke);if(current.undo.length>8)current.undo.shift()
  current.prints.forEach(print=>refreshPrint(current!,print))
  stroke=undefined;renderControls()
}
function activateTool(){
  viewer.move();viewer.paint()
  if(!current||moving)return
  const item=current
  if(tool==='tighten'||tool==='loosen'||tool==='raise'||tool==='recess')viewer.paint({
    meshes:()=>index>=0?[item.mesh[index]]:item.mesh,
    begin:()=>{stroke=[]},stroke:strokeAt,end:endStroke
  })
  else if(tool==='print')viewer.paint({
    meshes:()=>index>=0?[item.mesh[index]]:item.mesh,
    begin:()=>{},stroke:hit=>placePrint(item,hit),
    end:()=>{
      if(item.selectedPrint?.anchor)button('bind').textContent='Рассчитать веса и примерить'
    }
  })
  else if(tool!=='orbit'){
    const target=index>=0?item.mesh[index]:item.group
    const previousScale=target.scale.clone()
    viewer.move(target,tool==='move'?'translate':tool==='rotate'?'rotate':'scale',()=>{
      if(tool==='scale'){
        for(let axis=0;axis<3;axis++){
          const initial=previousScale.getComponent(axis),sign=Math.sign(initial)||1
          const value=target.scale.getComponent(axis)*sign
          if(!Number.isFinite(value)||value<Math.abs(initial)*.01)target.scale.setComponent(axis,sign*Math.abs(initial)*.01)
        }
      }
      item.prints.forEach(print=>refreshPrint(item,print))
      mark(item);button('bind').textContent='Рассчитать веса и примерить'
    })
  }
}

async function bind(item:Garment){
  if(!body || (!item.dirty && item.bound))return
  item.group.updateWorldMatrix(true,true)
  const result:Piece[]=[]
  const printSources:number[]=[]
  try {
    for(const [i,mesh] of item.mesh.entries()){
      const geometry=bakedGeometry(mesh,new Matrix4())
      if(!geometry.attributes.normal)geometry.computeVertexNormals()
      const piece=item.pieces[i]
      const fallback=()=>body!.nearestJoint(new Box3().setFromObject(mesh).getCenter(new Vector3()))
      const joint=item.mode==='rigid'?item.rigid.get(i)??item.joint??piece.joint??fallback():item.mode==='template'?item.rigid.get(i)??piece.joint:undefined
      result.push({name:item.name+' · '+piece.name,geometry,material:mesh.material,joint})
      body.weights(geometry,joint)
      await new Promise<void>(resolve=>setTimeout(resolve,0))
    }
    for(const print of item.prints){
      const skin=result[print.piece]?.geometry
      if(!skin)continue
      const geometry=printGeometry(item,print,skin)
      if(geometry){
        result.push({name:item.name+' · рисунок · '+print.name,geometry,material:print.material})
        printSources.push(print.piece)
      }
    }
  }catch(error){result.forEach(piece=>piece.geometry.dispose());throw error}
  detachBound(item);item.bound=result;item.dirty=false
  const group=new Group(), skin=body.canonicalSkin()
  for(const [i,piece] of result.entries()){
    const mesh=new SkinnedMesh(piece.geometry,piece.material)
    mesh.frustumCulled=false;mesh.bind(skin,new Matrix4());group.add(mesh)
    if(i>=item.mesh.length){
      mesh.renderOrder=10+i-item.mesh.length
      mesh.userData.wardrobePrintPiece=printSources[i-item.mesh.length]
    }
  }
  item.display=group;item.printSources=printSources;viewer.dressed.add(group)
}
function fitMode(){
  for(const item of items)stopCloth(item)
  if(moving){previousFrame=viewer.current();viewer.rest()}
  moving=false;$('playback').hidden=true
  if(current)tool='move'
  refreshVisibility();renderControls();activateTool()
}
async function motionMode(){
  if(!body?.asset.clips.length||busy)return
  await task('Проверяю привязку надетых вещей…',async()=>{
    for(const item of items.filter(item=>item.worn))await bind(item)
    viewer.paint();viewer.move();moving=true
    $('playback').hidden=false
    select('clips').value=String(previousFrame.index)
    viewer.play(previousFrame.index,previousFrame.time,previousFrame.paused)
    button('toggle-play').textContent=previousFrame.paused?'▶':'Ⅱ'
    refreshVisibility()
    const problems=items.filter(item=>item.worn).flatMap(startCloth)
    if(problems.length)status(problems[0],true)
    else status('Остановите анимацию на нужном кадре, чтобы проверить сгибы.')
  })
}

function clothParts(item:Garment):number[]{
  if(item.mode==='rigid')return []
  const flexible=(i:number)=>item.mode==='soft'||(item.rigid.get(i)??item.pieces[i].joint)===undefined
  if(index>=0)return flexible(index)?[index]:[]
  return item.pieces.flatMap((part,i)=>flexible(i)&&(item.pattern||/юбк|подол|полы плаща|полотно/i.test(part.name)||item.pieces.length===1)?[i]:[])
}
function clothBone(body:FittingBody,name:string,geometry:BufferGeometry){
  const slot=/подол|юбк/i.test(name)?BoneSlot.Pelvis:BoneSlot.Spine
  geometry.computeBoundingBox()
  const top=geometry.boundingBox!.getCenter(new Vector3())
  top.y=geometry.boundingBox!.max.y
  const pivot=/плащ/i.test(name)?body.nearestJoint(top):body.slots.findIndex(role=>role?.slot===slot)
  return pivot<0?body.nearestJoint(top):pivot
}
function startCloth(item:Garment):string[]{
  if(!body||!item.display||!item.bound||item.mode==='rigid')return []
  const problems:string[]=[]
  const nodes=[...item.display.children] as SkinnedMesh[]
  for(const i of item.cloth){
    const source=nodes[i]
    if(!source||item.bound[i].joint!==undefined)continue
    const j=clothBone(body,item.pieces[i].name,source.geometry)
    const decals=nodes.filter(node=>node.userData.wardrobePrintPiece===i&&node.geometry.userData.wardrobePrintVertices)
    try{item.effects.push(new ClothPreview(source,decals,body.bones[j],body.rest[j],body.height))}
    catch(error){problems.push((error as Error).message)}
  }
  return problems
}
button('cloth-toggle').onclick=()=>{
  if(!current)return
  const candidates=clothParts(current)
  const enabled=candidates.every(i=>current!.cloth.has(i))
  for(const i of candidates){
    if(enabled)current.cloth.delete(i)
    else current.cloth.add(i)
  }
  if(!enabled)status('Примерьте вещь и откройте «В движении». Верх полотна закреплён, низ свободен.')
  renderControls()
}
viewer.onPoseReset=()=>items.forEach(item=>item.effects.forEach(effect=>effect.reset()))
viewer.onMotionFrame=(delta,time,paused)=>{
  if(!body||!moving)return
  const active=items.filter(item=>item.worn&&item.effects.length)
  if(!active.length)return
  body.asset.scene.updateMatrixWorld(true)
  const colliders=clothColliders(body)
  for(const item of active)for(const effect of item.effects)effect.step(paused?0:delta,time,colliders)
}

for(const [key,name] of Object.entries(T))select('template').add(new Option(name,key))
$('export').onclick=()=>{
  const clips=select('bake-clip'), canBake=!!body?.asset.clips.length&&items.some(item=>item.worn&&item.cloth.size&&item.mode!=='rigid')
  $('bake-options').hidden=!canBake
  input('bake-cloth').checked=false;input('bake-cloth').disabled=!canBake
  clips.replaceChildren(...(body?.asset.clips??[]).map((clip,i)=>new Option(clip.name||'Движение '+(i+1),String(i))))
  clips.value=String(moving?viewer.current().index:previousFrame.index)
  if(clips.selectedIndex<0&&canBake)clips.selectedIndex=0
  clips.disabled=true
  const dialog=$<HTMLDialogElement>('save-dialog')
  dialog.returnValue='';dialog.showModal()
}
input('bake-cloth').onchange=()=>{select('bake-clip').disabled=!input('bake-cloth').checked}
requestFile('load-model','body-file')
requestFile('add-glb','garment-file')
requestFile('add-pattern','pattern-file')
requestFile('texture','texture-file')
requestFile('print-add','print-file')
requestFile('print-replace','print-replacement-file')
fileInput('body-file',([file])=>task('Открываю персонажа…',async()=>openCharacter(await bytes(file),file.name)))
fileInput('garment-file',files=>task('Открываю GLB одежды…',()=>importGarments(files)))
async function usePattern(file:File){
  if(!body||busy||moving)return
  try {
    if(file.size>1024*1024)throw new Error('Файл выкройки SVG больше 1 МБ.')
    const pieces=await editSvgPattern(await file.text(),body,$<HTMLDialogElement>('pattern-dialog'))
    if(pieces)addItem(file.name.replace(/\.svg$/i,''),pieces,undefined,undefined,true)
  }catch(error){status((error as Error).message,true)}
}
async function useFabric(file:File){
  if(!current||busy||moving)return
  const item=current
  await task('Открываю текстуру…',async()=>{
    const materials=[...chosenMaterials(item)].filter(hasColor)
    if(!materials.length)throw new Error('У детали нет материала для текстуры ткани.')
    const {texture}=drawImage(await openImage(file),false)
    const meshes=index>=0?[item.mesh[index]]:item.mesh
    for(const mesh of meshes)ensureFabricUv(mesh.geometry)
    texture.flipY=!item.source
    texture.userData.wardrobeFabric=true
    for(const material of materials){
      if(material.map?.userData.wardrobeFabric)material.map.dispose()
      material.map=texture.clone();material.color.set(0xffffff);material.needsUpdate=true
    }
    texture.dispose()
    item.color='#ffffff'
    mark(item);status('Текстура нанесена. Настройте частоту повторения ткани.')
  })
}
async function useDecal(file:File){
  if(!current||busy||moving)return
  const item=current
  await task('Открываю рисунок…',async()=>{
    addPrint(item,file.name.replace(/\.[^.]+$/,''),await openImage(file))
    tool='print';activateTool()
    status('Коснитесь одежды, чтобы разместить рисунок.')
  })
}
fileInput('pattern-file',([file])=>usePattern(file))
fileInput('texture-file',([file])=>useFabric(file))
fileInput('print-file',([file])=>useDecal(file))
fileInput('print-replacement-file',async([file])=>{
  const item=current,print=item?.selectedPrint
  if(!item||!print||busy)return
  await task('Заменяю рисунок…',async()=>{
    const {texture,aspect,padding}=drawImage(await openImage(file),true)
    detachBound(item)
    print.material.map?.dispose()
    print.material.map=texture;print.material.needsUpdate=true
    print.name=file.name.replace(/\.[^.]+$/,'')
    print.aspect=aspect;print.padding=padding
    mark(item);refreshPrint(item,print)
    status('Рисунок заменён.')
  })
})
function materialRegions(item:Garment){
  return item.pieces.flatMap((piece,i)=>{
    if(index>=0&&index!==i)return []
    const materials=Array.isArray(piece.material)?piece.material:[piece.material]
    return materials.map((material,j)=>({id:i+':'+j,name:piece.regions?.[j]??piece.name,material}))
  })
}
function chosenMaterials(item:Garment):Set<Material>{
  const targets=materialRegions(item)
  const region=targets.find(target=>target.id===item.surface)
  return new Set(region?[region.material]:targets.map(target=>target.material))
}
select('fabric-region').onchange=()=>{
  if(!current)return
  current.surface=select('fabric-region').value||undefined
  imageControls(current)
}
input('fabric-repeat').oninput=()=>{
  if(!current)return
  const value=number('fabric-repeat')
  $<HTMLOutputElement>('fabric-repeat-value').value=value+'×'
  for(const material of chosenMaterials(current)){
    if(!hasColor(material)||!material.map)continue
    if(!material.map.userData.wardrobeFabric){
      material.map=material.map.clone()
      material.map.userData.wardrobeFabric=true
    }
    material.map.wrapS=material.map.wrapT=RepeatWrapping
    material.map.repeat.setScalar(value);material.map.needsUpdate=true
  }
  mark(current)
}
const showResources=connectResources($<HTMLDialogElement>('resource-dialog'),()=>{
  if(busy||moving||!body)return {}
  return {pattern:file=>void usePattern(file),decor:file=>void task('Открываю 3D-декор…',()=>importGarments([file])),
    ...(current?{fabric:(file:File)=>void useFabric(file),decal:(file:File)=>void useDecal(file)}:{})}
},file=>void startCut(file))
button('resources-open').onclick=()=>showResources()
button('texture-saved').onclick=()=>showResources('fabric')
button('decal-saved').onclick=()=>showResources('decal')
button('cut-open').onclick=()=>void startCut()
async function startCut(file?:File){
  if(!body||busy||moving)return
  const target=body
  try{
    const image=file?await openImage(file):undefined
    if(body!==target||busy||moving)return
    const shape=await drawCut($<HTMLDialogElement>('cut-dialog'),file&&image?{file,image}:undefined,accept=>showResources('pattern',accept))
    if(!shape||body!==target||moving)return
    await task('Собираю выкроенное полотно…',async()=>{
      const piece=cutPanel(target,shape,image)
      addItem(shape.name,[piece],undefined,undefined,true)
      if(shape.save){
        const width=1000*shape.aspect
        const points=shape.points.map(p=>(p.x*width).toFixed(4)+','+(p.y*1000).toFixed(4)).join(' ')
        const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' 1000"><polygon points="'+points+'"/></svg>'
        const filename=shape.name.replace(/[\/?\\:<>*|]/g,'_')+'.svg'
        try{await storeResource(new File([svg],filename,{type:'image/svg+xml'}),'pattern')}
        catch{status('Полотно создано. Копию контура сохранить не удалось.',true);return}
      }
      status('Полотно готово. Подгоните его и примерьте в движении.')
    })
  }catch(error){status((error as Error).message,true)}
}

function changeAlpha(mode:AlphaMode,amount:number){
  if(!current)return
  for(const material of chosenMaterials(current))if(hasColor(material))setAlpha(material,mode,amount)
  mark(current);button('bind').textContent='Рассчитать веса и примерить'
}
select('alpha-mode').onchange=()=>{
  const mode=select('alpha-mode').value as AlphaMode
  changeAlpha(mode,mode==='cutout'?.5:.68)
  if(current)imageControls(current)
}
input('alpha').oninput=()=>{
  const amount=number('alpha')
  setUiValue('alpha',amount);changeAlpha(select('alpha-mode').value as AlphaMode,amount/100)
}
input('roughness').oninput=()=>{
  if(!current)return
  const value=number('roughness')
  setUiValue('roughness',value)
  for(const material of chosenMaterials(current))if(material instanceof MeshStandardMaterial)material.roughness=value/100
  mark(current);button('bind').textContent='Рассчитать веса и примерить'
}
const layerDialog=$<HTMLDialogElement>('layer-dialog')
button('layer-open').onclick=()=>{
  layerDialog.returnValue='';input('layer-offset').value='.65';layerDialog.showModal()
}
layerDialog.onclose=()=>{
  const base=current,target=body
  if(layerDialog.returnValue!=='apply'||!base||!target)return
  const distance=number('layer-offset')*target.height/100
  if(Math.abs(distance)<target.height*.0003){status('Укажите смещение слоя от 0,05%.',true);return}
  const selection=base.surface?.split(':').map(Number)
  const selected=selection?.length===2?[selection[0]]:index>=0?[index]:base.mesh.map((_,i)=>i)
  void task('Создаю отдельный слой…',async()=>{
    const pieces=selected.map(i=>{
      const piece=offsetPiece(base.mesh[i],base.pieces[i].name,distance,selection?.[1])
      if(base.mode==='rigid')piece.joint=base.rigid.get(i)??base.joint??base.pieces[i].joint
      else if(base.mode==='template')piece.joint=base.rigid.get(i)??base.pieces[i].joint
      if(selection===undefined)piece.regions=base.pieces[i].regions
      return piece
    })
    const layer=addItem(base.name+' · слой',pieces,undefined,undefined,true)
    layer.mode=base.mode
    layer.worn=true;base.worn=true
    tool='orbit';activateTool()
    status('Слой создан. Его цвет, прозрачность и положение настраиваются отдельно.')
  })
}
select('prints').onchange=()=>{
  if(!current)return
  current.selectedPrint=current.prints[Number(select('prints').value)]
  renderControls()
}
button('print-place').onclick=()=>{
  tool=tool==='print'?'orbit':'print'
  activateTool();renderControls()
}
button('print-delete').onclick=()=>{
  const item=current,print=item?.selectedPrint
  if(!item||!print)return
  detachBound(item)
  disposePrint(print)
  item.prints.splice(item.prints.indexOf(print),1)
  item.selectedPrint=item.prints.at(-1)
  tool='orbit';mark(item);activateTool();renderControls()
}
for(const [id,unit] of [['print-width','%'],['print-angle','°'],['print-opacity','%']] as const)
  input(id).oninput=()=>{
    const item=current,print=item?.selectedPrint
    if(!item||!print)return
    const value=number(id)
    $<HTMLOutputElement>(id+'-value').value=value+unit
    if(id==='print-opacity')print.material.opacity=value/100
    else{
      if(id==='print-width')print.size=value
      else print.angle=value
      refreshPrint(item,print)
    }
    mark(item)
  }
button('demo').onclick=()=>void task('Открываю учебного персонажа…',async()=>{
  const response=await fetch(new URL(/* @vite-ignore */ '../demo.glb',import.meta.url))
  if(!response.ok)throw new Error('Учебная модель не открылась.')
  await openCharacter(await response.arrayBuffer(),'Учебный персонаж')
})
button('add-template').onclick=()=>void task('Строю сетку одежды…',async()=>{
  const type=select('template').value as GarmentType
  if(type==='armor'||type==='boots'){
    addFashion(type==='armor'?'knight':'rider',templateName(type))
    return
  }
  addItem(templateName(type),template(body!,type,defaultEase(type)/100,1,1,'#3d9281'),type)
  status('Вещь создана. Настройте посадку или выделите участок кистью.')
})
function addCatalogueItem(type:'shirt'|'hoodie'|'joggers', name:string,color:string,style?:ShirtStyle){
  if(!body||busy||moving)return
  $<HTMLDialogElement>('catalogue').close()
  void task('Подгоняю шаблон…',async()=>{
    const pieces=template(body!,type,defaultEase(type)/100,1,1,color)
    if(style)styleMaterials(pieces,style)
    const item=addItem(name,pieces,type)
    let placed=true
    const image=style&&stylePrint(style)
    if(image){
      const print=addPrint(item,style.motif==='bear'?'Мишка':style.name,image)
      const placement=shirtPrintPlacement(body!,item.mesh[0],style.large)
      placed=!!placement
      if(placement){
        print.piece=0;print.anchor=placement.anchor;print.size=placement.size
        refreshPrint(item,print)
      }
    }
    tool=placed?'orbit':'print'
    activateTool()
    status(placed?'Шаблон создан. Можно менять цвет участков и примерять.':'Шаблон создан. Коснитесь футболки, чтобы поставить рисунок.')
  })
}
function addFashion(id:FashionId,name:string){
  addItem(name,fashionTemplate(body!,id),undefined,undefined,false,id)
  tool='orbit';activateTool()
  status('Шаблон готов. Выберите деталь для подгонки.')
}
const thumbnails=import.meta.glob('./thumbnails/*.webp',{eager:true,query:'?url',import:'default'}) as Record<string,string>
button('catalogue-open').onclick=()=>{
  const dialog=$<HTMLDialogElement>('catalogue'), shirts=$('catalogue-shirts'), sport=$('catalogue-sport')
  const card=(image:HTMLCanvasElement|HTMLImageElement,label:string,apply:()=>void)=>{
    const tile=make('',apply), caption=document.createElement('span')
    caption.textContent=label;tile.append(image,caption);return tile
  }
  if(!shirts.children.length){
    shirts.append(...shirtStyles.map(style=>card(shirtCard(style),style.name,()=>addCatalogueItem('shirt',style.name,style.panel,style))))
    for(const [category,entries] of Object.entries(fashionCatalogue)){
      for(const [id,name] of entries){
        const img=new Image(192,192);img.alt='';img.loading='lazy';img.src=thumbnails['./thumbnails/'+id+'.webp']
        $('catalogue-'+category).append(card(img,name,()=>{
          if(!body||busy||moving)return
          dialog.close()
          void task('Подгоняю шаблон…',async()=>addFashion(id,name))
        }))
      }
    }
    for(const [type,color] of [['hoodie','#557ba1'],['joggers','#59674b']] as const){
      const name=templateName(type)
      sport.append(card(sportCard(type,color),name,()=>addCatalogueItem(type,name,color)))
    }
  }
  dialog.showModal()
}
button('catalogue-close').onclick=()=>$<HTMLDialogElement>('catalogue').close()
button('center').onclick=()=>{if(current)alignItem(current,select('anchor').value)}
button('delete').onclick=()=>{
  if(!current||busy)return
  const index=items.indexOf(current);disposeItem(current);items.splice(index,1);choose(items[index]??items[index-1])
}
button('wear').onclick=()=>{
  if(!current||busy)return
  if(moving){current.worn=false;fitMode()}
  else{current.worn=!current.worn;renderControls()}
}
button('bind').onclick=()=>{
  if(!current)return
  const item=current
  void task('Рассчитываю веса одежды…',async()=>{await bind(item);item.worn=true;status('Одежда надета. Перейдите в «В движении».')})
}
button('fitting').onclick=fitMode
button('motion').onclick=()=>void motionMode()
button('front').onclick=()=>{if(body)viewer.frame(body.bounds)}
button('side').onclick=()=>{if(body)viewer.frame(body.bounds,true)}
button('toggle-play').onclick=()=>{button('toggle-play').textContent=viewer.pause()?'▶':'Ⅱ'}
select('clips').onchange=()=>{viewer.play(Number(select('clips').value));button('toggle-play').textContent='Ⅱ'}
input('timeline').oninput=()=>viewer.seek(number('timeline'))
viewer.onTime=(time,length)=>{input('timeline').max=String(length);input('timeline').value=String(time);$('time').textContent=time.toFixed(2)+' с'}
select('piece').onchange=()=>{index=Number(select('piece').value);activateTool();renderControls()}
for(const id of ['move','rotate','scale','orbit','tighten','loosen','raise','recess'])button(id).onclick=()=>{tool=id;activateTool();renderControls()}
for(const id of ['ease','width','length','radius','strength']){
  setUiValue(id,number(id))
  input(id).oninput=()=>{
    const value=number(id);$<HTMLOutputElement>(id+'-value').value=value+'%'
    if(current&&(id==='ease'||id==='width'||id==='length'))current[id]=value
  }
}
button('reshape').onclick=()=>{
  const item=current
  if(!item||!body||!(item.type||item.fashion)||item.marks&&!confirm('Новая форма заменит мазки кисти. Продолжить?'))return
  void task('Обновляю форму шаблона…',async()=>{
    const fit=[item.ease/100,item.width/100,item.length/100] as const
    const next=item.fashion?fashionTemplate(body!,item.fashion,...fit):template(body!,item.type!,...fit,item.color)
    const center=pieceBounds(next).getCenter(new Vector3())
    next.forEach(piece=>piece.geometry.translate(-center.x,-center.y,-center.z))
    const old=item.pieces.map(piece=>piece.material)
    next.forEach((piece,i)=>{
      if(!old[i])return
      for(const material of Array.isArray(piece.material)?piece.material:[piece.material])material.dispose()
      piece.material=old[i]
    })
    putMeshes(item,next);item.undo=[];item.marks=false;index=-1;activateTool()
    status('Форма обновлена.')
  })
}
button('undo').onclick=()=>{
  if(!current)return
  const previous=current.undo.pop()
  if(!previous)return
  for(const {mesh,positions} of previous){
    const p=mesh.geometry.attributes.position as BufferAttribute
    for(let i=0;i<p.count;i++)p.setXYZ(i,positions[i*3],positions[i*3+1],positions[i*3+2])
    p.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();mesh.geometry.computeBoundingBox()
  }
  current.prints.forEach(print=>refreshPrint(current!,print))
  mark(current);renderControls()
}
input('color').oninput=()=>{
  if(!current)return
  current.color=input('color').value
  for(const material of chosenMaterials(current))if(hasColor(material))material.color.copy(new Color(current.color))
  mark(current)
}
select('binding').onchange=()=>{if(current){current.mode=select('binding').value as Garment['mode'];mark(current);renderControls()}}
select('bone').onchange=()=>{
  if(!current)return
  const selected=select('bone').value
  if(index>=0){
    if(selected==='auto')current.rigid.delete(index)
    else current.rigid.set(index,Number(selected))
  }else current.joint=selected==='auto'?undefined:Number(selected)
  mark(current);renderControls()
}
$<HTMLDialogElement>('save-dialog').onclose=event=>{
  const name=(event.currentTarget as HTMLDialogElement).returnValue
  if((name!=='item'&&name!=='all')||!body)return
  const selected=name==='item'?(current?[current]:[]):items.filter(item=>item.worn)
  if(!selected.length){status('Выберите вещь или наденьте одежду для общего экспорта.',true);return}
  const bake=name==='all'&&!input('bake-cloth').disabled&&input('bake-cloth').checked
  const clip=bake?Number(select('bake-clip').value):undefined
  if(bake&&moving)fitMode()
  void task(bake?'Запекаю ткань в выбранный клип…':'Собираю GLB…',async()=>{
    for(const item of selected)await bind(item)
    const pieces=selected.flatMap(item=>item.bound!)
    const targets:ClothTarget[]=[]
    if(clip!==undefined){
      let offset=0
      for(const item of selected){
        for(const piece of item.cloth){
          const bound=item.bound?.[piece]
          if(!bound||bound.joint!==undefined)continue
          const bone=clothBone(body!,item.pieces[piece].name,bound.geometry)
          const decals=(item.printSources??[]).flatMap((parent,i)=>parent===piece?[offset+item.mesh.length+i]:[])
          targets.push({piece:offset+piece,bone,decals})
        }
        offset+=item.bound!.length
      }
    }
    const baked=clip===undefined?undefined:await bakeCloth(body!,pieces,targets,clip)
    const dressed=await encodeGarments(body!,pieces,baked)
    const result=name==='all'?combineGlb(body!.asset.source_bytes,dressed,clip):dressed
    const title=name==='all'?body!.asset.name+' · в одежде':selected[0].name
    await exportService.save(new Blob([result],{type:'model/gltf-binary'}),title.replace(/[/?\\:<>*|]/g,'_')+'.glb')
    status('GLB сохранён.')
  })
}
renderControls()
