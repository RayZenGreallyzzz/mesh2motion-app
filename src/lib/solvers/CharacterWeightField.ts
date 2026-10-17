import { BufferGeometry, Float32BufferAttribute } from 'three'
import SkinningAlgorithm from './SkinningAlgorithm.ts'
import { type WeightJob } from './CharacterWeightJob.ts'

/** One surface graph across every mesh, including welded material seams. */
export class CharacterWeightField {
  private cached: { key: string, positions: number[], triangles: number[], weights: number[][] } | undefined

  private collect (geometries: BufferGeometry[]) {
    const positions: number[] = [], triangles: number[] = []
    for (const geometry of geometries) {
      const attribute = geometry.getAttribute('position')
      const offset = positions.length / 3
      for (let i = 0; i < attribute.count; i++) positions.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i))
      for (let i = 0; i < (geometry.index?.count ?? attribute.count); i++) triangles.push(offset + (geometry.index?.getX(i) ?? i))
    }
    return { positions, triangles }
  }

  private matches (key: string, positions: number[], triangles: number[]): boolean {
    const cached = this.cached
    const equal = (a: number[], b: number[]) => a.length === b.length && a.every((value, i) => value === b[i])
    return !!cached && cached.key === key && equal(positions, cached.positions) && equal(triangles, cached.triangles)
  }

  public async prepare (geometries: BufferGeometry[], solver: SkinningAlgorithm): Promise<void> {
    const { positions, triangles } = this.collect(geometries)
    const key = solver.cache_key()
    if (this.matches(key, positions, triangles)) return
    if (typeof Worker === 'undefined') { this.calculate(geometries, solver); return }
    const worker = new Worker(new URL('./CharacterWeightWorker.ts', import.meta.url), { type: 'module' })
    try {
      const weights = await new Promise<number[][]>((resolve, reject) => {
        worker.onmessage = event => event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.weights)
        worker.onerror = event => reject(new Error(event.message))
        worker.postMessage({ ...solver.worker_config(), positions, triangles } satisfies WeightJob)
      })
      this.cached = { key, positions, triangles, weights }
    } finally { worker.terminate() }
  }

  public calculate (geometries: BufferGeometry[], solver: SkinningAlgorithm): number[][][] {
    const { positions, triangles } = this.collect(geometries)
    const key = solver.cache_key()
    if (!this.matches(key, positions, triangles)) {
      const combined = new BufferGeometry()
      combined.setAttribute('position', new Float32BufferAttribute(positions, 3))
      combined.setIndex(triangles)
      solver.set_geometry(combined)
      const weights = solver.calculate_indexes_and_weights()
      combined.dispose()
      this.cached = { key, positions, triangles, weights }
    }
    let offset = 0
    return geometries.map(geometry => {
      const count = geometry.getAttribute('position').count * 4
      const result = this.cached!.weights.map(values => values.slice(offset, offset + count))
      offset += count
      return result
    })
  }
}
