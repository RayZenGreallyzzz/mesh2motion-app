import { RestSpaceRetargeter, type BoneRestSpace } from '../../../retarget/RestSpaceRetargeter.ts'
import { UI } from '../../UI.ts'
import { ModalDialog } from '../../ModalDialog.ts'
import { PlatformUtils } from '../../PlatformUtils.ts'
import { type Skeleton, type SkinnedMesh } from 'three'
import { archive_input, input_format, open_motion_archive, type MotionInput } from '../../../my-rigs/MotionArchive.ts'
import { type AnimationLoader } from './AnimationLoader.ts'
import CustomAnimationValidation from './CustomAnimationValidation.ts'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'

/**
 * Imports GLB/FBX animations and ZIP batches with the active target rest pose.
 * This class encapsulates the UI and logic for the import process.
 */
export class CustomAnimationImporter extends EventTarget {
  private readonly rest_spaces = new WeakMap<Skeleton, Map<string, BoneRestSpace>>()
  private known_ids: string[] = []
  private readonly ui: UI
  private readonly animation_loader: AnimationLoader
  private skinned_meshes_to_animate: SkinnedMesh[] = []
  private skeleton_scale: number = 1.0
  private import_context_provider: (() => { skinned_meshes_to_animate: SkinnedMesh[], skeleton_scale: number, known_ids?: string[] }) | null = null
  private enabled: boolean = true
  private importing: boolean = false
  private has_added_event_listeners: boolean = false

  constructor (animation_loader: AnimationLoader) {
    super()
    this.ui = UI.getInstance()
    this.animation_loader = animation_loader
    this.prepare_mobile_import_ui()
    this.add_event_listeners()
  }

  public remember_rest_pose (mesh: SkinnedMesh): void {
    if (this.rest_spaces.has(mesh.skeleton)) return
    const poses = new Map<string, BoneRestSpace>()
    for (const bone of mesh.skeleton.bones) {
      if (mesh.skeleton.bones.includes(bone.parent as never)) continue
      for (const [name, pose] of RestSpaceRetargeter.capture(bone)) poses.set(name, pose)
    }
    this.rest_spaces.set(mesh.skeleton, poses)
  }

  public set_import_context (skinned_meshes_to_animate: SkinnedMesh[], skeleton_scale: number): void {
    this.skinned_meshes_to_animate = skinned_meshes_to_animate
    this.skeleton_scale = skeleton_scale
  }

  public set_import_context_provider (provider: () => { skinned_meshes_to_animate: SkinnedMesh[], skeleton_scale: number, known_ids?: string[] }): void {
    this.import_context_provider = provider
  }

  public set_enabled (enabled: boolean): void {
    this.enabled = enabled
    if (this.ui.dom_import_animations_button != null) {
      this.ui.dom_import_animations_button.disabled = !this.is_enabled()
    }
  }

  public is_enabled (): boolean {
    return this.enabled && !this.importing
  }

  private prepare_mobile_import_ui (): void {
    const button = this.ui.dom_import_animations_button
    if (button !== null && button.querySelector('.ras-import-animation-label') === null) {
      const label = document.createElement('span')
      label.className = 'ras-import-animation-label'
      label.textContent = 'Импорт движений'
      button.appendChild(label)
      button.title = 'Импортировать анимации GLB, FBX или ZIP с Mixamo'
      button.setAttribute('aria-label', 'Импортировать анимации GLB, FBX или ZIP с Mixamo')
    }

    // Android document providers report GLB files under several different MIME
    // types. Let the picker show all files and validate the extension ourselves.
    if ((PlatformUtils.isAndroid() || PlatformUtils.isIOS()) && this.ui.dom_import_animations_input !== null) {
      this.ui.dom_import_animations_input.setAttribute('accept', '*/*')
    }
  }

  private add_event_listeners (): void {
    if (this.has_added_event_listeners) {
      return
    }

    this.ui.dom_import_animations_button?.addEventListener('click', () => {
      if (!this.is_enabled()) {
        return
      }
      this.sync_import_context_from_provider()
      this.ui.dom_import_animations_input?.click()
    })

    this.ui.dom_import_animations_input?.addEventListener('change', (event) => {
      void this.handle_import_animations_input_change(event)
    })

    this.has_added_event_listeners = true
  }

  private async handle_import_animations_input_change (event: Event): Promise<void> {
    if (!this.is_enabled()) {
      return
    }

    this.sync_import_context_from_provider()

    // potentially allow multiple files
    const input = event.target as HTMLInputElement
    const files = input.files
    if (files === null || files.length === 0) {
      return
    }

    this.importing = true
    this.set_enabled(this.enabled)

    const skeleton = this.skinned_meshes_to_animate[0]?.skeleton
    const target_rest = skeleton ? this.rest_spaces.get(skeleton) : undefined
    const known = new Set(this.known_ids)
    let imported = 0, duplicates = 0
    const errors: string[] = []
    const consume = async (motion: MotionInput): Promise<void> => {
      this.sync_import_context_from_provider()
      if (this.skinned_meshes_to_animate[0]?.skeleton !== skeleton) throw new Error('Персонаж изменился. Повторите импорт для выбранного персонажа.')
      const pairs = await this.animation_loader.load_animations_from_input(motion, this.skeleton_scale,
        { source_type: 'custom-import', tags: [] }, target_rest, [...known])
      if (!pairs.length) { duplicates++; return }
      this.sync_import_context_from_provider()
      if (this.skinned_meshes_to_animate[0]?.skeleton !== skeleton) throw new Error('Персонаж изменился. Повторите импорт для выбранного персонажа.')
      CustomAnimationValidation.validate_animation_bones_match(pairs.map(pair => pair.display_animation_clip), this.skinned_meshes_to_animate)
      this.dispatchEvent(new CustomEvent<TransformedAnimationClipPair[]>('import-success', { detail: pairs }))
      for (const tag of pairs[0].metadata.tags) if (tag.startsWith('sha256-')) known.add(tag)
      imported += pairs.length
    }
    try {
      for (const file of Array.from(files)) {
        try {
          if (file.name.toLowerCase().endsWith('.zip')) {
            const archive = await open_motion_archive(file)
            archive.entries = archive.entries.filter(entry => entry.format === 'glb' || entry.format === 'fbx')
            errors.push(...archive.issues)
            if (!archive.entries.length) throw new Error('В ZIP нет анимаций GLB или FBX')
            for (const entry of archive.entries) {
              try { await consume(await archive_input(file, entry)) }
              catch (error) { errors.push(entry.path + ': ' + (error instanceof Error ? error.message : String(error))) }
              await new Promise<void>(resolve => setTimeout(resolve, 0))
            }
          } else {
            const format = input_format(file.name)
            if (format !== 'glb' && format !== 'fbx') throw new Error('Выберите GLB, FBX или ZIP с анимациями')
            await consume({ blob: file, name: file.name, size: file.size, format })
          }
        } catch (error) { errors.push(file.name + ': ' + (error instanceof Error ? error.message : String(error))) }
      }
      const summary = ['Добавлено анимаций: ' + imported]
      if (duplicates) summary.push('Уже импортировано файлов: ' + duplicates)
      if (errors.length) summary.push('Ошибки (' + errors.length + '): ' + errors.slice(0, 3).join('\n'))
      const message = document.createElement('div')
      message.textContent = summary.join('\n')
      new ModalDialog('Импорт движений', message.innerHTML.replaceAll('\n', '<br>')).show()
    } finally {
      input.value = ''
      this.importing = false
      this.set_enabled(this.enabled)
    }
  }

  private sync_import_context_from_provider (): void {
    if (this.import_context_provider === null) {
      return
    }

    const { skinned_meshes_to_animate, skeleton_scale, known_ids } = this.import_context_provider()
    this.known_ids = known_ids ?? []
    this.set_import_context(skinned_meshes_to_animate, skeleton_scale)
  }

}
