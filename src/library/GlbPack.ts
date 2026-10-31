import './pack-style.css'
import JSZip from 'jszip'
import { inspect_glb } from '../my-rigs/GlbEnvelope.ts'
import { RigLibrary } from '../my-rigs/RigLibrary.ts'

const MB = 1048576
export interface PackEntry { path: string, bytes: number, crc: number, file: JSZip.JSZipObject }
export interface GlbPack { entries: PackEntry[], blend_count: number }

export async function open_glb_pack (bytes: ArrayBuffer): Promise<GlbPack> {
  if (bytes.byteLength > 128 * MB) throw new Error('ZIP больше 128 МБ. Разделите набор.')
  const zip = await JSZip.loadAsync(bytes), files = Object.values(zip.files)
  if (files.length > 4096) throw new Error('В ZIP слишком много файлов')
  const entries: PackEntry[] = []
  let total = 0, blend_count = 0
  for (const file of files) {
    const internal = file as JSZip.JSZipObject & { unsafeOriginalName?: string, _data?: { uncompressedSize: number, crc32: number } }
    const path = internal.unsafeOriginalName ?? file.name
    if (/^[\\/]|^[a-z]:|\0/i.test(path) || path.replace(/\\/g, '/').split('/').includes('..')) throw new Error('Небезопасный путь в ZIP')
    if (file.dir) continue
    if (/\.blend$/i.test(path)) blend_count++
    if (!/\.glb$/i.test(path)) continue
    const size = internal._data?.uncompressedSize, crc = internal._data?.crc32
    if (!Number.isSafeInteger(size) || !size || size > 128 * MB || crc === undefined) throw new Error('Некорректный размер GLB в ZIP')
    total += size
    if (total > 512 * MB || entries.length >= 256) throw new Error('Набор слишком большой: максимум 256 GLB и 512 МБ после распаковки')
    entries.push({ path, bytes: size, crc: crc >>> 0, file })
  }
  return { entries, blend_count }
}

const crc_table = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
export async function read_pack_entry (entry: PackEntry): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const stream = (entry.file as JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array')
    const chunks: Uint8Array[] = []; let size = 0, crc = 0xffffffff, failed = false
    stream.on('data', chunk => {
      if (failed) return
      size += chunk.length
      if (size > entry.bytes || size > 128 * MB) { failed = true; stream.pause(); reject(new Error('Размер распаковки превышает лимит')); return }
      for (const byte of chunk) crc = crc_table[(crc ^ byte) & 255] ^ (crc >>> 8)
      chunks.push(chunk)
    }).on('error', reject).on('end', () => {
      if (failed) return
      if (size !== entry.bytes || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) { reject(new Error('ZIP повреждён: размер или CRC не совпадает')); return }
      const bytes = new Uint8Array(size); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      resolve(bytes.buffer)
    }).resume()
  })
}

export async function save_pack_entry (entry: PackEntry, title: string, library = new RigLibrary()): Promise<boolean> {
  const bytes = await read_pack_entry(entry), document = inspect_glb(bytes)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const id = 'sha256-' + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  if ((await library.list()).some(item => item.id === id)) return false
  try {
    await library.save({ id, title: entry.path.split('/').pop()!.replace(/\.glb$/i, ''), created_at: Date.now(), bytes: bytes.byteLength,
      clip_count: document.animations?.length ?? 0, bone_count: new Set(document.skins?.flatMap(skin => skin.joints) ?? []).size,
      skeleton_count: document.skins?.length ?? 0, source_pack: title, source_path: entry.path }, bytes)
  } catch (error) { if (error instanceof DOMException && error.name === 'ConstraintError') return false; throw error }
  return true
}

export function show_pack_import (pack: GlbPack, name: string, on_saved: () => void): void {
  const dialog = document.createElement('dialog'); dialog.className = 'pack-dialog'
  const title = document.createElement('h2'); title.textContent = 'Импорт набора GLB'
  const message = document.createElement('p'); message.textContent = name + ' · ' + pack.entries.length + ' GLB' + (pack.blend_count ? ' · .blend требуют конвертации в GLB на компьютере.' : '')
  const list = document.createElement('div'); list.className = 'pack-list'
  const checks = pack.entries.map(entry => {
    const label = document.createElement('label'), check = document.createElement('input'), text = document.createElement('span')
    check.type = 'checkbox'; check.checked = true; text.textContent = entry.path + ' · ' + (entry.bytes / MB).toFixed(1) + ' МБ'
    label.append(check, text); list.append(label); return check
  })
  const all = document.createElement('button'), none = document.createElement('button'), start = document.createElement('button'), close = document.createElement('button')
  all.textContent = 'Все'; none.textContent = 'Снять выбор'; start.textContent = 'Импортировать выбранные'; close.textContent = 'Закрыть'
  all.onclick = () => checks.forEach(check => { check.checked = true }); none.onclick = () => checks.forEach(check => { check.checked = false })
  const actions = document.createElement('div'); actions.className = 'pack-actions'; actions.append(all, none, start, close)
  const log = document.createElement('p'); log.className = 'pack-log'; log.setAttribute('role', 'status')
  let busy = false, cancel = false, changed = false
  const finish = () => { dialog.close(); dialog.remove(); if (changed) on_saved() }
  close.onclick = () => { if (busy) { cancel = true; close.textContent = 'Завершаю…' } else finish() }
  dialog.oncancel = event => { event.preventDefault(); close.click() }
  start.onclick = async () => {
    if (busy) return
    busy = true; cancel = false; close.textContent = 'Остановить'; all.disabled = none.disabled = start.disabled = true
    checks.forEach(check => { check.disabled = true })
    let saved = 0, duplicates = 0, errors = 0
    try { await navigator.storage?.persist?.() } catch {}
    for (let i = 0; i < pack.entries.length && !cancel; i++) {
      if (!checks[i].checked) continue
      log.textContent = 'Импорт: ' + pack.entries[i].path
      try { if (await save_pack_entry(pack.entries[i], name)) saved++; else duplicates++; changed = true }
      catch (error) {
        errors++; const item = document.createElement('p'); item.textContent = pack.entries[i].path + ': ' + String(error); item.className = 'error'; list.append(item)
        if (error instanceof DOMException && error.name === 'QuotaExceededError') break
      }
    }
    busy = false; close.textContent = 'Закрыть'; all.disabled = none.disabled = start.disabled = false; checks.forEach(check => { check.disabled = false })
    log.textContent = `Сохранено: ${saved}. Уже было: ${duplicates}. Ошибок: ${errors}.`
  }
  dialog.append(title, message, actions, list, log); document.body.append(dialog); dialog.showModal()
}
