import type { BufferGeometry } from 'three'
import { inspect_glb, MAX_GLB_BYTES } from './GlbEnvelope.ts'

export type MeshEdit = { id: string, original: BufferGeometry, geometry: BufferGeometry }

const names: Record<string, string> = {
  POSITION: 'position', NORMAL: 'normal', TANGENT: 'tangent', TEXCOORD_0: 'uv',
  TEXCOORD_1: 'uv1', TEXCOORD_2: 'uv2', TEXCOORD_3: 'uv3', COLOR_0: 'color',
  JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight'
}

// Append only the edited accessors. Original images, transforms, motion
// tracks, and skin binding remain in place, including compressed textures.
export function write_mesh_edits (original: ArrayBuffer, edits: MeshEdit[]): ArrayBuffer {
  inspect_glb(original)
  const view = new DataView(original), size = view.getUint32(12, true), bin = 20 + size
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(original, 20, size)))
  const byte_length = doc.buffers?.[0]?.byteLength
  if (doc.buffers?.[0]?.uri || !byte_length || bin + 8 > original.byteLength ||
      view.getUint32(bin + 4, true) !== 0x004e4942 || view.getUint32(bin, true) < byte_length) {
    throw new Error('Для правки нужен GLB со встроенной геометрией.')
  }
  let length = (byte_length + 3) & ~3
  const blocks: { at: number, bytes: Uint8Array }[] = []
  const append = (attribute: BufferGeometry['attributes'][string], kind: string): number => {
    const width = attribute.itemSize
    const values = kind === 'indices' ? new Uint32Array(attribute.count) :
      kind === 'JOINTS_0' ? new Uint16Array(attribute.count * width) : new Float32Array(attribute.count * width)
    const bounds = kind === 'POSITION'
    const min = Array(width).fill(Infinity), max = Array(width).fill(-Infinity)
    for (let i = 0; i < attribute.count; i++) for (let c = 0; c < width; c++) {
      const x = attribute.getComponent(i, c)
      if (!Number.isFinite(x)) throw new Error('Правка содержит некорректные координаты.')
      values[i * width + c] = x
      if (bounds) { min[c] = Math.min(min[c], x); max[c] = Math.max(max[c], x) }
    }
    const bytes = new Uint8Array(values.buffer)
    if (length + bytes.byteLength > MAX_GLB_BYTES) throw new Error('GLB после правки больше 128 МБ.')
    const bufferView = doc.bufferViews.length
    doc.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength })
    blocks.push({ at: length, bytes })
    length = (length + bytes.byteLength + 3) & ~3
    const componentType = kind === 'indices' ? 5125 : kind === 'JOINTS_0' ? 5123 : 5126
    doc.accessors.push({ bufferView, componentType, count: attribute.count, type: width === 1 ? 'SCALAR' : 'VEC' + width, ...(bounds ? { min, max } : {}) })
    return doc.accessors.length - 1
  }
  const copies = new Map<number, number>()
  for (const {id, original: prior, geometry} of edits) {
    const address = /^n(\d+)(?:\/p(\d+))?$/.exec(id), node_index = Number(address?.[1])
    const node = doc.nodes[node_index], source = doc.meshes[node?.mesh]
    if (!source) throw new Error('Не найдена деталь GLB для сохранения.')
    if (!copies.has(node_index)) {
      const shared = doc.nodes.some((other: { mesh?: number }, i: number) => i !== node_index && other.mesh === node.mesh)
      if (shared) { node.mesh = doc.meshes.length; doc.meshes.push(structuredClone(source)) }
      copies.set(node_index, node.mesh)
    }
    const primitive = doc.meshes[copies.get(node_index)!].primitives[Number(address?.[2] ?? 0)]
    if (!primitive || (primitive.mode ?? 4) !== 4) throw new Error('Правка поддерживает треугольную сетку.')
    const draco = primitive.extensions?.KHR_draco_mesh_compression
    if (draco) delete primitive.extensions.KHR_draco_mesh_compression
    const keys = new Set<string>(Object.keys(primitive.attributes))
    if (geometry.attributes.color) keys.add('COLOR_0')
    for (const key of keys) {
      const name = names[key] ?? key.toLowerCase(), attr = geometry.attributes[name]
      if (!attr) throw new Error('Не удалось сохранить атрибут сетки ' + key)
      if (draco || attr !== prior.attributes[name]) primitive.attributes[key] = append(attr, key)
    }
    if ((draco || geometry.index !== prior.index) && geometry.index) primitive.indices = append(geometry.index, 'indices')
    for (const [index, target] of (primitive.targets ?? []).entries()) {
      for (const key of Object.keys(target)) {
        const name = names[key] as 'position' | 'normal' | 'color'
        const attr = geometry.morphAttributes[name]?.[index]
        if (!attr) throw new Error('Недоступны данные морфа для сохранения.')
        if (draco || attr !== prior.morphAttributes[name]?.[index]) target[key] = append(attr, key)
      }
    }
  }
  doc.buffers[0].byteLength = length
  const json = new TextEncoder().encode(JSON.stringify(doc)), padding = (json.length + 3) & ~3
  const tail = new Uint8Array(original, bin + 8 + view.getUint32(bin, true))
  const total = 28 + padding + length + tail.byteLength
  if (total > MAX_GLB_BYTES) throw new Error('GLB после правки больше 128 МБ.')
  const out = new ArrayBuffer(total), d = new DataView(out), data = new Uint8Array(out)
  d.setUint32(0, 0x46546c67, true); d.setUint32(4, 2, true); d.setUint32(8, total, true)
  d.setUint32(12, padding, true); d.setUint32(16, 0x4e4f534a, true)
  data.fill(32, 20, 20 + padding); data.set(json, 20)
  d.setUint32(20 + padding, length, true); d.setUint32(24 + padding, 0x004e4942, true)
  data.set(new Uint8Array(original, bin + 8, byte_length), 28 + padding)
  for (const block of blocks) data.set(block.bytes, 28 + padding + block.at)
  data.set(tail, 28 + padding + length)
  inspect_glb(out)
  return out
}
