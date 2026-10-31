import { LoadingManager, Texture, TextureLoader } from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { dispose_rig_scene } from './RigAsset.ts'
import { document_from_fbx_scene, type MotionDocument } from './MotionDocument.ts'
import { MB } from './MotionArchive.ts'

export function validate_fbx_budget (bytes: ArrayBuffer): void {
  if (bytes.byteLength > 64 * MB || bytes.byteLength < 27) throw new Error('FBX: размер должен быть не больше 64 МБ')
  if (new TextDecoder().decode(new Uint8Array(bytes, 0, 21)) !== 'Kaydara FBX Binary  \0') {
    if (bytes.byteLength > 32 * MB) throw new Error('Текстовый FBX больше 32 МБ. Сохраните бинарный FBX без сетки.')
    return
  }
  const view = new DataView(bytes), wide = view.getUint32(23, true) >= 7500, header = wide ? 25 : 13
  let nodes = 0, allocated = 0
  const u64 = (p: number) => { const n = Number(view.getBigUint64(p, true)); if (!Number.isSafeInteger(n)) throw new Error('Повреждён размер FBX'); return n }
  const node = (start: number, depth: number): number => {
    if (++nodes > 100000 || depth > 128 || start + header > bytes.byteLength) throw new Error('Слишком сложная структура FBX')
    const end = wide ? u64(start) : view.getUint32(start, true)
    if (!end) return start + header
    const count = wide ? u64(start + 8) : view.getUint32(start + 4, true), length = wide ? u64(start + 16) : view.getUint32(start + 8, true)
    let p = start + header + view.getUint8(start + header - 1), propertyEnd = p + length
    if (end <= start || end > bytes.byteLength || propertyEnd > end || count > 100000) throw new Error('Повреждён узел FBX')
    for (let i = 0; i < count; i++) {
      if (p >= propertyEnd) throw new Error('Оборвано свойство FBX')
      const type = String.fromCharCode(view.getUint8(p++)), scalar: Record<string, number> = { Y:2, C:1, I:4, F:4, D:8, L:8 }
      if (scalar[type]) p += scalar[type]
      else if (type === 'S' || type === 'R') { if (p + 4 > propertyEnd) throw new Error('Оборвано свойство FBX'); const n = view.getUint32(p, true); p += 4 + n; allocated += n }
      else if ('fdlicb'.includes(type)) {
        if (p + 12 > propertyEnd) throw new Error('Оборван массив FBX')
        const n = view.getUint32(p, true), encoding = view.getUint32(p + 4, true), compressed = view.getUint32(p + 8, true), width = type === 'd' || type === 'l' ? 8 : type === 'f' || type === 'i' ? 4 : 1, expanded = n * width
        if (expanded > 64 * MB || encoding > 1) throw new Error('Один массив FBX слишком велик')
        allocated += expanded; p += 12 + (encoding ? compressed : expanded)
      } else throw new Error('Неизвестное свойство FBX')
      if (p > propertyEnd || allocated > 192 * MB) throw new Error('FBX требует слишком много памяти. Используйте анимацию без сетки.')
    }
    if (p !== propertyEnd) throw new Error('Размер свойств FBX не совпадает')
    while (p < end) p = node(p, depth + 1)
    if (p !== end) throw new Error('Размер узла FBX не совпадает')
    return end
  }
  let offset = 27
  while (offset + header <= bytes.byteLength) { if ((wide ? u64(offset) : view.getUint32(offset, true)) === 0) break; offset = node(offset, 0) }
}

export function parse_fbx_motion (bytes: ArrayBuffer, name: string): MotionDocument {
  validate_fbx_budget(bytes)
  const manager = new LoadingManager(), textures = new TextureLoader(manager)
  textures.load = () => new Texture()
  manager.addHandler(/.*/, textures)
  manager.setURLModifier(() => { throw new Error('Движению не нужны внешние файлы') })
  const scene = new FBXLoader(manager).parse(bytes, '')
  try { return document_from_fbx_scene(scene, name) } finally { dispose_rig_scene(scene) }
}
