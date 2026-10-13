import { describe, expect, it } from 'vitest'
import { AnimationClip, QuaternionKeyframeTrack } from 'three'
import { StepAnimationsListing } from './StepAnimationsListing.ts'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'
import { type ThemeManager } from '../../ThemeManager.ts'

describe('animation warp invalidation', () => {
  it('updates the active clip during a drag and resolves every clip before export without accumulating warps', () => {
    const pairs: TransformedAnimationClipPair[] = [0, 1].map(index => {
      const clip = new AnimationClip(`clip${index}`, 1, [
        new QuaternionKeyframeTrack('upperarm_l.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
      ])
      return {
        original_animation_clip: clip,
        display_animation_clip: clip.clone(),
        metadata: { source_type: 'default-library', tags: [] }
      }
    })
    const listing = new StepAnimationsListing({} as ThemeManager)
    Object.assign(listing, { animation_clips_loaded: pairs })
    listing.apply_model_variation_arm_extension(7)
    expect(pairs[0].display_animation_clip.tracks[0].values[2]).toBeCloseTo(-Math.sin(0.035), 6)
    expect(pairs[1].display_animation_clip.tracks[0].values[2]).toBe(0)
    const exported = listing.animation_clips()
    expect(exported[1].tracks[0].values[2]).toBeCloseTo(-Math.sin(0.035), 6)
    listing.apply_model_variation_arm_extension(-50)
    for (const clip of listing.animation_clips()) {
      expect(clip.tracks[0].values[2]).toBeCloseTo(Math.sin(0.25), 6)
    }
    for (const pair of pairs) expect(pair.original_animation_clip.tracks[0].values[2]).toBe(0)
    listing.apply_model_variation_arm_extension(0)
    for (const clip of listing.animation_clips()) expect(clip.tracks[0].values[2]).toBeCloseTo(0, 6)
  })
})
