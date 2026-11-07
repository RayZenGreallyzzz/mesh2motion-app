import { SurfaceWeightBrush } from './lib/weight-paint/SurfaceWeightBrush.ts'
import { register_asset_renderer } from './lib/AssetCodecs.ts'
import { selectedWeight } from './lib/weight-paint/ManualWeightEdits.ts'
import { default_chest_guard } from './lib/solvers/ChestWeightGuard.ts'
import { RigConfig } from './lib/RigConfig.ts'
import * as THREE from 'three'
import { CustomTransformControls } from './lib/components/CustomTransformControls.ts'
import type { CustomViewHelper } from './lib/CustomViewHelper.ts'

import tippy from 'tippy.js'
import './environment.js'
import 'tippy.js/dist/tippy.css' // optional for styling

import { Utility } from './lib/Utilities.ts'
import { Generators } from './lib/Generators.ts'

import { UI } from './lib/UI.ts'

import { StepLoadModel } from './lib/processes/load-model/StepLoadModel.ts'
import { StepLoadSkeleton } from './lib/processes/load-skeleton/StepLoadSkeleton.ts'
import { StepEditSkeleton } from './lib/processes/edit-skeleton/StepEditSkeleton.ts'
import { MeshDragBonePlacement } from './lib/processes/edit-skeleton/MeshDragBonePlacement.ts'
import { fit_humanoid_rig } from './lib/processes/edit-skeleton/HumanoidAutoFit.ts'
import { AnimalAutoFit } from './lib/processes/edit-skeleton/AnimalAutoFit.ts'
import { MannequinMarkerFit } from './lib/processes/edit-skeleton/MannequinMarkerFit.ts'
import { StepAnimationsListing } from './lib/processes/animations-listing/StepAnimationsListing.ts'
import { ArmExtensionControl } from './lib/processes/animations-listing/ArmExtensionControl.ts'
import { DownloadSettings } from './lib/processes/export-to-file/DownloadSettings.ts'
import { StepExportToFile } from './lib/processes/export-to-file/StepExportToFile.ts'
import { StepWeightSkin } from './lib/processes/weight-skin/StepWeightSkin.ts'

import { ProcessStep } from './lib/enums/ProcessStep.ts'
import { type Bone, Group, Scene, type Skeleton, type Vector3 } from 'three'

import { SkeletonType } from './lib/enums/SkeletonType.ts'
import { is_humanoid_skeleton_type } from './lib/HumanoidSkeleton.ts'

import { CustomSkeletonHelper } from './lib/CustomSkeletonHelper.ts'
import { EventListeners } from './lib/EventListeners.ts'
import { ModelPreviewDisplay } from './lib/enums/ModelPreviewDisplay.ts'
import { TransformControlType } from './lib/enums/TransformControlType.ts'
import { TransformSpace } from './lib/enums/TransformSpace.ts'
import { ThemeManager } from './lib/ThemeManager.ts'
import { SettingsDropdownManager } from './lib/SettingsDropdownManager.ts'
import { ModalDialog } from './lib/ModalDialog.ts'
import { ModelCleanupUtility } from './lib/processes/load-model/ModelCleanupUtility.ts'
import { SceneEnvironmentManager } from './lib/SceneEnvironmentManager.ts'
import { CameraShake } from './lib/CameraShake.ts'
import { DOMUtilities } from './lib/DOMUtilities.ts'
import { PlatformManager } from './lib/PlatformManager.ts'
import { NetworkStatusManager } from './lib/NetworkStatusManager.ts'

export class Mesh2MotionEngine {
  public readonly camera = Generators.create_camera()
  public readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })

  public readonly transform_controls: CustomTransformControls = new CustomTransformControls(this.camera, this.renderer.domElement)
  public is_transform_controls_dragging: boolean = false
  public readonly transform_controls_hover_distance: number = window.matchMedia?.('(pointer: coarse)').matches ? 0.055 : 0.02 // larger finger hit radius on tablets
  public is_model_gizmo_active: boolean = false
  private weights_busy = false
  private rig_setup_group: Group | null = null
  private rig_setup_locked_state: boolean = true
  private manual_weight_stroke_vertices: Map<number, Map<number, { amount: number, target?: number }>> | null = null
  private manual_weight_options = { bone: 0, strength: .15, radius: .04, front: true, mode: 'add' as 'add' | 'remove' | 'smooth' }
  private manual_weight_brushes = new WeakMap<THREE.BufferGeometry, SurfaceWeightBrush>()
  private manual_weight_preparing = false
  private manual_weight_previous_hit: { mesh: number, point: THREE.Vector3 } | null = null
  private manual_weight_ring: HTMLDivElement | null = null
  private manual_weight_last_sample_ms: number = -Infinity
  public readonly mesh_drag_bone_placement: MeshDragBonePlacement

  public view_helper: CustomViewHelper | undefined // mini 3d view to help orient orthographic views

  // has UI elements on the HTML page that we will reference/use
  public scene: Scene
  public theme_manager: ThemeManager
  public settings_dropdown_manager: SettingsDropdownManager | undefined
  public ui: UI
  public load_model_step: StepLoadModel
  public load_skeleton_step: StepLoadSkeleton
  public edit_skeleton_step: StepEditSkeleton
  public weight_skin_step: StepWeightSkin
  public animations_listing_step: StepAnimationsListing
  public download_settings: DownloadSettings
  public file_export_step: StepExportToFile

  // for looking at specific bones
  public process_step: ProcessStep = ProcessStep.LoadModel
  public skeleton_helper: CustomSkeletonHelper | undefined = undefined
  public debugging_visual_object: Group = new Group()

  // when editing the skeleton, what type of mesh will we see
  public mesh_preview_display_type: ModelPreviewDisplay = ModelPreviewDisplay.Textured
  public transform_controls_type: TransformControlType = TransformControlType.Translation
  public transform_space_type: TransformSpace = TransformSpace.Global

  private readonly clock = new THREE.Clock()
  private readonly scene_environment: SceneEnvironmentManager
  private readonly eventListeners: EventListeners
  private readonly camera_shake: CameraShake

  constructor () {
    register_asset_renderer(this.renderer)
    this.initialize_shared_dom_mounts()

    // this will add a platform CSS file if we are running our desktop app
    new PlatformManager().init();
    new NetworkStatusManager();

    this.eventListeners = new EventListeners(this)
    // helps resolve requestAnimationFrame calling animate() with wrong context
    this.animate = this.animate.bind(this)
    this.camera_shake = new CameraShake(this.camera)

    this.scene = new Scene()
    this.theme_manager = new ThemeManager()
    this.ui = UI.getInstance()
    this.settings_dropdown_manager = undefined

    // setting up steps
    this.load_model_step = new StepLoadModel()
    this.load_skeleton_step = new StepLoadSkeleton(this.scene)
    this.edit_skeleton_step = new StepEditSkeleton()
    this.weight_skin_step = new StepWeightSkin()
    this.animations_listing_step = new StepAnimationsListing(this.theme_manager)
    this.animations_listing_step.addEventListener('pose-editor-visibility', (event: Event) => {
      if (this.skeleton_helper) this.skeleton_helper.visible = (event as CustomEvent<boolean>).detail || !!(document.getElementById('show-skeleton-checkbox') as HTMLInputElement | null)?.checked
    })
    document.getElementById('classic-initial-pose-button')?.addEventListener('click', () => this.animations_listing_step.open_initial_pose_editor())
    document.getElementById('weight-initial-pose-button')?.addEventListener('click', () => {
      this.process_step_changed(ProcessStep.AnimationsListing)
      if (this.process_step === ProcessStep.AnimationsListing) this.animations_listing_step.open_initial_pose_editor()
    })
    this.animations_listing_step.set_manual_weight_locks_provider(() => this.weight_skin_step.manual_weight_locks())
    this.download_settings = new DownloadSettings()
    this.file_export_step = new StepExportToFile()
    this.mesh_drag_bone_placement = new MeshDragBonePlacement(
      this.camera,
      this.edit_skeleton_step,
      this.load_model_step,
      this.weight_skin_step,
      this.transform_controls_hover_distance
    )

    this.scene_environment = new SceneEnvironmentManager(
      this.scene,
      this.renderer,
      this.camera,
      this.transform_controls,
      this.theme_manager,
      this.mesh_drag_bone_placement
    )

    this.settings_dropdown_manager = new SettingsDropdownManager(this.scene_environment)

    this.setup_environment()
    this.eventListeners.addEventListeners()
    this.process_step = this.process_step_changed(ProcessStep.LoadModel)
    this.animate() // start the render loop which will continue rendering the scene
    this.inject_build_version()
    this.setup_tooltips()
    this.setup_chest_guard_controls()
  }

  private setup_chest_guard_controls (): void {
    for (const id of ['chest-guard-enabled', 'chest-guard-strength', 'chest-guard-width', 'chest-guard-height', 'chest-guard-offset', 'chest-guard-preview']) {
      document.getElementById(id)?.addEventListener('input', () => this.update_chest_guard_labels())
    }
    document.getElementById('chest-guard-apply')?.addEventListener('click', async () => {
      if (this.weights_busy || this.process_step !== ProcessStep.WeightSkin) return
      if ((document.getElementById('chest-guard-enabled') as HTMLInputElement)?.checked &&
          (document.getElementById('chest-guard-preview') as HTMLInputElement)?.checked) {
        (document.getElementById('manual-weight-enabled') as HTMLInputElement).checked = false
      }
      await this.regenerate_weight_painted_preview_mesh()
    })
    document.getElementById('chest-guard-reset')?.addEventListener('click', () => {
      for (const [id, value] of Object.entries({ strength: 1, width: 1, height: 1, offset: 0 })) {
        const input = document.getElementById('chest-guard-' + id) as HTMLInputElement | null
        if (input) input.value = String(value)
      }
      this.update_chest_guard_labels()
    })
    this.update_chest_guard_labels()
  }

  private update_chest_guard_labels (): void {
    for (const id of ['strength', 'width', 'height', 'offset']) {
      const input = document.getElementById('chest-guard-' + id) as HTMLInputElement | null, label = document.getElementById('chest-guard-' + id + '-value')
      if (input && label) label.textContent = Math.round(Number(input.value) * 100) + '%'
    }
    const status = document.getElementById('chest-guard-status')
    if (status) status.textContent = 'Настройте область и нажмите «Применить». Ручная кисть применяется после защиты.'
  }

  private configure_chest_guard (): void {
    const options = default_chest_guard()
    options.anchor_to_chest = this.load_skeleton_step.skeleton_type() === SkeletonType.Woman
    options.enabled = (document.getElementById('chest-guard-enabled') as HTMLInputElement | null)?.checked ?? false
    for (const id of ['strength', 'width', 'height', 'offset'] as const) {
      const input = document.getElementById('chest-guard-' + id) as HTMLInputElement | null
      if (input && Number.isFinite(Number(input.value))) options[id] = Number(input.value)
    }
    const preview = options.enabled && ((document.getElementById('chest-guard-preview') as HTMLInputElement | null)?.checked ?? false) &&
      !((document.getElementById('manual-weight-enabled') as HTMLInputElement | null)?.checked ?? false)
    this.weight_skin_step.set_chest_guard(options, preview)
    if (preview && this.process_step === ProcessStep.WeightSkin) this.mesh_preview_display_type = ModelPreviewDisplay.WeightPainted
  }

  private show_chest_guard_status (): void {
    const status = document.getElementById('chest-guard-status'), result = this.weight_skin_step.get_chest_guard_stats()
    if (!status) return
    status.textContent = !result ? 'Защита выключена. Используются обычные автоматические веса и ручные правки.' : !result.available ? result.reason :
      'Область: ' + result.region.toLocaleString('ru') + ' вершин. Исправлено: ' + result.changed.toLocaleString('ru') + '. Опора: ' + result.target + '. Проверьте движение рук.'
  }

  public get_theme_manager(): ThemeManager {
    return this.theme_manager
  }

  /** Eventually make the scene its own singleton/manager class
   * that we can inject into other classes that need it
   */
  public get_scene (): Scene {
    return this.scene
  }

  /* Add this attribute to an HTML element to give it a tooltip */
  private setup_tooltips (): void {
    tippy('[data-tippy-content]', { theme: 'mesh2motion' })
  }

  // for the release, let's just show the first N characters of the commit SHA
  // then the branch we used to build. This comes from Cloudflare build process
  private inject_build_version (): void {
    if (this.ui.dom_build_version !== null) {
      const commit_sha: string = window.CLOUDFLARE_COMMIT_SHA.slice(0, 9)
      const branch: string = window.CLOUDFLARE_BRANCH

      this.ui.dom_build_version.innerHTML = `git:${commit_sha}-${branch}`
    }
  }

  public set_camera_position (position: Vector3): void {
    this.scene_environment.set_camera_position(position)
  }

  /** Trigger a gentle camera shake transition effect. */
  public shake_camera (intensity?: number, duration?: number): void {
    this.camera_shake.start(intensity, duration)
  }

  public set_zoom_limits (min_distance: number, max_distance: number): void {
    this.scene_environment.set_zoom_limits(min_distance, max_distance)
  }

  public set_fog_enabled (enabled: boolean): void {
    this.scene_environment.set_fog_enabled(enabled)
  }

  public enable_orbit_controls (enabled: boolean): void {
    const painting = this.process_step === ProcessStep.WeightSkin && (document.getElementById('manual-weight-enabled') as HTMLInputElement | null)?.checked
    this.scene_environment.enable_orbit_controls(enabled && !painting)
  }

  private setup_environment (): void {
    this.scene_environment.setup_environment()
    this.view_helper = this.scene_environment.get_view_helper()
  } // end setup_environment()

  public regenerate_floor_grid (): void {
    this.scene_environment.regenerate_floor_grid()
  }

  public regenerate_skeleton_helper (new_skeleton: Skeleton, helper_name = 'Skeleton Helper'): void {
    // if skeleton helper exists...remove it
    this.dispose_skeleton_helper()

    // no color passed, so bone shapes and joints both use the bone category colors
    const mobileHelperThickness = this.load_skeleton_step.skeleton_type() === SkeletonType.MobileFemale ? 0.045 : 0.1
    this.skeleton_helper = new CustomSkeletonHelper(this.find_skeleton_root_bone(new_skeleton), {
      thickness_ratio: mobileHelperThickness
    })
    this.skeleton_helper.name = helper_name
    this.scene.add(this.skeleton_helper)
  }

  // Returns the topmost bone whose parent is not also tracked in the skeleton.
  // Using bones[0] directly failed for custom rigs where the exporter stored
  // bones in non-hierarchical order, causing getBoneList to miss every bone
  // outside bones[0]'s subtree.
  private find_skeleton_root_bone (skeleton: Skeleton): Bone {
    const bone_set = new Set<Bone>(skeleton.bones)
    for (const bone of skeleton.bones) {
      if (!bone_set.has(bone.parent as Bone)) {
        return bone
      }
    }
    return skeleton.bones[0]
  }

  /**
   * Takes the current skeleton helper out of the scene and releases its GPU
   * resources. Skipping the dispose leaked a geometry, materials and an
   * instance matrix buffer on every rebuild, and rebuilds happen on every
   * skeleton edit undo/redo.
   */
  private dispose_skeleton_helper (): void {
    if (this.skeleton_helper === undefined) {
      return
    }

    this.scene.remove(this.skeleton_helper)
    this.skeleton_helper.dispose()
    this.skeleton_helper = undefined
  }

  public sync_skeleton_helper_joint_visibility (): void {
    if (this.skeleton_helper === undefined) {
      return
    }

    const is_edit_skeleton_step = this.process_step === ProcessStep.EditSkeleton

    this.skeleton_helper.setJointsVisible(is_edit_skeleton_step)
    this.skeleton_helper.setHideRightSideJoints(
      is_edit_skeleton_step && this.edit_skeleton_step.is_mirror_mode_enabled()
    )
  }

  public update_a_pose_options_visibility (): void {
    ArmExtensionControl.getInstance().set_visible(
      is_humanoid_skeleton_type(this.load_skeleton_step.skeleton_type())
    )
  }

  public handle_transform_controls_moving (): void {
    if (this.is_model_gizmo_active) { return }
    if (!this.rig_setup_locked_state) { return }

    const selected_bone: Bone = this.transform_controls.object as Bone

    if (this.edit_skeleton_step.is_mirror_mode_enabled()) {
      this.edit_skeleton_step.apply_mirror_mode(selected_bone, this.transform_controls.getMode())
    }

    if (this.edit_skeleton_step.independent_bone_movement.is_enabled() &&
        this.transform_controls.getMode() === 'translate') {
      const mirror_bone = this.edit_skeleton_step.is_mirror_mode_enabled()
        ? this.edit_skeleton_step.find_mirror_bone(selected_bone)
        : undefined
      this.edit_skeleton_step.independent_bone_movement.apply(selected_bone, mirror_bone)
    }
  }

  /**
   * Mixamo-style local AutoRig. This does not call any cloud service: it fits
   * the existing humanoid skeleton to the imported mesh using its geometry,
   * then leaves the joints editable for a final human check.
   */
  private auto_fit_in_progress = false
  private active_body_profile: SkeletonType | null = null

  public async auto_fit_humanoid_rig (): Promise<void> {
    if (this.process_step !== ProcessStep.EditSkeleton || this.auto_fit_in_progress) return
    if (!this.rig_setup_locked_state) this.lock_rig_setup()
    const model = this.load_model_step.model_meshes()
    const skeleton = this.edit_skeleton_step.skeleton()
    const species = this.load_skeleton_step.skeleton_type()
    const status = document.getElementById('rig-setup-status')
    this.auto_fit_in_progress = true
    const bind_button = document.getElementById('action_bind_pose') as HTMLButtonElement | null
    const fit_button = document.getElementById('autorig-humanoid-button') as HTMLButtonElement | null
    if (bind_button) bind_button.disabled = true
    if (fit_button) fit_button.disabled = true
    if (status) status.textContent = 'Подгонка скелета по геометрии…'
    try {
      // Yield for the busy message without waiting for a foreground render frame.
      await new Promise<void>(resolve => setTimeout(resolve, 16))
      const before = () => this.edit_skeleton_step.store_bone_state_for_undo()
      let result: string | null
      const marker = MannequinMarkerFit.recognize(model)
      if (marker) {
        if (!MannequinMarkerFit.compatible(marker, skeleton)) {
          if (status) status.textContent = `Для манекена «${marker.profile.title}» нужен совместимый скелет: ${RigConfig.by_key(marker.profile.recommendedRig)?.rig_display_name ?? marker.profile.recommendedRig}. Вернитесь к выбору скелета.`
          return
        }
        result = MannequinMarkerFit.apply(marker, skeleton, await AnimalAutoFit.load_reference(species), before)
        for (const id of ['skeleton-template-image', 'creature-fit-options']) { const el = document.getElementById(id); if (el) el.style.display = 'none' }
      } else if (is_humanoid_skeleton_type(species) || (RigConfig.by_key(species)?.pack_source && ['upperarm_l', 'thigh_l', 'pelvis'].every(name => skeleton.bones.some(bone => bone.name === name)))) {
        result = fit_humanoid_rig(model, skeleton, this.rig_setup_group, before, species === SkeletonType.Woman ? 'woman' : 'human')
        if (result && species === SkeletonType.Woman) result = 'Woman · ' + result
      } else {
        const reference = await AnimalAutoFit.load_reference(species)
        const selected = (document.getElementById('creature-fit-mode') as HTMLSelectElement | null)?.value
        const mode = species === SkeletonType.Dragon && (selected === 'template' || selected === 'upright-winged') ? selected : 'auto'
        result = AnimalAutoFit.fit(model, skeleton, this.rig_setup_group, reference, before, mode)
      }
      this.regenerate_skeleton_helper(skeleton, 'Skeleton Helper')
      this.sync_skeleton_helper_joint_visibility()
      this.edit_skeleton_step.dispatchEvent(new CustomEvent('skeletonTransformed'))
      if (status) status.textContent = result
        ? `Подгонка: ${result}. Проверьте суставы перед расчётом весов.`
        : 'Форма не распознана. Попробуйте обычный шаблон или расставьте суставы вручную.'
      const uncertain = skeleton.bones.filter(b => b.userData.rigFitWarning).map(b => b.name)
      if (status && uncertain.length) status.textContent += ` Оранжевые суставы требуют ручной проверки: ${uncertain.join(', ')}.`
    } catch (error) {
      console.error(error)
      if (status) status.textContent = 'Не удалось подогнать скелет. Можно расставить суставы вручную.'
    } finally {
      this.auto_fit_in_progress = false
      if (bind_button) bind_button.disabled = !this.rig_setup_locked_state
      if (fit_button) fit_button.disabled = false
    }
  }

  public is_rig_setup_locked (): boolean {
    return this.rig_setup_locked_state
  }

  private prepare_rig_setup_group (): void {
    if (this.rig_setup_group !== null) return

    const model = this.load_model_step.model_meshes()
    const armature = this.edit_skeleton_step.armature()
    const group = new Group()
    group.name = 'Rig Setup Group'
    group.position.set(0, 0, 0)
    group.quaternion.identity()
    group.scale.set(1, 1, 1)

    this.scene.add(group)
    group.add(model)
    group.add(armature)
    group.updateWorldMatrix(true, true)
    this.rig_setup_group = group
  }

  private bake_rig_setup_group_transform (): void {
    const group = this.rig_setup_group
    if (group === null) return

    const model = this.load_model_step.model_meshes()
    const armature = this.edit_skeleton_step.armature()

    group.updateWorldMatrix(true, true)
    armature.updateWorldMatrix(true, true)
    const armature_world_matrix = armature.matrixWorld.clone()

    // The skinning solver reads raw mesh geometry and the armature below its
    // container, so bake the shared setup transform into both before ungrouping.
    ModelCleanupUtility.bake_transforms_into_geometry(model)
    group.remove(model)
    this.scene.add(model)

    group.remove(armature)
    this.scene.add(armature)
    armature.position.set(0, 0, 0)
    armature.quaternion.identity()
    armature.scale.set(1, 1, 1)
    armature.updateMatrix()

    armature.children.forEach((child) => {
      child.applyMatrix4(armature_world_matrix)
    })
    armature.updateWorldMatrix(true, true)

    group.removeFromParent()
    this.rig_setup_group = null
    this.edit_skeleton_step.skeleton().bones[0]?.updateWorldMatrix(true, true)
    this.regenerate_skeleton_helper(this.edit_skeleton_step.skeleton(), 'Skeleton Helper')
    this.sync_skeleton_helper_joint_visibility()
  }

  public unlock_rig_setup (): void {
    if (this.process_step !== ProcessStep.EditSkeleton) return

    this.prepare_rig_setup_group()
    this.rig_setup_locked_state = false
    this.edit_skeleton_step.set_currently_selected_bone(null)
    this.transform_controls.detach()

    if (this.rig_setup_group !== null) {
      this.transform_controls.attach(this.rig_setup_group)
      this.transform_controls.setSpace('world')
      this.transform_controls.setMode('translate')
      this.transform_controls.enabled = true
    }

    this.enable_orbit_controls(true)
    this.update_rig_setup_controls()
  }

  public lock_rig_setup (): void {
    if (this.rig_setup_locked_state) return

    this.transform_controls.detach()

    // Canonical rig world transform v4.8
    // Keep the user's global move/rotate/scale OUTSIDE the armature instead of
    // baking it into the root bone. Animation clips contain local quaternion
    // tracks authored for the canonical browser rig. Baking a global rotation
    // into the armature makes the joints look correctly placed in bind pose but
    // causes those animation quaternions to fight the baked orientation and can
    // twist the entire character. The shared Rig Setup Group stays as the
    // non-animated world transform; skinning is calculated from the model and
    // armature's canonical local coordinates and the same world transform is
    // copied onto the generated preview/skinned outputs afterwards.
    this.rig_setup_group?.updateWorldMatrix(true, true)
    this.rig_setup_locked_state = true
    this.update_edit_bone_interaction_mode()
    this.update_rig_setup_controls()
  }

  public toggle_rig_setup_lock (): void {
    if (this.rig_setup_locked_state) {
      this.unlock_rig_setup()
    } else {
      this.lock_rig_setup()
    }
  }

  public set_rig_setup_transform_mode (mode: 'translate' | 'rotate'): void {
    if (this.rig_setup_locked_state || this.rig_setup_group === null) return
    this.transform_controls.setMode(mode)
    this.transform_controls.attach(this.rig_setup_group)
    this.transform_controls.enabled = true
  }

  public set_rig_camera_view (view: 'front' | 'side' | 'back'): void {
    const target = new THREE.Vector3(0, 0.9, 0)
    const current_distance = Math.max(this.camera.position.distanceTo(target), 2)
    this.camera.up.set(0, 1, 0)

    if (view === 'front') {
      this.set_camera_position(new THREE.Vector3(0, target.y, current_distance))
    } else if (view === 'side') {
      this.set_camera_position(new THREE.Vector3(current_distance, target.y, 0))
    } else {
      this.set_camera_position(new THREE.Vector3(0, target.y, -current_distance))
    }
  }

  private update_rig_setup_controls (): void {
    const lock_button = document.getElementById('rig-setup-lock-button') as HTMLButtonElement | null
    const move_button = document.getElementById('rig-setup-move-button') as HTMLButtonElement | null
    const rotate_button = document.getElementById('rig-setup-rotate-button') as HTMLButtonElement | null
    const status = document.getElementById('rig-setup-status')
    const pose_a = document.getElementById('pose-preset-a') as HTMLButtonElement | null
    const pose_t = document.getElementById('pose-preset-t') as HTMLButtonElement | null
    const bind = document.getElementById('action_bind_pose') as HTMLButtonElement | null
    const autorig = document.getElementById('autorig-humanoid-button') as HTMLButtonElement | null

    if (lock_button !== null) {
      lock_button.textContent = this.rig_setup_locked_state ? 'Разблокировать риг' : 'Зафиксировать скелет'
    }
    if (move_button !== null) move_button.disabled = this.rig_setup_locked_state
    if (rotate_button !== null) rotate_button.disabled = this.rig_setup_locked_state
    if (pose_a !== null) pose_a.disabled = !this.rig_setup_locked_state
    if (pose_t !== null) pose_t.disabled = !this.rig_setup_locked_state
    if (bind !== null) bind.disabled = !this.rig_setup_locked_state
    const creature_options = document.getElementById('creature-fit-options')
    if (creature_options) creature_options.style.display = this.load_skeleton_step.skeleton_type() === SkeletonType.Dragon ? 'flex' : 'none'
    if (autorig !== null) {
      autorig.textContent = 'Подогнать скелет'
    }
    if (status !== null) {
      const cleanLive = ''
      status.textContent = this.rig_setup_locked_state
        ? cleanLive + 'риг зафиксирован: правьте суставы, обзор меняется только камерой.'
        : cleanLive + 'риг разблокирован: модель и скелет двигаются вместе.'
    }

    const weight_enabled = document.getElementById('manual-weight-enabled') as HTMLInputElement | null
    if (weight_enabled !== null) {
      weight_enabled.disabled = !this.rig_setup_locked_state
      if (!this.rig_setup_locked_state) weight_enabled.checked = false
    }
  }

  /**
   * Copy the non-animated Rig Setup Group world transform onto generated skin
   * outputs. The skeleton itself stays canonical, matching the browser rig and
   * the coordinate system used by the bundled animation quaternion tracks.
   */
  private apply_rig_world_transform_to_skin_outputs (): void {
    const group = this.rig_setup_group
    if (group === null) {
      this.weight_skin_step.check_bind_after_world_transform()
      this.show_bind_rest_diagnostic()
      return
    }

    group.updateWorldMatrix(true, true)
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    group.matrixWorld.decompose(position, quaternion, scale)

    const apply = (object: THREE.Object3D): void => {
      object.position.copy(position)
      object.quaternion.copy(quaternion)
      object.scale.copy(scale)
      object.updateMatrixWorld(true)
    }

    this.weight_skin_step.final_skinned_meshes().forEach(apply)
    const preview = this.weight_skin_step.weight_painted_mesh_group()
    if (preview !== null) apply(preview)
    this.weight_skin_step.check_bind_after_world_transform()
    this.show_bind_rest_diagnostic()
  }

  private show_bind_rest_diagnostic (): void {
    const host = this.ui.dom_weight_skin_tools
    if (host === null) return
    let message = document.getElementById('bind-rest-diagnostic')
    if (message === null) {
      message = document.createElement('div')
      message.id = 'bind-rest-diagnostic'
      message.style.fontSize = '12px'
      message.style.padding = '5px'
      message.style.whiteSpace = 'pre-wrap'
      host.appendChild(message)
    }
    const result = this.weight_skin_step.bind_rest_diagnostic()
    const errorLabel = Number.isFinite(result.maxError)
      ? result.maxError.toExponential(3)
      : 'INVALID'
    const world = this.weight_skin_step.bind_world_diagnostic()
    const worldLabel = Number.isFinite(world.maxError)
      ? world.maxError.toExponential(3)
      : 'INVALID'
    message.textContent =
      (result.failedMeshes === 0 ? 'BIND REST OK' : 'BIND REST ERROR') +
      ' · Δ ' + errorLabel + ' · ' + result.samples + ' vertices' +
      '\n' + (world.failedMeshes === 0 ? 'BIND WORLD OK' : 'BIND WORLD ERROR') +
      ' · Δ ' + worldLabel
    message.style.color = result.failedMeshes === 0 && world.failedMeshes === 0
      ? '#b6ddc7' : '#ffb5a8'
  }

  public refresh_manual_weight_editor (): void {
    const select = document.getElementById('manual-weight-bone') as HTMLSelectElement | null
    if (select === null) return

    const previous = select.value
    select.innerHTML = ''
    const weightEditorSkeleton = this.process_step === ProcessStep.WeightSkin
      ? this.weight_skin_step.skeleton()
      : this.edit_skeleton_step.skeleton()
    weightEditorSkeleton?.bones.forEach((bone, index) => {
      const option = document.createElement('option')
      option.value = index.toString()
      option.textContent = bone.name || `Bone ${index}`
      select.appendChild(option)
    })

    if ([...select.options].some(option => option.value === previous)) select.value = previous
    else {
      const pelvis = [...select.options].find(option => /pelvis|hips/i.test(option.textContent ?? ''))
      if (pelvis !== undefined) select.value = pelvis.value
      else if (select.options.length > 0) select.selectedIndex = 0
    }

    const selected = Number.parseInt(select.value, 10)
    this.weight_skin_step.set_manual_weight_preview_bone(Number.isFinite(selected) ? selected : null)
    this.update_manual_weight_labels()
  }

  public is_manual_weight_editor_enabled (): boolean {
    if (this.weights_busy) return false
    const enabled = document.getElementById('manual-weight-enabled') as HTMLInputElement | null
    return this.process_step === ProcessStep.WeightSkin &&
      (enabled?.checked ?? false)
  }

  public sync_manual_weight_editor (): void {
    const enabled = document.getElementById('manual-weight-enabled') as HTMLInputElement | null
    const status = document.getElementById('manual-weight-status')
    if (enabled === null) return
    if (!enabled.checked) this.end_manual_weight_stroke(undefined, true)
    this.enable_orbit_controls(!enabled.checked)
    const mode=document.getElementById('manual-weight-focus-mode')
    if(mode)mode.textContent=enabled.checked?'Обзор':'Кисть' 

    const select = document.getElementById('manual-weight-bone') as HTMLSelectElement | null
    const selected = select === null ? NaN : Number.parseInt(select.value, 10)
    this.weight_skin_step.set_manual_weight_preview_bone(Number.isFinite(selected) ? selected : null)

    if (enabled.checked) {
      const areaPreview = document.getElementById('chest-guard-preview') as HTMLInputElement | null
      if (areaPreview) areaPreview.checked = false
      this.weight_skin_step.hide_chest_guard_preview()
      this.mesh_preview_display_type = ModelPreviewDisplay.WeightPainted
      this.changed_model_preview_display(ModelPreviewDisplay.WeightPainted)
      void this.prepare_manual_weight_brushes()
    } else if (this.weight_skin_step.is_chest_guard_preview()) {
      this.mesh_preview_display_type = ModelPreviewDisplay.WeightPainted
      this.weight_skin_step.final_skinned_meshes().forEach(mesh => { mesh.visible = false })
      this.weight_skin_step.weight_painted_mesh_group().visible = true
      if (status !== null) status.textContent = 'Золотым показана область защиты груди. Включение кисти вернёт раскраску выбранной кости.'
    } else {
      this.changed_model_preview_display(ModelPreviewDisplay.Textured)
      if (status !== null) status.textContent = 'Включите кисть, выберите кость и проведите пальцем по модели.'
    }

    const radio = document.getElementById(this.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted ? 'preview-painted' : 'preview-textured') as HTMLInputElement | null
    if (radio) radio.checked = true

    this.update_manual_weight_labels()
    this.refresh_manual_weight_history()
  }

  public preview_selected_weight_bone (): void {
    if (this.process_step !== ProcessStep.WeightSkin) return
    const select = document.getElementById('manual-weight-bone') as HTMLSelectElement | null
    const selected = Number.parseInt(select?.value ?? '', 10)
    this.weight_skin_step.set_manual_weight_preview_bone(Number.isFinite(selected) ? selected : null)
    this.changed_model_preview_display(ModelPreviewDisplay.WeightPainted)
    this.update_weight_debug_status(false)
  }

  public sync_clothing_weight_guard (): void {
    const checkbox = document.getElementById('clothing-weight-guard') as HTMLInputElement | null
    this.weight_skin_step.set_clothing_weight_guard_enabled(checkbox?.checked ?? true)
    if (this.process_step === ProcessStep.WeightSkin) {
      this.regenerate_weight_painted_preview_mesh()
      this.update_weight_debug_status(false)
    }
  }

  public update_weight_debug_status (includeRig: boolean = true): void {
    const output = document.getElementById('weight-debug-status')
    if (output === null || this.process_step !== ProcessStep.WeightSkin) return
    const skeleton = this.weight_skin_step.skeleton()
    if (skeleton === undefined) { output.textContent = 'Скелет не найден.'; return }
    const select = document.getElementById('manual-weight-bone') as HTMLSelectElement | null
    const selected = Number.parseInt(select?.value ?? '', 10)
    const fmt = (index: number): string => {
      if (!Number.isFinite(index) || index < 0) return '—'
      const s = this.weight_skin_step.get_bone_weight_stats(index)
      return s.boneName + ': ' + s.influenced.toString() + '/' + s.total.toString() + ' вершин · avg ' + Math.round(s.average * 100).toString() + '% · max ' + Math.round(s.max * 100).toString() + '%'
    }
    const rootIndex = skeleton.bones.findIndex(bone => /root/i.test(bone.name))
    const pelvisIndex = skeleton.bones.findIndex(bone => /pelvis|hips/i.test(bone.name))
    const outputLines = ['Выбрано — ' + fmt(selected), 'Root — ' + fmt(rootIndex), 'Pelvis — ' + fmt(pelvisIndex)]
    if (includeRig) {
      const deg = (value: number): number => Math.round(value * 180 / Math.PI)
      const describe = (index: number): string => {
        const bone = skeleton.bones[index]
        if (bone === undefined) return '—'
        return bone.name + ': pos(' + bone.position.x.toFixed(2) + ', ' + bone.position.y.toFixed(2) + ', ' + bone.position.z.toFixed(2) + ') rot(' + deg(bone.rotation.x).toString() + '°, ' + deg(bone.rotation.y).toString() + '°, ' + deg(bone.rotation.z).toString() + '°)'
      }
      outputLines.push('Bind Root — ' + describe(rootIndex))
      outputLines.push('Bind Pelvis — ' + describe(pelvisIndex))
    }
    output.textContent = outputLines.join('\n')
  }

  public update_manual_weight_labels (): void {
    const radius = document.getElementById('manual-weight-radius') as HTMLInputElement | null
    const strength = document.getElementById('manual-weight-strength') as HTMLInputElement | null
    const radius_label = document.getElementById('manual-weight-radius-value')
    const strength_label = document.getElementById('manual-weight-strength-value')
    if (radius !== null && radius_label !== null) radius_label.textContent = Math.round(Number(radius.value) * 100).toString()
    if (strength !== null && strength_label !== null) strength_label.textContent = Math.round(Number(strength.value) * 100).toString()
  }

  public set_manual_weight_focus(focus: boolean): void {
    if(focus && (this.process_step!==ProcessStep.WeightSkin || this.weights_busy))return
    const panel=document.getElementById('tool-panel'),toolbar=document.getElementById('manual-weight-toolbar')
    if(panel)panel.style.visibility=focus?'hidden':''
    if(toolbar)toolbar.hidden=!focus
    if(focus){const enabled=document.getElementById('manual-weight-enabled') as HTMLInputElement|null;if(enabled)enabled.checked=true;this.sync_manual_weight_editor()}
  }
  public toggle_manual_weight_focus_mode(): void {
    if(this.weights_busy)return
    const enabled=document.getElementById('manual-weight-enabled') as HTMLInputElement|null
    if(enabled){enabled.checked=!enabled.checked;this.sync_manual_weight_editor()}
  }

  private async prepare_manual_weight_brushes(): Promise<void> {
    if(this.manual_weight_preparing)return
    this.manual_weight_preparing=true
    const status=document.getElementById('manual-weight-status')
    try {
      for(const mesh of this.weight_skin_step.final_skinned_meshes())if(!this.manual_weight_brushes.has(mesh.geometry)){
        if(status)status.textContent='Подготовка кисти…'
        await new Promise<void>(resolve=>setTimeout(resolve,16))
        this.manual_weight_brushes.set(mesh.geometry,new SurfaceWeightBrush(mesh.geometry))
      }
      if(status && (document.getElementById('manual-weight-enabled') as HTMLInputElement)?.checked)status.textContent='Рисуйте одним пальцем. Для поворота модели выключите кисть. Правка применяется после отпускания.'
    } finally { this.manual_weight_preparing=false }
  }

  private collect_manual_weight_vertices(event: PointerEvent, force=false): boolean {
    if(!this.is_manual_weight_editor_enabled() || !this.manual_weight_stroke_vertices || this.manual_weight_preparing)return false
    if(!force && event.timeStamp-this.manual_weight_last_sample_ms<55)return true
    this.manual_weight_last_sample_ms=event.timeStamp
    const group=this.weight_skin_step.weight_painted_mesh_group()
    if(!group?.visible)return false
    const rect=this.renderer.domElement.getBoundingClientRect(), pointer=new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1)
    const raycaster=new THREE.Raycaster();raycaster.setFromCamera(pointer,this.camera)
    const hit=raycaster.intersectObjects(group.children.filter(o=>o.userData.manualWeightSurface),false)[0]
    if(!hit || !(hit.object instanceof THREE.Mesh) || !hit.face){this.manual_weight_previous_hit=null;if(this.manual_weight_ring)this.manual_weight_ring.hidden=true;return false}
    const mesh=Number(hit.object.userData.weightMeshIndex),source=this.weight_skin_step.final_skinned_meshes()[mesh],brush=this.manual_weight_brushes.get(source?.geometry)
    if(!brush)return false
    const point=hit.object.worldToLocal(hit.point.clone()),box=new THREE.Box3()
    for(const m of this.weight_skin_step.final_skinned_meshes()){if(!m.geometry.boundingBox)m.geometry.computeBoundingBox();box.union(m.geometry.boundingBox!)}
    const radius=this.manual_weight_options.radius*Math.max(box.max.y-box.min.y,1e-6)
    const inverse=hit.object.matrixWorld.clone().invert(),view=raycaster.ray.direction.clone().negate().transformDirection(inverse)
    let vertices=this.manual_weight_stroke_vertices.get(mesh)
    if(!vertices){vertices=new Map();this.manual_weight_stroke_vertices.set(mesh,vertices)}
    const previous=this.manual_weight_previous_hit,dist=previous?.mesh===mesh?previous.point.distanceTo(point):Infinity
    const steps=dist<radius*8?Math.min(12,Math.max(1,Math.ceil(dist/(radius*.45)))):1
    for(let n=1;n<=steps;n++){
      const center=steps>1?previous!.point.clone().lerp(point,n/steps):point
      for(const [i,amount] of brush.query(center,radius,hit.face.a,view,this.manual_weight_options.front)){
        if(amount<=(vertices.get(i)?.amount??0))continue
        let target:number|undefined
        if(this.manual_weight_options.mode==='smooth'){
          const p=new THREE.Vector3().fromBufferAttribute(source.geometry.getAttribute('position'),i)
          let sum=0,total=0
          for(const [neighbor,w] of brush.query(p,radius*.3,i,view,this.manual_weight_options.front,64)){
            const values=this.weight_skin_step.read_vertex_weights(mesh,neighbor);if(values){sum+=selectedWeight(values,this.manual_weight_options.bone)*w;total+=w}
          }
          if(total>0)target=sum/total
        }
        vertices.set(i,{amount,target})
      }
    }
    this.manual_weight_previous_hit={mesh,point}
    // Project the real local radius so the touch outline agrees with the brush.
    const worldRadius=radius*hit.object.getWorldScale(new THREE.Vector3()).x
    const edge=hit.point.clone().add(new THREE.Vector3(worldRadius,0,0).applyQuaternion(this.camera.quaternion)).project(this.camera),center=hit.point.clone().project(this.camera)
    const pixels=Math.abs(edge.x-center.x)*rect.width*.5
    if(!this.manual_weight_ring){this.manual_weight_ring=document.createElement('div');this.manual_weight_ring.id='manual-weight-ring';this.manual_weight_ring.style.cssText='position:fixed;pointer-events:none;z-index:60;border:2px solid #ffca7c;border-radius:50%;box-sizing:border-box;box-shadow:0 0 0 1px #14202a;';document.body.appendChild(this.manual_weight_ring)}
    const ring=this.manual_weight_ring;ring.hidden=false;ring.style.width=ring.style.height=`${pixels*2}px`;ring.style.left=`${event.clientX-pixels}px`;ring.style.top=`${event.clientY-pixels}px`
    return true
  }

  public begin_manual_weight_stroke(event: PointerEvent): boolean {
    if(!this.is_manual_weight_editor_enabled() || this.manual_weight_preparing || this.manual_weight_stroke_vertices)return false
    const value=(id:string,fallback:number)=>Number((document.getElementById(id) as HTMLInputElement)?.value??fallback)
    this.manual_weight_options={bone:value('manual-weight-bone',0),strength:value('manual-weight-strength',.15),radius:value('manual-weight-radius',.04),front:(document.getElementById('manual-weight-front') as HTMLInputElement)?.checked??true,mode:(document.getElementById('manual-weight-smooth') as HTMLInputElement)?.checked?'smooth':(document.getElementById('manual-weight-remove') as HTMLInputElement)?.checked?'remove':'add'}
    this.manual_weight_stroke_vertices=new Map();this.manual_weight_previous_hit=null;this.manual_weight_last_sample_ms=-Infinity
    this.enable_orbit_controls(false);this.collect_manual_weight_vertices(event,true);return true
  }
  public continue_manual_weight_stroke(event: PointerEvent): boolean {
    if(!this.manual_weight_stroke_vertices)return false
    this.collect_manual_weight_vertices(event);return true
  }
  public end_manual_weight_stroke(event?: PointerEvent,cancel=false): boolean {
    if(!this.manual_weight_stroke_vertices)return false
    if(event&&!cancel)this.collect_manual_weight_vertices(event,true)
    const stroke=this.manual_weight_stroke_vertices;this.manual_weight_stroke_vertices=null;this.manual_weight_previous_hit=null
    if(this.manual_weight_ring)this.manual_weight_ring.hidden=true
    if(!cancel){const o=this.manual_weight_options,count=this.weight_skin_step.paint_manual_weights(stroke,o.bone,o.strength,o.mode);const status=document.getElementById('manual-weight-status');if(status)status.textContent=count?`Изменено вершин: ${count}. Мазок можно отменить.`:'Вес не изменился. Проверьте кость, режим и силу кисти.'}
    this.refresh_manual_weight_history();this.enable_orbit_controls(true);return true
  }
  private refresh_manual_weight_history(): void {
    const state=this.weight_skin_step.manual_weight_history()
    for(const key of ['undo','redo'] as const)for(const prefix of ['manual-weight-','manual-weight-focus-']){const b=document.getElementById(prefix+key) as HTMLButtonElement|null;if(b)b.disabled=!state[key]}
  }
  public change_manual_weight_history(action:'undo'|'redo'|'reset'):void {
    if(this.weights_busy)return
    this.end_manual_weight_stroke(undefined,true)
    const count=action==='undo'?this.weight_skin_step.undo_manual_weights():action==='redo'?this.weight_skin_step.redo_manual_weights():this.weight_skin_step.reset_manual_weights()
    this.refresh_manual_weight_history()
    const status=document.getElementById('manual-weight-status');if(status)status.textContent=`${action==='undo'?'Отменено':action==='redo'?'Повторено':'Сброшено'}: ${count} вершин.`
  }
  public reset_manual_weight_overrides(): void {this.change_manual_weight_history('reset')}

  // --- Model position gizmo (step 2) ---

  public enable_model_gizmo (): void {
    this.is_model_gizmo_active = true
    this.transform_controls.attach(this.load_model_step.model_meshes())
    this.transform_controls.setMode('translate')
    this.transform_controls.enabled = true
  }

  private bake_and_disable_model_gizmo (): void {
    const mesh_data = this.load_model_step.model_meshes()
    const pos = mesh_data.position
    if (pos.x !== 0 || pos.y !== 0 || pos.z !== 0) {
      ModelCleanupUtility.translate_model_vertices(mesh_data, pos.x, pos.y, pos.z)
      mesh_data.position.set(0, 0, 0)
    }
    this.is_model_gizmo_active = false
    this.transform_controls.detach()
    this.transform_controls.enabled = false
  }

  public handle_mesh_drag_mode_mouse_down (mouse_event: MouseEvent | PointerEvent): boolean {
    return this.mesh_drag_bone_placement.handle_mouse_down(mouse_event)
  }

  public handle_mesh_drag_mode_mouse_move (mouse_event: MouseEvent | PointerEvent): void {
    this.mesh_drag_bone_placement.handle_mouse_move(mouse_event)
  }

  public handle_mesh_drag_mode_mouse_up (): void {
    const did_end_drag = this.mesh_drag_bone_placement.handle_mouse_up()

    if (!did_end_drag) {
      return
    }

    if (this.process_step === ProcessStep.EditSkeleton &&
      this.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted) {
      this.regenerate_weight_painted_preview_mesh()
    }
  }

  public update_edit_bone_interaction_mode (): void {
    if (!this.rig_setup_locked_state && this.rig_setup_group !== null) {
      this.transform_controls.detach()
      this.transform_controls.attach(this.rig_setup_group)
      this.transform_controls.enabled = true
      this.enable_orbit_controls(true)
      this.is_transform_controls_dragging = false
      return
    }

    this.mesh_drag_bone_placement.sync_interaction_mode(this.process_step, this.transform_controls)
    this.is_transform_controls_dragging = false
  }

  public get is_mesh_drag_mode_dragging (): boolean {
    return this.mesh_drag_bone_placement.is_dragging()
  }

  private update_current_process_step (process_step: ProcessStep): void {
    switch (process_step) {
      case ProcessStep.LoadModel:
        this.process_step = ProcessStep.LoadModel
        break
      case ProcessStep.LoadSkeleton:
        this.process_step = ProcessStep.LoadSkeleton
        break
      case ProcessStep.EditSkeleton:
        this.process_step = ProcessStep.EditSkeleton
        break
      case ProcessStep.BindPose:
        this.process_step = ProcessStep.BindPose
        break
      case ProcessStep.WeightSkin:
        this.process_step = ProcessStep.WeightSkin
        break
      case ProcessStep.AnimationsListing:
        this.process_step = ProcessStep.AnimationsListing
        break
    }
  }

  // the retargeting functionality also uses, so expose this out publicly
  public show_animation_player (show: boolean): void {
    if (this.ui.dom_animation_player === null) {
      console.error('Cannot find animation player DOM element to show/hide')
      return
    }

    if (show) {
      this.ui.dom_animation_player.style.display = 'flex'
      return
    }

    this.ui.dom_animation_player.style.display = 'none'
  }

  public process_step_changed (process_step: ProcessStep): ProcessStep {
    if (this.auto_fit_in_progress || this.weights_busy) return this.process_step
    if(process_step !== ProcessStep.WeightSkin){
      this.set_manual_weight_focus(false)
      this.end_manual_weight_stroke(undefined,true)
      const enabled=document.getElementById('manual-weight-enabled') as HTMLInputElement|null
      if(enabled)enabled.checked=false
      this.enable_orbit_controls(true)
    }
    const previous_step = this.process_step
    if (previous_step === ProcessStep.AnimationsListing) this.animations_listing_step.stop_and_restore_pose()

    // Never animate a rig whose bind matrices already move the mesh in REST.
    // The diagnostic used to be log-only, allowing a badly fitted skeleton
    // to enter the animation/export stage and appear catastrophically broken.
    if (process_step === ProcessStep.AnimationsListing) {
      this.weight_skin_step.check_bind_after_world_transform()
      const rest = this.weight_skin_step.bind_rest_diagnostic()
      const world = this.weight_skin_step.bind_world_diagnostic()
      if (this.weight_skin_step.final_skinned_meshes().length === 0 ||
          rest.samples === 0 || rest.failedMeshes !== 0 || world.failedMeshes !== 0 ||
          !Number.isFinite(rest.maxError) || !Number.isFinite(world.maxError)) {
        new ModalDialog(
          'Rig Animation Studio: привязка скелета не прошла проверку',
          'Обнаружена ошибка BIND REST/WORLD. Анимация остановлена, чтобы не растягивать модель. ' +
          'Вернитесь к установке скелета и проверьте масштаб, положение костей и исходную позу. ' +
          'REST Δ=' + rest.maxError.toExponential(3) +
          ', WORLD Δ=' + world.maxError.toExponential(3)
        ).show()
        this.show_bind_rest_diagnostic()
        return previous_step
      }
    }

    if (previous_step === ProcessStep.EditSkeleton &&
        process_step !== ProcessStep.EditSkeleton &&
        !this.rig_setup_locked_state) {
      this.lock_rig_setup()
    }

    // we will have the current step turn on the UI elements it needs
    this.ui.hide_all_elements()

    // update the current process step variable
    this.update_current_process_step(process_step)

    // clean up things related to steps in since we can navigate back and forth
    this.edit_skeleton_step.cleanup_on_exit_step()
    this.load_skeleton_step.dispose()

    // only show animation player on the animation listing page
    if (process_step === ProcessStep.AnimationsListing) {
      this.show_animation_player(true)
    } else {
      this.show_animation_player(false)
    }

    // bake model gizmo position into vertices before transitioning away from step 2
    if (this.is_model_gizmo_active) {
      this.bake_and_disable_model_gizmo()
    }

    // when we change steps, we are re-creating the skeleton and helper
    // so the current transform control reference will be lost/give an error
    this.transform_controls.detach()

    /**********
     * MAIN PROCESS FLOW LOGIC
     * I am doing else if here since the bindpose step changes the step at the end
     * we don't want to trigger the animation listing too early since it is the case after
     *********/
    if (this.process_step === ProcessStep.LoadModel) {
      // reset the state in the case of coming back to this step
      this.remove_imported_model()
      this.weight_skin_step.clear_manual_weight_overrides()
      this.active_body_profile = null
      for (const id of ['chest-guard-enabled', 'chest-guard-preview']) { const input = document.getElementById(id) as HTMLInputElement | null; if (input) input.checked = false }
      this.weight_skin_step.set_chest_guard(default_chest_guard(), false)
      for (const [id, value] of Object.entries({ strength: 1, width: 1, height: 1, offset: 0 })) {
        const input = document.getElementById('chest-guard-' + id) as HTMLInputElement | null
        if (input) input.value = String(value)
      }
      this.update_chest_guard_labels()
      this.load_model_step.clear_loaded_model_data()
      this.load_model_step.begin()
    }
    else if (this.process_step === ProcessStep.LoadSkeleton) {
      // if skeleton helper existed because we are going back to this
      this.dispose_skeleton_helper()

      // need to change the texture display to normal material in
      this.mesh_preview_display_type = ModelPreviewDisplay.Textured
      this.changed_model_preview_display(this.mesh_preview_display_type)

      // initializing all the load skeleton step stuff
      this.scene.add(this.load_model_step.model_meshes())

      // enable model position gizmo so user can freely position the model
      this.enable_model_gizmo()

      // finish initialization and add origin markers
      // this needs to happen at the end since it is expecting the mesh data
      this.load_skeleton_step.begin()
      const skeleton_select = document.getElementById('skeleton-selection') as HTMLSelectElement | null
      if (skeleton_select) {
        for (const option of skeleton_select.options) if (option.dataset.markerOriginalLabel) { option.textContent = option.dataset.markerOriginalLabel; delete option.dataset.markerOriginalLabel }
        const known = MannequinMarkerFit.recognize(this.load_model_step.model_meshes()), recommended = known && [...skeleton_select.options].find(o => o.value === known.profile.recommendedRig)
        if (known && recommended) { recommended.dataset.markerOriginalLabel = recommended.textContent ?? ''; recommended.textContent = `${known.profile.title} · ${known.profile.kind === 'winged-quadruped' ? '4 лапы + 2 крыла' : known.profile.kind === 'quadruped' ? '4 лапы' : 'гуманоид'} · по меткам` }
        if (previous_step === ProcessStep.LoadModel && !new URLSearchParams(location.search).has('rig') && known && recommended) { skeleton_select.value = known.profile.recommendedRig; skeleton_select.dispatchEvent(new Event('change', { bubbles: true })) }
      }
    }
    else if (this.process_step === ProcessStep.EditSkeleton) {
      this.load_skeleton_step?.dispose()

      const start_rig_unlocked = previous_step === ProcessStep.LoadSkeleton
      const profile = this.load_skeleton_step.skeleton_type()
      if (start_rig_unlocked && profile !== this.active_body_profile) {
        if (profile === SkeletonType.Woman || this.active_body_profile === SkeletonType.Woman) {
          const guard = document.getElementById('chest-guard-enabled') as HTMLInputElement | null
          if (guard) guard.checked = profile === SkeletonType.Woman
          this.update_chest_guard_labels()
        }
        this.active_body_profile = profile
      }
      this.rig_setup_locked_state = !start_rig_unlocked
      if (start_rig_unlocked) {
        this.prepare_rig_setup_group()
      }

      this.regenerate_skeleton_helper(this.edit_skeleton_step.skeleton())
      process_step = ProcessStep.EditSkeleton
      this.edit_skeleton_step.begin(this.scene, this.load_skeleton_step.skeleton_type())

      if (start_rig_unlocked) {
        this.unlock_rig_setup()
        if (profile === SkeletonType.Woman || RigConfig.by_key(profile)?.pack_source || MannequinMarkerFit.recognize(this.load_model_step.model_meshes())) void this.auto_fit_humanoid_rig()
      } else {
        this.update_edit_bone_interaction_mode()
        this.transform_controls.setMode(this.transform_controls_type) // 'translate', 'rotate'
        this.update_rig_setup_controls()
      }

      this.sync_skeleton_helper_joint_visibility()
      this.mesh_preview_display_type = ModelPreviewDisplay.Textured
      this.changed_model_preview_display(this.mesh_preview_display_type)
    }
    else if (this.process_step === ProcessStep.BindPose) {
      this.transform_controls.enabled = false
      this.process_step_changed(ProcessStep.WeightSkin)
    }
    else if (this.process_step === ProcessStep.WeightSkin) {
      this.process_step = ProcessStep.WeightSkin
      this.transform_controls.enabled = false
      this.dispose_skeleton_helper()

      this.mesh_preview_display_type = ModelPreviewDisplay.Textured
      if (this.ui.dom_weight_skin_tools) this.ui.dom_weight_skin_tools.style.display = 'flex'
      void this.regenerate_weight_painted_preview_mesh()
    }
    else if (this.process_step === ProcessStep.AnimationsListing) {
      this.process_step = ProcessStep.AnimationsListing
      // Leave the static diagnostic surface behind when starting playback.
      this.mesh_preview_display_type = ModelPreviewDisplay.Textured
      this.load_model_step.model_meshes().visible = false
      this.weight_skin_step.weight_painted_mesh_group().visible = false
      this.weight_skin_step.final_skinned_meshes().forEach(mesh => { mesh.visible = true })

      const active_skeleton_type: SkeletonType = this.load_skeleton_step.skeleton_type()
      this.animations_listing_step.begin(active_skeleton_type, this.load_skeleton_step.skeleton_scale())

      // download options for export currently will only work for humanoid skeletons
      // since we will give options to change the bone names to other standard formats.
      this.download_settings.update_download_settings_ui_visibility(active_skeleton_type)

      // update reference of skeleton helper to use the final skinned mesh
      this.regenerate_skeleton_helper(this.weight_skin_step.skeleton())
      this.sync_skeleton_helper_joint_visibility()

      // hide skeleton by default in animations listing step
      if (this.ui.dom_show_skeleton_checkbox !== null) {
        this.ui.dom_show_skeleton_checkbox.checked = false
      }

      // Show/hide A-Pose correction options based on skeleton type
      this.update_a_pose_options_visibility()

      this.animations_listing_step.load_and_apply_default_animation_to_skinned_mesh(this.weight_skin_step.final_skinned_meshes())

      if (this.skeleton_helper !== undefined) {
        this.skeleton_helper.hide() // hide skeleton helper in animations listing step
      }
    }

    return this.process_step
  } // end process_step_changed()


  private animate (): void {
    requestAnimationFrame(this.animate)
    const delta_time: number = this.clock.getDelta()

    this.scene_environment.frame_change()

    // camera shake effect
    this.camera_shake.update(delta_time)

    // if we are in the animation listing step, we can call
    // render/update functions in that
    if (this.process_step === ProcessStep.AnimationsListing) {
      this.animations_listing_step.frame_change(delta_time)
    }

    this.renderer.render(this.scene, this.camera)

    // view helper
    this.view_helper.render(this.renderer) // updates current viewport
    if (this.view_helper.animating) {
      this.view_helper.update(delta_time) // updates animation when clicking on axis
    }
  }

  public changed_model_preview_display (mesh_textured_display_type: ModelPreviewDisplay): void {
    this.mesh_preview_display_type = mesh_textured_display_type

    if (this.process_step === ProcessStep.WeightSkin) {
      if (this.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted) {
        this.weight_skin_step.refresh_manual_weight_colors()
        this.load_model_step.model_meshes().visible = false
        this.weight_skin_step.final_skinned_meshes().forEach(mesh => { mesh.visible = false })
        const group=this.weight_skin_step.weight_painted_mesh_group()
        if(group)group.visible = true
        return
      }

      this.load_model_step.model_meshes().visible = false
      this.weight_skin_step.final_skinned_meshes().forEach(mesh => { mesh.visible = true })
      this.weight_skin_step.weight_painted_mesh_group().visible = false
      return
    }

    this.load_model_step.model_meshes().visible = this.mesh_preview_display_type === ModelPreviewDisplay.Textured

    if (this.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted) {
      this.regenerate_weight_painted_preview_mesh()
    }

    this.weight_skin_step.weight_painted_mesh_group().visible =
      this.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted
  }

  public changed_transform_controls_mode (radio_button_selected: string): void {
    switch (radio_button_selected) {
      case 'translate':
        this.transform_controls_type = TransformControlType.Translation
        this.transform_controls.setMode('translate')
        break
      case 'rotation':
        this.transform_controls_type = TransformControlType.Rotation
        this.transform_controls.setMode('rotate')
        break
      default:
        console.warn(`Unknown transform mode selected: ${radio_button_selected}`)
        break
    }
  }

  public changed_transform_controls_space (radio_button_selected: TransformSpace | undefined): void {
    if (radio_button_selected) {
      this.transform_space_type = radio_button_selected
      this.transform_controls.setSpace(radio_button_selected as 'world' | 'local')
    } else {
      console.warn(`Unknown transform space selected`)
    }
  }

  public handle_transform_controls_mouse_down (mouse_event: MouseEvent | PointerEvent): void {
    if (!this.rig_setup_locked_state) { return }

    // primary click is made for rotating around 3d scene
    const is_primary_button_click = mouse_event.button === 0

    if (is_primary_button_click === false) { return }

    if (this.edit_skeleton_step.skeleton()?.bones === undefined) { return }

    // when we are done with skinned mesh, we shouldn't be editing transforms
    if (!this.transform_controls.enabled) {
      return
    }

    // we will change which skeleton we do an intersection test with
    // depending on what step we are on. We are either moving the setup skeleton
    // or moving the bind pose skeleton
    const skeleton_to_test: Skeleton | undefined = this.edit_skeleton_step.skeleton()

    // if no skeleton to test, abort
    if (skeleton_to_test === undefined) {
      console.warn('No skeleton to test for intersection, aborting transform controls mouse down')
      return
    }

    // this returns 3 values, so we can destructure them. do not remove any of these
    // even if one of them is not used, otherwise there will be weird issues
    const [closest_bone, closest_bone_index, closest_distance] = Utility.raycast_closest_bone_test(this.camera, mouse_event, skeleton_to_test)

    // don't allow to select root bone for now
    if (closest_bone?.name === 'root') {
      return
    }

    if (!this.edit_skeleton_step.is_bone_selectable(closest_bone)) {
      return
    }

    // only do selection if we are close
    // the orbit controls also have panning with alt-click, so we don't want to interfere with that
    if (closest_distance === null || closest_distance > this.transform_controls_hover_distance) {
      return
    }

    if (closest_bone !== null) {
      this.transform_controls.attach(closest_bone)
      this.edit_skeleton_step.set_currently_selected_bone(closest_bone)
    } else {
      this.edit_skeleton_step.set_currently_selected_bone(null)
    }
  }

  public remove_skinned_meshes_from_scene (): void {
    const existing_skinned_meshes = this.scene.children.filter((child: THREE.Object3D) => child.name.includes('Skinned Mesh'))

    // SkinnedMesh instances created by StepWeightSkin intentionally reuse the
    // geometry/material objects owned by StepLoadModel. Disposing a temporary
    // skinned result here also disposes those shared GPU resources, so the next
    // weight recalculation/rebind may render with missing textures, hitch while
    // re-uploading buffers, or otherwise behave inconsistently on Android.
    //
    // This method only removes transient skinned wrappers from the scene. The
    // source model remains the owner of geometry/material resources and handles
    // their lifetime when a model is actually replaced.
    existing_skinned_meshes.forEach((existing_skinned_mesh: THREE.Object3D) => {
      existing_skinned_mesh.removeFromParent()
    })
  }

  public remove_imported_model (): void {
    // The canonical rig setup group can still own the hidden source model when
    // restarting the flow. Remove the wrapper itself so no stale armature/model
    // survives into the next import.
    if (this.rig_setup_group !== null) {
      this.rig_setup_group.removeFromParent()
      this.rig_setup_group = null
    }

    if (this.load_model_step.model_meshes() !== undefined) {
      const imported_model = this.scene.getObjectByName('Imported Model')
      if (imported_model !== undefined) imported_model.removeFromParent()
    }
  }

  public remove_weight_painted_mesh_preview (): void {
    if (this.load_model_step.model_meshes() !== undefined) {
      const weight_painted_mesh = this.scene.getObjectByName('Weight Painted Mesh Preview')
      if (weight_painted_mesh !== null) {
        this.scene.remove(weight_painted_mesh)
      }
    }
  }

  public async regenerate_weight_painted_preview_mesh (): Promise<void> {
    if (this.weights_busy) return
    this.weights_busy = true
    const panel = this.ui.dom_weight_skin_tools
    const was_inert = panel?.inert ?? false
    if (panel) panel.inert = true
    if (this.ui.dom_current_step_element) this.ui.dom_current_step_element.textContent = 'Расчёт весов… Можно вращать модель.'
    const is_weight_step = this.process_step === ProcessStep.WeightSkin
    try {
      if (is_weight_step) this.remove_skinned_meshes_from_scene()
      await this.calculate_skin_weighting_for_models()
      this.apply_rig_world_transform_to_skin_outputs()
      this.scene.add(this.weight_skin_step.weight_painted_mesh_group())
      if (is_weight_step) {
        this.scene.add(...this.weight_skin_step.final_skinned_meshes())
        const textured = this.mesh_preview_display_type === ModelPreviewDisplay.Textured
        this.load_model_step.model_meshes().visible = false
        this.weight_skin_step.final_skinned_meshes().forEach(mesh => { mesh.visible = textured })
        this.weight_skin_step.weight_painted_mesh_group().visible = !textured
        this.refresh_manual_weight_editor()
        this.sync_manual_weight_editor()
      }
      if (this.ui.dom_current_step_element) this.ui.dom_current_step_element.textContent = 'Веса'
    } catch (error) {
      console.error(error)
      this.load_model_step.model_meshes().visible = true
      if (this.ui.dom_current_step_element) this.ui.dom_current_step_element.textContent = 'Не удалось рассчитать веса. Повторите расчёт.'
    } finally {
      this.weights_busy = false
      if (panel) panel.inert = was_inert
    }
  }

  private async calculate_skin_weighting_for_models (): Promise<void> {
    // we only need one binding skeleton. All skinned meshes will use this.
    this.weight_skin_step.reset_all_skin_process_data() // clear out any existing skinned meshes in storage

    // needed for skinning process if we change modes
    this.weight_skin_step.create_bone_formula_object(this.edit_skeleton_step.armature(), this.load_skeleton_step.skeleton_type())

    // Pass head weight correction settings to the weight skin step
    this.weight_skin_step.set_head_weight_correction_settings(
      this.edit_skeleton_step.use_head_weight_correction(),
      this.edit_skeleton_step.get_preview_plane_height()
    )

    // Pass arm plane correction settings to the weight skin step
    this.weight_skin_step.set_arm_plane_correction_settings(
      this.edit_skeleton_step.use_arm_plane_correction(),
      this.edit_skeleton_step.get_arm_plane_offset()
    )

    this.weight_skin_step.create_binding_skeleton()

    // add geometry data needed for skinning
    this.load_model_step.models_geometry_list().forEach((mesh_geometry) => {
      this.weight_skin_step.add_to_geometry_data_to_skin(mesh_geometry)
    })

    // all mesh material data associated with the geometry data
    this.load_model_step.models_material_list().forEach((mesh_material) => {
      this.weight_skin_step.add_mesh_material(mesh_material)
    })

    this.configure_chest_guard()

    // perform skinning operation
    // this will take all the mesh geometry data we added above and create skinned meshes
    // TODO: Always regenerate the weight painted mesh preview for now. This will change later
    // when we have are in the "Weight Painted" display mode
    await this.weight_skin_step.prepare_automatic_weights()
    this.weight_skin_step.calculate_weights_for_all_mesh_data(true)
    this.show_chest_guard_status()
    this.show_bind_rest_diagnostic()

    // remember our skeleton position before we do the skinning process
    // that way if we revert to try again...we will have the original positions/rotations
    this.load_model_step.model_meshes().visible = false // hide our unskinned mesh after we have done the skinning process

    // re-define skeleton helper to use the skinned mesh)
    if (this.weight_skin_step.skeleton() === undefined) {
      console.warn('Tried to regenerate skeleton helper, but skeleton is undefined!')
    }
  }

  public setup_weight_skinning_config (): void {
    // v5.8 baseline: bind the exact editable skeleton as-is. Do not rewrite or
    // "restore" local bone rotations here; stock Human clips expect the authored
    // Human local quaternion basis throughout the entire bind/playback pipeline.
    this.weight_skin_step.create_bone_formula_object(this.edit_skeleton_step.armature(), this.load_skeleton_step.skeleton_type())

    // Pass head weight correction settings to the weight skin step
    this.weight_skin_step.set_head_weight_correction_settings(
      this.edit_skeleton_step.use_head_weight_correction(),
      this.edit_skeleton_step.get_preview_plane_height()
    )

    // Pass arm plane correction settings to the weight skin step
    this.weight_skin_step.set_arm_plane_correction_settings(
      this.edit_skeleton_step.use_arm_plane_correction(),
      this.edit_skeleton_step.get_arm_plane_offset()
    )
  }

  public show_contributors_dialog (): void {
    new ModalDialog('Contributors', Generators.get_contributors_list()).show()
  }

  public show_learning_resources_dialog (): void {
    new ModalDialog('Learning Resources', Generators.get_learning_resources_html()).show()
  }


  /**
   * Populate shared HTML fragments that are reused across app pages.
   * This runs before UI/Theme initialization so expected DOM IDs exist
   * when singleton classes bind their element references and listeners.
   */
  private initialize_shared_dom_mounts (): void {
    const top_nav_links_mount = document.querySelector('#top-nav-links-mount')
    if (top_nav_links_mount instanceof HTMLElement) {
      DOMUtilities.populate_top_nav_links(top_nav_links_mount)
    }

    const header_ui_mount = document.querySelector('#header-ui-mount')
    if (header_ui_mount instanceof HTMLElement) {
      DOMUtilities.populate_header_controls(header_ui_mount)
    }

    const animation_player_mount = document.querySelector('#animation-player-mount')
    if (animation_player_mount instanceof HTMLElement) {
      DOMUtilities.populate_animation_player(animation_player_mount)
    }

    const arm_extension_mount = document.querySelector('#arm-extension-mount')
    if (arm_extension_mount instanceof HTMLElement) {
      DOMUtilities.populate_arm_extension_controls(arm_extension_mount)
    }

    const download_control_mount = document.querySelector('#download-control-mount')
    if (download_control_mount instanceof HTMLElement) {
      DOMUtilities.populate_download_control(download_control_mount)
    }

    const settings_dropdown_mount = document.querySelector('#settings-dropdown-mount')
    if (settings_dropdown_mount instanceof HTMLElement) {
      DOMUtilities.populate_settings_dropdown(settings_dropdown_mount)
    }
  }

} // end Mesh2Motion Engine

