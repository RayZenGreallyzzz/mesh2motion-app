import { type Group, type Mesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { asset_decoder_path } from '../lib/AssetCodecs.ts'
import { inspect_glb, type GlbDocument } from './GlbEnvelope.ts'

const property = 'rigStudioOriginalMeshesV1'

/** Mesh indices in the embedded original BIN, keyed by the live glTF node. */
export function original_meshes (doc: GlbDocument): Map<number, number> {
  const entries = doc.asset.extras?.[property]
  const result = new Map<number, number>()
  if (entries === undefined) return result
  if (!Array.isArray(entries) || entries.length > (doc.nodes?.length ?? 0)) {
    throw new Error('Некорректная исходная сетка для подгонки.')
  }
  for (const pair of entries) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error('Некорректная исходная сетка для подгонки.')
    const [node, mesh] = pair
    if (!Number.isInteger(node) || !Number.isInteger(mesh) || result.has(node) ||
        doc.nodes?.[node]?.mesh === undefined || !doc.meshes?.[mesh]) {
      throw new Error('Некорректная исходная сетка для подгонки.')
    }
    result.set(node, mesh)
  }
  return result
}

export function record_original_meshes (doc: GlbDocument, references: Map<number, number>): void {
  doc.asset.extras = { ...doc.asset.extras, [property]: [...references] }
}

function bin (bytes: ArrayBuffer): Uint8Array {
  const view = new DataView(bytes), header = 20 + view.getUint32(12, true)
  if (header + 8 > bytes.byteLength || view.getUint32(header + 4, true) !== 0x004e4942) {
    throw new Error('Для исходной сетки нужен GLB со встроенной геометрией.')
  }
  return new Uint8Array(bytes, header + 8, view.getUint32(header, true))
}

export function verify_original_for_fit (edited: ArrayBuffer, original: ArrayBuffer): void {
  const source = inspect_glb(original)
  if (!source.buffers?.[0] || source.buffers[0].uri) throw new Error('Для подгонки выберите исходный GLB модели.')
  const base = bin(original), current = bin(edited), length = source.buffers[0].byteLength
  if (length > current.length || length > base.length) throw new Error('Этот GLB отличается от исходника открытой модели.')
  // The mesh editor retains the BIN prefix byte-for-byte, including textures.
  // Check the exact prefix to keep an unrelated character out of the fit.
  const count = length >>> 2
  const a = new Uint32Array(base.buffer, base.byteOffset, count), b = new Uint32Array(current.buffer, current.byteOffset, count)
  for (let i = 0; i < count; i++) if (a[i] !== b[i]) throw new Error('Этот GLB отличается от исходника открытой модели.')
  for (let i = count * 4; i < length; i++) if (base[i] !== current[i]) throw new Error('Этот GLB отличается от исходника открытой модели.')
}

/** Load the unedited surface with its original primitive/vertex order.
 * Textures, animations and skinning are irrelevant to anatomical fitting. */
export async function load_fit_surface (edited: ArrayBuffer, original?: ArrayBuffer): Promise<{scene: Group, meshes: Mesh[]} | undefined> {
  const bytes = original ?? edited
  const doc = inspect_glb(bytes), references = original_meshes(doc)
  if (!original && !references.size) return
  if (original) verify_original_for_fit(edited, original)
  const decoder = new DRACOLoader().setDecoderPath(asset_decoder_path('draco')).setWorkerLimit(1)
  const loader = new GLTFLoader().setDRACOLoader(decoder).setMeshoptDecoder(MeshoptDecoder)
  loader.register(parser => {
    // Swap nodes before GLTFLoader counts shared mesh instances.
    const json = parser.json
    json.nodes.forEach((node: {mesh?: number, skin?: number, weights?: number}, index: number) => {
      const original = references.get(index)
      if (original !== undefined) node.mesh = original
      delete node.skin; delete node.weights
    })
    for (const mesh of json.meshes ?? []) {
      for (const primitive of mesh.primitives) {
        delete primitive.material; delete primitive.targets
        primitive.attributes = { POSITION: primitive.attributes.POSITION }
        const draco = primitive.extensions?.KHR_draco_mesh_compression
        if (draco) draco.attributes = { POSITION: draco.attributes.POSITION }
      }
    }
    delete json.animations
    return { name: 'StudioAnatomicalSurface' }
  })
  try {
    const gltf = await loader.parseAsync(bytes, '')
    const nodes: Mesh[] = [], primitives: Mesh[] = []
    gltf.scene.traverse(object => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const group = gltf.parser.associations.get(object)?.nodes === undefined ? primitives : nodes
      group.push(mesh)
    })
    return { scene: gltf.scene, meshes: nodes.concat(primitives) }
  }
  finally { decoder.dispose() }
}
