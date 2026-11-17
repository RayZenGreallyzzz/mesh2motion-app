import {
  BufferAttribute, CanvasTexture, LinearFilter, RepeatWrapping, SRGBColorSpace,
  type BufferGeometry
} from 'three'

export type LoadedImage = { image: HTMLImageElement, width: number, height: number }

export async function openImage(file:File):Promise<LoadedImage> {
  if(file.size>16*1024*1024)throw new Error('Изображение больше 16 МБ.')
  const url=URL.createObjectURL(file)
  try{
    const image=new Image()
    image.src=url
    await image.decode().catch(()=>{throw new Error('Откройте изображение PNG, JPG или WebP.')})
    if(!image.naturalWidth||!image.naturalHeight)throw new Error('У изображения нет пикселей.')
    const ratio=Math.min(1,1800/Math.max(image.naturalWidth,image.naturalHeight))
    return {image,width:Math.max(1,Math.round(image.naturalWidth*ratio)),height:Math.max(1,Math.round(image.naturalHeight*ratio))}
  }finally{ URL.revokeObjectURL(url) }
}

export function drawImage(source:LoadedImage,transparentEdge:boolean){
  const padding=transparentEdge?8:0
  const canvas=document.createElement('canvas')
  canvas.width=source.width+padding*2;canvas.height=source.height+padding*2
  const context=canvas.getContext('2d')
  if(!context)throw new Error('Не удалось подготовить изображение.')
  context.drawImage(source.image,padding,padding,source.width,source.height)
  const texture=new CanvasTexture(canvas)
  texture.colorSpace=SRGBColorSpace
  if(transparentEdge){
    texture.minFilter=LinearFilter
    texture.generateMipmaps=false
  }else texture.wrapS=texture.wrapT=RepeatWrapping
  return {texture,padding:[padding/canvas.width,padding/canvas.height] as [number,number],
    aspect:source.width/source.height}
}

export function ensureFabricUv(geometry:BufferGeometry):boolean {
  if(geometry.hasAttribute('uv'))return false
  const p=geometry.getAttribute('position')
  geometry.computeBoundingBox()
  const box=geometry.boundingBox!
  const axes=[0,1,2].sort((a,b)=>(box.max.getComponent(b)-box.min.getComponent(b))-
    (box.max.getComponent(a)-box.min.getComponent(a))).slice(0,2).sort()
  const uvs=new Float32Array(p.count*2)
  for(let i=0;i<p.count;i++)for(let j=0;j<2;j++){
    const axis=axes[j],min=box.min.getComponent(axis),range=box.max.getComponent(axis)-min
    uvs[i*2+j]=range>0?(p.getComponent(i,axis)-min)/range:0
  }
  geometry.setAttribute('uv',new BufferAttribute(uvs,2))
  return true
}
