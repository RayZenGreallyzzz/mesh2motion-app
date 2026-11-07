import { Box3, CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3, type Scene, type Texture } from 'three'

export function room_layout(bounds: Box3): { center: Vector3, floor: number, unit: number, extent: number, height: number } {
  const size = bounds.getSize(new Vector3()), unit = Math.max(size.y, size.length() * 0.65, 0.0001)
  return { center: bounds.getCenter(new Vector3()), floor: bounds.min.y - unit * 0.003, unit, extent: unit * 9, height: unit * 5 }
}

function fallback_stone(): CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#4e514e'; ctx.fillRect(0, 0, 512, 256)
  for (let row = 0; row < 8; row++) for (let col = -1; col < 7; col++) {
    const x = col * 88 + (row % 2) * 44, y = row * 32, shade = 104 + ((row * 43 + col * 17 + 200) % 37)
    ctx.fillStyle = `rgb(${shade + 5},${shade + 3},${shade - 1})`; ctx.fillRect(x + 2, y + 2, 84, 28)
    ctx.fillStyle = '#ffffff16'; ctx.fillRect(x + 3, y + 2, 82, 2); ctx.fillStyle = '#00000020'; ctx.fillRect(x + 3, y + 28, 82, 2)
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; return texture
}

/** Display scenery belongs to the viewer scene, never to the exported rig scene. */
export class StudioRoom {
  readonly group = new Group()
  private readonly geometry = new PlaneGeometry(1, 1)
  private wall_texture: Texture = fallback_stone()
  private readonly wall_material = new MeshStandardMaterial({ map: this.wall_texture, color: 0xc9c9c0, roughness: 1, metalness: 0 })
  private readonly floor = new Mesh(this.geometry, new MeshStandardMaterial({ color: 0x777d79, roughness: 1, metalness: 0 }))
  private readonly ceiling = new Mesh(this.geometry, new MeshStandardMaterial({ color: 0xabad9f, roughness: 1, metalness: 0 }))
  private readonly walls = Array.from({ length: 4 }, () => new Mesh(this.geometry, this.wall_material))
  private readonly shadow: Mesh
  constructor(scene: Scene) {
    this.group.name = 'Studio display room'; this.group.userData.viewerOnly = true
    this.group.add(this.floor, this.ceiling, ...this.walls); scene.add(this.group)
    this.floor.rotation.x = -Math.PI / 2; this.ceiling.rotation.x = Math.PI / 2
    this.walls[1].rotation.y = Math.PI; this.walls[2].rotation.y = Math.PI / 2; this.walls[3].rotation.y = -Math.PI / 2
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')!, gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64)
    gradient.addColorStop(0, 'rgba(0,0,0,0.25)'); gradient.addColorStop(0.45, 'rgba(0,0,0,0.12)'); gradient.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128)
    this.shadow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2; this.group.add(this.shadow)
    this.tile()
    // The owner's original wall PNG is injected into the private APK. Public
    // builds use the small procedural stone surface rather than that private file.
    new TextureLoader().load(new URL('../native-room-wall.png', location.href).href, texture => {
      texture.colorSpace = SRGBColorSpace; this.wall_texture.dispose(); this.wall_texture = texture; this.tile(); this.wall_material.map = texture; this.wall_material.needsUpdate = true
    }, undefined, () => {})
  }
  private tile(): void {
    this.wall_texture.wrapS = this.wall_texture.wrapT = RepeatWrapping
    this.wall_texture.repeat.set(10, 4); this.wall_texture.needsUpdate = true
  }
  configure(bounds: Box3): void {
    const { center, floor, unit, extent, height } = room_layout(bounds)
    this.group.position.set(center.x, floor, center.z)
    this.floor.scale.set(extent * 2, extent * 2, 1); this.ceiling.scale.copy(this.floor.scale); this.ceiling.position.y = height
    for (const wall of this.walls) wall.scale.set(extent * 2, height, 1)
    this.walls[0].position.set(0, height / 2, -extent); this.walls[1].position.set(0, height / 2, extent)
    this.walls[2].position.set(-extent, height / 2, 0); this.walls[3].position.set(extent, height / 2, 0)
    this.shadow.position.y = unit * 0.001; this.shadow.scale.set(unit * 0.8, unit * 0.65, 1)
  }
  set_visible(visible: boolean): void { this.group.visible = visible }
  get visible(): boolean { return this.group.visible }
}
