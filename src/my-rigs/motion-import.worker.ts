import { import_motion_input, result_buffers } from './MotionImportCore.ts'
import type { MotionInput } from './MotionArchive.ts'
// FBXLoader references window for embedded-image URLs and camera defaults.
// This worker imports skeletal motion only; no image decoding/network is needed.
Object.assign(globalThis, { window: { URL: { createObjectURL: () => 'data:application/octet-stream;base64,' }, innerWidth: 1, innerHeight: 1 } })
const worker = globalThis as unknown as { onmessage: (event: MessageEvent<{ input: MotionInput, knownIds: string[] }>) => void, postMessage: (data: unknown, transfer?: Transferable[]) => void }
worker.onmessage = async event => {
  try { const result = await import_motion_input(event.data.input, event.data.knownIds); worker.postMessage({ result }, result_buffers(result)) }
  catch (error) { worker.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
