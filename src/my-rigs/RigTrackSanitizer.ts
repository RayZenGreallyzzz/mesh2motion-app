import type { KeyframeTrack } from 'three'

// Float32 conversion can collapse two source timestamps into one. Removing
// identical samples is lossless; conflicting samples remain invalid.
export function dedupe_identical_keys (track: KeyframeTrack): void {
  const stride = track.getValueSize()
  if (!Number.isInteger(stride) || stride <= 0) throw new Error('Повреждены значения ключевых кадров')
  const keep: number[] = []
  for (let i = 0; i < track.times.length; i++) {
    const previous = keep.at(-1)
    if (previous !== undefined && track.times[i] === track.times[previous]) {
      for (let j = 0; j < stride; j++) if (track.values[i * stride + j] !== track.values[previous * stride + j]) throw new Error('Разные позы в одном ключевом кадре')
    } else keep.push(i)
  }
  if (keep.length === track.times.length) return
  track.times = new Float32Array(keep.map(i => track.times[i]))
  track.values = new Float32Array(keep.flatMap(i => Array.from(track.values.slice(i * stride, (i + 1) * stride))))
}
