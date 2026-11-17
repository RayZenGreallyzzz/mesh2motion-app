import { Box3, Color, Group, Matrix4, Mesh, MeshStandardMaterial, SRGBColorSpace, SkinnedMesh, TextureLoader, Vector3,
  type BufferAttribute, type Intersection, type Material } from 'three'
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
import { editSvgPattern } from './pattern.ts'
import './style.css'

const $=<E extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as E
const button=(id:string)=>$<HTMLButtonElement>(id)
const input=(id:string)=>$<HTMLInputElement>(id)
const select=(id:string)=>$<HTMLSelectElement>(id)
const number=(id:string)=>Number(input(id).value)
const make=(label:string, action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.onclick=action;return b}
type Snapshot={mesh:Mesh,positions:Float32Array}
type Garment={ name:string, group:Group, mesh:Mesh[], pieces:Piece[], worn:boolean, marks:boolean, dirty:boolean, source?:RigAsset,
  bound?:Piece[], display?:Group, type?:GarmentType, pattern:boolean, ease:number,width:number,length:number, color:string, undo:Snapshot[][],
  mode:'soft'|'rigid', rigid:Map<number,number>, joint?:number }
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

function detachBound(item:Garment) {
  item.display?.removeFromParent();item.display=undefined
  item.bound?.forEach(piece=>piece.geometry.dispose());item.bound=undefined
}
function disposeItem(item:Garment){
  detachBound(item);item.group.removeFromParent()
  item.mesh.forEach(mesh=>mesh.geometry.dispose())
  if(item.source)dispose_rig_scene(item.source.scene)
  const materials=new Set(item.mesh.flatMap(mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material]))
  materials.forEach(material=>{(material as MeshStandardMaterial).map?.dispose();material.dispose()})
}
function refreshVisibility(){
  items.forEach(item=>{
    item.group.visible=!moving&&(item.worn||item===current)
    if(item.display)item.display.visible=moving&&item.worn&&!item.dirty
  })
}
function mark(item:Garment){ item.dirty=true; if(item.display)item.display.visible=false }

function putMeshes(item:Garment,pieces:Piece[]){
  item.mesh.forEach(mesh=>{mesh.removeFromParent();mesh.geometry.dispose()})
  item.pieces=pieces;item.mesh=pieces.map(accessoryMesh)
  item.group.add(...item.mesh);mark(item)
}
function addItem(name:string,pieces:Piece[],kind?:GarmentType,source?:RigAsset,pattern=false){
  const group=new Group()
  const item:Garment={name,group,mesh:[],pieces:[],worn:false,marks:false,dirty:true,type:kind,source,pattern,ease:1.3,width:100,length:100,color:'#3d9281',undo:[],
    mode:kind==='armor'?'rigid':'soft',rigid:new Map()}
  if(kind){
    const center=pieceBounds(pieces).getCenter(new Vector3())
    pieces.forEach(piece=>piece.geometry.translate(-center.x,-center.y,-center.z));group.position.copy(center)
  }
  putMeshes(item,pieces);items.push(item);viewer.edited.add(item.group)
  choose(item)
  return item
}
function choose(item:Garment|undefined) {
  if(moving&&item&&!item.worn)fitMode()
  current=item;index=-1;tool='move';renderControls();activateTool();refreshVisibility()
}
function setUiValue(id:string,value:number){input(id).value=String(value);$<HTMLOutputElement>(id+'-value').value=value+'%'}

function renderControls(){
  for(const id of ['load-model','demo'])button(id).disabled=busy
  for(const id of ['add-glb','add-pattern','add-template'])button(id).disabled=busy||!body||moving
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
  $('alignment').hidden=!!item.type||item.pattern
  $('reshape').hidden=!item.type
  for(const id of ['ease','width','length']){
    const v=id==='ease'?item.ease:id==='width'?item.width:item.length
    input(id).disabled=busy||!item.type
    setUiValue(id,v)
    input(id).closest('label')!.hidden=!item.type
  }
  input('color').value=item.color
  select('binding').value=item.mode
  const piece=index>=0?item.pieces[index]:undefined
  const rigid=index>=0?item.rigid.get(index)??piece?.joint:item.joint
  select('bone').value=rigid===undefined?'auto':String(rigid)
  $('bone-row').hidden=item.mode!=='rigid'
  for(const id of ['move','rotate','scale','orbit','tighten','loosen'])button(id).setAttribute('aria-pressed',String(tool===id))
  for(const id of ['color','texture','binding','bone','center','reshape','tighten','loosen','move','rotate','scale','orbit','radius','strength'])
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
  mark(item);activateTool();renderControls()
}

function strokeAt(hit:Intersection<Mesh>){
  if(busy||!body||!current||!stroke||!hit.face)return
  const mesh=hit.object,p=mesh.geometry.attributes.position
  const radius=body.height*number('radius')/100, strength=number('strength')/100
  const before=stroke.some(item=>item.mesh===mesh)?undefined:Float32Array.from({length:p.count*3},(_,i)=>p.getComponent(Math.floor(i/3),i%3))
  if(!fitPatch(body,mesh,hit.point,hit.face.normal,radius,strength,tool==='loosen'?'loosen':'tighten',current.mode==='soft'))return
  if(before)stroke.push({mesh,positions:before})
  mark(current);current.marks=true
}
function endStroke(){
  if(!stroke?.length||!current){stroke=undefined;return}
  stroke.forEach(({mesh})=>mesh.geometry.computeVertexNormals())
  current.undo.push(stroke);if(current.undo.length>8)current.undo.shift()
  stroke=undefined;renderControls()
}
function activateTool(){
  viewer.move();viewer.paint()
  if(!current||moving)return
  const item=current
  if(tool==='tighten'||tool==='loosen')viewer.paint({
    meshes:()=>index>=0?[item.mesh[index]]:item.mesh,
    begin:()=>{stroke=[]},stroke:strokeAt,end:endStroke
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
      mark(item);button('bind').textContent='Рассчитать веса и примерить'
    })
  }
}

async function bind(item:Garment){
  if(!body || (!item.dirty && item.bound))return
  item.group.updateWorldMatrix(true,true)
  const result:Piece[]=[]
  try {
    for(const [i,mesh] of item.mesh.entries()){
      const geometry=bakedGeometry(mesh,new Matrix4())
      if(!geometry.attributes.normal)geometry.computeVertexNormals()
      const piece=item.pieces[i]
      const fallback=()=>body!.nearestJoint(new Box3().setFromObject(mesh).getCenter(new Vector3()))
      const joint=item.mode==='rigid'?item.rigid.get(i)??item.joint??piece.joint??fallback():undefined
      result.push({name:item.name+' · '+piece.name,geometry,material:mesh.material,joint})
      body.weights(geometry,joint)
      await new Promise<void>(resolve=>setTimeout(resolve,0))
    }
  }catch(error){result.forEach(piece=>piece.geometry.dispose());throw error}
  detachBound(item);item.bound=result;item.dirty=false
  const group=new Group(), skin=body.canonicalSkin()
  for(const piece of result){
    const mesh=new SkinnedMesh(piece.geometry,piece.material)
    mesh.frustumCulled=false;mesh.bind(skin,new Matrix4());group.add(mesh)
  }
  item.display=group;viewer.dressed.add(group)
}
function fitMode(){
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
    status('Остановите анимацию на нужном кадре, чтобы проверить сгибы.')
  })
}

for(const [key,name] of Object.entries(T))select('template').add(new Option(name,key))
$('export').onclick=()=>$<HTMLDialogElement>('save-dialog').showModal()
requestFile('load-model','body-file')
requestFile('add-glb','garment-file')
requestFile('add-pattern','pattern-file')
requestFile('texture','texture-file')
fileInput('body-file',([file])=>task('Открываю персонажа…',async()=>openCharacter(await bytes(file),file.name)))
fileInput('garment-file',files=>task('Открываю GLB одежды…',()=>importGarments(files)))
fileInput('pattern-file',async([file])=>{
  if(!body || busy)return
  try {
    if(file.size>1024*1024)throw new Error('Файл выкройки SVG больше 1 МБ.')
    const pieces=await editSvgPattern(await file.text(),body,$<HTMLDialogElement>('pattern-dialog'))
    if(pieces)addItem(file.name.replace(/\.svg$/i,''),pieces,undefined,undefined,true)
  }catch(error){status((error as Error).message,true)}
})
fileInput('texture-file',async([file])=>{
  if(!current||busy)return
  const item=current
  if(file.size>16*1024*1024){status('Текстура больше 16 МБ.',true);return}
  await task('Открываю текстуру…',async()=>{
    const url=URL.createObjectURL(file)
    try{
      const texture=await new TextureLoader().loadAsync(url);texture.colorSpace=SRGBColorSpace;texture.flipY=!item.source
      for(const material of chosenMaterials(item))if(material instanceof MeshStandardMaterial){material.map=texture;material.color.set(0xffffff);material.needsUpdate=true}
      mark(item);status('Текстура применена.')
    }finally{URL.revokeObjectURL(url)}
  })
})
function chosenMaterials(item:Garment):Set<Material>{
  return new Set((index>=0?[item.mesh[index]]:item.mesh).flatMap(mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material]))
}
button('demo').onclick=()=>void task('Открываю учебного персонажа…',async()=>{
  const response=await fetch(new URL(/* @vite-ignore */ '../demo.glb',import.meta.url))
  if(!response.ok)throw new Error('Учебная модель не открылась.')
  await openCharacter(await response.arrayBuffer(),'Учебный персонаж')
})
button('add-template').onclick=()=>void task('Строю сетку одежды…',async()=>{
  const type=select('template').value as GarmentType
  addItem(templateName(type),template(body!,type,.013,1,1,'#3d9281'),type)
  status('Вещь создана. Настройте посадку или выделите участок кистью.')
})
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
for(const id of ['move','rotate','scale','orbit','tighten','loosen'])button(id).onclick=()=>{tool=id;activateTool();renderControls()}
for(const id of ['ease','width','length','radius','strength']){
  setUiValue(id,number(id))
  input(id).oninput=()=>{
    const value=number(id);$<HTMLOutputElement>(id+'-value').value=value+'%'
    if(current&&(id==='ease'||id==='width'||id==='length'))current[id]=value
  }
}
button('reshape').onclick=()=>{
  const item=current
  if(!item?.type||!body||item.marks&&!confirm('Новая форма заменит мазки кисти. Продолжить?'))return
  void task('Обновляю форму шаблона…',async()=>{
    const next=template(body!,item.type!,item.ease/100,item.width/100,item.length/100,item.color)
    const center=pieceBounds(next).getCenter(new Vector3())
    next.forEach(piece=>piece.geometry.translate(-center.x,-center.y,-center.z))
    const old=item.pieces.map(piece=>piece.material)
    next.forEach((piece,i)=>{
      if(!old[i])return
      if(!Array.isArray(piece.material))piece.material.dispose()
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
  mark(current);renderControls()
}
input('color').oninput=()=>{
  if(!current)return
  current.color=input('color').value
  for(const material of chosenMaterials(current))if(material instanceof MeshStandardMaterial)material.color.copy(new Color(current.color))
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
  void task('Собираю GLB…',async()=>{
    for(const item of selected)await bind(item)
    const dressed=await encodeGarments(body!,selected.flatMap(item=>item.bound!))
    const result=name==='all'?combineGlb(body!.asset.source_bytes,dressed):dressed
    const title=name==='all'?body!.asset.name+' · в одежде':selected[0].name
    await exportService.save(new Blob([result],{type:'model/gltf-binary'}),title.replace(/[/?\\:<>*|]/g,'_')+'.glb')
    status('GLB сохранён.')
  })
}
renderControls()
