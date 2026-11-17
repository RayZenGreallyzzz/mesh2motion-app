import { BufferAttribute, BufferGeometry, LineCurve, ShapeUtils, Vector2, Vector3, type Curve } from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import type { FittingBody } from './body.ts'
import { fabric, type Piece } from './garments.ts'
import { BoneSlot } from '../retarget/bone-automap/BoneTypes.ts'

export type Panel = { edges:Vector2[][], center:Vector2, width:number, height:number, angle:number, horizontal:number, vertical:number }
export type Seam = { a:[number,number],b:[number,number],reverse:boolean }
const STEPS=6

export function parsePattern(svg:string):Panel[]{
  const data=new SVGLoader().parse(svg)
  const panels:Panel[]=[]
  for(const path of data.paths)for(const contour of path.subPaths){
    if(!contour.curves.length)continue
    const curves=[...contour.curves] as Curve<Vector2>[]
    const first=curves[0].getPoint(0), last=curves.at(-1)!.getPoint(1)
    if(first.distanceToSquared(last)>1e-7){
      if(!contour.autoClose)continue
      curves.push(new LineCurve(last,first))
    }
    const edges=curves.map(edge=>Array.from({length:STEPS+1},(_,i)=>edge.getPointAt(i/STEPS))) as Vector2[][]
    if(edges.length<2)continue
    const points=edges.flat(), left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x))
    const top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y))
    if(right-left<1e-6||bottom-top<1e-6)continue
    panels.push({edges,center:new Vector2((left+right)/2,(top+bottom)/2),width:right-left,height:bottom-top,
      angle:panels.length===0?0:panels.length===1?180:panels.length%2===0?90:270,horizontal:0,vertical:0})
  }
  if(!panels.length)throw new Error('В SVG нужен хотя бы один замкнутый контур.')
  if(panels.length>16||panels.some(panel=>panel.edges.length>128))throw new Error('Откройте до 16 полотен с простыми контурами.')
  return panels
}

export function sewPanels(body:FittingBody, panels:Panel[],seams:Seam[],scale:number):Piece[]{
  const flat:Vector2[][]=[],positions:Vector3[]=[], faces:number[][]=[], offsets:number[]=[]
  const anchors=body.joint(BoneSlot.Pelvis)??body.center.clone()
  const ratio=body.height*scale/100/Math.max(...panels.map(panel=>panel.width))
  const gap=body.height*.012
  for(const panel of panels){
    const points=panel.edges.flatMap(edge=>edge.slice(0,-1)), at=positions.length
    flat.push(points);offsets.push(at)
    const theta=panel.angle*Math.PI/180
    const radial=body.forward.clone().multiplyScalar(Math.cos(theta)).addScaledVector(body.across,Math.sin(theta))
    const tangent=body.across.clone().multiplyScalar(Math.cos(theta)).addScaledVector(body.forward,-Math.sin(theta))
    const center=anchors.clone().addScaledVector(body.up,body.height*(.1+panel.vertical/100))
      .addScaledVector(tangent,body.height*panel.horizontal/100)
    const radius=body.section(center,tangent,radial,body.up,body.height*.05,body.height*.21)[1]+gap
    for(const p of points){
      const horizontal=(p.x-panel.center.x)*ratio
      const vertical=(panel.center.y-p.y)*ratio
      positions.push(center.clone().addScaledVector(tangent,horizontal).addScaledVector(body.up,vertical)
        .addScaledVector(radial,Math.max(gap,radius-Math.abs(horizontal)*.21)))
    }
    const triangles=ShapeUtils.triangulateShape(points.slice(),[])
    if(!triangles.length)throw new Error('Контур пересекает сам себя. Исправьте выкройку SVG.')
    for(const triangle of triangles)faces.push(triangle.map(i=>i+at))
  }
  const parents=positions.map((_,i)=>i)
  const root=(id:number):number=>{
    while(id!==parents[id]){parents[id]=parents[parents[id]];id=parents[id]}
    return id
  }
  const boundary=([i,edge]:[number,number],step:number)=>offsets[i]+(edge*STEPS+step)%flat[i].length
  for(const {a,b,reverse} of seams)for(let step=0;step<=STEPS;step++){
    const p=root(boundary(a,step)),q=root(boundary(b,reverse?STEPS-step:step))
    parents[p]=q
  }
  const verts:number[]=[], indices:number[]=[],u:number[]=[],mapping=new Map<number,number>()
  const sums=new Map<number,{sum:Vector3,count:number}>()
  positions.forEach((p,i)=>{
    const k=root(i), group=sums.get(k)??{sum:new Vector3(),count:0}
    group.sum.add(p);group.count++;sums.set(k,group)
  })
  for(const [id,{sum,count}] of sums){
    mapping.set(id,verts.length/3)
    const p=sum.divideScalar(count);verts.push(...p.toArray())
    const delta=p.clone().sub(anchors)
    u.push(.5+Math.atan2(delta.dot(body.across),delta.dot(body.forward))/(Math.PI*2),.5+delta.y/body.height)
  }
  for(const f of faces){
    const triangle=f.map(i=>mapping.get(root(i))!)
    if(new Set(triangle).size===3)indices.push(...triangle)
  }
  if(!indices.length)throw new Error('Швы полностью схлопнули выкройку. Проверьте пары краёв.')
  const geometry=new BufferGeometry()
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(verts),3))
  geometry.setAttribute('uv',new BufferAttribute(new Float32Array(u),2))
  geometry.setIndex(indices);geometry.computeVertexNormals()
  return [{name:'Сшитая выкройка',geometry,material:fabric('#3d9281')}]
}

export function editSvgPattern(data:string,body:FittingBody,dialog:HTMLDialogElement):Promise<Piece[]|undefined>{
  const panels=parsePattern(data),seams:Seam[]=[]
  let pending:[number,number]|undefined
  const el=<K extends keyof HTMLElementTagNameMap>(name:K,text='')=>{const e=document.createElement(name);e.textContent=text;return e}
  const layer=(tag:string)=>document.createElementNS('http://www.w3.org/2000/svg',tag)
  const btn=(text:string,click:()=>void)=>{const b=el('button',text);b.onclick=click;return b}
  const form=el('div');form.className='pattern-editor'
  const title=el('h2','Выкройка и швы')
  const help=el('p','Коснитесь первого края, затем второго. Для каждого полотна выберите сторону и положение вокруг тела.')
  const scale=el('input');scale.type='number';scale.min='5';scale.max='150';scale.value='34'
  const scaleLabel=el('label','Ширина самого широкого полотна, % роста ');scaleLabel.append(scale)
  const preview=layer('svg');preview.setAttribute('class','pattern-preview');preview.setAttribute('aria-label','Контуры выкройки')
  const list=el('div');list.className='pattern-list'
  const seamRows=el('div');seamRows.className='pattern-list'
  const issue=el('p')
  const palette=['#82d2c6','#d9a8ea','#b3caff','#f0b88b','#93d498','#f7ce73']
  const points=panels.flatMap(panel=>panel.edges.flat())
  const x=Math.min(...points.map(p=>p.x)), y=Math.min(...points.map(p=>p.y))
  const w=Math.max(...points.map(p=>p.x))-x,h=Math.max(...points.map(p=>p.y))-y
  const unit=Math.max(w,h)/150
  preview.setAttribute('viewBox',[x-unit*3,y-unit*3,w+unit*6,h+unit*6].join(' '))
  const same=(a:[number,number],b:[number,number])=>a[0]===b[0]&&a[1]===b[1]
  const selected=(edge:[number,number])=>seams.some(seam=>same(seam.a,edge)||same(seam.b,edge))
  const draw=()=>{
    preview.replaceChildren()
    for(const [i,panel] of panels.entries())for(const [j,edge] of panel.edges.entries()){
      const path=layer('path'),ref:[number,number]=[i,j]
      const drawing=edge.map((p,k)=>(k?'L':'M')+p.x+' '+p.y).join(' ')
      path.setAttribute('d',drawing);path.setAttribute('fill','none');path.setAttribute('stroke-width',String(unit*1.7))
      const paired=seams.findIndex(seam=>same(seam.a,ref)||same(seam.b,ref))
      path.setAttribute('stroke',pending&&same(ref,pending)?'#fff7a0':paired>=0?palette[paired%palette.length]:'#a6b5ce')
      const tap=layer('path')
      tap.setAttribute('d',drawing);tap.setAttribute('fill','none');tap.setAttribute('stroke','transparent')
      tap.setAttribute('stroke-width',String(unit*7));tap.setAttribute('tabindex','0');tap.setAttribute('role','button')
      const label='Полотно '+(i+1)+' · край '+(j+1)
      tap.setAttribute('aria-label',label)
      const pick=()=>{
        if(selected(ref))return
        if(!pending){pending=ref;issue.textContent='Выбран '+label.toLowerCase()+'. Коснитесь второго края.'}
        else if(same(ref,pending)){pending=undefined;issue.textContent='Выбор сброшен.'}
        else {seams.push({a:pending,b:ref,reverse:true});pending=undefined;issue.textContent='Шов добавлен.'}
        draw()
      }
      tap.addEventListener('click',pick);tap.addEventListener('keydown',event=>{if((event as KeyboardEvent).key==='Enter')pick()})
      preview.append(path,tap)
    }
    seamRows.replaceChildren(...seams.map((seam,i)=>{
      const row=el('div');row.className='pattern-line';row.style.color=palette[i%palette.length]
      row.append(el('span','Шов '+(i+1)+' · '+(seam.a[0]+1)+':'+(seam.a[1]+1)+' ↔ '+(seam.b[0]+1)+':'+(seam.b[1]+1)),
        btn('Развернуть края',()=>{seam.reverse=!seam.reverse;issue.textContent='Направление соответствия изменено.';draw()}),
        btn('Убрать',()=>{seams.splice(i,1);draw()}))
      return row
    }))
  }
  for(const [i,panel] of panels.entries()){
    const row=el('div');row.className='pattern-line';row.append(el('span','Полотно '+(i+1)))
    const side=el('select')
    for(const [caption,angle] of [['Спереди',0],['Сзади',180],['Слева',90],['Справа',270]] as const)side.add(new Option(caption,String(angle)))
    side.value=String(panel.angle);side.onchange=()=>{panel.angle=Number(side.value)}
    side.setAttribute('aria-label','Сторона полотна '+(i+1));row.append(side)
    for(const [name,key] of [['Вбок','horizontal'],['Вверх','vertical']] as const){
      const field=el('input');field.type='number';field.min='-100';field.max='100';field.value='0'
      field.oninput=()=>{panel[key]=Math.min(100,Math.max(-100,Number(field.value)))}
      field.setAttribute('aria-label',name+' · полотно '+(i+1))
      const cap=el('label',name+' ');cap.append(field);row.append(cap)
    }
    list.append(row)
  }
  return new Promise(resolve=>{
    let output:Piece[]|undefined
    dialog.addEventListener('close',()=>resolve(output),{once:true})
    const accept=btn(panels.length===1?'Вырезать полотно':'Собрать полотна',()=>{
      const value=Number(scale.value)
      if(!(value>=5&&value<=150)){issue.textContent='Укажите ширину от 5 до 150% роста.';return}
      try{output=sewPanels(body,panels,seams,value);dialog.close()}catch(error){issue.textContent=(error as Error).message}
    })
    accept.className='accent'
    const row=el('div');row.className='row';row.append(accept,btn('Отмена',()=>dialog.close()))
    form.append(title,help,scaleLabel,preview,list,seamRows,issue,row)
    dialog.replaceChildren(form);draw();dialog.showModal()
  })
}
