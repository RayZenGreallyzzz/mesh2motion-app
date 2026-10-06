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
  if (!source.includes(search)) throw new Error(`Weight workflow patch marker not found: ${label}`)
  return source.replace(search, replacement)
}

patchFile('src/create.html', (html) => {
  if (html.includes('id="weight-skin-tools"')) return html

  const previewStartMarker = '          <div class="pill-switch-group" aria-label="Preview Display">'
  const manualStartMarker = '          <div id="manual-weight-editor"'
  const mirrorMarker = '          <div class="styled-checkbox">\n            <input type="checkbox" id="mirror-skeleton"'

  const previewStart = html.indexOf(previewStartMarker)
  const manualStart = html.indexOf(manualStartMarker)
  if (previewStart < 0 || manualStart < 0 || manualStart <= previewStart) throw new Error('Cannot locate weight preview/editor blocks')

  const previewBlock = html.slice(previewStart, manualStart).trimEnd()
  html = html.slice(0, previewStart) + html.slice(manualStart)

  const movedManualStart = html.indexOf(manualStartMarker)
  const mirrorStart = html.indexOf(mirrorMarker)
  if (movedManualStart < 0 || mirrorStart < 0 || mirrorStart <= movedManualStart) throw new Error('Cannot isolate manual weight editor')

  const manualBlock = html.slice(movedManualStart, mirrorStart).trimEnd()
  html = html.slice(0, movedManualStart) + html.slice(mirrorStart)

  const insertionMarker = '        <!-- <span id="skinned-step-tools">'
  const weightPanel = `        <span id="weight-skin-tools" style="display: none; flex-direction: column; gap: 0.65rem;">\n          <div class="alternate-background-section" style="display: flex; flex-direction: column; gap: 0.45rem;">\n            <strong>Веса</strong>\n            <small>Модель уже привязана к скелету. Выберите кость и поправьте влияние кистью, затем переходите к анимациям.</small>\n          </div>\n\n${previewBlock}\n\n${manualBlock}\n\n          <div style="display: flex; gap: 0.5rem;">\n            <button type="button" class="no-style-button" id="action_weights_back_to_skeleton">&#x2039; Скелет</button>\n            <button type="button" id="action_weights_to_animations" style="flex: 1;">Анимации &#x203a;</button>\n          </div>\n        </span>\n\n`

  html = replaceOnce(html, insertionMarker, weightPanel + insertionMarker, 'weight panel insertion')
  html = html.replace(
    '<button class="no-style-button" id="action_back_to_edit_skeleton">\n                &#x2039; Back\n              </button>',
    '<button class="no-style-button" id="action_back_to_edit_skeleton">\n                &#x2039; Веса\n              </button>'
  )
  return html
})

patchFile('src/lib/UI.ts', (source) => {
  if (!source.includes('dom_weight_skin_tools: HTMLElement | null = null')) {
    source = replaceOnce(
      source,
      '  dom_skinned_mesh_tools: HTMLElement | null = null\n',
      '  dom_weight_skin_tools: HTMLElement | null = null\n  dom_skinned_mesh_tools: HTMLElement | null = null\n',
      'UI field'
    )
  }

  if (!source.includes("this.dom_weight_skin_tools = document.querySelector('#weight-skin-tools')")) {
    source = replaceOnce(
      source,
      "    // UI controls for working with skinned mesh\n    this.dom_skinned_mesh_tools = document.querySelector('#skinned-step-tools')\n",
      "    // UI controls for post-bind weight editing / working with skinned mesh\n    this.dom_weight_skin_tools = document.querySelector('#weight-skin-tools')\n    this.dom_skinned_mesh_tools = document.querySelector('#skinned-step-tools')\n",
      'UI query'
    )
  }

  if (!source.includes('if (this.dom_weight_skin_tools != null)')) {
    source = replaceOnce(
      source,
      "    if (this.dom_skinned_mesh_tools != null) {\n      this.dom_skinned_mesh_tools.style.display = 'none'\n    }\n",
      "    if (this.dom_weight_skin_tools != null) {\n      this.dom_weight_skin_tools.style.display = 'none'\n    }\n    if (this.dom_skinned_mesh_tools != null) {\n      this.dom_skinned_mesh_tools.style.display = 'none'\n    }\n",
      'UI hide weight panel'
    )
  }

  return source
})

patchFile('src/lib/EventListeners.ts', (source) => {
  if (!source.includes("action_weights_back_to_skeleton')?.addEventListener")) {
    source = replaceOnce(
      source,
      "    this.bootstrap.ui.dom_bind_pose_button?.addEventListener('click', () => {\n      this.bootstrap.setup_weight_skinning_config()\n      this.bootstrap.process_step_changed(ProcessStep.BindPose)\n    })\n",
      "    this.bootstrap.ui.dom_bind_pose_button?.addEventListener('click', () => {\n      this.bootstrap.setup_weight_skinning_config()\n      this.bootstrap.process_step_changed(ProcessStep.BindPose)\n    })\n\n    document.getElementById('action_weights_back_to_skeleton')?.addEventListener('click', () => {\n      this.bootstrap.remove_skinned_meshes_from_scene()\n      this.bootstrap.remove_weight_painted_mesh_preview()\n      this.bootstrap.process_step = this.bootstrap.process_step_changed(ProcessStep.EditSkeleton)\n      this.bootstrap.edit_skeleton_step.set_currently_selected_bone(null)\n    })\n\n    document.getElementById('action_weights_to_animations')?.addEventListener('click', () => {\n      this.bootstrap.process_step = this.bootstrap.process_step_changed(ProcessStep.AnimationsListing)\n    })\n",
      'weight navigation listeners'
    )
  }

  const oldBack = `    // going back to edit skeleton step after skinning\n    // this will do a lot of resetting\n    this.bootstrap.ui.dom_back_to_edit_skeleton_button?.addEventListener('click', () => {\n      this.bootstrap.remove_skinned_meshes_from_scene() // clear any existing skinned meshes\n      this.bootstrap.debugging_visual_object = Utility.regenerate_debugging_scene(this.bootstrap.scene)\n      this.bootstrap.process_step = this.bootstrap.process_step_changed(ProcessStep.EditSkeleton)\n\n      // reset current bone selection for edit skeleton step\n      this.bootstrap.edit_skeleton_step.set_currently_selected_bone(null)\n\n      // reset the undo/redo system\n      this.bootstrap.edit_skeleton_step.clear_undo_history()\n    })\n`
  const newBack = `    // Return from animations to the post-bind weight editing stage.\n    this.bootstrap.ui.dom_back_to_edit_skeleton_button?.addEventListener('click', () => {\n      this.bootstrap.remove_skinned_meshes_from_scene()\n      this.bootstrap.debugging_visual_object = Utility.regenerate_debugging_scene(this.bootstrap.scene)\n      this.bootstrap.process_step = this.bootstrap.process_step_changed(ProcessStep.WeightSkin)\n    })\n`
  if (source.includes(oldBack)) source = source.replace(oldBack, newBack)

  return source
})

patchFile('src/Mesh2MotionEngine.ts', (source) => {
  source = source.replace(
    `    return this.process_step === ProcessStep.EditSkeleton &&\n      this.rig_setup_locked_state &&\n      (enabled?.checked ?? false)`,
    `    return this.process_step === ProcessStep.WeightSkin &&\n      (enabled?.checked ?? false)`
  )

  source = source.replace(
    `    if (!this.rig_setup_locked_state && enabled.checked) enabled.checked = false\n\n`,
    ``
  )

  source = source.replace(
    `    if (this.process_step === ProcessStep.EditSkeleton) this.regenerate_weight_painted_preview_mesh()`,
    `    if (this.process_step === ProcessStep.WeightSkin) this.regenerate_weight_painted_preview_mesh()`
  )

  if (!source.includes('case ProcessStep.WeightSkin:')) {
    source = replaceOnce(
      source,
      `      case ProcessStep.BindPose:\n        this.process_step = ProcessStep.BindPose\n        break\n      case ProcessStep.AnimationsListing:`,
      `      case ProcessStep.BindPose:\n        this.process_step = ProcessStep.BindPose\n        break\n      case ProcessStep.WeightSkin:\n        this.process_step = ProcessStep.WeightSkin\n        break\n      case ProcessStep.AnimationsListing:`,
      'WeightSkin switch case'
    )
  }

  source = source.replace(
    `      this.sync_skeleton_helper_joint_visibility()\n      this.refresh_manual_weight_editor()\n\n      this.changed_model_preview_display(this.mesh_preview_display_type) // show weight painted mesh by default\n    }\n    else if (this.process_step === ProcessStep.BindPose) {\n      this.transform_controls.enabled = false // shouldn't be editing bones\n      this.calculate_skin_weighting_for_models()\n\n      this.remove_skinned_meshes_from_scene() // clean up in case we had skinned meshes in scene previously\n      this.scene.add(...this.weight_skin_step.final_skinned_meshes()) // add final skinned mesh to scene\n\n      this.weight_skin_step.weight_painted_mesh_group().visible = false // hide weight painted mesh\n      this.process_step_changed(ProcessStep.AnimationsListing)\n    }\n    else if (this.process_step === ProcessStep.AnimationsListing) {`,
    `      this.sync_skeleton_helper_joint_visibility()\n      this.mesh_preview_display_type = ModelPreviewDisplay.Textured\n      this.changed_model_preview_display(this.mesh_preview_display_type)\n    }\n    else if (this.process_step === ProcessStep.BindPose) {\n      this.transform_controls.enabled = false\n      this.process_step_changed(ProcessStep.WeightSkin)\n    }\n    else if (this.process_step === ProcessStep.WeightSkin) {\n      this.process_step = ProcessStep.WeightSkin\n      this.transform_controls.enabled = false\n      this.dispose_skeleton_helper()\n\n      this.remove_skinned_meshes_from_scene()\n      this.calculate_skin_weighting_for_models()\n      this.scene.add(...this.weight_skin_step.final_skinned_meshes())\n      this.scene.add(this.weight_skin_step.weight_painted_mesh_group())\n\n      this.load_model_step.model_meshes().visible = false\n      this.mesh_preview_display_type = ModelPreviewDisplay.Textured\n      this.weight_skin_step.final_skinned_meshes().forEach(mesh => { mesh.visible = true })\n      this.weight_skin_step.weight_painted_mesh_group().visible = false\n\n      if (this.ui.dom_weight_skin_tools !== null) this.ui.dom_weight_skin_tools.style.display = 'flex'\n      if (this.ui.dom_current_step_element !== null) this.ui.dom_current_step_element.textContent = 'Веса'\n      this.refresh_manual_weight_editor()\n      this.sync_manual_weight_editor()\n    }\n    else if (this.process_step === ProcessStep.AnimationsListing) {`
  )

  const oldRegenerate = `  public regenerate_weight_painted_preview_mesh (): void {\n    // needed for skinning process\n    this.calculate_skin_weighting_for_models()\n\n    // if the weight painted mesh is not in scene, add it\n    if (this.scene.getObjectByName('Weight Painted Mesh') === undefined) {\n      this.scene.add(this.weight_skin_step.weight_painted_mesh_group())\n    }\n  }\n`
  const newRegenerate = `  public regenerate_weight_painted_preview_mesh (): void {\n    const is_weight_step = this.process_step === ProcessStep.WeightSkin\n    if (is_weight_step) this.remove_skinned_meshes_from_scene()\n\n    this.calculate_skin_weighting_for_models()\n\n    if (this.scene.getObjectByName('Weight Painted Mesh Preview') === undefined) {\n      this.scene.add(this.weight_skin_step.weight_painted_mesh_group())\n    }\n\n    if (is_weight_step) {\n      this.scene.add(...this.weight_skin_step.final_skinned_meshes())\n      const show_textured = this.mesh_preview_display_type === ModelPreviewDisplay.Textured\n      this.load_model_step.model_meshes().visible = false\n      this.weight_skin_step.final_skinned_meshes().forEach(mesh => { mesh.visible = show_textured })\n      this.weight_skin_step.weight_painted_mesh_group().visible = !show_textured\n    }\n  }\n`
  if (source.includes(oldRegenerate)) source = source.replace(oldRegenerate, newRegenerate)

  const oldPreview = `  public changed_model_preview_display (mesh_textured_display_type: ModelPreviewDisplay): void {\n    this.mesh_preview_display_type = mesh_textured_display_type\n\n    // show/hide loaded textured model depending on view\n    this.load_model_step.model_meshes().visible = this.mesh_preview_display_type === ModelPreviewDisplay.Textured\n\n    if (this.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted) {\n      this.regenerate_weight_painted_preview_mesh()\n    }\n\n    // show/hide weight painted mesh depending on view\n    this.weight_skin_step.weight_painted_mesh_group().visible =\n      this.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted\n  }\n`
  const newPreview = `  public changed_model_preview_display (mesh_textured_display_type: ModelPreviewDisplay): void {\n    this.mesh_preview_display_type = mesh_textured_display_type\n\n    if (this.process_step === ProcessStep.WeightSkin) {\n      if (this.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted) {\n        this.regenerate_weight_painted_preview_mesh()\n        return\n      }\n\n      this.load_model_step.model_meshes().visible = false\n      this.weight_skin_step.final_skinned_meshes().forEach(mesh => { mesh.visible = true })\n      this.weight_skin_step.weight_painted_mesh_group().visible = false\n      return\n    }\n\n    this.load_model_step.model_meshes().visible = this.mesh_preview_display_type === ModelPreviewDisplay.Textured\n\n    if (this.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted) {\n      this.regenerate_weight_painted_preview_mesh()\n    }\n\n    this.weight_skin_step.weight_painted_mesh_group().visible =\n      this.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted\n  }\n`
  if (source.includes(oldPreview)) source = source.replace(oldPreview, newPreview)

  // Turning the brush off returns to the textured, actually skinned model.
  source = source.replace(
    `    } else if (status !== null) {\n      status.textContent = 'Зафиксируйте риг, включите кисть и проведите пальцем по модели.'\n    }\n\n    this.update_manual_weight_labels()`,
    `    } else {\n      this.changed_model_preview_display(ModelPreviewDisplay.Textured)\n      if (status !== null) status.textContent = 'Включите кисть, выберите кость и проведите пальцем по модели.'\n    }\n\n    this.update_manual_weight_labels()`
  )

  return source
})

console.log('Post-bind WeightSkin workflow v4.5 applied')
