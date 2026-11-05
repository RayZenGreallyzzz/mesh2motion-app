// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { AnimationClip } from 'three'
import type { ThemeManager } from '../../ThemeManager.ts'
import { SkeletonType } from '../../enums/SkeletonType.ts'
import type { TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'
vi.mock('../../components/animation-request/AnimationRequestDialog', () => ({ AnimationRequestDialog: { enable_request_links: () => {} } }))
vi.mock('../../RigConfig', () => ({ RigConfig: { by_skeleton_type: () => ({ animation_preview_folder: 'human' }) } }))
import { AnimationSearch } from './AnimationSearch.ts'

afterEach(() => vi.unstubAllGlobals())

it('releases old list handlers so importing a sorted clip cannot also select its old neighbour', () => {
  vi.stubGlobal('IntersectionObserver', class {
    observe () {}
    disconnect () {}
  })
  document.body.innerHTML = '<input id="filter"><div id="list"></div>'
  const theme = Object.assign(new EventTarget(), { get_current_theme: () => 'dark' }) as unknown as ThemeManager
  const pair = (name: string): TransformedAnimationClipPair => {
    const clip = new AnimationClip(name, 1, [])
    return { original_animation_clip: clip, display_animation_clip: clip,
      metadata: { source_type: 'custom-import', tags: [] } }
  }
  const idle = pair('NinjaJump_Idle'), mixamo = pair('Mixamo_Walk_Test')
  const old = new AnimationSearch('filter', 'list', theme, SkeletonType.Human)
  old.initialize_animations([idle])
  old.dispose()
  const current = new AnimationSearch('filter', 'list', theme, SkeletonType.Human)
  current.initialize_animations([mixamo, idle])
  const checkbox = document.querySelector<HTMLInputElement>('input[value="0"]')!
  checkbox.checked = true
  checkbox.dispatchEvent(new Event('change', { bubbles: true }))
  expect(current.get_selected_animation_indices()).toEqual([0])
  expect(current.get_selected_export_animation_count()).toBe(1)
  const filter = document.querySelector<HTMLInputElement>('#filter')!
  filter.value = 'Ninja'
  filter.dispatchEvent(new Event('input'))
  expect(document.querySelector<HTMLInputElement>('input[value="1"]')!.checked).toBe(false)
  current.dispose()
})
