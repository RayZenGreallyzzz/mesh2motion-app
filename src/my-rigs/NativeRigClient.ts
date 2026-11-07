import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type NativePoint = [number, number, number]
export type NativePoints = Record<string, NativePoint>
export type NativeCommand = 'ANALYZE' | 'INITIAL_BODY_GUIDES' | 'PROPOSE_BODY' | 'PREVIEW_BODY' | 'BUILD_SKELETON' | 'COMPUTE_WEIGHTS' | 'EXPORT'
export interface NativeReceipt { status: string, command: string, nativeReturn?: Record<string, unknown>, nativeReport?: Record<string, unknown>, error?: string, outputBytes?: number }
interface NativeBridge {
  capabilities(): Promise<{ available: boolean, reason?: string }>
  begin(options: { size: number }): Promise<{ project: string }>
  append(options: { project: string, offset: number, data: string }): Promise<void>
  prepare(options: { project: string }): Promise<unknown>
  run(options: { project: string, command: NativeCommand, bodyGuides?: NativePoints, bodyLandmarks?: NativePoints, reviewed?: boolean }): Promise<{ receipt: NativeReceipt }>
  read(options: { project: string, kind: 'output' | 'prepared', offset: number, size: number }): Promise<{ data: string, offset: number, total: number }>
  cancel(): Promise<void>
  discard(options: { project: string }): Promise<void>
  addListener(name: 'progress', callback: (event: { project: string, stage: string, percent: number }) => void): Promise<PluginListenerHandle>
}
const bridge = registerPlugin<NativeBridge>('RigNativeEngine')
const chunk_size = 98304

export function native_point(value: unknown): NativePoint | undefined {
  if (!Array.isArray(value) && value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (o.point !== undefined || o.rigPosition !== undefined || o.position !== undefined) return native_point(o.point ?? o.rigPosition ?? o.position)
    value = [o.x, o.y, o.z]
  }
  if (!Array.isArray(value) || value.length !== 3 || value.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1_000_000)) return
  return [...value] as NativePoint
}

function object(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') { try { return object(JSON.parse(value)) } catch { return } }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function native_data(receipt: NativeReceipt): Record<string, unknown> {
  const root = receipt.nativeReport ?? receipt.nativeReturn ?? {}
  return object(root.stats) ?? root
}

export function native_points(receipt: NativeReceipt, field: 'points' | 'landmarks'): NativePoints {
  const data = native_data(receipt), raw = data[field]
  const entries: Array<[string, unknown]> = Array.isArray(raw)
    ? raw.map(value => { const o = object(value); return [String(o?.name ?? ''), o?.point ?? o?.rigPosition ?? o?.position ?? value] })
    : Object.entries(object(raw) ?? {})
  const result: NativePoints = {}
  for (const [name, value] of entries) {
    const point = native_point(value)
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(name) || !point) throw new Error('Движок вернул непонятный ориентир: ' + name)
    result[name] = point
  }
  if (!Object.keys(result).length || Object.keys(result).length > 64) throw new Error('Движок не вернул ожидаемые ориентиры. Модель сохранена; сохраните отчёт для разбора.')
  return result
}

export function native_failure(receipt: NativeReceipt): string | undefined {
  const root = receipt.nativeReport ?? receipt.nativeReturn
  if (receipt.status === 'DONE' && root?.status !== 'FAILED') return
  const code = String(root?.errorCode ?? receipt.status), detail = String(root?.detail ?? receipt.error ?? '')
  if (code === 'UNSUPPORTED_GLTF_EXTENSION') return 'Движок не поддерживает формат ' + detail + '. Исходная модель остаётся на экране.'
  if (code === 'BODY_DEPTH_CONFIRMATION_REQUIRED') return 'Проверьте суставы спереди и сбоку перед расчётом весов.'
  return 'Риггер остановился: ' + code + (detail ? ' · ' + detail : '')
}

export class NativeRigClient {
  project?: string
  readonly receipts: NativeReceipt[] = []
  preparation?: unknown
  constructor(private readonly api: NativeBridge = bridge) {}
  async available(): Promise<{ available: boolean, reason?: string }> {
    if (this.api === bridge && !Capacitor.isNativePlatform()) return { available: false, reason: 'Этот движок доступен в отдельной ARM64-сборке Android.' }
    return await this.api.capabilities()
  }
  async prepare(bytes: ArrayBuffer): Promise<void> {
    if (bytes.byteLength < 20 || bytes.byteLength > 100 * 1024 * 1024) throw new Error('Для нативного риггера нужен GLB меньше 100 МБ.')
    await this.dispose()
    const { project } = await this.api.begin({ size: bytes.byteLength }); this.project = project
    try {
      const data = new Uint8Array(bytes)
      for (let offset = 0; offset < data.length; offset += chunk_size) {
        const part = data.subarray(offset, offset + chunk_size); let text = ''
        for (let i = 0; i < part.length; i += 8192) text += String.fromCharCode(...part.subarray(i, i + 8192))
        await this.api.append({ project, offset, data: btoa(text) })
      }
      this.preparation = await this.api.prepare({ project })
      const prepared = object(this.preparation), receipt = object(prepared?.receipt)
      if (receipt && receipt.status !== 'DONE') throw new Error(String(receipt.error ?? 'Не удалось подготовить модель.'))
    } catch (error) { await this.dispose(); throw error }
  }
  async run(command: NativeCommand, options: { bodyGuides?: NativePoints, bodyLandmarks?: NativePoints, reviewed?: boolean } = {}): Promise<NativeReceipt> {
    if (!this.project) throw new Error('Сначала подготовьте модель.')
    const { receipt } = await this.api.run({ project: this.project, command, ...options })
    this.receipts.push(receipt)
    const error = native_failure(receipt); if (error) throw new Error(error)
    return receipt
  }
  async result(kind: 'output' | 'prepared' = 'output'): Promise<ArrayBuffer> {
    if (!this.project) throw new Error('Сессия недоступна.')
    let data: Uint8Array | undefined, offset = 0
    do {
      const part = await this.api.read({ project: this.project, kind, offset, size: chunk_size })
      if (!Number.isSafeInteger(part.total) || part.total < 20 || part.total > 128 * 1024 * 1024 || part.offset !== offset || (data && data.byteLength !== part.total)) throw new Error('Нарушен размер результата.')
      data ??= new Uint8Array(part.total)
      const text = atob(part.data)
      if (!text.length || text.length > chunk_size || offset + text.length > data.length) throw new Error('Нарушен порядок получения результата.')
      for (let i = 0; i < text.length; i++) data[offset + i] = text.charCodeAt(i)
      offset += text.length
    } while (offset < data.length)
    const header = new DataView(data.buffer)
    if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== data.length) throw new Error('Движок вернул повреждённый GLB.')
    return data.buffer
  }
  async cancel(): Promise<void> { await this.api.cancel() }
  async listen(callback: (stage: string, percent: number) => void): Promise<PluginListenerHandle> {
    return await this.api.addListener('progress', event => { if (event.project === this.project) callback(event.stage, event.percent) })
  }
  async dispose(): Promise<void> {
    const id = this.project; this.project = undefined; this.receipts.length = 0; this.preparation = undefined
    if (id) { try { await this.api.discard({ project: id }) } catch { /* An active worker owns its files until cancelled. */ } }
  }
}
