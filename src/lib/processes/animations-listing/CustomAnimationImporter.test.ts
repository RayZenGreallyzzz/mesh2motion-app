// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { AnimationClip, Bone, QuaternionKeyframeTrack, Skeleton, SkinnedMesh } from 'three'
import type { TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'
import type { AnimationLoader } from './AnimationLoader.ts'
const ui = vi.hoisted(() => ({ dom_import_animations_button: null as HTMLButtonElement | null, dom_import_animations_input: null as HTMLInputElement | null }))
vi.mock('../../UI.ts', () => ({ UI: { getInstance: () => ui } }))
import { CustomAnimationImporter } from './CustomAnimationImporter.ts'

describe('Animation import batch lifecycle', () => {
  it('keeps the picker disabled across intermediate success events and rejects concurrent batches', async () => {
    document.body.innerHTML = '<button id="import"></button><input id="files" type="file" multiple>'
    ui.dom_import_animations_button = document.querySelector('button')
    ui.dom_import_animations_input = document.querySelector('input')
    const waiting: Array<(pairs: TransformedAnimationClipPair[]) => void> = []
    const read = vi.fn(() => new Promise<TransformedAnimationClipPair[]>(resolve => waiting.push(resolve)))
    const importer = new CustomAnimationImporter({ load_animations_from_input: read } as unknown as AnimationLoader)
    const root = new Bone(); root.name = 'root'
    const mesh = new SkinnedMesh(); mesh.skeleton = new Skeleton([root]); mesh.add(root)
    const pool: TransformedAnimationClipPair[] = []
    importer.remember_rest_pose(mesh)
    importer.set_import_context_provider(() => ({ skinned_meshes_to_animate: [mesh], skeleton_scale: 1,
      known_ids: pool.flatMap(pair => pair.metadata.tags) }))
    const disabledOnSuccess: boolean[] = []
    importer.addEventListener('import-success', event => {
      pool.push(...(event as CustomEvent<TransformedAnimationClipPair[]>).detail)
      importer.set_enabled(true)
      disabledOnSuccess.push(ui.dom_import_animations_button!.disabled)
    })
    const files = [new File(['one'], 'one.glb'), new File(['two'], 'two.glb')]
    Object.defineProperty(ui.dom_import_animations_input, 'files', { value: files, configurable: true })
    ui.dom_import_animations_input!.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    expect(ui.dom_import_animations_button!.disabled).toBe(true)
    const pair = (name: string): TransformedAnimationClipPair => {
      const clip = new AnimationClip(name, 1, [new QuaternionKeyframeTrack('root.quaternion',[0],[0,0,0,1])])
      return { original_animation_clip: clip, display_animation_clip: clip.clone(), metadata: { source_type: 'custom-import', tags: ['sha256-' + name] } }
    }
    waiting.shift()!([pair('one')])
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    ui.dom_import_animations_input!.dispatchEvent(new Event('change'))
    expect(read).toHaveBeenCalledTimes(2)
    waiting.shift()!([pair('two')])
    await vi.waitFor(() => expect(document.querySelector('.modal-dialog-body')?.textContent).toContain('Добавлено анимаций: 2'))
    expect(disabledOnSuccess).toEqual([true,true])
    expect(ui.dom_import_animations_button!.disabled).toBe(false)
    expect(pool).toHaveLength(2)
  })
})
