import { refineAnimationWeights, type MotionWeightInput } from './AnimationWeightRefiner.ts'

// Instantiated as a module worker by Vite. Work stays off the viewport thread.
self.onmessage = (event: MessageEvent<MotionWeightInput>) => {
  try {
    const result = refineAnimationWeights(event.data, {
      onProgress: fraction => self.postMessage({ type: 'progress', fraction })
    })
    self.postMessage({ type: 'result', ...result }, { transfer: [result.weights.buffer] })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
