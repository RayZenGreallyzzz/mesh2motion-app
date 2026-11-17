import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2, Vector3 } from 'three'
import { BoneSlot } from '../retarget/bone-automap/BoneTypes.ts'
import type { FittingBody } from './body.ts'
import { drawImage, type LoadedImage } from './fabric-image.ts'
import { fabric, type Piece } from './garments.ts'
import { thicken } from './surface-layers.ts'
import { parsePattern, type Panel } from './pattern.ts'

export type CutShape={points:Vector2[],aspect:number,width:number,angle:number,height:number,thickness:number,name:string,save?:boolean}

function contour(points:Vector2[]){
  if(points.length<3)throw new Error('Поставьте хотя бы три точки края.')
  const twist=(a:Vector2,b:Vector2,c:Vector2)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)
  const on=(a:Vector2,b:Vector2,c:Vector2)=>
    c.x>=Math.min(a.x,b.x)-1e-8&&c.x<=Math.max(a.x,b.x)+1e-8&&
    c.y>=Math.min(a.y,b.y)-1e-8&&c.y<=Math.max(a.y,b.y)+1e-8
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length]
    if(a.distanceToSquared(b)<1e-8)throw new Error('Две точки стоят слишком близко.')
    for(let j=i+2;j<points.length;j++){
      if(i===0&&j===points.length-1)continue
      const c=points[j],d=points[(j+1)%points.length]
      const p=twist(a,b,c),q=twist(a,b,d),r=twist(c,d,a),s=twist(c,d,b)
      const crossing=p*q<0&&r*s<0
      const touches=Math.abs(p)<1e-8&&on(a,b,c)||Math.abs(q)<1e-8&&on(a,b,d)||
        Math.abs(r)<1e-8&&on(c,d,a)||Math.abs(s)<1e-8&&on(c,d,b)
      if(crossing||touches)throw new Error('Края пересекаются. Отмените точку и уточните контур.')
    }
  }
  if(Math.abs(ShapeUtils.area(points))<.00015)throw new Error('Контур слишком узкий.')
}

export function panelGeometry(shape:CutShape, place:(horizontal:number,vertical:number)=>Vector3):BufferGeometry{
  const {points,aspect,width}=shape
  contour(points)
  const xMin=Math.min(...points.map(p=>p.x)),xMax=Math.max(...points.map(p=>p.x))
  const yMin=Math.min(...points.map(p=>p.y)),yMax=Math.max(...points.map(p=>p.y))
  const span=xMax-xMin
  if(span<.004)throw new Error('Увеличьте ширину выкройки.')
  const shapeHeight=(yMax-yMin)/span/aspect*width
  if(shapeHeight>245)throw new Error('Выбранная деталь выше 245% роста. Уменьшите ширину детали.')
  const faces=ShapeUtils.triangulateShape([...points],[])
  const verts:number[]=[], uv:number[]=[], indices:number[]=[], byPoint=new Map<string,number>()
  const vertex=(point:Vector2)=>{
    const key=Math.round(point.x*1e7)+':'+Math.round(point.y*1e7)
    const previous=byPoint.get(key)
    if(previous!==undefined)return previous
    const index=verts.length/3
    const horizontal=(point.x-(xMin+xMax)/2)/span*width/100
    const vertical=((yMin+yMax)/2-point.y)/span/aspect*width/100
    verts.push(...place(horizontal,vertical).toArray());uv.push(point.x,1-point.y)
    byPoint.set(key,index)
    return index
  }
  const steps=Math.max(4,Math.min(13,Math.ceil(Math.max(shape.width,shapeHeight)/7)))
  for(const [a,b,c] of faces){
    const rows:number[][]=[]
    for(let i=0;i<=steps;i++){
      const row:number[]=[]
      for(let j=0;j<=steps-i;j++){
        const point=points[a].clone().multiplyScalar(1-(i+j)/steps)
          .addScaledVector(points[b],i/steps).addScaledVector(points[c],j/steps)
        row.push(vertex(point))
      }
      rows.push(row)
    }
    for(let i=0;i<steps;i++)for(let j=0;j<steps-i;j++){
      const first=rows[i][j],second=rows[i+1][j],third=rows[i][j+1]
      indices.push(first,third,second)
      if(j<steps-i-1)indices.push(third,rows[i+1][j+1],second)
    }
  }
  const geometry=new BufferGeometry()
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(verts),3))
  geometry.setAttribute('uv',new BufferAttribute(new Float32Array(uv),2))
  geometry.setIndex(indices);geometry.computeVertexNormals()
  return geometry
}

export function cutPanel(body:FittingBody,shape:CutShape,image?:LoadedImage):Piece{
  const h=body.height
  const angle=shape.angle*Math.PI/180
  const radial=body.forward.clone().multiplyScalar(Math.cos(angle)).addScaledVector(body.across,Math.sin(angle))
  const tangent=body.across.clone().multiplyScalar(Math.cos(angle)).addScaledVector(body.forward,-Math.sin(angle))
  const center=(body.joint(BoneSlot.Pelvis)??body.center.clone()).addScaledVector(body.up,h*shape.height/100)
  const radius=body.section(center,tangent,radial,body.up,h*.075,h*.21)[1]+h*(.006+shape.thickness/1800)
  const geometry=panelGeometry(shape,(x,y)=>center.clone().addScaledVector(tangent,x*h).addScaledVector(body.up,y*h)
    .addScaledVector(radial,Math.max(h*.018,radius-Math.abs(x)*h*.22)))
  const normal=geometry.attributes.normal
  if(new Vector3().fromBufferAttribute(normal,0).dot(radial)<0){
    for(let i=0;i<geometry.index!.count;i+=3){
      const second=geometry.index!.getX(i+1)
      geometry.index!.setX(i+1,geometry.index!.getX(i+2));geometry.index!.setX(i+2,second)
    }
    geometry.computeVertexNormals()
  }
  const material=fabric(image?'#ffffff':'#b1b8c1')
  if(image)material.map=drawImage(image,false).texture
  return {name:shape.name,material,geometry:thicken(geometry,h*shape.thickness/1800)}
}

export function drawCut(dialog:HTMLDialogElement,source?:{file:File,image:LoadedImage},saved?:(selected:(file:File)=>void)=>void):Promise<CutShape|undefined>{
  const heading=dialog.querySelector<HTMLElement>('h2')!
  const view=dialog.querySelector<SVGSVGElement>('svg')!
  const form=dialog.querySelector<HTMLFormElement>('form')!
  const value=(key:string)=>(form.elements.namedItem(key) as HTMLInputElement)
  const hint=dialog.querySelector<HTMLElement>('[role=status]')!
  const points:Vector2[]=[]
  const aspect=source?source.image.width/source.image.height:1
  // Match the display window to the fabric, with normalized coordinates for texture UVs.
  const w=360*Math.min(1,aspect),h=360*Math.min(1,1/aspect)
  const swatch=source?URL.createObjectURL(source.file):undefined
  const node=(name:string)=>document.createElementNS('http://www.w3.org/2000/svg',name)
  const show=()=>{
    view.replaceChildren()
    if(swatch){
      const image=node('image')
      image.setAttribute('href',swatch);image.setAttribute('width',String(w));image.setAttribute('height',String(h))
      view.append(image)
    }
    const line=node('polygon')
    line.setAttribute('points',points.map(p=>p.x*w+','+p.y*h).join(' '))
    line.setAttribute('fill','#65e2c946');line.setAttribute('stroke','#d9fff5');line.setAttribute('stroke-width','2')
    view.append(line)
    for(const p of points){
      const circle=node('circle');circle.setAttribute('cx',String(p.x*w));circle.setAttribute('cy',String(p.y*h))
      circle.setAttribute('r','3');circle.setAttribute('fill','#f9de95');view.append(circle)
    }
  }
  view.setAttribute('viewBox','0 0 '+w+' '+h)
  heading.textContent=source?'Раскрой · '+source.file.name:'Нарисовать выкройку'
  value('name').value='Полотно'
  value('width').value='25';value('height').value='14';value('thickness').value='0'
  value('angle').value='0';value('save').checked=true
  hint.textContent=''
  view.onclick=event=>{
    if(points.length>=64){hint.textContent='Для одной детали доступно до 64 точек.';return}
    const matrix=view.getScreenCTM()
    if(!matrix)return
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse())
    if(point.x<0||point.y<0||point.x>w||point.y>h)return
    points.push(new Vector2(point.x/w,point.y/h));hint.textContent='';show()
  }
  dialog.querySelector<HTMLButtonElement>('[data-outline]')!.onclick=()=>{
    points.splice(0,points.length,...[[.27,.24],[.73,.24],[.77,.67],[.50,.85],[.23,.67]].map(([x,y])=>new Vector2(x,y)))
    hint.textContent='';show()
  }
  const picker=value('outline'), choose=form.elements.namedItem('panel') as HTMLSelectElement
  let imported:Panel[]=[]
  choose.hidden=true
  const place=(panel:Panel)=>{
    const factor=Math.min(w/panel.width,h/panel.height)*.86
    const samples=panel.edges.flatMap(edge=>edge.slice(0,-1))
    const stride=Math.max(1,Math.ceil(samples.length/64))
    const visible=samples.filter((_,i)=>!(i%stride)).map(p=>
      new Vector2(.5+(p.x-panel.center.x)*factor/w,.5+(p.y-panel.center.y)*factor/h))
    contour(visible)
    points.splice(0,points.length,...visible);show()
    hint.textContent=''
  }
  choose.onchange=()=>{
    try{place(imported[Number(choose.value)])}
    catch(error){hint.textContent=(error as Error).message}
  }
  const load=async(file:File)=>{
    try{
      if(file.size>1024*1024)throw new Error('Файл выкройки SVG больше 1 МБ.')
      imported=parsePattern(await file.text())
      if(!dialog.open)return
      choose.replaceChildren(...imported.map((_,i)=>new Option('Полотно '+(i+1),String(i))))
      choose.hidden=imported.length<2
      place(imported[0])
      value('name').value=file.name.replace(/\.svg$/i,'').slice(0,64)
    }catch(error){hint.textContent=(error as Error).message}
  }
  dialog.querySelector<HTMLButtonElement>('[data-load]')!.onclick=()=>picker.click()
  const library=dialog.querySelector<HTMLButtonElement>('[data-saved]')!
  library.disabled=!saved
  library.onclick=()=>saved?.(file=>void load(file))
  picker.onchange=()=>{
    const file=picker.files?.[0];picker.value=''
    if(file)void load(file)
  }
  for(const button of form.querySelectorAll<HTMLButtonElement>('[data-nudge]'))button.onclick=()=>{
    if(!points.length)return
    const [x,y]=button.dataset.nudge!.split(',').map(Number)
    const dx=x<0?Math.max(x,-Math.min(...points.map(p=>p.x))):Math.min(x,1-Math.max(...points.map(p=>p.x)))
    const dy=y<0?Math.max(y,-Math.min(...points.map(p=>p.y))):Math.min(y,1-Math.max(...points.map(p=>p.y)))
    for(const point of points){point.x+=dx;point.y+=dy}
    show()
  }
  dialog.querySelector<HTMLButtonElement>('[data-undo]')!.onclick=()=>{points.pop();hint.textContent='';show()}
  dialog.querySelector<HTMLButtonElement>('[data-clear]')!.onclick=()=>{points.length=0;hint.textContent='';show()}
  dialog.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick=()=>dialog.close()
  return new Promise(resolve=>{
    let result:CutShape|undefined
    form.onsubmit=event=>{
      event.preventDefault()
      try{
        contour(points)
        result={points:[...points],name:value('name').value.trim()||'Полотно',aspect,width:Number(value('width').value),
          height:Number(value('height').value),thickness:Number(value('thickness').value),angle:Number(value('angle').value)}
        dialog.close()
      }catch(error){hint.textContent=(error as Error).message}
    }
    dialog.addEventListener('close',()=>{
      if(swatch)URL.revokeObjectURL(swatch)
      view.replaceChildren();view.onclick=null;form.onsubmit=null
      resolve(result&&Object.assign(result,{save:value('save').checked}))
    },{once:true})
    show();dialog.showModal()
  })
}
