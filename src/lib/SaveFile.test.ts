import { afterEach, describe, expect, it } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { save_file } from './SaveFile'

afterEach(() => { delete window.Mesh2MotionNative })

describe('Android file export protocol', () => {
  it('streams the exact bytes in bounded chunks and waits for the picker to finish', async () => {
    const source = Uint8Array.from({ length: 450_000 }, (_, i) => i % 251)
    const chunks: Uint8Array[] = []
    let finish: (() => void) | undefined
    let saved = false
    window.Mesh2MotionNative = {
      onmessage: null,
      postMessage (text) {
        const message = JSON.parse(text)
        const reply = (): void => window.Mesh2MotionNative!.onmessage!({ data: JSON.stringify({ id: message.id, ok: true }) })
        if (message.action === 'chunk') {
          expect(message.data.length).toBeLessThanOrEqual(262144)
          expect(message.offset).toBe(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
          chunks.push(Uint8Array.from(atob(message.data), char => char.charCodeAt(0)))
        }
        if (message.action === 'finish') finish = reply
        else queueMicrotask(reply)
      }
    }
    const operation = save_file(new NodeBlob([source]) as unknown as Blob, 'character.glb').then(() => { saved = true })
    // Wait for the native Save As request, not a fixed delay.
    for (let i = 0; i < 100 && !finish; i++) await new Promise(resolve => setTimeout(resolve, 0))
    expect(finish).toBeDefined()
    expect(saved).toBe(false)
    const combined = new Uint8Array(source.length)
    let offset = 0
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length }
    expect(combined).toEqual(source)
    finish!()
    await operation
    expect(saved).toBe(true)
  })

  it('reports cancellation and releases the export so a later save works', async () => {
    let cancel = true
    window.Mesh2MotionNative = {
      onmessage: null,
      postMessage (text) {
        const message = JSON.parse(text)
        const cancelled = message.action === 'finish' && cancel
        queueMicrotask(() => window.Mesh2MotionNative!.onmessage!({ data: JSON.stringify({ id: message.id, ok: !cancelled, cancelled }) }))
      }
    }
    const blob = new NodeBlob(['model']) as unknown as Blob
    await expect(save_file(blob, 'character.glb')).rejects.toMatchObject({ name: 'AbortError' })
    cancel = false
    await expect(save_file(blob, 'character.glb')).resolves.toBeUndefined()
  })
})
