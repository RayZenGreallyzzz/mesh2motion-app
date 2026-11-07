import type {RigAsset} from './RigAsset.ts'
import type {RigViewer} from './RigViewer.ts'
import {build_humanoid65} from './Humanoid65Builder.ts'
export async function humanoid_template():Promise<ArrayBuffer>{const response=await fetch(new URL('../rigs/rig-human.glb',location.href));if(!response.ok)throw new Error('Полный человеческий шаблон недоступен');return response.arrayBuffer()}
interface Options{viewer:RigViewer,asset():RigAsset|undefined,operation(message:string,task:()=>Promise<void>):Promise<void>,show(bytes:ArrayBuffer):Promise<void>,status(message:string,error?:boolean):void}
export class Humanoid65Panel {
  private busy=false
  private external=false
  private abort?:AbortController
  private readonly build=document.createElement('button')
  private readonly cancel=document.createElement('button')
  private readonly profile=document.createElement('select')
  constructor(container:HTMLElement,private readonly options:Options){
    const title=document.createElement('h2');title.textContent='Полный гуманоид · 65 костей'
    const info=document.createElement('p');info.className='hint';info.textContent='Тело, голова и все пальцы. Подгонка и новые веса для исходной T- или A-позы. Результат заменит открытый риг после успешной проверки.'
    const label=document.createElement('label');label.textContent='Шаблон тела ';this.profile.setAttribute('aria-label','Шаблон полного гуманоидного рига');this.profile.append(new Option('Человек / гуманоид','human'),new Option('Женский','woman'));label.append(this.profile)
    this.build.type='button';this.build.className='primary';this.build.textContent='Создать полный риг · 65 костей';this.build.onclick=()=>void this.run()
    this.cancel.type='button';this.cancel.textContent='Отменить создание рига';this.cancel.onclick=()=>this.abort?.abort();this.cancel.hidden=true
    container.append(title,info,label,this.build,this.cancel);this.refresh()
  }
  refresh(external=this.external):void{this.external=external;this.build.disabled=this.busy||external||!this.options.asset();this.profile.disabled=this.build.disabled;this.cancel.hidden=!this.busy}
  private async run():Promise<void>{
    const asset=this.options.asset();if(!asset||this.busy||this.external)return
    this.busy=true;this.abort=new AbortController();this.refresh();this.options.viewer.stop()
    try{await this.options.operation('Подготавливаю полный гуманоидный риг…',async()=>{
      const result=await build_humanoid65(asset,{template:await humanoid_template(),profile:this.profile.value as 'human'|'woman',signal:this.abort!.signal,progress:text=>this.options.status(text)})
      await this.options.show(result.bytes);this.options.status('Готов полный риг: 65 костей, включая пальцы. Проверьте голову и сгибы с анимацией перед экспортом.')
    })}finally{this.busy=false;this.abort=undefined;this.refresh()}
  }
}
