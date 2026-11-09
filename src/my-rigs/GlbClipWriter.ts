import { InterpolateDiscrete, type KeyframeTrack } from 'three'
import type { RigAsset } from './RigAsset.ts'
import { inspect_glb, MAX_GLB_BYTES } from './GlbEnvelope.ts'

/** Replace only animation declarations. Geometry, images, unedited node transforms,
 * inverse bind matrices and vertex weights retain their exact original bytes. */
export function write_clips_glb (asset: RigAsset, indices: number[]): ArrayBuffer | undefined {
  const original = asset.source_bytes, view = new DataView(original)
  inspect_glb(original)
  const jsonLength = view.getUint32(12, true)
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(original, 20, jsonLength)))
  if (!doc.buffers?.length || doc.buffers[0].uri) return undefined
  // Meshopt may declare a virtual fallback buffer with no physical bytes. Keep
  // it, and all original compressed views/images, while appending keys to BIN.
  if (doc.buffers.slice(1).some((buffer: any) => buffer.uri ||
    !(buffer.extensions?.EXT_meshopt_compression?.fallback === true || buffer.extensions?.KHR_meshopt_compression?.fallback === true))) return undefined
  let binary: Uint8Array | undefined
  const other: Uint8Array[] = []
  for (let at = 20 + jsonLength; at < original.byteLength;) {
    const size = view.getUint32(at, true), kind = view.getUint32(at + 4, true)
    if (kind === 0x004e4942) binary = new Uint8Array(original, at + 8, size)
    else other.push(new Uint8Array(original, at, size + 8))
    at += 8 + size
  }
  if (!binary || binary.byteLength < doc.buffers[0].byteLength) return undefined
  const chunks: Array<{ offset: number, bytes: Uint8Array }> = [{ offset: 0, bytes: binary.subarray(0, doc.buffers[0].byteLength) }]
  let length = Math.ceil(doc.buffers[0].byteLength / 4) * 4
  for (const id of asset.pose_overrides ?? []) {
    const node = asset.nodes.get(id), match = /^n(\d+)$/.exec(id)
    if (!node || !match || !doc.nodes?.[Number(match[1])]) throw new Error('Не найден сустав исходной позы при экспорте')
    const target = doc.nodes[Number(match[1])]; delete target.matrix
    target.translation = node.position.toArray(); target.rotation = node.rotation.toArray(); target.scale = node.scale.toArray()
  }
  doc.accessors ??= []; doc.bufferViews ??= []
  const add = (values: ArrayLike<number>, width: number, type: string, times = false): number => {
    if (!values.length || values.length % width !== 0) throw new Error('Некорректная дорожка при сохранении GLB')
    const floats = new Float32Array(values.length)
    for (let i = 0; i < values.length; i++) { if (!Number.isFinite(values[i])) throw new Error('Некорректный ключ анимации'); floats[i] = values[i] }
    const bytes = new Uint8Array(floats.buffer), bv = doc.bufferViews.length
    doc.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength }); chunks.push({ offset: length, bytes }); length += bytes.byteLength
    const accessor: Record<string, unknown> = { bufferView: bv, componentType: 5126, count: values.length / width, type }
    if (times) { accessor.min = [values[0]]; accessor.max = [values[values.length - 1]] }
    doc.accessors.push(accessor); return doc.accessors.length - 1
  }
  const byUuid = new Map([...asset.nodes.values()].map(n => [n.object.uuid, n]))
  doc.animations = indices.map(index => {
    const clip = asset.clips[index]; if (!clip) throw new Error('Анимация больше не существует')
    if (!clip.tracks.length) throw new Error('В анимации нет дорожек')
    const channels: unknown[] = [], samplers: unknown[] = [], seen = new Map<string, KeyframeTrack>()
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.'), node = byUuid.get(track.name.slice(0, dot)), property = track.name.slice(dot + 1)
      const id = node && /^n(\d+)(?:\/p\d+)?$/.exec(node.id)
      const path = ({ quaternion: 'rotation', position: 'translation', scale: 'scale', morphTargetInfluences: 'weights' } as Record<string, string>)[property]
      if (!id || !path || !doc.nodes?.[Number(id[1])]) return null
      const key = id[1] + ':' + path, previous = seen.get(key)
      if (previous) {
        if (previous.times.length !== track.times.length || previous.values.length !== track.values.length || previous.times.some((v, i) => v !== track.times[i]) || previous.values.some((v, i) => v !== track.values[i])) throw new Error('Разные дорожки управляют одним узлом GLB')
        continue
      }
      seen.set(key, track)
      const factory = (track as KeyframeTrack & { createInterpolant: { isInterpolantFactoryMethodGLTFCubicSpline?: boolean } }).createInterpolant
      const interpolation = factory.isInterpolantFactoryMethodGLTFCubicSpline ? 'CUBICSPLINE' : track.getInterpolation() === InterpolateDiscrete ? 'STEP' : 'LINEAR'
      const width = path === 'rotation' ? 4 : path === 'weights' ? 1 : 3
      const input = add(track.times, 1, 'SCALAR', true), output = add(track.values, width, width === 4 ? 'VEC4' : width === 3 ? 'VEC3' : 'SCALAR')
      channels.push({ sampler: samplers.length, target: { node: Number(id[1]), path } }); samplers.push({ input, output, interpolation })
    }
    return { name: clip.name, channels, samplers }
  })
  if (doc.animations.some((a: unknown) => a === null)) return undefined
  if (!doc.animations.length) delete doc.animations
  doc.buffers[0].byteLength = length
  const json = new TextEncoder().encode(JSON.stringify(doc)), padded = Math.ceil(json.byteLength / 4) * 4
  const total = 12 + 8 + padded + 8 + length + other.reduce((n, bytes) => n + bytes.byteLength, 0)
  if (total > MAX_GLB_BYTES) throw new Error('После добавления анимаций GLB больше 128 МБ. Экспортируйте меньше движений.')
  const result = new ArrayBuffer(total), out = new DataView(result), bytes = new Uint8Array(result)
  out.setUint32(0, 0x46546c67, true); out.setUint32(4, 2, true); out.setUint32(8, total, true); out.setUint32(12, padded, true); out.setUint32(16, 0x4e4f534a, true)
  bytes.fill(32, 20, 20 + padded); bytes.set(json, 20)
  const start = 20 + padded; out.setUint32(start, length, true); out.setUint32(start + 4, 0x004e4942, true)
  chunks.forEach(chunk => bytes.set(chunk.bytes, start + 8 + chunk.offset))
  let next = start + 8 + length; for (const chunk of other) { bytes.set(chunk, next); next += chunk.byteLength }
  inspect_glb(result); return result
}

