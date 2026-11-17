import { Box3, MeshStandardMaterial, Raycaster, Vector3, type Material, type Mesh } from 'three'
import { drawImage, type LoadedImage } from './fabric-image.ts'
import type { Piece } from './garments.ts'
import type { FittingBody } from './body.ts'
import { anchorPrint } from './image-placement.ts'

type Pattern = 'stripes'|'plaid'|'color-block'
type Motif = 'star'|'orbit'|'bear'
export interface ShirtStyle {
  name:string
  panel:string
  back?:string
  sleeve?:string
  contrast?:string
  pattern?:Pattern
  motif?:Motif
  large?:boolean
}

export const shirtStyles:readonly ShirtStyle[] = [
  {name:'Белая классика',panel:'#ede9df'},
  {name:'Контрастные рукава',panel:'#f4eddf',sleeve:'#e85652'},
  {name:'Морская полоска',panel:'#1e3b59',contrast:'#76b8c9',pattern:'stripes'},
  {name:'Лесная полоска',panel:'#354323',contrast:'#6d803a',pattern:'stripes'},
  {name:'Красная клетка',panel:'#7e252f',contrast:'#e66e68',pattern:'plaid'},
  {name:'Два цвета',panel:'#eceae1',contrast:'#203349',pattern:'color-block',sleeve:'#eceae1'},
  {name:'Звезда',panel:'#6b42bb',contrast:'#ffd068',motif:'star'},
  {name:'Орбита',panel:'#203c51',contrast:'#9bd5db',motif:'orbit'},
  {name:'Мишка на весь перед',panel:'#8a664e',sleeve:'#634a3b',contrast:'#f3c990',motif:'bear',large:true}
]

export function styleMaterials(pieces:Piece[],style:ShirtStyle):void{
  const [torso,...sleeves]=pieces
  if(!torso||!Array.isArray(torso.material)||torso.material.length!==2)throw new Error('У футболки отсутствуют перед и спинка.')
  assign(torso.material[0],style.panel,style, true)
  assign(torso.material[1],style.back??style.panel,style,true)
  for(const sleeve of sleeves)if(!Array.isArray(sleeve.material)){
    assign(sleeve.material,style.sleeve??style.panel,style,!style.sleeve)
  }
}

function assign(material:Material,base:string,style:ShirtStyle,withPattern:boolean){
  if(!(material instanceof MeshStandardMaterial))return
  material.color.set(base)
  if(!withPattern||!style.pattern)return
  const src=sheet((ctx,w,h)=>drawFabric(ctx,w,h,base,style))
  const {texture}=drawImage(src,false)
  texture.userData.wardrobeFabric=true
  material.map=texture
  material.color.set(0xffffff)
  material.needsUpdate=true
}

function sheet(paint:(ctx:CanvasRenderingContext2D,w:number,h:number)=>void):LoadedImage{
  const image=document.createElement('canvas')
  const width=384,height=384
  image.width=width;image.height=height
  const ctx=image.getContext('2d')
  if(!ctx)throw new Error('Не удалось подготовить оформление футболки.')
  paint(ctx,width,height)
  return {image,width,height}
}

function drawFabric(ctx:CanvasRenderingContext2D,w:number,h:number,base:string,style:ShirtStyle){
  ctx.fillStyle=base;ctx.fillRect(0,0,w,h)
  if(style.pattern==='stripes'){
    ctx.fillStyle=style.contrast!
    for(let i=0;i<9;i++)ctx.fillRect(0,i*h/9,w,h/19)
  }else if(style.pattern==='plaid'){
    ctx.fillStyle=style.contrast!
    ctx.save();ctx.globalAlpha=.34
    for(let i=0;i<10;i++){
      ctx.fillRect(0,i*h/10,w,h/23)
      ctx.fillRect(i*w/10,0,w/23,h)
    }
    ctx.globalAlpha=.62
    for(let i=0;i<10;i++){
      ctx.fillRect(0,i*h/10,w,h/106)
      ctx.fillRect(i*w/10,0,w/106,h)
    }
    ctx.restore()
  }else if(style.pattern==='color-block'){
    ctx.fillStyle=style.contrast!;ctx.fillRect(0,h*.64,w,h*.36)
  }
}

function circle(ctx:CanvasRenderingContext2D,x:number,y:number,radius:number,fill:string){
  ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill()
}

function drawMotif(ctx:CanvasRenderingContext2D,kind:Motif,color:string,x:number,y:number,r:number){
  ctx.save();ctx.translate(x,y);ctx.scale(r,r)
  if(kind==='star'){
    ctx.beginPath()
    for(let i=0;i<10;i++){
      const angle=i*Math.PI/5-Math.PI/2, radius=i%2?.49:1
      if(i===0)ctx.moveTo(Math.cos(angle)*radius,Math.sin(angle)*radius)
      else ctx.lineTo(Math.cos(angle)*radius,Math.sin(angle)*radius)
    }
    ctx.closePath();ctx.fillStyle=color;ctx.fill()
  }else if(kind==='orbit'){
    ctx.strokeStyle=color;ctx.lineWidth=.083
    for(const angle of [0,Math.PI/3,Math.PI*2/3]){
      ctx.beginPath();ctx.ellipse(0,0,.96,.365,angle,0,Math.PI*2);ctx.stroke()
    }
    circle(ctx,0,0,.162,color)
  }else{
    circle(ctx,-.66,-.59,.31,'#594139');circle(ctx,.66,-.59,.31,'#594139')
    circle(ctx,-.65,-.59,.17,'#d3a982');circle(ctx,.65,-.59,.17,'#d3a982')
    ctx.beginPath();ctx.ellipse(0,.06,.85,.75,0,0,Math.PI*2);ctx.fillStyle=color;ctx.fill()
    circle(ctx,-.32,-.06,.105,'#432a27');circle(ctx,.32,-.06,.105,'#432a27')
    circle(ctx,-.35,-.10,.029,'#ffefd9');circle(ctx,.29,-.10,.029,'#ffefd9')
    ctx.beginPath();ctx.ellipse(0,.36,.38,.255,0,0,Math.PI*2);ctx.fillStyle='#ffe0b0';ctx.fill()
    ctx.beginPath();ctx.ellipse(0,.245,.132,.083,0,0,Math.PI*2);ctx.fillStyle='#4b332b';ctx.fill()
    ctx.strokeStyle='#4b332b';ctx.lineWidth=.038;ctx.lineCap='round'
    ctx.beginPath();ctx.moveTo(0,.32);ctx.lineTo(0,.40);ctx.quadraticCurveTo(-.105,.503,-.16,.403)
    ctx.moveTo(0,.40);ctx.quadraticCurveTo(.105,.503,.16,.403);ctx.stroke()
  }
  ctx.restore()
}

export function stylePrint(style:ShirtStyle):LoadedImage|undefined{
  const {motif}=style
  if(!motif)return
  return sheet((ctx,w,h)=>drawMotif(ctx,motif,style.contrast!,w/2,h/2,w*.462))
}

export function shirtPrintPlacement(body:FittingBody,torso:Mesh,large=false){
  torso.updateWorldMatrix(true,false)
  const box=new Box3().setFromObject(torso),center=box.getCenter(new Vector3()),bounds=box.getSize(new Vector3())
  center.y=box.min.y+bounds.y*(large?.56:.66)
  const direction=body.forward.clone()
  const ray=new Raycaster(center.clone().addScaledVector(direction,body.height),direction.clone().negate())
  const hit=ray.intersectObject(torso,false)[0]
  const face=hit?.face
  if(!face)return
  const anchor=anchorPrint(torso.geometry,torso.matrixWorld,[face.a,face.b,face.c],hit.point,body.up,direction)
  if(!anchor)return
  const point=new Vector3()
  const points=torso.geometry.attributes.position
  let left=Infinity,right=-Infinity
  for(let i=0;i<points.count;i++){
    const x=point.fromBufferAttribute(points,i).applyMatrix4(torso.matrixWorld).dot(body.across)
    left=Math.min(left,x);right=Math.max(right,x)
  }
  const width=Math.min((right-left)*(large?.92:.40),bounds.y*(large?.78:.43))
  return {anchor,size:Math.max(1,Math.min(55,width/body.height*100))}
}

export function shirtCard(style:ShirtStyle):HTMLCanvasElement{
  const canvas=document.createElement('canvas')
  canvas.width=272;canvas.height=196;canvas.setAttribute('aria-hidden','true')
  const ctx=canvas.getContext('2d')
  if(!ctx)return canvas
  const shape=new Path2D('M 89,38 L 112,29 Q 136,48 160,29 L 183,38 Q 203,46 211,65 L 237,111 L 201,129 L 188,108 L 192,169 Q 137,183 80,169 L 84,108 L 71,129 L 35,111 L 61,65 Q 70,46 89,38 Z')
  ctx.save();ctx.clip(shape)
  ctx.translate(35,28)
  drawFabric(ctx,202,144,style.panel,style)
  ctx.translate(-35,-28)
  if(style.sleeve){
    ctx.fillStyle=style.sleeve
    ctx.beginPath();ctx.moveTo(35,33);ctx.lineTo(86,33);ctx.quadraticCurveTo(96,68,80,105)
    ctx.lineTo(78,134);ctx.lineTo(34,134);ctx.closePath();ctx.fill()
    ctx.beginPath();ctx.moveTo(237,33);ctx.lineTo(186,33);ctx.quadraticCurveTo(176,68,192,105)
    ctx.lineTo(194,134);ctx.lineTo(238,134);ctx.closePath();ctx.fill()
  }
  if(style.motif)drawMotif(ctx,style.motif,style.contrast!,136,style.large?112:95,style.large?48:24)
  ctx.restore()
  ctx.strokeStyle='#0a1525';ctx.lineWidth=2;ctx.stroke(shape)
  ctx.strokeStyle='#15172163';ctx.lineWidth=3
  ctx.beginPath();ctx.moveTo(112,31);ctx.quadraticCurveTo(135,66,160,31);ctx.stroke()
  return canvas
}

export function sportCard(kind:'hoodie'|'joggers',color:string):HTMLCanvasElement{
  const canvas=document.createElement('canvas')
  canvas.width=272;canvas.height=196;canvas.setAttribute('aria-hidden','true')
  const ctx=canvas.getContext('2d')
  if(!ctx)return canvas
  const path=(data:string,fill:string,stroke='#152035')=>{
    const shape=new Path2D(data)
    ctx.fillStyle=fill;ctx.fill(shape)
    ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke(shape)
  }
  if(kind==='hoodie'){
    path('M 110 49 Q 102 25 136 16 Q 169 25 162 49 L 156 60 L 116 60 Z',color)
    path('M 121 47 Q 121 30 136 26 Q 151 30 151 47 L 145 56 L 128 56 Z','#1b2635')
    path('M 114 49 L 92 54 Q 76 58 70 77 L 48 152 L 70 162 L 90 109 L 92 174 Q 136 184 180 174 L 182 109 L 201 162 L 224 152 L 202 77 Q 195 58 178 54 L 158 49 Q 137 69 114 49 Z',color)
    path('M 110 132 L 162 132 L 172 159 L 100 159 Z',color,'#14233680')
    ctx.strokeStyle='#e2e9df';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(129,58);ctx.lineTo(128,91)
    ctx.moveTo(143,58);ctx.lineTo(144,95);ctx.stroke()
  }else{
    path('M 104 28 L 169 28 Q 178 48 176 74 L 160 174 L 140 174 L 136 102 L 130 174 L 111 174 L 96 74 Q 95 48 104 28 Z',color)
    path('M 101 45 L 171 45 L 169 30 L 104 30 Z',color,'#111b296e')
    path('M 111 165 L 130 165 L 130 176 L 112 176 Z',color,'#111b296e')
    path('M 140 165 L 162 165 L 159 176 L 140 176 Z',color,'#111b296e')
    ctx.strokeStyle='#d0d6c3';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(134,42);ctx.quadraticCurveTo(124,53,128,65)
    ctx.moveTo(137,42);ctx.quadraticCurveTo(145,56,141,71);ctx.stroke()
  }
  return canvas
}
