import {
  AnimationMixer, Box3, Color, GridHelper, HemisphereLight, DirectionalLight,
  PerspectiveCamera, PMREMGenerator, Scene, SkeletonHelper, Vector3, WebGLRenderer,
  Group, Mesh, MeshBasicMaterial, SphereGeometry, Plane, Raycaster, Vector2, LineSegments, BufferGeometry, Float32BufferAttribute, LineBasicMaterial,
  type AnimationAction, type AnimationClip, type Object3D, type SkinnedMesh
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { restore_rig_pose, type RigAsset } from './RigAsset.ts'
import { register_asset_renderer } from '../lib/AssetCodecs.ts'
import { joint_roles } from './RigBoneMapping.ts'
import { BoneSlot } from '../retarget/bone-automap/BoneTypes.ts'

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
  private suspended = false
  private follow_enabled = true
  private follow_node?: Object3D
  private readonly follow_anchor = new Vector3()
  private readonly follow_position = new Vector3()
  private readonly native_markers = new Group()
  private native_bones?: LineSegments<BufferGeometry, LineBasicMaterial>
  private native_change?: (name: string, point: [number, number, number]) => void
  private native_drag?: { name: string, mesh: Mesh, plane: Plane, offset: Vector3, pointer: number }
  on_time: (time: number, duration: number) => void = () => {}

  constructor (container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false })
    register_asset_renderer(this.renderer)
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
    this.scene.add(this.native_markers)
    const canvas = this.renderer.domElement, ray = new Raycaster()
    const pointer = (event: PointerEvent): void => {
      const r = canvas.getBoundingClientRect()
      ray.setFromCamera(new Vector2((event.clientX - r.left) / r.width * 2 - 1, 1 - (event.clientY - r.top) / r.height * 2), this.camera)
    }
    canvas.addEventListener('pointerdown', event => {
      if (!this.native_change || !this.native_markers.children.length) return
      const rect = canvas.getBoundingClientRect(); let target: Mesh | undefined, distance = 24 * 24
      for (const child of this.native_markers.children) {
        const p = child.getWorldPosition(new Vector3()).project(this.camera)
        const d = ((p.x + 1) * rect.width / 2 + rect.left - event.clientX) ** 2 + ((1 - p.y) * rect.height / 2 + rect.top - event.clientY) ** 2
        if (p.z >= -1 && p.z <= 1 && d < distance) { target = child as Mesh; distance = d }
      }
      if (!target) return
      pointer(event)
      const plane = new Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new Vector3()), target.position), hit = ray.ray.intersectPlane(plane, new Vector3())
      if (!hit) return
      this.native_drag = { name: target.name, mesh: target, plane, offset: target.position.clone().sub(hit), pointer: event.pointerId }
      this.controls.enabled = false; canvas.setPointerCapture(event.pointerId); event.preventDefault(); event.stopImmediatePropagation()
    }, true)
    canvas.addEventListener('pointermove', event => {
      const drag = this.native_drag; if (!drag || drag.pointer !== event.pointerId) return
      pointer(event); const hit = ray.ray.intersectPlane(drag.plane, new Vector3())
      if (hit) { drag.mesh.position.copy(hit.add(drag.offset)); this.native_change?.(drag.name, [-hit.x, hit.y, hit.z]) }
      event.preventDefault(); event.stopImmediatePropagation()
    }, true)
    const finish = (event: PointerEvent): void => {
      if (!this.native_drag || this.native_drag.pointer !== event.pointerId) return
      this.native_drag = undefined; this.controls.enabled = true; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      event.preventDefault(); event.stopImmediatePropagation()
    }
    canvas.addEventListener('pointerup', finish, true); canvas.addEventListener('pointercancel', finish, true)
    new ResizeObserver(() => {
      const width = container.clientWidth, height = container.clientHeight
      if (!width || !height) return
      this.renderer.setSize(width, height)
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
    }).observe(container)
    this.renderer.setAnimationLoop(time => {
      if (this.suspended) { this.previous = 0; return }
      const delta = this.previous ? Math.min((time - this.previous) / 1000, 0.1) : 0
      this.previous = time
      if (this.playing) this.mixer?.update(delta * this.speed)
      this.follow_motion()
      if (this.action) this.on_time(this.action.time, this.action.getClip().duration)
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    })
  }

  set_asset (asset: RigAsset): void {
    this.set_native_points({})
    this.set_native_bones([])
    this.stop(false)
    if (this.asset) {
      this.mixer?.uncacheRoot(this.asset.scene)
      this.asset.scene.removeFromParent()
    }
    if (this.helper) {
      this.helper.removeFromParent()
      this.helper.dispose()
    }
    this.asset = asset
    // Animated skin may leave the cached bind-pose bounding sphere.
    asset.scene.traverse(object => { if ((object as SkinnedMesh).isSkinnedMesh) object.frustumCulled = false })
    const roles = joint_roles(asset)
    const anchor = [...roles].find(([, role]) => role.slot === BoneSlot.Pelvis) ?? [...roles].find(([, role]) => role.slot === 'root') ?? [...roles][0]
    this.follow_node = anchor ? asset.nodes.get(anchor[0])?.object : undefined
    this.scene.add(asset.scene)
    this.mixer = new AnimationMixer(asset.scene)
    this.helper = new SkeletonHelper(asset.scene)
    this.helper.visible = false
    this.scene.add(this.helper)
    this.fit()
  }

  fit (preserve_view = false): void {
    if (!this.asset) return
    this.asset.scene.updateWorldMatrix(true, true)
    this.asset.scene.traverse(object => { const mesh = object as SkinnedMesh; if (mesh.isSkinnedMesh) mesh.computeBoundingBox() })
    const bounds = new Box3().setFromObject(this.asset.scene)
    // Skeleton-only files have no geometry to frame.
    if (bounds.isEmpty()) this.asset.nodes.forEach(node => bounds.expandByPoint(node.object.getWorldPosition(new Vector3())))
    if (bounds.isEmpty()) bounds.setFromCenterAndSize(new Vector3(), new Vector3(1, 1, 1))
    const center = bounds.getCenter(new Vector3())
    const radius = Math.max(bounds.getSize(new Vector3()).length() * 0.5, 0.1)
    const aspect = Math.min(this.camera.aspect, 1)
    const distance = radius / Math.sin(this.camera.fov * Math.PI / 360) / aspect * 1.15
    const direction = preserve_view ? this.camera.position.clone().sub(this.controls.target).normalize() : new Vector3(0.55, 0.28, 1).normalize()
    this.camera.position.copy(center).add(direction.multiplyScalar(distance))
    this.camera.near = Math.max(radius / 1000, 0.0001)
    this.camera.far = Math.max(distance * 10, 100)
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(center)
    this.grid.position.set(center.x, bounds.min.y - radius * 0.01, center.z)
    this.grid.scale.setScalar(radius * 0.4)
    this.controls.update()
    this.follow_node?.getWorldPosition(this.follow_anchor)
  }

  play (index: number): void {
    if (!this.asset || !this.mixer || !this.asset.clips[index]) { this.stop(); return }
    this.play_clip(this.asset.clips[index])
  }

  play_clip (clip: AnimationClip): void {
    this.stop(false)
    if (!this.asset || !this.mixer) return
    this.action = this.mixer.clipAction(clip)
    this.action.reset().play()
    this.mixer.update(0)
    this.fit(true)
    this.on_time(0, clip.duration)
    this.playing = true
  }

  stop (refit = true): void {
    const oldClip = this.action?.getClip()
    this.mixer?.stopAllAction()
    if (oldClip) this.mixer?.uncacheClip(oldClip)
    if (this.asset) restore_rig_pose(this.asset)
    if (refit && oldClip) this.fit(true)
    else this.follow_motion()
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
    this.follow_motion()
    this.on_time(this.action.time, this.action.getClip().duration)
  }

  private follow_motion (): void {
    if (!this.follow_node) return
    this.follow_node.getWorldPosition(this.follow_position)
    if (this.follow_enabled) {
      const dx = this.follow_position.x - this.follow_anchor.x, dy = this.follow_position.y - this.follow_anchor.y, dz = this.follow_position.z - this.follow_anchor.z
      this.camera.position.x += dx; this.camera.position.y += dy; this.camera.position.z += dz
      this.controls.target.x += dx; this.controls.target.y += dy; this.controls.target.z += dz
    }
    this.follow_anchor.copy(this.follow_position)
  }

  set_follow (enabled: boolean): void { this.follow_enabled = enabled; if (enabled) this.fit(true) }

  set_speed (value: number): void { this.speed = value }
  set_suspended (value: boolean): void { this.suspended = value; this.previous = 0 }
  show_skeleton (value: boolean): void { if (this.helper) this.helper.visible = value }

  set_native_points(points: Record<string, [number, number, number]>, change?: (name: string, point: [number, number, number]) => void): void {
    this.native_drag = undefined; this.controls.enabled = true; this.native_change = change
    for (const child of [...this.native_markers.children]) {
      const mesh = child as Mesh<SphereGeometry, MeshBasicMaterial>; mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose()
    }
    if (!this.asset) return
    const bounds = new Box3().setFromObject(this.asset.scene), radius = Math.max(bounds.getSize(new Vector3()).length() / 150, 0.000001)
    for (const [name, [x, y, z]] of Object.entries(points)) {
      const marker = new Mesh(new SphereGeometry(radius, 12, 8), new MeshBasicMaterial({ color: name.endsWith('_l') ? 0x6ee7a8 : name.endsWith('_r') ? 0xf3a0cf : 0xffd47b, depthTest: false }))
      marker.name = name; marker.position.set(-x, y, z); marker.renderOrder = 1000; this.native_markers.add(marker)
    }
  }

  native_view(side: boolean): void {
    if (!this.asset) return
    const distance = this.camera.position.distanceTo(this.controls.target)
    this.camera.position.copy(this.controls.target).add(side ? new Vector3(distance, 0, 0) : new Vector3(0, 0, distance))
    this.camera.lookAt(this.controls.target); this.controls.update()
  }

  set_native_bones(bones: unknown[]): void {
    if (this.native_bones) { this.native_bones.removeFromParent(); this.native_bones.geometry.dispose(); this.native_bones.material.dispose(); this.native_bones = undefined }
    if (!bones.length) return
    const points = bones.map(value => {
      const b = value as { name?: unknown, parent?: unknown, rigPosition?: unknown }, p = b.rigPosition
      if (typeof b.name !== 'string' || !Array.isArray(p) || p.length !== 3 || p.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('Непонятные координаты скелета в ответе движка.')
      return { name: b.name, parent: b.parent, point: new Vector3(-p[0], p[1], p[2]) }
    })
    const positions: number[] = []
    points.forEach(bone => {
      const parent = typeof bone.parent === 'number' ? points[bone.parent] : points.find(p => p.name === bone.parent)
      if (parent) positions.push(...parent.point.toArray(), ...bone.point.toArray())
    })
    if (!positions.length) throw new Error('Движок не вернул связи между костями.')
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3))
    this.native_bones = new LineSegments(geometry, new LineBasicMaterial({ color: 0x8eeaff, depthTest: false })); this.native_bones.renderOrder = 999; this.scene.add(this.native_bones)
  }
}

