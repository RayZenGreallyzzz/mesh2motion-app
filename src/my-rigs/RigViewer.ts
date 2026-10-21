import {
  AnimationMixer, Box3, Color, GridHelper, HemisphereLight, DirectionalLight,
  PerspectiveCamera, PMREMGenerator, Scene, SkeletonHelper, Vector3, WebGLRenderer,
  type AnimationAction
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { restore_rig_pose, type RigAsset } from './RigAsset.ts'

export class RigViewer {
  readonly scene = new Scene()
  readonly renderer: WebGLRenderer
  private readonly camera = new PerspectiveCamera(42, 1, 0.01, 10000)
  private readonly controls: OrbitControls
  private readonly grid = new GridHelper(10, 20, 0x596579, 0x303b4c)
  private mixer?: AnimationMixer
  private action?: AnimationAction
  private asset?: RigAsset
  private helper?: SkeletonHelper
  private playing = false
  private speed = 1
  private previous = 0
  on_time: (time: number, duration: number) => void = () => {}

  constructor (container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    container.append(this.renderer.domElement)
    this.renderer.domElement.setAttribute('aria-label', 'Предпросмотр персонажа; поворот одним пальцем, масштаб двумя')
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.scene.background = new Color(0x151d2b)
    const environment = new RoomEnvironment()
    const generator = new PMREMGenerator(this.renderer)
    this.scene.environment = generator.fromScene(environment).texture
    environment.dispose()
    generator.dispose()
    this.scene.add(new HemisphereLight(0xc2d9ff, 0x43434e, 2))
    const light = new DirectionalLight(0xffe8cb, 3)
    light.position.set(3, 6, 5)
    this.scene.add(light, this.grid)
    new ResizeObserver(() => {
      const width = container.clientWidth, height = container.clientHeight
      if (!width || !height) return
      this.renderer.setSize(width, height)
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
    }).observe(container)
    this.renderer.setAnimationLoop(time => {
      const delta = this.previous ? Math.min((time - this.previous) / 1000, 0.1) : 0
      this.previous = time
      if (this.playing) this.mixer?.update(delta * this.speed)
      if (this.action) this.on_time(this.action.time, this.action.getClip().duration)
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    })
  }

  set_asset (asset: RigAsset): void {
    this.stop()
    if (this.asset) {
      this.mixer?.uncacheRoot(this.asset.scene)
      this.asset.scene.removeFromParent()
    }
    if (this.helper) {
      this.helper.removeFromParent()
      this.helper.dispose()
    }
    this.asset = asset
    this.scene.add(asset.scene)
    this.mixer = new AnimationMixer(asset.scene)
    this.helper = new SkeletonHelper(asset.scene)
    this.helper.visible = false
    this.scene.add(this.helper)
    this.fit()
  }

  fit (): void {
    if (!this.asset) return
    const bounds = new Box3().setFromObject(this.asset.scene)
    // Skeleton-only files have no geometry to frame.
    if (bounds.isEmpty()) this.asset.nodes.forEach(node => bounds.expandByPoint(node.object.getWorldPosition(new Vector3())))
    if (bounds.isEmpty()) bounds.setFromCenterAndSize(new Vector3(), new Vector3(1, 1, 1))
    const center = bounds.getCenter(new Vector3())
    const radius = Math.max(bounds.getSize(new Vector3()).length() * 0.5, 0.1)
    const aspect = Math.min(this.camera.aspect, 1)
    const distance = radius / Math.sin(this.camera.fov * Math.PI / 360) / aspect * 1.15
    this.camera.position.copy(center).add(new Vector3(0.55, 0.28, 1).normalize().multiplyScalar(distance))
    this.camera.near = Math.max(radius / 1000, 0.0001)
    this.camera.far = Math.max(distance * 10, 100)
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(center)
    this.grid.position.set(center.x, bounds.min.y - radius * 0.01, center.z)
    this.grid.scale.setScalar(radius * 0.4)
    this.controls.update()
  }

  play (index: number): void {
    this.stop()
    if (!this.asset || !this.mixer || !this.asset.clips[index]) return
    this.action = this.mixer.clipAction(this.asset.clips[index])
    this.action.reset().play()
    this.mixer.update(0)
    this.playing = true
  }

  stop (): void {
    this.mixer?.stopAllAction()
    if (this.asset) restore_rig_pose(this.asset)
    this.action = undefined
    this.playing = false
    this.on_time(0, 0)
  }

  toggle_pause (): boolean {
    if (this.action) this.playing = !this.playing
    return this.playing
  }

  seek (time: number): void {
    if (!this.action || !this.mixer) return
    this.action.time = time
    this.mixer.update(0)
  }

  set_speed (value: number): void { this.speed = value }
  show_skeleton (value: boolean): void { if (this.helper) this.helper.visible = value }
}
