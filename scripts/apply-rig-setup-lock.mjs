import fs from 'node:fs'

function patchFile (path, patcher) {
  const before = fs.readFileSync(path, 'utf8')
  const after = patcher(before)
  if (after === before) {
    console.log(`No changes needed: ${path}`)
    return
  }
  fs.writeFileSync(path, after)
  console.log(`Updated: ${path}`)
}

function replaceOnce (source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Cannot apply ${label}: marker not found`)
  }
  return source.replace(search, replacement)
}

patchFile('src/create.html', (html) => {
  if (html.includes('id="rig-setup-lock-button"')) return html

  const marker = `          <div style="display: flex; flex-direction: column;">\n            \n            <div class="pill-switch-group" aria-label="Positioning mode">`
  const block = `          <div id="rig-setup-controls" class="alternate-background-section" style="display: flex; flex-direction: column; gap: 0.5rem;">\n            <span class="pill-switch-label">Положение рига</span>\n            <button type="button" id="rig-setup-lock-button">Зафиксировать скелет</button>\n            <div style="display: flex; gap: 0.35rem;">\n              <button type="button" class="secondary-button" id="rig-setup-move-button" style="flex: 1;">Двигать</button>\n              <button type="button" class="secondary-button" id="rig-setup-rotate-button" style="flex: 1;">Повернуть</button>\n            </div>\n            <div style="display: flex; gap: 0.35rem;">\n              <button type="button" class="secondary-button" id="rig-view-front" style="flex: 1;">Спереди</button>\n              <button type="button" class="secondary-button" id="rig-view-side" style="flex: 1;">Сбоку</button>\n              <button type="button" class="secondary-button" id="rig-view-back" style="flex: 1;">Сзади</button>\n            </div>\n            <small id="rig-setup-status">Риг разблокирован: модель и скелет двигаются вместе.</small>\n          </div>\n\n`

  return replaceOnce(html, marker, block + marker, 'rig setup controls')
})

patchFile('src/Mesh2MotionEngine.ts', (source) => {
  if (!source.includes('private rig_setup_group: Group | null = null')) {
    source = replaceOnce(
      source,
      `  public is_model_gizmo_active: boolean = false\n  public readonly mesh_drag_bone_placement: MeshDragBonePlacement\n`,
      `  public is_model_gizmo_active: boolean = false\n  private rig_setup_group: Group | null = null\n  private rig_setup_locked_state: boolean = true\n  public readonly mesh_drag_bone_placement: MeshDragBonePlacement\n`,
      'rig setup state fields'
    )
  }

  if (!source.includes('public is_rig_setup_locked (): boolean')) {
    const marker = `  // --- Model position gizmo (step 2) ---\n`
    const methods = `  public is_rig_setup_locked (): boolean {\n    return this.rig_setup_locked_state\n  }\n\n  private prepare_rig_setup_group (): void {\n    if (this.rig_setup_group !== null) return\n\n    const model = this.load_model_step.model_meshes()\n    const armature = this.edit_skeleton_step.armature()\n    const group = new Group()\n    group.name = 'Rig Setup Group'\n    group.position.set(0, 0, 0)\n    group.quaternion.identity()\n    group.scale.set(1, 1, 1)\n\n    this.scene.add(group)\n    group.add(model)\n    group.add(armature)\n    group.updateWorldMatrix(true, true)\n    this.rig_setup_group = group\n  }\n\n  private bake_rig_setup_group_transform (): void {\n    const group = this.rig_setup_group\n    if (group === null) return\n\n    const model = this.load_model_step.model_meshes()\n    const armature = this.edit_skeleton_step.armature()\n\n    group.updateWorldMatrix(true, true)\n    armature.updateWorldMatrix(true, true)\n    const armature_world_matrix = armature.matrixWorld.clone()\n\n    // The skinning solver reads raw mesh geometry and the armature below its\n    // container, so bake the shared setup transform into both before ungrouping.\n    ModelCleanupUtility.bake_transforms_into_geometry(model)\n    group.remove(model)\n    this.scene.add(model)\n\n    group.remove(armature)\n    this.scene.add(armature)\n    armature.position.set(0, 0, 0)\n    armature.quaternion.identity()\n    armature.scale.set(1, 1, 1)\n    armature.updateMatrix()\n\n    armature.children.forEach((child) => {\n      child.applyMatrix4(armature_world_matrix)\n    })\n    armature.updateWorldMatrix(true, true)\n\n    group.removeFromParent()\n    this.rig_setup_group = null\n    this.edit_skeleton_step.skeleton().bones[0]?.updateWorldMatrix(true, true)\n    this.regenerate_skeleton_helper(this.edit_skeleton_step.skeleton(), 'Skeleton Helper')\n    this.sync_skeleton_helper_joint_visibility()\n  }\n\n  public unlock_rig_setup (): void {\n    if (this.process_step !== ProcessStep.EditSkeleton) return\n\n    this.prepare_rig_setup_group()\n    this.rig_setup_locked_state = false\n    this.edit_skeleton_step.set_currently_selected_bone(null)\n    this.transform_controls.detach()\n\n    if (this.rig_setup_group !== null) {\n      this.transform_controls.attach(this.rig_setup_group)\n      this.transform_controls.setSpace('world')\n      this.transform_controls.setMode('translate')\n      this.transform_controls.enabled = true\n    }\n\n    this.enable_orbit_controls(true)\n    this.update_rig_setup_controls()\n  }\n\n  public lock_rig_setup (): void {\n    if (this.rig_setup_locked_state) return\n\n    this.transform_controls.detach()\n    this.bake_rig_setup_group_transform()\n    this.rig_setup_locked_state = true\n    this.update_edit_bone_interaction_mode()\n    this.update_rig_setup_controls()\n  }\n\n  public toggle_rig_setup_lock (): void {\n    if (this.rig_setup_locked_state) {\n      this.unlock_rig_setup()\n    } else {\n      this.lock_rig_setup()\n    }\n  }\n\n  public set_rig_setup_transform_mode (mode: 'translate' | 'rotate'): void {\n    if (this.rig_setup_locked_state || this.rig_setup_group === null) return\n    this.transform_controls.setMode(mode)\n    this.transform_controls.attach(this.rig_setup_group)\n    this.transform_controls.enabled = true\n  }\n\n  public set_rig_camera_view (view: 'front' | 'side' | 'back'): void {\n    const target = new THREE.Vector3(0, 0.9, 0)\n    const current_distance = Math.max(this.camera.position.distanceTo(target), 2)\n    this.camera.up.set(0, 1, 0)\n\n    if (view === 'front') {\n      this.set_camera_position(new THREE.Vector3(0, target.y, current_distance))\n    } else if (view === 'side') {\n      this.set_camera_position(new THREE.Vector3(current_distance, target.y, 0))\n    } else {\n      this.set_camera_position(new THREE.Vector3(0, target.y, -current_distance))\n    }\n  }\n\n  private update_rig_setup_controls (): void {\n    const lock_button = document.getElementById('rig-setup-lock-button') as HTMLButtonElement | null\n    const move_button = document.getElementById('rig-setup-move-button') as HTMLButtonElement | null\n    const rotate_button = document.getElementById('rig-setup-rotate-button') as HTMLButtonElement | null\n    const status = document.getElementById('rig-setup-status')\n    const pose_a = document.getElementById('pose-preset-a') as HTMLButtonElement | null\n    const pose_t = document.getElementById('pose-preset-t') as HTMLButtonElement | null\n    const bind = document.getElementById('action_bind_pose') as HTMLButtonElement | null\n\n    if (lock_button !== null) {\n      lock_button.textContent = this.rig_setup_locked_state ? 'Разблокировать риг' : 'Зафиксировать скелет'\n    }\n    if (move_button !== null) move_button.disabled = this.rig_setup_locked_state\n    if (rotate_button !== null) rotate_button.disabled = this.rig_setup_locked_state\n    if (pose_a !== null) pose_a.disabled = !this.rig_setup_locked_state\n    if (pose_t !== null) pose_t.disabled = !this.rig_setup_locked_state\n    if (bind !== null) bind.disabled = !this.rig_setup_locked_state\n    if (status !== null) {\n      status.textContent = this.rig_setup_locked_state\n        ? 'Риг зафиксирован: правьте суставы, обзор меняется только камерой.'\n        : 'Риг разблокирован: модель и скелет двигаются вместе.'\n    }\n  }\n\n`
    source = replaceOnce(source, marker, methods + marker, 'rig setup engine methods')
  }

  if (!source.includes('if (!this.rig_setup_locked_state) { return }\n\n    const selected_bone')) {
    source = replaceOnce(
      source,
      `  public handle_transform_controls_moving (): void {\n    if (this.is_model_gizmo_active) { return }\n\n    const selected_bone: Bone = this.transform_controls.object as Bone\n`,
      `  public handle_transform_controls_moving (): void {\n    if (this.is_model_gizmo_active) { return }\n    if (!this.rig_setup_locked_state) { return }\n\n    const selected_bone: Bone = this.transform_controls.object as Bone\n`,
      'group transform movement guard'
    )
  }

  if (!source.includes('if (!this.rig_setup_locked_state && this.rig_setup_group !== null)')) {
    source = replaceOnce(
      source,
      `  public update_edit_bone_interaction_mode (): void {\n    this.mesh_drag_bone_placement.sync_interaction_mode(this.process_step, this.transform_controls)\n    this.is_transform_controls_dragging = false\n  }\n`,
      `  public update_edit_bone_interaction_mode (): void {\n    if (!this.rig_setup_locked_state && this.rig_setup_group !== null) {\n      this.transform_controls.detach()\n      this.transform_controls.attach(this.rig_setup_group)\n      this.transform_controls.enabled = true\n      this.enable_orbit_controls(true)\n      this.is_transform_controls_dragging = false\n      return\n    }\n\n    this.mesh_drag_bone_placement.sync_interaction_mode(this.process_step, this.transform_controls)\n    this.is_transform_controls_dragging = false\n  }\n`,
      'rig setup interaction mode'
    )
  }

  if (!source.includes('const previous_step = this.process_step')) {
    source = replaceOnce(
      source,
      `  public process_step_changed (process_step: ProcessStep): ProcessStep {\n    // we will have the current step turn on the UI elements it needs\n`,
      `  public process_step_changed (process_step: ProcessStep): ProcessStep {\n    const previous_step = this.process_step\n\n    if (previous_step === ProcessStep.EditSkeleton &&\n        process_step !== ProcessStep.EditSkeleton &&\n        !this.rig_setup_locked_state) {\n      this.lock_rig_setup()\n    }\n\n    // we will have the current step turn on the UI elements it needs\n`,
      'process step rig bake guard'
    )
  }

  if (!source.includes('const start_rig_unlocked = previous_step === ProcessStep.LoadSkeleton')) {
    source = replaceOnce(
      source,
      `    else if (this.process_step === ProcessStep.EditSkeleton) {\n      this.load_skeleton_step?.dispose()\n\n      this.regenerate_skeleton_helper(this.edit_skeleton_step.skeleton())\n      process_step = ProcessStep.EditSkeleton\n      this.edit_skeleton_step.begin(this.scene, this.load_skeleton_step.skeleton_type())\n      this.update_edit_bone_interaction_mode()\n      this.transform_controls.setMode(this.transform_controls_type) // 'translate', 'rotate'\n`,
      `    else if (this.process_step === ProcessStep.EditSkeleton) {\n      this.load_skeleton_step?.dispose()\n\n      const start_rig_unlocked = previous_step === ProcessStep.LoadSkeleton\n      this.rig_setup_locked_state = !start_rig_unlocked\n      if (start_rig_unlocked) {\n        this.prepare_rig_setup_group()\n      }\n\n      this.regenerate_skeleton_helper(this.edit_skeleton_step.skeleton())\n      process_step = ProcessStep.EditSkeleton\n      this.edit_skeleton_step.begin(this.scene, this.load_skeleton_step.skeleton_type())\n\n      if (start_rig_unlocked) {\n        this.unlock_rig_setup()\n      } else {\n        this.update_edit_bone_interaction_mode()\n        this.transform_controls.setMode(this.transform_controls_type) // 'translate', 'rotate'\n        this.update_rig_setup_controls()\n      }\n`,
      'edit skeleton rig setup entry'
    )
  }

  if (!source.includes('if (!this.rig_setup_locked_state) { return }\n\n    // when we are done with skinned mesh')) {
    source = replaceOnce(
      source,
      `  public handle_transform_controls_mouse_down (mouse_event: MouseEvent | PointerEvent): void {\n    // primary click is made for rotating around 3d scene\n`,
      `  public handle_transform_controls_mouse_down (mouse_event: MouseEvent | PointerEvent): void {\n    if (!this.rig_setup_locked_state) { return }\n\n    // primary click is made for rotating around 3d scene\n`,
      'bone selection guard while rig unlocked'
    )
  }

  return source
})

patchFile('src/lib/EventListeners.ts', (source) => {
  if (!source.includes("rig-setup-lock-button')?.addEventListener")) {
    source = replaceOnce(
      source,
      `    this.bootstrap.load_skeleton_step.addEventListener('skeletonLoaded', () => {\n      this.bootstrap.edit_skeleton_step.load_original_armature_from_model(this.bootstrap.load_skeleton_step.armature())\n      this.bootstrap.process_step = this.bootstrap.process_step_changed(ProcessStep.EditSkeleton)\n    })\n`,
      `    this.bootstrap.load_skeleton_step.addEventListener('skeletonLoaded', () => {\n      this.bootstrap.edit_skeleton_step.load_original_armature_from_model(this.bootstrap.load_skeleton_step.armature())\n      this.bootstrap.process_step = this.bootstrap.process_step_changed(ProcessStep.EditSkeleton)\n    })\n\n    document.getElementById('rig-setup-lock-button')?.addEventListener('click', () => {\n      this.bootstrap.toggle_rig_setup_lock()\n    })\n    document.getElementById('rig-setup-move-button')?.addEventListener('click', () => {\n      this.bootstrap.set_rig_setup_transform_mode('translate')\n    })\n    document.getElementById('rig-setup-rotate-button')?.addEventListener('click', () => {\n      this.bootstrap.set_rig_setup_transform_mode('rotate')\n    })\n    document.getElementById('rig-view-front')?.addEventListener('click', () => {\n      this.bootstrap.set_rig_camera_view('front')\n    })\n    document.getElementById('rig-view-side')?.addEventListener('click', () => {\n      this.bootstrap.set_rig_camera_view('side')\n    })\n    document.getElementById('rig-view-back')?.addEventListener('click', () => {\n      this.bootstrap.set_rig_camera_view('back')\n    })\n`,
      'rig setup event listeners'
    )
  }

  source = source.replace(
    `      if (this.bootstrap.process_step === ProcessStep.EditSkeleton) {\n`,
    `      if (this.bootstrap.process_step === ProcessStep.EditSkeleton && this.bootstrap.is_rig_setup_locked()) {\n`
  )

  source = source.replace(
    `      const use_mesh_drag_mode =\n        this.bootstrap.process_step === ProcessStep.EditSkeleton &&\n        this.bootstrap.edit_skeleton_step.is_mesh_drag_placement_enabled()\n`,
    `      const use_mesh_drag_mode =\n        this.bootstrap.process_step === ProcessStep.EditSkeleton &&\n        this.bootstrap.is_rig_setup_locked() &&\n        this.bootstrap.edit_skeleton_step.is_mesh_drag_placement_enabled()\n`
  )

  source = source.replace(
    `      if (event.value && this.bootstrap.process_step === ProcessStep.EditSkeleton) {\n`,
    `      if (event.value && this.bootstrap.process_step === ProcessStep.EditSkeleton && this.bootstrap.is_rig_setup_locked()) {\n`
  )

  source = source.replace(
    `      if (!event.value &&\n        this.bootstrap.process_step === ProcessStep.EditSkeleton &&\n`,
    `      if (!event.value &&\n        this.bootstrap.process_step === ProcessStep.EditSkeleton &&\n        this.bootstrap.is_rig_setup_locked() &&\n`
  )

  return source
})
