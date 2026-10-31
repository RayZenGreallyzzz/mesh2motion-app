import type { MotionInput } from './MotionArchive.ts'
import type { ImportResult } from './MotionImportCore.ts'
export class MotionImportClient {
  private worker?: Worker
  private reject?: (error: Error) => void
  private count = 0
  async read (input: MotionInput, knownIds: string[] = []): Promise<ImportResult> {
    if (this.reject) throw new Error('Дождитесь текущего файла')
    if (!this.worker) this.worker = new Worker(new URL('./motion-import.worker.ts', import.meta.url), { type: 'module' })
    const worker = this.worker
    const result = await new Promise<ImportResult>((resolve, reject) => {
      this.reject = reject
      worker.onmessage = event => { this.reject = undefined; if (event.data.error) { worker.terminate(); this.worker = undefined; this.count = 0; reject(new Error(event.data.error)) } else resolve(event.data.result as ImportResult) }
      worker.onerror = event => { this.reject = undefined; this.worker?.terminate(); this.worker = undefined; reject(new Error(event.message || 'Не удалось прочитать движение')) }
      worker.postMessage({ input, knownIds })
    })
    // FBXLoader holds a module-level parse tree; reclaim it after each FBX.
    if (input.format === 'fbx' || ++this.count >= 64) { worker.terminate(); this.worker = undefined; this.count = 0 }
    return result
  }
  close (): void {
    this.worker?.terminate(); this.worker = undefined
    const reject = this.reject; this.reject = undefined; reject?.(new Error('Импорт остановлен'))
  }
}
