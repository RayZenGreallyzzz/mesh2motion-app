export const MB = 1024 * 1024
export type InputFormat = 'bvh' | 'fbx' | 'glb'
export const input_limit = (format: InputFormat): number => (format === 'bvh' ? 32 : format === 'fbx' ? 64 : 128) * MB
export interface ArchiveEntry { path: string, format: InputFormat, compressed_size: number, size: number, crc: number, method: number, offset: number, flags: number }
export interface MotionArchive { entries: ArchiveEntry[], ignored: number, fingerprint: string, issues: string[] }
export interface MotionInput { blob: Blob, name: string, format: InputFormat, size: number, compressed?: { method: number, crc: number } }
export function input_format (name: string): InputFormat | undefined { const ext = name.split('.').pop()?.toLowerCase(); return ext === 'bvh' || ext === 'fbx' || ext === 'glb' ? ext : undefined }
export function hex (bytes: ArrayBuffer): string { return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('') }
const safe_path = (path: string): boolean => !/^[\\/]|^[a-z]:|\0/i.test(path) && !path.replace(/\\/g, '/').split('/').includes('..')

export async function open_motion_archive (file: Blob): Promise<MotionArchive> {
  if (file.size < 22 || file.size > 4 * 1024 * MB) throw new Error('Поддерживается обычный ZIP размером до 4 ГБ')
  const tailStart = Math.max(0, file.size - 65557), tail = new DataView(await file.slice(tailStart).arrayBuffer())
  let eocd = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50 && i + 22 + tail.getUint16(i + 20, true) === tail.byteLength) { eocd = i; break }
  if (eocd < 0) throw new Error('Не найден каталог ZIP. Нужен полный, не многотомный архив.')
  const count = tail.getUint16(eocd + 10, true), size = tail.getUint32(eocd + 12, true), offset = tail.getUint32(eocd + 16, true)
  if (tail.getUint16(eocd + 4, true) || tail.getUint16(eocd + 6, true) || tail.getUint16(eocd + 8, true) !== count) throw new Error('Многотомный ZIP не поддерживается')
  if (count === 65535 || offset === 0xffffffff || size === 0xffffffff) throw new Error('ZIP64 пока не поддерживается. Разделите архив на обычные ZIP.')
  if (count > 10000 || size > 8 * MB || offset + size > tailStart + eocd) throw new Error('Слишком большой или повреждённый каталог ZIP')
  const centralBytes = await file.slice(offset, offset + size).arrayBuffer(), central = new DataView(centralBytes)
  const entries: ArchiveEntry[] = [], issues: string[] = []; let cursor = 0, ignored = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > size || central.getUint32(cursor, true) !== 0x02014b50) throw new Error('Повреждён каталог ZIP')
    const flags = central.getUint16(cursor + 8, true), method = central.getUint16(cursor + 10, true), crc = central.getUint32(cursor + 16, true), compressed_size = central.getUint32(cursor + 20, true), entrySize = central.getUint32(cursor + 24, true)
    const nameLength = central.getUint16(cursor + 28, true), extraLength = central.getUint16(cursor + 30, true), commentLength = central.getUint16(cursor + 32, true), disk = central.getUint16(cursor + 34, true), localOffset = central.getUint32(cursor + 42, true), end = cursor + 46 + nameLength + extraLength + commentLength
    if (end > size || disk) throw new Error('Повреждена запись ZIP')
    const nameBytes = new Uint8Array(centralBytes, cursor + 46, nameLength)
    let path = new TextDecoder(flags & 2048 ? 'utf-8' : 'ibm866').decode(nameBytes)
    // Prefer the Unicode Path extra field when an older ZIP omitted the UTF-8 flag.
    let extra = cursor + 46 + nameLength, extraEnd = extra + extraLength
    while (extra + 4 <= extraEnd) {
      const kind = central.getUint16(extra, true), n = central.getUint16(extra + 2, true); extra += 4
      if (extra + n > extraEnd) throw new Error('Повреждены дополнительные поля ZIP')
      if (kind === 0x7075 && n >= 5 && central.getUint8(extra) === 1 && crc32(nameBytes) === central.getUint32(extra + 1, true)) path = new TextDecoder().decode(new Uint8Array(centralBytes, extra + 5, n - 5))
      extra += n
    }
    if (!safe_path(path) || path.length > 2048) { issues.push('Пропущен некорректный путь в ZIP'); cursor = end; continue }
    const format = input_format(path)
    if (format && !path.endsWith('/')) {
      if (flags & 1 || ![0,8].includes(method) || !entrySize || entrySize > input_limit(format) || compressed_size > input_limit(format) || localOffset + 30 + compressed_size > offset) { issues.push(path + ': пароль, неподдерживаемое сжатие или превышен лимит файла'); cursor = end; continue }
      entries.push({ path, format, compressed_size, size: entrySize, crc, method, offset: localOffset, flags })
    } else if (!path.endsWith('/')) ignored++
    cursor = end
  }
  if (cursor !== size) throw new Error('Размер каталога ZIP не совпадает')
  return { entries, ignored, issues, fingerprint: file.size + ':' + hex(await crypto.subtle.digest('SHA-256', centralBytes)) }
}

export async function archive_input (file: Blob, entry: ArchiveEntry): Promise<MotionInput> {
  const local = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer())
  if (local.byteLength !== 30 || local.getUint32(0, true) !== 0x04034b50 || local.getUint16(8, true) !== entry.method || local.getUint16(6, true) & 1) throw new Error('Повреждён локальный заголовок ZIP')
  const start = entry.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true)
  if (start + entry.compressed_size > file.size) throw new Error('Файл ZIP обрезан')
  return { blob: file.slice(start, start + entry.compressed_size), name: entry.path, format: entry.format, size: entry.size, compressed: { method: entry.method, crc: entry.crc } }
}

const table = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0 })
export function crc_update (crc: number, bytes: Uint8Array): number { for (const n of bytes) crc = table[(crc ^ n) & 255] ^ crc >>> 8; return crc >>> 0 }
export function crc32 (bytes: Uint8Array): number { return (crc_update(0xffffffff, bytes) ^ 0xffffffff) >>> 0 }
