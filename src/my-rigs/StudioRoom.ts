import {
  Box3, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, MirroredRepeatWrapping, PlaneGeometry, RepeatWrapping,
  SRGBColorSpace, TextureLoader, Vector3, type Scene, type Texture, type Wrapping
} from 'three'

export function room_layout(bounds: Box3) {
  const size = bounds.getSize(new Vector3()), unit = Math.max(size.y, size.length() * 0.65, 0.0001)
  const stage_top = bounds.min.y - unit * 0.001
  const step_height = unit * 0.075
  const stage_radius = Math.max(unit * 0.54, Math.hypot(size.x, size.z) / 2 + unit * 0.06)
  return {
    center: bounds.getCenter(new Vector3()), unit, extent: unit * 9, height: unit * 5,
    floor: stage_top - 2 * step_height, stage_top, step_height,
    stage_radius, base_radius: stage_radius + unit * 0.16
  }
}

function fallback_stone(): CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#4e514e'; ctx.fillRect(0, 0, 512, 256)
  for (let row = 0; row < 8; row++) for (let col = -1; col < 7; col++) {
    const x = col * 88 + (row % 2) * 44, y = row * 32, shade = 104 + ((row * 43 + col * 17 + 200) % 37)
    ctx.fillStyle = `rgb(${shade + 5},${shade + 3},${shade - 1})`; ctx.fillRect(x + 2, y + 2, 84, 28)
    ctx.fillStyle = '#ffffff16'; ctx.fillRect(x + 3, y + 2, 82, 2); ctx.fillStyle = '#00000020'; ctx.fillRect(x + 3, y + 28, 82, 2)
  }
  return new CanvasTexture(canvas)
}

function tile(texture: Texture, repeat: [number, number], wrapping: Wrapping): Texture {
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = texture.wrapT = wrapping
  texture.repeat.set(...repeat)
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

function stage_geometry(): CylinderGeometry {
  const geometry = new CylinderGeometry(1, 1, 1, 64)
  const uv = geometry.attributes.uv
  const normal = geometry.attributes.normal
  // Keep the cap mapped across the image and give the low riser a narrow strip.
  for (let index = 0; index < uv.count; index++) {
    if (Math.abs(normal.getY(index)) < 0.5) {
      uv.setXY(index, uv.getX(index) * 4, uv.getY(index) * 0.12)
    }
  }
  return geometry
}

/** Display scenery belongs to the viewer scene, never to the exported rig scene. */
export class StudioRoom {
  readonly group = new Group()
  private readonly geometry = new PlaneGeometry(1, 1)
  private readonly wall_material = new MeshStandardMaterial({ map: tile(fallback_stone(), [10, 4], RepeatWrapping), color: 0xc9c9c0, roughness: 1 })
  private readonly floor_material = new MeshStandardMaterial({ map: tile(fallback_stone(), [12, 12], MirroredRepeatWrapping), roughness: 0.95 })
  private readonly marble_material = new MeshStandardMaterial({ color: 0x226343, roughness: 0.34 })
  private readonly floor = new Mesh(this.geometry, this.floor_material)
  private readonly ceiling = new Mesh(this.geometry, new MeshStandardMaterial({ color: 0xabad9f, roughness: 1, metalness: 0 }))
  private readonly walls = Array.from({ length: 4 }, () => new Mesh(this.geometry, this.wall_material))
  private readonly cylinder = stage_geometry()
  private readonly lower_step = new Mesh(this.cylinder, this.marble_material)
  private readonly upper_step = new Mesh(this.cylinder, this.marble_material)
  private readonly shadow: Mesh
  constructor(scene: Scene) {
    this.group.name = 'Studio display room'; this.group.userData.viewerOnly = true
    this.group.add(this.floor, this.ceiling, ...this.walls, this.lower_step, this.upper_step); scene.add(this.group)
    this.floor.rotation.x = -Math.PI / 2; this.ceiling.rotation.x = Math.PI / 2
    this.walls[1].rotation.y = Math.PI; this.walls[2].rotation.y = Math.PI / 2; this.walls[3].rotation.y = -Math.PI / 2
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')!, gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64)
    gradient.addColorStop(0, 'rgba(0,0,0,0.25)'); gradient.addColorStop(0.45, 'rgba(0,0,0,0.12)'); gradient.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128)
    this.shadow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2; this.group.add(this.shadow)
    // Private APK assembly provides the owner's room textures.
    const loader = new TextureLoader()
    const load_surface = (filename: string, material: MeshStandardMaterial, repeat: [number, number], wrapping: Wrapping, color = 0xffffff): void => {
      loader.load(new URL('../' + filename, location.href).href, texture => {
        material.map?.dispose()
        material.map = tile(texture, repeat, wrapping)
        material.color.setHex(color)
        material.needsUpdate = true
      }, undefined, () => {})
    }
    load_surface('native-room-wall.png', this.wall_material, [10, 4], RepeatWrapping, 0xc9c9c0)
    load_surface('native-room-floor.webp', this.floor_material, [12, 12], MirroredRepeatWrapping)
    load_surface('native-room-stage.webp', this.marble_material, [1, 1], MirroredRepeatWrapping)
  }
  configure(bounds: Box3): void {
    const { center, floor, unit, extent, height, step_height, stage_radius, base_radius } = room_layout(bounds)
    this.group.position.set(center.x, floor, center.z)
    this.floor.scale.set(extent * 2, extent * 2, 1); this.ceiling.scale.copy(this.floor.scale); this.ceiling.position.y = height
    for (const wall of this.walls) wall.scale.set(extent * 2, height, 1)
    this.walls[0].position.set(0, height / 2, -extent); this.walls[1].position.set(0, height / 2, extent)
    this.walls[2].position.set(-extent, height / 2, 0); this.walls[3].position.set(extent, height / 2, 0)
    this.lower_step.scale.set(base_radius, step_height, base_radius)
    this.lower_step.position.y = step_height / 2
    this.upper_step.scale.set(stage_radius, step_height, stage_radius)
    this.upper_step.position.y = step_height * 1.5
    this.shadow.position.y = step_height * 2 + unit * 0.0005
    this.shadow.scale.set(unit * 0.8, unit * 0.65, 1)
  }
  get stage_radius(): number { return this.lower_step.scale.x }
  set_visible(visible: boolean): void { this.group.visible = visible }
  get visible(): boolean { return this.group.visible }
}
