import type { Object3D } from 'three'
import { GLTFExporter, type GLTFExporterOptions } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { TextureReadback } from './TextureReadback.ts'

/** Standard GLB for game import, including characters loaded with KTX2 maps. */
export async function export_plain_glb (scene: Object3D, options: GLTFExporterOptions): Promise<ArrayBuffer> {
  const textures = new TextureReadback()
  try {
    const exporter = new GLTFExporter().setTextureUtils({ decompress: (texture, size) => textures.read(texture, size) })
    const result = await exporter.parseAsync(scene, { ...options, binary: true })
    if (!(result instanceof ArrayBuffer)) throw new Error('Экспорт не вернул GLB')
    return result
  } finally {
    textures.restore()
  }
}
