import { Capacitor, registerPlugin } from '@capacitor/core'

interface NativeFileExport {
  begin (options: { filename: string, size: number }): Promise<{ id: string }>
  append (options: { id: string, offset: number, data: string }): Promise<void>
  finish (options: { id: string }): Promise<{ status: 'saved' | 'cancelled' }>
  abort (options: { id: string }): Promise<void>
}

const native_export = registerPlugin<NativeFileExport>('RigFileExport')

export class ExportCancelledError extends Error {
  constructor () { super('Сохранение отменено') }
}

export class ExportFileSaver {
  static is_android (): boolean { return Capacitor.getPlatform() === 'android' }

  public async save (blob: Blob, filename: string): Promise<void> {
    if (blob.size === 0) throw new Error('Экспорт создал пустой файл')
    if (ExportFileSaver.is_android()) {
      await this.save_android(blob, filename)
      return
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.hidden = true
    document.body.append(link)
    try { link.click() } finally {
      link.remove()
      // The browser needs time to acquire the blob, especially on mobile.
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    }
  }

  private async save_android (blob: Blob, filename: string): Promise<void> {
    const { id } = await native_export.begin({ filename, size: blob.size })
    try {
      // Avoid a second full-file base64 copy across the WebView bridge.
      const chunk_size = 256 * 1024
      for (let offset = 0; offset < blob.size; offset += chunk_size) {
        const data = await this.read_base64(blob.slice(offset, offset + chunk_size))
        await native_export.append({ id, offset, data })
      }
      const result = await native_export.finish({ id })
      if (result.status === 'cancelled') throw new ExportCancelledError()
      if (result.status !== 'saved') throw new Error('Android не подтвердил запись файла')
    } finally {
      // Idempotent: finish also removes its temporary file, including on cancel.
      await native_export.abort({ id }).catch(() => {})
    }
  }

  private read_base64 (blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error ?? new Error('Не удалось подготовить файл'))
      reader.onabort = () => reject(new ExportCancelledError())
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.readAsDataURL(blob)
    })
  }
}
