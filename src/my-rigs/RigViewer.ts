import {
  AnimationMixer, Box3, Color, GridHelper, HemisphereLight, DirectionalLight,
  PerspectiveCamera, PMREMGenerator, Scene, SkeletonHelper, Vector3, WebGLRenderer,
  Group, Mesh, MeshBasicMaterial, SphereGeometry, Plane, Raycaster, Vector2, LineSegments, BufferGeometry, Float32BufferAttribute, LineBasicMaterial, Quaternion,
  type AnimationAction, type AnimationClip, type Intersection, type Object3D, type SkinnedMesh
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls, type TransformControlsMode } from 'three/examples/jsm/controls/TransformControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { restore_rig_pose, type RigAsset } from './RigAsset.ts'
import { register_asset_renderer } from '../lib/AssetCodecs.ts'
import { joint_roles } from './RigBoneMapping.ts'
import { BoneSlot } from '../retarget/bone-automap/BoneTypes.ts'
import { StudioRoom } from './StudioRoom.ts'
import { BodyLandmarkOverlay, type BodyOverlayState } from './BodyLandmarkOverlay.ts'

export class RigViewer {
  readonly scene = new Scene()
  readonly renderer: WebGLRenderer
  private readonly camera = new PerspectiveCamera(42, 1, 0.01, 10000)
  private readonly controls: OrbitControls
  private readonly grid = new GridHelper(10, 20, 0x596579, 0x303b4c)
  private readonly body_landmarks: BodyLandmarkOverlay
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
  private readonly room: StudioRoom
  private room_asset?: RigAsset
  private framing_bounds?: Box3
  private overlay = { width: 0, height: 0, bottom: false }
  private native_change?: (name: string, point: [number, number, number]) => void
  private native_drag?: { name: string, mesh: Mesh, plane: Plane, offset: Vector3, pointer: number }
  private mesh_picker?: (hit: Intersection<Mesh>) => void
  private pick_nearby = false
  private blade_gizmo?: TransformControls
  private on_gizmo_change?: () => void
  private mesh_touch?: { pointer: number, x: number, y: number }
  on_time: (time: number, duration: number) => void = () => {}

  constructor (container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false })
    register_asset_renderer(this.renderer)
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    container.append(this.renderer.domElement)
    this.body_landmarks = new BodyLandmarkOverlay(container, this.camera)
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
    this.room = new StudioRoom(this.scene); this.room.set_visible(true); this.grid.visible = false
    this.scene.add(this.native_markers)
    const canvas = this.renderer.domElement, ray = new Raycaster()
    const touches = new Set<number>()
    let gizmo_pinch = false
    const pointer = (event: PointerEvent): void => {
      const r = canvas.getBoundingClientRect()
      ray.setFromCamera(new Vector2((event.clientX - r.left) / r.width * 2 - 1, 1 - (event.clientY - r.top) / r.height * 2), this.camera)
    }
    canvas.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') {
        touches.add(event.pointerId)
        if (touches.size > 1 && this.blade_gizmo?.enabled) {
          this.blade_gizmo.pointerUp(null)
          this.blade_gizmo.enabled = false
          gizmo_pinch = true
        }
      }
      if (this.mesh_picker) {
        this.mesh_touch = event.isPrimary && event.button === 0
          ? { pointer: event.pointerId, x: event.clientX, y: event.clientY } : undefined
        return
      }
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
      if (this.mesh_touch?.pointer === event.pointerId &&
          Math.hypot(this.mesh_touch.x - event.clientX, this.mesh_touch.y - event.clientY) > 12) this.mesh_touch = undefined
      const drag = this.native_drag; if (!drag || drag.pointer !== event.pointerId) return
      pointer(event); const hit = ray.ray.intersectPlane(drag.plane, new Vector3())
      if (hit) { drag.mesh.position.copy(hit.add(drag.offset)); this.native_change?.(drag.name, [-hit.x, hit.y, hit.z]) }
      event.preventDefault(); event.stopImmediatePropagation()
    }, true)
    const finish = (event: PointerEvent): void => {
      touches.delete(event.pointerId)
      if (gizmo_pinch && !touches.size) {
        gizmo_pinch = false
        queueMicrotask(() => { if (this.blade_gizmo?.object) this.blade_gizmo.enabled = true })
      }
      const touch = this.mesh_touch
      if (touch?.pointer === event.pointerId) {
        this.mesh_touch = undefined
        if (event.type === 'pointerup' && Math.hypot(touch.x - event.clientX, touch.y - event.clientY) < 12 && this.asset) {
          pointer(event)
          const find = () => ray.intersectObject(this.asset!.scene, true).find(item => item.face && (item.object as Mesh).isMesh)
          let hit = find()
          if (!hit && this.pick_nearby) {
            const center = ray.ray.clone(), rect = canvas.getBoundingClientRect()
            for (const offset of [-12, 12, -24, 24]) {
              ray.setFromCamera(new Vector2((event.clientX + offset - rect.left) / rect.width * 2 - 1,
                1 - (event.clientY - rect.top) / rect.height * 2), this.camera)
              hit = find()
              if (hit) {
                const plane = new Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new Vector3()), hit.point)
                const point = center.intersectPlane(plane, new Vector3())
                if (point) hit = { ...hit, point }
                break
              }
            }
          }
          if (hit) this.mesh_picker?.(hit as Intersection<Mesh>)
        }
        return
      }
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
      this.apply_overlay()
      this.camera.updateProjectionMatrix()
      if (this.asset) this.fit(true, false)
    }).observe(container)
    this.renderer.setAnimationLoop(time => {
      if (this.suspended) { this.previous = 0; return }
      const delta = this.previous ? Math.min((time - this.previous) / 1000, 0.1) : 0
      this.previous = time
      if (this.playing) this.mixer?.update(delta * this.speed)
      this.follow_motion()
      if (this.action) this.on_time(this.action.time, this.action.getClip().duration)
      if (this.controls.enabled) this.controls.update()
      this.renderer.render(this.scene, this.camera)
      this.body_landmarks.project()
    })
  }

  set_asset (asset: RigAsset): void {
    this.body_landmarks.update()
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

  fit (preserve_view = false, measure = true): void {
    if (!this.asset) return
    let bounds = this.framing_bounds
    // A layout change can reuse the bounds while the model stays in its rest pose.
    if (measure || this.action || !bounds) {
      this.asset.scene.updateWorldMatrix(true, true)
      this.asset.scene.traverse(object => { const mesh = object as SkinnedMesh; if (mesh.isSkinnedMesh) mesh.computeBoundingBox() })
      const measured = new Box3().setFromObject(this.asset.scene)
      // Skeleton-only files have no geometry to frame.
      if (measured.isEmpty()) this.asset.nodes.forEach(node => measured.expandByPoint(node.object.getWorldPosition(new Vector3())))
      if (measured.isEmpty()) measured.setFromCenterAndSize(new Vector3(), new Vector3(1, 1, 1))
      bounds = this.framing_bounds = measured
    }
    if (this.room_asset !== this.asset) { this.room.configure(bounds); this.room_asset = this.asset }
    const frame = bounds.clone()
    const stage_radius = this.room.visible ? this.room.stage_radius : 0
    const floor = this.room.group.position.y
    // Leave room below the stage for the playback bar.
    if (this.room.visible) frame.min.y = Math.min(frame.min.y, floor - stage_radius * 0.18)
    const center = frame.getCenter(new Vector3())
    const stage_frame_radius = this.room.visible ? Math.hypot(stage_radius, center.y - floor) : 0
    const radius = Math.max(frame.getSize(new Vector3()).length() * 0.5, stage_frame_radius, 0.1)
    const width = this.renderer.domElement.clientWidth || 1, height = this.renderer.domElement.clientHeight || 1
    const free_width = Math.max(width - (this.overlay.bottom ? 0 : this.overlay.width), width * 0.18)
    const free_height = Math.max(height - (this.overlay.bottom ? this.overlay.height : 0), height * 0.18)
    const aspect = Math.min(free_width / height, free_height / height, 1)
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
    if (this.room.visible) this.grid.position.y = this.room.group.position.y + radius * 0.001
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
    this.framing_bounds = undefined
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
  set_mesh_picker (picker?: (hit: Intersection<Mesh>) => void, nearby = false): void {
    this.mesh_picker = picker
    this.pick_nearby = nearby
    this.mesh_touch = undefined
    this.renderer.domElement.style.cursor = picker ? 'crosshair' : ''
  }
  edit_gizmo (target?: Object3D, mode: TransformControlsMode = 'translate', change?: () => void): void {
    if (!target) {
      if (this.blade_gizmo) { this.blade_gizmo.detach(); this.blade_gizmo.enabled = false }
      this.on_gizmo_change = undefined
      this.controls.enabled = true
      return
    }
    if (!this.blade_gizmo) {
      const gizmo = this.blade_gizmo = new TransformControls(this.camera, this.renderer.domElement)
      gizmo.setSize(.85); gizmo.setSpace('local')
      gizmo.addEventListener('dragging-changed', event => { this.controls.enabled = !event.value })
      gizmo.addEventListener('objectChange', () => this.on_gizmo_change?.())
      this.scene.add(gizmo.getHelper())
    }
    this.on_gizmo_change = change
    this.blade_gizmo.enabled = true
    this.blade_gizmo.setMode(mode)
    this.blade_gizmo.attach(target)
  }
  camera_rotation (): Quaternion { return this.camera.getWorldQuaternion(new Quaternion()) }
  view_direction (x: number, y: number, z: number): Vector3 {
    return new Vector3(x, y, z).applyQuaternion(this.camera.quaternion)
  }
  model_size (): number {
    if (!this.asset) return 0
    const size = new Box3().setFromObject(this.asset.scene).getSize(new Vector3())
    return Math.max(size.x, size.y, size.z)
  }
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
      const marker = new Mesh(new SphereGeometry(radius, 12, 8), new MeshBasicMaterial({ color: name === 'head' ? 0x62d9ff : name === 'head_end' ? 0xd69aff : name.endsWith('_l') ? 0x6ee7a8 : name.endsWith('_r') ? 0xf3a0cf : 0xffd47b, depthTest: false }))
      marker.name = name; marker.position.set(-x, y, z); marker.renderOrder = 1000; this.native_markers.add(marker)
    }
  }

  set_body_landmarks(state?: BodyOverlayState): void { this.body_landmarks.update(state) }

  native_view(side: boolean, yaw = 0): void {
    if (!this.asset) return
    const distance = this.camera.position.distanceTo(this.controls.target)
    const axis = (side ? new Vector3(distance, 0, 0) : new Vector3(0, 0, distance)).applyAxisAngle(new Vector3(0, 1, 0), yaw)
    this.camera.position.copy(this.controls.target).add(axis)
    this.camera.lookAt(this.controls.target); this.controls.update()
  }

  focus_points(points: Array<[number, number, number]>): void {
    if (!points.length || points.some(p => !p.every(Number.isFinite))) return
    const bounds = new Box3().setFromPoints(points.map(p => new Vector3(...p))), center = bounds.getCenter(new Vector3())
    const radius = Math.max(bounds.getSize(new Vector3()).length() * .8, .0001)
    const width = this.renderer.domElement.clientWidth || 1, height = this.renderer.domElement.clientHeight || 1
    const freeWidth = Math.max(width - (this.overlay.bottom ? 0 : this.overlay.width), width * .18), freeHeight = Math.max(height - (this.overlay.bottom ? this.overlay.height : 0), height * .18)
    const distance = radius / Math.sin(this.camera.fov * Math.PI / 360) / Math.min(freeWidth / height, freeHeight / height, 1) * 1.15
    const direction = this.camera.position.clone().sub(this.controls.target).normalize()
    this.camera.position.copy(center).addScaledVector(direction, distance); this.controls.target.copy(center)
    this.camera.near = Math.max(radius / 1000, .000001); this.camera.far = Math.max(distance * 10, 100); this.camera.updateProjectionMatrix(); this.controls.update()
    this.follow_node?.getWorldPosition(this.follow_anchor)
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

  set_room_enabled(value: boolean): void { this.room.set_visible(value); this.fit(true, false) }
  set_grid_visible(value: boolean): void { this.grid.visible = value }
  set_settings_overlay(width: number, height: number, bottom: boolean, refit = true): void {
    const changed = Math.abs(this.overlay.width - width) > 8 || Math.abs(this.overlay.height - height) > 8 || this.overlay.bottom !== bottom
    this.overlay = { width, height, bottom }; this.apply_overlay(); if (changed && refit) this.fit(true, false)
  }
  private apply_overlay(): void {
    const width = this.renderer.domElement.clientWidth, height = this.renderer.domElement.clientHeight
    if (!width || !height) return
    if (this.overlay.width || this.overlay.height) this.camera.setViewOffset(width, height, this.overlay.bottom ? 0 : this.overlay.width / 2, this.overlay.bottom ? this.overlay.height / 2 : 0, width, height)
    else this.camera.clearViewOffset()
  }
}

