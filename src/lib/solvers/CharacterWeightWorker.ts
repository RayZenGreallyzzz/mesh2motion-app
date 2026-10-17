import { solve_weight_job, type WeightJob } from './CharacterWeightJob.ts'
self.onmessage = (event: MessageEvent<WeightJob>) => {
  try { self.postMessage({ weights: solve_weight_job(event.data) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
