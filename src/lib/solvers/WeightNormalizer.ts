import { type BufferGeometry } from 'three'

/**
 * Ensure every vertex has four finite nonnegative skin weights summing to one.
 * A previous correction distributed (1 - sum) / 3 across nonzero slots, which
 * can leave invalid totals (or create negative weights when sum > 1).
 */
export class WeightNormalizer {
  constructor (private readonly geometry: BufferGeometry) {}

  public find_vertices_with_incorrect_weight_sum (skin_weights: number[]): number[] {
    const incorrect: number[] = []
    const count = this.geometry.attributes.position.count
    for (let vertex = 0; vertex < count; vertex++) {
      let sum = 0
      let has_invalid = false
      for (let slot = 0; slot < 4; slot++) {
        const weight = skin_weights[vertex * 4 + slot]
        if (!Number.isFinite(weight) || weight < 0) {
          has_invalid = true
        } else {
          sum += weight
        }
      }
      if (has_invalid || Math.abs(sum - 1) > 1e-4) incorrect.push(vertex)
    }
    return incorrect
  }

  public normalize_weights (skin_weights: number[]): void {
    const count = this.geometry.attributes.position.count
    for (let vertex = 0; vertex < count; vertex++) {
      const offset = vertex * 4
      let total = 0
      for (let slot = 0; slot < 4; slot++) {
        const weight = skin_weights[offset + slot]
        const valid = Number.isFinite(weight) && weight > 0 ? weight : 0
        skin_weights[offset + slot] = valid
        total += valid
      }

      if (total <= 1e-12) {
        // Preserve the existing primary bone index; an empty influence list
        // must still have a valid normalized primary weight.
        skin_weights[offset] = 1
        skin_weights[offset + 1] = 0
        skin_weights[offset + 2] = 0
        skin_weights[offset + 3] = 0
      } else {
        for (let slot = 0; slot < 4; slot++) {
          skin_weights[offset + slot] /= total
        }
      }
    }
  }
}
