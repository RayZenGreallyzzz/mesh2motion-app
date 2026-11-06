import { WebGLRenderer, type Object3D, type Texture, type CanvasTexture } from 'three'
import { decompress } from 'three/examples/jsm/utils/WebGLTextureUtils.js'

/** Temporary, private GPU readback for compatible PNG/FBX exports. The viewport
 * renderer and original KTX2 textures must retain their state after success or failure. */
export class TextureReadback {
  private renderer?: WebGLRenderer
  private readonly readable = new Map<Texture, CanvasTexture>()
  private readonly changes: Array<{ material: Record<string, unknown>, key: string, original: Texture }> = []

  read (texture: Texture, max_size = Infinity): CanvasTexture {
    const cached = this.readable.get(texture)
    if (cached) return cached
    this.renderer ??= new WebGLRenderer({ antialias: false, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true })
    // WebGLTextureUtils constructs a CanvasTexture; its public declaration
    // currently widens that return value to Texture.
    const result = decompress(texture, max_size, this.renderer) as CanvasTexture
    // Readback changes the image representation, not its UV set or transform.
    result.channel = texture.channel
    result.mapping = texture.mapping
    result.offset.copy(texture.offset)
    result.repeat.copy(texture.repeat)
    result.center.copy(texture.center)
    result.rotation = texture.rotation
    result.matrix.copy(texture.matrix)
    result.matrixAutoUpdate = texture.matrixAutoUpdate
    // GPU -> canvas readback reverses the image rows. Keep the CanvasTexture's
    // flipY=true from WebGLTextureUtils; copying glTF's false would mirror it.
    result.premultiplyAlpha = texture.premultiplyAlpha
    // GLTFLoader records image/ktx2 here. Readback has changed those bytes to
    // PNG; preserving that MIME tag would create an invalid GLB image entry.
    result.userData = { ...texture.userData, mimeType: 'image/png' }
    this.readable.set(texture, result)
    return result
  }

  /** FBX does not have GLTFExporter's texture-utils hook. */
  prepare_fbx (scene: Object3D): void {
    scene.traverse(object => {
      const source = (object as Object3D & { material?: unknown }).material
      for (const material of Array.isArray(source) ? source : source ? [source] : []) {
        if (typeof material !== 'object' || material === null) continue
        const record = material as Record<string, unknown>
        for (const [key, value] of Object.entries(record)) {
          const texture = value as Texture & { isCompressedTexture?: boolean, isCubeTexture?: boolean }
          if (!texture?.isCompressedTexture || texture.isCubeTexture) continue
          const decoded = this.read(texture)
          this.changes.push({ material: record, key, original: texture })
          record[key] = decoded
        }
      }
    })
  }

  restore (): void {
    for (const { material, key, original } of this.changes) material[key] = original
    this.changes.length = 0
    for (const texture of this.readable.values()) {
      texture.dispose()
      texture.image.width = 0; texture.image.height = 0
    }
    this.readable.clear()
    this.renderer?.dispose()
    this.renderer?.forceContextLoss()
    this.renderer = undefined
  }
}
