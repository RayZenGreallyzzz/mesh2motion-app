import { openImage } from './fabric-image.ts'
import { MAX_GLB_BYTES } from '../my-rigs/GlbEnvelope.ts'

export const resourceKinds = {
  fabric:{name:'Текстуры',accept:'image/png,image/jpeg,image/webp'},
  decal:{name:'Декали',accept:'.png,.webp,image/png,image/webp'},
  decor:{name:'3D-декор',accept:'.glb,model/gltf-binary'},
  pattern:{name:'Выкройки',accept:'.svg,image/svg+xml'}
} as const
export type ResourceKind = keyof typeof resourceKinds
type Resource = { id:string, kind:ResourceKind, name:string, data:Blob }

let connection:Promise<IDBDatabase>|undefined
function database(){
  if(!connection){
    connection=new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('wardrobe-studio-resources',1)
      request.onupgradeneeded=()=>{
        const store=request.result.createObjectStore('assets',{keyPath:'id'})
        store.createIndex('kind','kind')
      }
      request.onsuccess=()=>{
        request.result.onversionchange=()=>{request.result.close();connection=undefined}
        resolve(request.result)
      }
      request.onerror=()=>reject(request.error)
    }).catch(error=>{connection=undefined;throw error})
  }
  return connection
}
async function resources(kind:ResourceKind):Promise<Resource[]>{
  const db=await database()
  return new Promise((resolve,reject)=>{
    const request=db.transaction('assets','readonly').objectStore('assets').index('kind').getAll(kind)
    request.onsuccess=()=>resolve(request.result.sort((a:Resource,b:Resource)=>a.name.localeCompare(b.name,'ru')))
    request.onerror=()=>reject(request.error)
  })
}
async function write(change:(store:IDBObjectStore)=>void){
  const db=await database()
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('assets','readwrite')
    tx.oncomplete=()=>resolve()
    tx.onabort=()=>reject(tx.error??new Error('Операция с библиотекой отменена.'))
    change(tx.objectStore('assets'))
  })
}
async function validate(file:File,kind:ResourceKind){
  if(kind==='fabric'||kind==='decal'){
    if(kind==='decal'&&!/\.(png|webp)$/i.test(file.name)&&!/^image\/(png|webp)$/.test(file.type))
      throw new Error('Для декалей выберите PNG или WebP.')
    await openImage(file)
  }else if(kind==='decor'){
    if(file.size<20||file.size>MAX_GLB_BYTES)throw new Error('Размер GLB должен быть от 20 байт до 128 МБ.')
    const header=new DataView(await file.slice(0,12).arrayBuffer())
    if(header.getUint32(0,true)!==0x46546c67||header.getUint32(4,true)!==2||header.getUint32(8,true)!==file.size)
      throw new Error('Выберите корректный GLB 2.0.')
  }else{
    if(file.size>1024*1024)throw new Error('Файл выкройки SVG больше 1 МБ.')
    const root=new DOMParser().parseFromString(await file.text(),'image/svg+xml').documentElement
    if(root.localName!=='svg'||root.namespaceURI!=='http://www.w3.org/2000/svg')
      throw new Error('Выберите файл выкройки SVG.')
  }
}

export async function storeResource(file:File,kind:ResourceKind){
  await validate(file,kind)
  const id=JSON.stringify([kind,file.name,file.size,file.lastModified])
  await write(store=>store.put({id,kind,name:file.name,data:file} satisfies Resource))
}

type Actions=Partial<Record<ResourceKind,(file:File)=>void>>
export function connectResources(dialog:HTMLDialogElement, getActions:()=>Actions, cut:(file:File)=>void){
  const tabs=dialog.querySelector<HTMLElement>('.resource-tabs')!
  const list=dialog.querySelector<HTMLElement>('.resource-list')!
  const notice=dialog.querySelector<HTMLElement>('[role=status]')!
  const picker=dialog.querySelector<HTMLInputElement>('input[type=file]')!
  const add=dialog.querySelector<HTMLButtonElement>('[data-import]')!
  const urls:string[]=[]
  let kind:ResourceKind='fabric', revision=0, pick:((file:File)=>void)|undefined
  const button=(label:string,run:()=>void)=>{
    const node=document.createElement('button')
    node.type='button';node.textContent=label;node.onclick=run
    return node
  }
  const clear=()=>{list.replaceChildren();urls.splice(0).forEach(url=>URL.revokeObjectURL(url))}
  const error=(problem:unknown)=>{notice.textContent=(problem as Error).message||'Библиотека недоступна.'}
  async function render(){
    const generation=++revision, tab=kind
    clear()
    picker.accept=resourceKinds[tab].accept
    tabs.hidden=!!pick
    tabs.replaceChildren(...(Object.keys(resourceKinds) as ResourceKind[]).map(key=>{
      const node=button(resourceKinds[key].name,()=>{
        kind=key
        notice.textContent=''
        void render()
      })
      node.setAttribute('aria-pressed',String(tab===key))
      return node
    }))
    try{
      const found=await resources(tab)
      if(generation!==revision||!dialog.open)return
      if(!found.length){
        const empty=document.createElement('p');empty.textContent='Здесь пока нет файлов.';list.append(empty)
      }
      for(const resource of found){
        const row=document.createElement('div');row.className='resource-row'
        const title=document.createElement('span');title.textContent=resource.name
        if(tab==='fabric'||tab==='decal'){
          const preview=new Image()
          const url=URL.createObjectURL(resource.data);urls.push(url)
          preview.src=url;preview.alt='';preview.loading='lazy'
          row.append(preview)
        }
        const use=pick??getActions()[tab]
        const sketched=tab==='fabric'&&getActions().pattern
        const file=()=>new File([resource.data],resource.name,{type:resource.data.type})
        const apply=button(pick?'Выбрать':tab==='fabric'?'Нанести':tab==='decal'?'Поставить':'Добавить',()=>{dialog.close();use?.(file())})
        apply.disabled=!use
        const actions=document.createElement('div');actions.className='row'
        actions.append(apply)
        if(sketched)actions.append(button('Кроить',()=>{dialog.close();cut(file())}))
        actions.append(button('Удалить',()=>{
          if(!confirm('Удалить «'+resource.name+'» из библиотеки?'))return
          void write(store=>store.delete(resource.id)).then(render,error)
        }))
        row.append(title,actions);list.append(row)
      }
    }catch(problem){error(problem)}
  }
  add.onclick=()=>picker.click()
  picker.onchange=async()=>{
    const files=Array.from(picker.files??[])
    picker.value=''
    if(!files.length)return
    const tab=kind, failures:string[]=[]
    add.disabled=true
    let saved=0
    try{
      for(const file of files){
        try{
          await storeResource(file,tab);saved++
        }catch(problem){failures.push(file.name+' — '+(problem as Error).message)}
      }
      notice.textContent=[saved?'Сохранено файлов: '+saved:'',...failures].filter(Boolean).join(' · ')
      await render()
    }finally{add.disabled=false}
  }
  dialog.addEventListener('close',()=>{if(!dialog.open){revision++;clear()}})
  return (requested:ResourceKind='fabric', selected?:(file:File)=>void)=>{
    kind=requested;pick=selected;notice.textContent=''
    dialog.showModal();void render()
  }
}
