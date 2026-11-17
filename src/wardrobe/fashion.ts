import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, SphereGeometry, TubeGeometry, Vector3 } from 'three'
import { BoneSlot as B, BoneSide } from '../retarget/bone-automap/BoneTypes.ts'
import type { FittingBody } from './body.ts'
import { fabric, type Piece } from './garments.ts'

export const fashionCatalogue = {
  clothing: [
    ['court','Придворное платье'],['gothicDress','Готическое платье'],['tunic','Средневековая туника'],
    ['coat','Дорожный плащ с капюшоном'],['techJacket','Киберпанк-куртка']
  ],
  armor:[['knight','Рыцарские латы'],['gothic','Готические латы'],['runic','Рунный панцирь'],['cyber','Киберброня']],
  footwear:[['rider','Сапоги всадника'],['ranger','Сапоги следопыта'],['sabatons','Латные башмаки'],
    ['street','Кроссовки с толстой подошвой'],['victor','Ботинки на каблуке']]
} as const
export type FashionId = typeof fashionCatalogue[keyof typeof fashionCatalogue][number][0]
const sides=[BoneSide.Left,BoneSide.Right] as const
const tau=Math.PI*2
const gray='#818892',edge='#b2b9c1',under='#565c65'
type Skin=(u:number,v:number)=>Vector3
function surface(skin:Skin,width=40,height=18){
  const vertices:number[]=[],uv:number[]=[],indices:number[]=[]
  for(let y=0;y<=height;y++)for(let x=0;x<=width;x++){
    vertices.push(...skin(x/width,y/height).toArray());uv.push(x/width,y/height)
    if(x<width&&y<height){
      const a=y*(width+1)+x,b=a+width+1
      indices.push(a,a+1,b,b,a+1,b+1)
    }
  }
  const mesh=new BufferGeometry()
  mesh.setAttribute('position',new Float32BufferAttribute(vertices,3));mesh.setAttribute('uv',new Float32BufferAttribute(uv,2))
  mesh.setIndex(indices);mesh.computeVertexNormals()
  return mesh
}
function line(path:(u:number)=>Vector3,radius:number,closed=false){
  const samples=Array.from({length:22+Number(!closed)},(_,i)=>path(i/22))
  return new TubeGeometry(new CatmullRomCurve3(samples,closed),44,radius,6,closed)
}
function finish(layers:[string,BufferGeometry[],string,boolean][],name:string,joint?:number):Piece{
  const geometry=new BufferGeometry()
  const pos:number[]=[],norm:number[]=[],uv:number[]=[],indices:number[]=[]
  for(const [index,[,meshes]] of layers.entries()){
    const start=indices.length
    for(const mesh of meshes){
      const offset=pos.length/3
      for(const n of mesh.attributes.position.array)pos.push(n)
      for(const n of mesh.attributes.normal.array)norm.push(n)
      for(const n of mesh.attributes.uv.array)uv.push(n)
      for(const n of mesh.index!.array)indices.push(n+offset)
      mesh.dispose()
    }
    geometry.addGroup(start,indices.length-start,index)
  }
  geometry.setIndex(indices);geometry.setAttribute('position',new Float32BufferAttribute(pos,3))
  geometry.setAttribute('normal',new Float32BufferAttribute(norm,3));geometry.setAttribute('uv',new Float32BufferAttribute(uv,2))
  return {name,geometry,material:layers.map(([region,,color,metal])=>{const m=fabric(color,metal);m.name=region;return m}),
    regions:layers.map(([region])=>region),joint}
}

export function fashionTemplate(body:FittingBody,id:FashionId,ease=.011,width=1,length=1):Piece[]{
  const h=body.height,gap=ease*h
  const {across,forward,up}=body
  const at=(p:Vector3,x:number,y:number,z:number)=>p.clone().addScaledVector(across,x).addScaledVector(up,y).addScaledVector(forward,z)
  const point=(slot:B,side?:BoneSide)=>{
    const result=body.joint(slot,side)
    if(!result)throw new Error('Для шаблона нужна кость «'+slot+'» в риге.')
    return result
  }
  const joint=(slot:B,side?:BoneSide)=>body.slots.findIndex(role=>role?.slot===slot&&(!side||role.side===side))
  const add=(name:string,shape:Skin,trim:BufferGeometry[],j?:number,material=gray,metal=false,rows=18)=>{
    result.push(finish([[metal?'Пластина':'Основа',[surface(shape,44,rows)],material,metal],['Окантовка',trim,edge,metal]],name,j!==undefined&&j>=0?j:undefined))
  }
  const tube=(start:Vector3,end:Vector3,r:number,tip:number,puff=.14):Skin=>{
    const axis=end.clone().sub(start).normalize()
    const front=forward.clone().addScaledVector(axis,-axis.dot(forward))
    if(front.lengthSq()<.01)front.copy(up).addScaledVector(axis,-axis.dot(up))
    front.normalize()
    const side=axis.clone().cross(front)
    return (u,v)=>{
      const radius=r*(1-v+v*tip+puff*Math.sin(Math.PI*v))
      return start.clone().lerp(end,v).addScaledVector(side,Math.sin(u*tau)*radius).addScaledVector(front,Math.cos(u*tau)*radius*.87)
    }
  }
  const result:Piece[]=[]
  const boots=fashionCatalogue.footwear.findIndex(([name])=>name===id)
  if(boots>=0){
    const shaftHeight=[.92,.61,.43,.15,.32][boots],metal=boots===2
    for(const side of sides){
      const tag=side===BoneSide.Left?'лев.':'прав.'
      const ankle=point(B.Foot,side),knee=point(B.Calf,side)
      const toe=body.joint(B.Ball,side)??ankle.clone().addScaledVector(forward,h*.075)
      const direction=toe.clone().sub(ankle).setY(0),footLength=Math.max(h*.043,direction.length())
      if(direction.lengthSq()<1e-8)direction.copy(forward)
      direction.normalize()
      const cross=up.clone().cross(direction)
      const [measured]=body.section(ankle,cross,up,direction,h*.04,h*.068)
      const radius=(Math.max(h*.026,Math.min(measured,h*.042))+gap*.55)*width
      const ground=toe.clone().copy(ankle).setY(Math.max(body.bounds.min.y,Math.min(toe.y,ankle.y)-h*.04))
      const reach=[1.47,1.53,1.64,1.49,1.55][boots]*length
      const heel=(boots===4?.019:0)*h
      const soleThickness=(boots===3?.023:.012)*h
      const foot=(u:number,v:number,sole=false)=>{
        const sine=Math.sin(u*tau),cosine=Math.cos(u*tau)
        const depth=footLength*((reach-.42)/2+cosine*(reach+.42)/2*(sole?1.04:1-v*.14))
        const horizontal=sine*radius*(.94-.13*Math.exp(-((cosine+.27)**2)/.12))*(sole?1.05:1-.5*v*v)
        return ground.clone().addScaledVector(cross,horizontal).addScaledVector(direction,depth)
          .addScaledVector(up,heel*Math.max(0,-cosine)+(sole?-soleThickness*(1-v):v*h*(.047-.019*cosine)))
      }
      const decoration=[line(u=>foot(u,0,true),h*.0022,true)]
      if(boots===1||boots===3)for(let row=0;row<4;row++){
        decoration.push(line(u=>ground.clone().addScaledVector(cross,(u-.5)*radius*1.33)
          .addScaledVector(direction,footLength*(.44+.15*row)).addScaledVector(up,h*(.046-.004*row+.007*Math.sin(Math.PI*u))),h*.0023))
      }
      if(metal)for(let row=0;row<4;row++)decoration.push(line(u=>foot((u-.5)*(.29+row*.038),.23+row*.18).addScaledVector(up,h*.003),h*.0024))
      const sole:Skin=(u,v)=>foot(u,v,true)
      const cap:Skin=(u,v)=>foot(u,1).lerp(ankle,v*.975)
      result.push(finish([[metal?'Металл':'Верх обуви',[surface(foot),surface(cap,44,8)],gray,metal],
        ['Подошва',[surface(sole,44,4),surface((u,v)=>foot(u,0,true).lerp(ground.clone().addScaledVector(up,-soleThickness),v*.997),44,5)],'#454a53',false],
        ['Отделка',decoration,edge,metal]],'Стопа '+tag,joint(B.Foot,side)))
      const start=ankle.clone().lerp(knee,.026),end=ankle.clone().lerp(knee,Math.min(.97,shaftHeight*length))
      const shaft=tube(start,end,radius*.93,shaftHeight>.4?1.17:1.02,.15)
      const rims=[line(u=>shaft(u,.96),h*.0031,true),line(u=>shaft(u,.12),h*.0024,true)]
      if(boots!==3)for(const v of [.37,.78])rims.push(line(u=>shaft(u,v),h*.0023,true))
      add('Голенище '+tag,shaft,rims,joint(shaftHeight>.2?B.Calf:B.Foot,side),under,metal)
    }
    return result
  }
  const pelvis=point(B.Pelvis),shoulders=sides.map(side=>point(B.UpperArm,side))
  const shouldersMid=shoulders[0].clone().lerp(shoulders[1],.5)
  const neck=body.joint(B.Neck)??at(shouldersMid,0,h*.03,0)
  const span=shoulders[0].distanceTo(shoulders[1])
  const waist=pelvis.clone().lerp(neck,.30),chest=pelvis.clone().lerp(neck,.73)
  const [x,z]=body.section(chest,across,forward,up,h*.037,Math.max(span*.6,h*.12))
  const [hx,hz]=body.section(pelvis,across,forward,up,h*.036,Math.max(span*.62,h*.13))
  const rx=(Math.max(x,span*.37)+gap)*width,rz=(Math.max(z,span*.23)+gap)*width
  const hipX=(Math.max(hx,span*.35)+gap)*width,hipZ=(Math.max(hz,span*.19)+gap)*width
  const armor=fashionCatalogue.armor.findIndex(([name])=>name===id)
  if(armor>=0){
    const metal=true,sharp=[.25,.42,.20,.095][armor],tiers=[3,4,2,2][armor]
    let chestJoint=joint(B.Spine),near=Infinity
    for(const [i,role] of body.slots.entries()){
      if(role?.slot!==B.Spine)continue
      const distance=new Vector3().setFromMatrixPosition(body.rest[i]).distanceToSquared(chest)
      if(distance<near){near=distance;chestJoint=i}
    }
    for(const side of [1,-1]){
      const plate:Skin=(u,v)=>{
        const a=(u-.5)*(side>0?3.02:3.38),center=Math.cos(a)**2
        const shield=waist.clone().lerp(neck,v)
        return at(shield,side*Math.sin(a)*rx*(.82+.29*Math.sin(v*Math.PI*.82)-.41*v**7),
          h*(-sharp*.19*center*(1-v)**3+.053*(1-center)*v**5)*length,
          side*(rz*Math.cos(a)*(.77+.34*Math.sin(Math.PI*v))+sharp*h*.39*center*v*(1-v)))
      }
      const trim:BufferGeometry[]=[line(u=>plate(u,0),h*.0035),line(u=>plate(u,1),h*.0031),line(v=>plate(.01,v),h*.0027),line(v=>plate(.99,v),h*.0027)]
      if(side>0){
        for(let rib=0;rib<(armor===3?5:3);rib++){
          const t=.26+rib*.10
          trim.push(line(u=>plate(.18+.64*u,t+(u-.5)**2*(armor===3?.17:.46)).addScaledVector(forward,h*.002),h*.0025))
        }
        const badge=(u:number)=>plate(.5+.106*Math.sin(u*tau),.58+.145*Math.cos(u*tau)).addScaledVector(forward,h*.003)
        trim.push(line(badge,h*.0033,true),new SphereGeometry(h*.008,12,8).translate(...plate(.5,.59).addScaledVector(forward,h*.005).toArray()))
      }
      add(side>0?'Кираса · нагрудник':'Кираса · спина',plate,trim,chestJoint,gray,metal)
    }
    const belt:Skin=(u,v)=>at(waist.clone().lerp(pelvis,.7),Math.sin(u*tau)*(hipX+h*.013),h*(v-.5)*.024,Math.cos(u*tau)*(hipZ+h*.011))
    add('Пояс',belt,[line(u=>belt(u,0),h*.002,true),line(u=>belt(u,1),h*.002,true)],joint(B.Pelvis),under)
    for(const [i,side] of sides.entries()){
      const sign=i===0?1:-1,tag=i===0?'лев.':'прав.'
      const shoulder=shoulders[i],elbow=point(B.LowerArm,side),wrist=point(B.Hand,side)
      const thigh=point(B.Thigh,side),knee=point(B.Calf,side),foot=point(B.Foot,side)
      const arm=elbow.clone().sub(shoulder).normalize()
      const front=forward.clone().addScaledVector(arm,-arm.dot(forward)).normalize()
      const crown=front.clone().cross(arm).multiplyScalar(sign)
      const r=Math.max(h*.043,Math.min(span*.32,shoulder.distanceTo(elbow)*.49))*[1,1.12,1.22,.87][armor]*width
      for(let layer=0;layer<tiers;layer++){
        const plate:Skin=(u,v)=>{
          const a=(u-.5)*Math.PI*1.41,bend=Math.sin(Math.PI*(.24+.58*v))*(1-layer*.10)
          return shoulder.clone().addScaledVector(arm,r*((v-.32)*1.15*length+layer*.27+sharp*v*v))
            .addScaledVector(front,Math.sin(a)*r*bend)
            .addScaledVector(crown,r*(.39+Math.cos(a)*bend+.23*(1-v)+sharp*Math.max(0,Math.cos(a))*(1-v)**2))
        }
        add('Наплечник '+tag+' · '+(layer+1),plate,[line(u=>plate(u,1),h*.003),line(v=>plate(.5,v),h*.0024)],joint(B.UpperArm,side),gray,metal,11)
      }
      for(const [name,a,b,slot,radius] of [['Наруч',elbow,wrist,B.LowerArm,.033],['Поножа',knee,foot,B.Calf,.036]] as const){
        const shell=tube(a.clone().lerp(b,.25),a.clone().lerp(b,Math.min(.99,.28+.63*length)),(h*radius+gap*.45)*width,.70)
        add(name+' '+tag,shell,[line(u=>shell(u,.07),h*.0029,true),line(u=>shell(u,.94),h*.0024,true),line(v=>shell(0,v),h*.0024)],joint(slot,side),gray,metal)
      }
      const kneePad:Skin=(u,v)=>at(knee,h*.035*(u-.5)*2*(.59+.40*Math.sin(v*Math.PI))*width,
        h*(v-.57)*.065*length,h*(.037+.018*Math.sin(Math.PI*u)*Math.sin(Math.PI*v))+gap)
      add('Наколенник '+tag,kneePad,[line(u=>kneePad(u,1),h*.0023),line(v=>kneePad(.50,v),h*.0027)],joint(B.Calf,side),gray,metal)
      for(let n=0;n<tiers;n++){
        const upper=thigh.clone().lerp(knee,.04+n*.44/tiers)
        const drop:Skin=(u,v)=>at(upper,sign*h*.009+Math.sin((u-.5)*1.91)*h*.052*width,
          -h*.043*v*length,Math.cos((u-.5)*1.91)*(h*.052+gap)+v*h*.008)
        add('Набедренник '+tag+' · '+(n+1),drop,[line(u=>drop(u,1),h*.0027)],joint(B.Thigh,side),gray,metal,8)
      }
    }
    return result
  }
  const style=fashionCatalogue.clothing.findIndex(([name])=>name===id)
  const dress=style<2,cloak=style===3, opening=cloak?.42:0
  const bodice:Skin=(u,v)=>{
    const a=opening+u*(tau-2*opening),front=Math.cos(a)
    return at(pelvis.clone().lerp(neck,.14+.86*v),
      Math.sin(a)*rx*(.86+.32*Math.sin(v*Math.PI*.9)-.59*v**8)*(cloak?1.21:1),
      -h*(dress?.075:.036)*v**6*Math.max(0,front)**2,front*rz*(.89+.24*Math.sin(v*Math.PI)-.34*v**9))
  }
  const details=[line(u=>bodice(u,1),h*.0034,!cloak)]
  if(dress)for(const u of [.08,.18,.27,.73,.82,.92])details.push(line(v=>bodice(u,.1+.81*v),h*.0022))
  if(style===4)details.push(line(v=>bodice(0,v),h*.0038))
  else details.push(line(u=>bodice(u,.08),h*.0037,!cloak))
  add(dress?'Лиф':'Корпус',bodice,details,undefined,gray,false,24)
  if(style<4){
    const top=pelvis.clone().lerp(waist,.42),drop=(pelvis.y-body.bounds.min.y)*[.92,.98,.37,.93][style]*length
    const flare=[1.83,1.43,1.05,1.55][style],split=cloak?.73:style===2?.105:0
    const skirt:Skin=(u,v)=>{
      const a=split+u*(tau-2*split)
      const wave=Math.cos(a*[12,9,7,10][style]+Math.sin(a*3)*.37)*h*(.001+.014*v*v)
      return at(top,Math.sin(a)*(hipX*(1+(flare-1)*v)+wave),-drop*v+h*.016*v**4*Math.cos(a*2),
        Math.cos(a)*(hipZ*(1+(flare-1)*v)+wave))
    }
    const hems=[line(u=>skirt(u,1),h*.0034,!split)]
    if(split)hems.push(line(v=>skirt(0,v),h*.003),line(v=>skirt(1,v),h*.003))
    add(dress?'Юбка':cloak?'Полы плаща':'Подол',skirt,hems,undefined,gray,false,28)
    if(style===0){
      const over:Skin=(u,v)=>skirt(u,v*(.55+.17*Math.cos(2*u*tau)))
        .addScaledVector(across,h*.008*Math.sin(u*tau)).addScaledVector(forward,h*.008*Math.cos(u*tau))
      add('Верхняя юбка',over,[line(u=>over(u,1),h*.003,true)],undefined,under)
    }
  }
  if(cloak){
    const head=body.joint(B.Head)??at(neck,0,h*.076,0)
    const hood:Skin=(u,v)=>{
      const a=.77+u*(tau-1.54),bulge=.18+.86*Math.sin(Math.PI*(.21+.77*v))
      return at(neck.clone().lerp(at(head,0,h*.119,0),v),
        Math.sin(a)*h*.066*bulge*width,0,h*(Math.cos(a)*.071*bulge-.02))
    }
    add('Капюшон',hood,[line(v=>hood(0,v),h*.0032),line(v=>hood(1,v),h*.0032),line(u=>hood(u,1),h*.003)],joint(B.Head),under)
  }else for(const [i,side] of sides.entries()){
    const shoulder=shoulders[i],elbow=point(B.LowerArm,side),wrist=point(B.Hand,side)
    const start=shoulder.clone().lerp(elbow,-.34)
    const end=style===2?shoulder.clone().lerp(elbow,Math.min(.93,.67*length)):elbow.clone().lerp(wrist,Math.min(.99,.82*length))
    const sleeve=tube(start,end,(Math.max(h*.036,span*.15)+gap*.53)*width,[1.31,.94,.76,.85,.63][style],.09)
    add(i===0?'Рукав лев.':'Рукав прав.',sleeve,[line(u=>sleeve(u,1),h*.0033,true)],undefined,gray)
  }
  return result
}
