import { AnimationMixer, Box3, Color, DirectionalLight, GridHelper, Group, HemisphereLight, Mesh, PerspectiveCamera,
  Raycaster, Scene, Vector2, Vector3, WebGLRenderer, type AnimationAction, type Intersection, type Object3D } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls, type TransformControlsMode } from 'three/examples/jsm/controls/TransformControls.js'
import { register_asset_renderer } from '../lib/AssetCodecs.ts'
import { restore_rig_pose, type RigAsset } from '../my-rigs/RigAsset.ts'

type Painter = { meshes:()=>Mesh[], begin:()=>void, stroke:(hit:Intersection<Mesh>)=>void, end:()=>void }

export class FittingView {
  readonly scene=new Scene()
  readonly edited=new Group()
  readonly dressed=new Group()
  readonly renderer=new WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'})
  private readonly camera=new PerspectiveCamera(39,1,.005,1000)
  private readonly orbit:OrbitControls
  private readonly gizmo:TransformControls
  private readonly grid=new GridHelper(9,28,0x47556e,0x273248)
  private readonly ray=new Raycaster()
  private readonly cursor=new Vector2()
  private asset?:RigAsset
  private mixer?:AnimationMixer
  private action?:AnimationAction
  private painter?:Painter
  private stroke?:{id:number,x:number,y:number}
  private changed?:()=>void
  private clip=-1
  private previous=0
  onTime:(time:number,length:number)=>void=()=>{}

  constructor (container:HTMLElement) {
    register_asset_renderer(this.renderer)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7))
    const canvas=this.renderer.domElement
    canvas.setAttribute('aria-label','3D-примерочная. Один палец вращает, два пальца приближают.')
    container.append(canvas)
    this.orbit=new OrbitControls(this.camera,canvas)
    this.orbit.enableDamping=true
    this.gizmo=new TransformControls(this.camera,canvas)
    this.gizmo.setSize(.72)
    this.gizmo.setSpace('world')
    this.gizmo.addEventListener('dragging-changed',e=>{ this.orbit.enabled=!e.value })
    this.gizmo.addEventListener('objectChange',()=>this.changed?.())
    this.gizmo.enabled=false
    this.scene.background=new Color(0x131d2e)
    const key=new DirectionalLight(0xffebd4,3), fill=new DirectionalLight(0x9adaa9,1.3)
    key.position.set(3,4,5);fill.position.set(-3,3,-2)
    this.scene.add(this.edited,this.dressed,this.gizmo.getHelper(),this.grid,new HemisphereLight(0xe6f3ff,0x475071,2.25),key,fill)
    this.camera.position.set(1.5,1.25,3)
    const active=new Set<number>()
    const sample=(e:PointerEvent) => {
      const r=canvas.getBoundingClientRect()
      this.cursor.set((e.clientX-r.left)*2/r.width-1,1-(e.clientY-r.top)*2/r.height)
      this.ray.setFromCamera(this.cursor,this.camera)
      this.scene.updateMatrixWorld(true)
      const hit=this.ray.intersectObjects(this.painter!.meshes(),false).find(result=>result.face)
      if(hit)this.painter?.stroke(hit as Intersection<Mesh>)
    }
    canvas.addEventListener('pointerdown',e=>{
      active.add(e.pointerId)
      if(!this.painter||e.button!==0)return
      if(active.size>1){if(this.stroke && canvas.hasPointerCapture(this.stroke.id))canvas.releasePointerCapture(this.stroke.id);this.stopStroke();return}
      this.stroke={id:e.pointerId,x:e.clientX,y:e.clientY};this.orbit.enabled=false
      canvas.setPointerCapture(e.pointerId);this.painter.begin();sample(e)
      e.preventDefault();e.stopImmediatePropagation()
    },true)
    canvas.addEventListener('pointermove',e=>{
      const stroke=this.stroke
      if(stroke?.id!==e.pointerId)return
      if(Math.hypot(e.clientX-stroke.x,e.clientY-stroke.y)<5)return
      stroke.x=e.clientX;stroke.y=e.clientY;sample(e)
      e.preventDefault();e.stopImmediatePropagation()
    },true)
    for(const event of ['pointerup','pointercancel','lostpointercapture'] as const)
      canvas.addEventListener(event,e=>{
        active.delete(e.pointerId)
        if(this.stroke?.id===e.pointerId)this.stopStroke()
      },true)
    new ResizeObserver(()=>{
      if(!container.clientWidth||!container.clientHeight)return
      this.camera.aspect=container.clientWidth/container.clientHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(container.clientWidth,container.clientHeight)
    }).observe(container)
    this.renderer.setAnimationLoop(time=>{
      const delta=this.previous ? Math.min(.06,(time-this.previous)/1000) : 0
      this.previous=time
      this.mixer?.update(delta)
      if(this.action)this.onTime(this.action.time,this.action.getClip().duration)
      this.orbit.update()
      this.renderer.render(this.scene,this.camera)
    })
  }

  private stopStroke () {
    if(!this.stroke)return
    this.stroke=undefined;this.orbit.enabled=true;this.painter?.end()
  }

  setAsset (asset:RigAsset,bounds:Box3) {
    this.rest()
    this.asset?.scene.removeFromParent()
    this.asset=asset;this.scene.add(asset.scene)
    this.mixer=new AnimationMixer(asset.scene);this.clip=-1
    this.grid.position.y=bounds.min.y-.015
    this.grid.scale.setScalar(Math.max(.03,bounds.getSize(new Vector3()).y*.55))
    this.frame(bounds)
  }

  frame (bounds:Box3, side=false) {
    const center=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3())
    const distance=Math.max(size.y,size.x/Math.max(.62,this.camera.aspect))*1.66
    const dir=side?new Vector3(1,.06,0):new Vector3(.22,.10,1)
    this.camera.position.copy(center).addScaledVector(dir.normalize(),distance)
    this.camera.near=Math.max(distance/1000,.00001)
    this.camera.far=Math.max(distance*100,1)
    this.camera.updateProjectionMatrix()
    this.orbit.target.copy(center);this.orbit.update()
  }

  rest () {
    this.mixer?.stopAllAction();this.action=undefined;this.clip=-1
    if(this.asset)restore_rig_pose(this.asset)
  }

  play (index:number,time=0,paused=false) {
    this.rest()
    const clip=this.asset?.clips[index]
    if(!clip||!this.mixer)return
    this.clip=index;this.action=this.mixer.clipAction(clip).play()
    this.action.time=Math.min(time,clip.duration)
    this.action.paused=paused;this.mixer.update(0)
    this.onTime(this.action.time,clip.duration)
  }

  current () { return {index:this.clip,time:this.action?.time??0,paused:this.action?.paused??false} }
  pause () { if(this.action)this.action.paused=!this.action.paused;return this.action?.paused??true }
  seek (at:number) { if(this.action&&this.mixer){this.action.time=at;this.mixer.update(0)} }

  move (object?:Object3D,mode:TransformControlsMode='translate',changed?:()=>void) {
    this.changed=changed
    this.gizmo.detach()
    this.gizmo.enabled=!!object
    this.orbit.enabled=true
    if(object){this.gizmo.setMode(mode);this.gizmo.attach(object)}
  }

  paint (painter?:Painter) {
    this.stopStroke()
    this.painter=painter
    this.renderer.domElement.style.cursor=painter?'crosshair':''
  }
}
