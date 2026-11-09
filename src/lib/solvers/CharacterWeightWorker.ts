import { solve_weight_job, solve_packed_weights, type PackedWeightJob, type WeightJob } from './CharacterWeightJob.ts'
self.onmessage = (event: MessageEvent<WeightJob | PackedWeightJob>) => {
  try {
    const job = event.data
    if ('packed' in job) {
      const weights = solve_packed_weights(job, progress => self.postMessage({ progress }))
      self.postMessage({ weights }, { transfer: [weights[0].buffer, weights[1].buffer] })
    } else {
      self.postMessage({ weights: solve_weight_job(job) })
    }
  }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
