import { Inflate } from 'three/examples/jsm/libs/fflate.module.js'
import { inspect_glb } from './GlbEnvelope.ts'
import { crc_update, hex, input_limit, type MotionInput } from './MotionArchive.ts'
import { parse_bvh_motion } from './BvhMotionReader.ts'
import { parse_fbx_motion } from './FbxMotionReader.ts'
import { document_bytes, type MotionDocument } from './MotionDocument.ts'

export type ImportResult = { kind: 'duplicate', id: string } |
  { kind: 'motion', id: string, document: MotionDocument, bytes: number } |
  { kind: 'glb', id: string, bytes: ArrayBuffer, clips: number, bones: number, skeletons: number }

export async function unpack_motion_input (input: MotionInput): Promise<ArrayBuffer> {
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > input_limit(input.format) || input.blob.size > input_limit(input.format)) throw new Error('Файл превышает лимит для этого формата')
  if (!input.compressed) { if (input.blob.size !== input.size) throw new Error('Неверный размер файла'); return input.blob.arrayBuffer() }
  const output = new Uint8Array(input.size); let offset = 0, crc = 0xffffffff
  const receive = (chunk: Uint8Array) => {
    if (offset + chunk.length > output.length) throw new Error('Размер распаковки превышает объявленный')
    output.set(chunk, offset); offset += chunk.length; crc = crc_update(crc, chunk)
  }
  const inflate = input.compressed.method === 8 ? new Inflate(receive) : undefined
  if (input.compressed.method !== 0 && !inflate) throw new Error('Неизвестное сжатие ZIP')
  // Small slices bound temporary compressed data even for a gigabyte archive.
  for (let p = 0; p < input.blob.size; p += 65536) {
    const chunk = new Uint8Array(await input.blob.slice(p, p + 65536).arrayBuffer())
    if (inflate) inflate.push(chunk, false); else receive(chunk)
  }
  inflate?.push(new Uint8Array(), true)
  if (offset !== input.size || ((crc ^ 0xffffffff) >>> 0) !== input.compressed.crc) throw new Error('ZIP повреждён: размер или CRC не совпадает')
  return output.buffer
}

export async function import_motion_input (input: MotionInput, knownIds: string[] = []): Promise<ImportResult> {
  const bytes = await unpack_motion_input(input), id = 'sha256-' + hex(await crypto.subtle.digest('SHA-256', bytes))
  if (knownIds.includes(id)) return { kind: 'duplicate', id }
  if (input.format === 'glb') {
    const doc = inspect_glb(bytes)
    return { kind: 'glb', id, bytes, clips: doc.animations?.length ?? 0, bones: new Set(doc.skins?.flatMap(s => s.joints) ?? []).size, skeletons: doc.skins?.length ?? 0 }
  }
  const name = input.name.replace(/\\/g, '/').split('/').pop()!.replace(/\.(bvh|fbx)$/i, '')
  const document = input.format === 'bvh' ? parse_bvh_motion(new TextDecoder('utf-8', { fatal: true }).decode(bytes), name) : parse_fbx_motion(bytes, name)
  return { kind: 'motion', id, document, bytes: document_bytes(document) }
}

export function result_buffers (result: ImportResult): ArrayBuffer[] {
  if (result.kind === 'glb') return [result.bytes]
  if (result.kind === 'duplicate') return []
  const buffers = new Set<ArrayBuffer>()
  for (const clip of result.document.clips) for (const track of clip.tracks) { buffers.add(track.times.buffer as ArrayBuffer); buffers.add(track.values.buffer as ArrayBuffer) }
  return [...buffers]
}
