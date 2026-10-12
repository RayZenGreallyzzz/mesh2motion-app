import { type BufferGeometry } from 'three'

/**
 * Normalize the four skin weights of each vertex to a finite, nonnegative
 * partition of unity. Never add equal residuals to occupied slots: that does
 * not preserve relative influence and fails when the active slot count != 3.
 */
export class WeightNormalizer {
  constructor (private readonly geometry: BufferGeometry) {}

  private geometry_vertex_count (): number {
    return this.geometry.getAttribute('position')?.count ?? 0
  }

  public find_vertices_with_incorrect_weight_sum (skin_weights: number[]): number[] {
    const incorrect: number[] = []
    for (let vertex = 0; vertex < this.geometry_vertex_count(); vertex++) {
      const offset = vertex * 4
      let total = 0
      let invalid = false
      for (let slot = 0; slot < 4; slot++) {
        const value = skin_weights[offset + slot]
        if (!Number.isFinite(value) || value < 0) invalid = true
        else total += value
      }
      if (invalid || Math.abs(total - 1) > 1e-4) incorrect.push(vertex)
    }
    return incorrect
  }

  public normalize_weights (all_skin_weights: number[]): void {
    for (let vertex = 0; vertex < this.geometry_vertex_count(); vertex++) {
      const offset = vertex * 4
      let sum = 0
      for (let slot = 0; slot < 4; slot++) {
        const raw = all_skin_weights[offset + slot]
        const weight = Number.isFinite(raw) && raw > 0 ? raw : 0
        all_skin_weights[offset + slot] = weight
        sum += weight
      }
      if (sum <= 1e-12) {
        // Keep an unmapped vertex stable by assigning it fully to slot 0.
        // The caller is responsible for ensuring skinIndex[0] is a valid bone.
        all_skin_weights[offset] = 1
        for (let slot = 1; slot < 4; slot++) all_skin_weights[offset + slot] = 0
      } else {
        for (let slot = 0; slot < 4; slot++) all_skin_weights[offset + slot] /= sum
      }
    }
  }
}
