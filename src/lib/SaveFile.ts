interface NativeBridge {
  postMessage: (message: string) => void
  onmessage: ((event: { data: string }) => void) | null
}

declare global {
  interface Window { Mesh2MotionNative?: NativeBridge }
}

let active_download = false
let next_id = 0
const pending = new Map<string, { resolve: () => void, reject: (error: Error) => void }>()
let connected_bridge: NativeBridge | undefined

function request (bridge: NativeBridge, data: Record<string, unknown>): Promise<void> {
  if (connected_bridge !== bridge) {
    connected_bridge = bridge
    bridge.onmessage = event => {
      const result = JSON.parse(event.data) as { id: string, ok: boolean, cancelled?: boolean, error?: string }
      const waiter = pending.get(result.id)
      if (!waiter) return
      pending.delete(result.id)
      if (result.ok) waiter.resolve()
      else waiter.reject(result.cancelled
        ? new DOMException('Сохранение отменено', 'AbortError')
        : new Error(result.error || 'Не удалось сохранить файл'))
    }
  }
  const id = String(++next_id)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try { bridge.postMessage(JSON.stringify({ ...data, id })) } catch (error) {
      pending.delete(id)
      reject(error)
    }
  })
}

/** Native export uses bounded, acknowledged chunks rather than one huge data URL. */
export async function save_file (blob: Blob, filename: string): Promise<void> {
  const bridge = window.Mesh2MotionNative
  if (!bridge) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return
  }
  if (active_download) throw new Error('Дождись завершения текущего сохранения')
  active_download = true
  const transfer = crypto.randomUUID()
  try {
    await request(bridge, { action: 'begin', transfer, filename, size: blob.size, mime: blob.type })
    for (let offset = 0; offset < blob.size; offset += 192 * 1024) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + 192 * 1024).arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      }
      await request(bridge, { action: 'chunk', transfer, offset, data: btoa(binary) })
    }
    // Resolves only after the system Save As dialog and actual file write finish.
    await request(bridge, { action: 'finish', transfer })
  } catch (error) {
    await request(bridge, { action: 'cancel', transfer }).catch(() => {})
    throw error
  } finally {
    active_download = false
  }
}
