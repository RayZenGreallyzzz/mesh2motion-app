export interface GlbNode {
  name?: string
  children?: number[]
  mesh?: number
  skin?: number
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  matrix?: number[]
}

export interface GlbDocument {
  asset: { version: string }
  scene?: number
  scenes?: Array<{ nodes?: number[] }>
  nodes?: GlbNode[]
  skins?: Array<{ joints: number[], inverseBindMatrices?: number }>
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>
  animations?: Array<{ channels: Array<{ target: { node?: number, path: string } }> }>
  buffers?: Array<{ uri?: string, byteLength: number }>
  images?: Array<{ uri?: string }>
  accessors?: Array<{ count: number }>
  extensionsRequired?: string[]
}

// Bound work before invoking image/geometry decoders on a mobile WebView.
export const MAX_GLB_BYTES = 128 * 1024 * 1024
const supported_extensions = new Set([
  'KHR_mesh_quantization', 'KHR_texture_transform', 'EXT_texture_webp',
  'KHR_draco_mesh_compression', 'EXT_meshopt_compression',
  'KHR_materials_unlit', 'KHR_materials_clearcoat', 'KHR_materials_ior',
  'KHR_materials_specular', 'KHR_materials_transmission', 'KHR_materials_volume',
  'KHR_materials_sheen', 'KHR_materials_emissive_strength',
  'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_dispersion'
])

export function inspect_glb (buffer: ArrayBuffer): GlbDocument {
  if (buffer.byteLength < 20) throw new Error('Файл слишком короткий для GLB')
  if (buffer.byteLength > MAX_GLB_BYTES) throw new Error('GLB больше 128 МБ. Сначала уменьшите модель.')
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('Нужен бинарный glTF 2.0 — файл GLB')
  }
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error('GLB повреждён: размер файла не совпадает с заголовком')
  let json: GlbDocument | undefined
  for (let offset = 12; offset < buffer.byteLength;) {
    if (offset + 8 > buffer.byteLength) throw new Error('Повреждён заголовок блока GLB')
    const size = view.getUint32(offset, true), type = view.getUint32(offset + 4, true)
    offset += 8
    if (size % 4 !== 0 || size > buffer.byteLength - offset) throw new Error('Повреждён блок GLB')
    if (type === 0x4e4f534a) {
      if (json || offset !== 20) throw new Error('Некорректный порядок блоков GLB')
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, size))) as GlbDocument
    }
    offset += size
  }
  if (!json || json.asset?.version !== '2.0') throw new Error('В GLB нет описания glTF 2.0')
  if ((json.scenes?.length ?? 0) > 1) {
    throw new Error('В файле несколько сцен. Экспортируйте нужную сцену отдельно; все скелеты внутри одной сцены поддерживаются.')
  }
  for (const entry of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (entry.uri && !/^data:(?:image\/(?:png|jpeg|webp)|application\/(?:octet-stream|gltf-buffer));base64,/i.test(entry.uri)) {
      throw new Error('GLB ссылается на внешний файл. Встройте текстуры и данные в GLB для работы офлайн.')
    }
  }
  for (const extension of json.extensionsRequired ?? []) {
    if (!supported_extensions.has(extension)) throw new Error('Этот GLB требует неподдерживаемое расширение: ' + extension)
  }
  const nodes = json.nodes ?? []
  if (nodes.length > 4096) throw new Error('Больше 4096 узлов: слишком большой риг для этого режима')
  const parents = new Map<number, number>()
  nodes.forEach((node, index) => {
    for (const child of node.children ?? []) {
      if (!Number.isInteger(child) || child < 0 || child >= nodes.length || parents.has(child)) {
        throw new Error('Некорректная иерархия узлов GLB')
      }
      parents.set(child, index)
    }
    for (const values of [node.translation, node.rotation, node.scale, node.matrix]) {
      if (values?.some(value => !Number.isFinite(value))) throw new Error('В риге есть некорректные координаты')
    }
  })
  for (let index = 0; index < nodes.length; index++) {
    const visited = new Set<number>()
    let cursor: number | undefined = index
    while (cursor !== undefined) {
      if (visited.has(cursor) || visited.size > 256) throw new Error('Цикл или чрезмерная глубина иерархии GLB')
      visited.add(cursor)
      cursor = parents.get(cursor)
    }
  }
  for (const skin of json.skins ?? []) {
    if (!skin.joints?.length || skin.joints.length > 1024 || new Set(skin.joints).size !== skin.joints.length ||
        skin.joints.some(index => !Number.isInteger(index) || index < 0 || index >= nodes.length)) {
      throw new Error('Некорректный список костей GLB')
    }
  }
  let vertices = 0
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      if (Object.keys(primitive.attributes).some(name => /^(JOINTS|WEIGHTS)_[1-9]/.test(name))) {
        throw new Error('Больше четырёх влияний на вершину. Этот режим пока не преобразует такие веса, чтобы не испортить риг.')
      }
      vertices += json.accessors?.[primitive.attributes.POSITION]?.count ?? 0
    }
  }
  if (vertices > 2_000_000) throw new Error('Больше 2 млн вершин. Уменьшите модель перед работой на Android.')
  if ((json.animations?.length ?? 0) > 256) throw new Error('Импортируйте не больше 256 анимаций за один раз')
  if ((json.accessors ?? []).some(accessor => !Number.isInteger(accessor.count) || accessor.count < 0 || accessor.count > 12_000_000)) {
    throw new Error('Слишком большой или повреждённый массив данных GLB')
  }
  return json
}
