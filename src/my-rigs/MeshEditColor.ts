import {
  Color, LinearSRGBColorSpace, SRGBColorSpace, Triangle, Vector2, Vector3,
  type Intersection, type Mesh, type MeshStandardMaterial, type Texture
} from 'three'
import { TextureReadback } from '../lib/processes/export-to-file/TextureReadback.ts'

/** Read the asset's base color at the tapped surface, including its UV set,
 * texture transform, color factor, and vertex color. Viewport lighting never
 * becomes part of the stored color. */
export function sample_surface_color (hit: Intersection<Mesh>): Color {
  const { object, face } = hit
  if (!face) throw new Error('Коснитесь поверхности модели.')
  const material = (Array.isArray(object.material) ? object.material[face.materialIndex] : object.material) as MeshStandardMaterial
  if (!material?.color) throw new Error('У этого материала нет доступного основного цвета.')
  const result = material.color.clone(), geometry = object.geometry
  const ids = [face.a, face.b, face.c]
  const points = ids.map(i => object.getVertexPosition(i, new Vector3()))
  const bary = Triangle.getBarycoord(object.worldToLocal(hit.point.clone()), points[0], points[1], points[2], new Vector3())
  if (!bary) throw new Error('Выберите соседний участок поверхности.')
  if (material.vertexColors && geometry.attributes.color) {
    const attr = geometry.attributes.color
    const rgb = [0, 1, 2].map(c => ids.reduce((sum, i, b) => sum + attr.getComponent(i, c) * bary.getComponent(b), 0))
    result.multiply(new Color().setRGB(rgb[0], rgb[1], rgb[2], LinearSRGBColorSpace))
  }
  if (!material.map) return result
  const texture = material.map
  const attr = geometry.attributes[texture.channel ? 'uv' + texture.channel : 'uv']
  if (!attr) throw new Error('У этой текстуры нет доступных координат.')
  const uv = new Vector2()
  for (let j = 0; j < 3; j++) {
    const weight = bary.getComponent(j)
    uv.x += attr.getX(ids[j]) * weight; uv.y += attr.getY(ids[j]) * weight
  }
  const reader = new TextureReadback()
  try {
    const image = (texture as Texture & {isCompressedTexture?: boolean}).isCompressedTexture ? reader.read(texture, 2048) : texture
    // Keep source sampler addressing after GPU readback. Its flipY describes
    // the decoded image, which may be reversed relative to the original KTX2.
    const sampler = image === texture ? texture : image.clone()
    if (sampler !== texture) { sampler.wrapS = texture.wrapS; sampler.wrapT = texture.wrapT }
    sampler.updateMatrix(); sampler.transformUv(uv)
    if (sampler !== texture) sampler.dispose()
    const source = image.image as CanvasImageSource & { width: number, height: number }
    const { width, height } = source
    if (!width || !height) throw new Error('Текстура ещё загружается.')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Цвет текстуры недоступен на устройстве.')
    const x = Math.max(0, Math.min(width - 1, Math.floor(uv.x * width)))
    const y = Math.max(0, Math.min(height - 1, Math.floor(uv.y * height)))
    ctx.drawImage(source, x, y, 1, 1, 0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return result.multiply(new Color().setRGB(r / 255, g / 255, b / 255,
      texture.colorSpace === LinearSRGBColorSpace ? LinearSRGBColorSpace : SRGBColorSpace))
  } finally { reader.restore() }
}
