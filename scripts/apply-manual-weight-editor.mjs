import fs from 'node:fs'

function replaceOnce (source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Manual weight editor patch marker not found: ${label}`)
  return source.replace(search, replacement)
}

// --- StepWeightSkin: persist manual vertex/bone deltas on top of automatic weights ---
{
  const path = 'src/lib/processes/weight-skin/StepWeightSkin.ts'
  let source = fs.readFileSync(path, 'utf8')

  if (!source.includes('manual_weight_deltas')) {
    source = replaceOnce(
      source,
      "  private readonly weight_painted_mesh_preview: Group = new Group()\n",
      "  private readonly weight_painted_mesh_preview: Group = new Group()\n\n  // Manual weight paint is stored as additive deltas on top of the automatic\n  // solver. Geometry order and vertex order stay stable while editing a model,\n  // so these survive preview rebuilds and are applied again at Bind.\n  private readonly manual_weight_deltas = new Map<number, Map<number, Map<number, number>>>()\n  private manual_weight_preview_bone_index: number | null = null\n",
      'StepWeightSkin properties'
    )

    source = replaceOnce(
      source,
      "  public calculate_weights (): number[][] {\n    if (this.bone_skinning_formula === undefined) return [[], []]\n    return this.bone_skinning_formula.calculate_indexes_and_weights()\n  }\n",
      `  public calculate_weights (): number[][] {\n    if (this.bone_skinning_formula === undefined) return [[], []]\n    return this.bone_skinning_formula.calculate_indexes_and_weights()\n  }\n\n  public set_manual_weight_preview_bone (bone_index: number | null): void {\n    this.manual_weight_preview_bone_index = bone_index\n  }\n\n  public clear_manual_weight_overrides (): void {\n    this.manual_weight_deltas.clear()\n  }\n\n  public add_manual_weight_adjustment (\n    mesh_index: number,\n    vertex_indices: number[],\n    bone_index: number,\n    delta: number\n  ): void {\n    if (!Number.isInteger(mesh_index) || !Number.isInteger(bone_index) || !Number.isFinite(delta) || delta === 0) return\n\n    let mesh_map = this.manual_weight_deltas.get(mesh_index)\n    if (mesh_map === undefined) {\n      mesh_map = new Map<number, Map<number, number>>()\n      this.manual_weight_deltas.set(mesh_index, mesh_map)\n    }\n\n    for (const vertex_index of vertex_indices) {\n      if (!Number.isInteger(vertex_index) || vertex_index < 0) continue\n      let vertex_map = mesh_map.get(vertex_index)\n      if (vertex_map === undefined) {\n        vertex_map = new Map<number, number>()\n        mesh_map.set(vertex_index, vertex_map)\n      }\n\n      const next_delta = Math.max(-1, Math.min(1, (vertex_map.get(bone_index) ?? 0) + delta))\n      if (Math.abs(next_delta) < 0.00001) vertex_map.delete(bone_index)\n      else vertex_map.set(bone_index, next_delta)\n\n      if (vertex_map.size === 0) mesh_map.delete(vertex_index)\n    }\n\n    if (mesh_map.size === 0) this.manual_weight_deltas.delete(mesh_index)\n  }\n\n  private apply_manual_weight_adjustments (mesh_index: number, skin_indices: number[], skin_weights: number[]): void {\n    const mesh_map = this.manual_weight_deltas.get(mesh_index)\n    if (mesh_map === undefined) return\n\n    for (const [vertex_index, bone_deltas] of mesh_map) {\n      const offset = vertex_index * 4\n      if (offset + 3 >= skin_indices.length || offset + 3 >= skin_weights.length) continue\n\n      const fallback_bone = skin_indices[offset]\n      const weights = new Map<number, number>()\n      for (let slot = 0; slot < 4; slot++) {\n        const weight = skin_weights[offset + slot] ?? 0\n        if (weight <= 0) continue\n        const bone = skin_indices[offset + slot]\n        weights.set(bone, (weights.get(bone) ?? 0) + weight)\n      }\n\n      for (const [bone_index, delta] of bone_deltas) {\n        const next = Math.max(0, Math.min(1, (weights.get(bone_index) ?? 0) + delta))\n        if (next <= 0.00001) weights.delete(bone_index)\n        else weights.set(bone_index, next)\n      }\n\n      let entries = [...weights.entries()]\n        .filter(([, weight]) => weight > 0.00001)\n        .sort((a, b) => b[1] - a[1])\n        .slice(0, 4)\n\n      if (entries.length === 0) entries = [[fallback_bone, 1]]\n      const total = entries.reduce((sum, [, weight]) => sum + weight, 0) || 1\n\n      for (let slot = 0; slot < 4; slot++) {\n        const entry = entries[slot]\n        skin_indices[offset + slot] = entry?.[0] ?? fallback_bone\n        skin_weights[offset + slot] = entry === undefined ? 0 : entry[1] / total\n      }\n    }\n  }\n`,
      'StepWeightSkin manual methods'
    )

    source = replaceOnce(
      source,
      "      const [final_skin_indices, final_skin_weights]: number[][] = this.calculate_weights()\n\n      geometry_data.setAttribute('skinIndex', new Uint16BufferAttribute(final_skin_indices, 4))\n",
      "      const [final_skin_indices, final_skin_weights]: number[][] = this.calculate_weights()\n      this.apply_manual_weight_adjustments(idx, final_skin_indices, final_skin_weights)\n\n      geometry_data.setAttribute('skinIndex', new Uint16BufferAttribute(final_skin_indices, 4))\n",
      'StepWeightSkin apply overrides'
    )

    source = replaceOnce(
      source,
      "        const weight_painted_mesh = Generators.create_weight_painted_mesh(final_skin_indices, geometry_data)\n        const wireframe_mesh = Generators.create_wireframe_mesh_from_geometry(geometry_data)\n        this.weight_painted_mesh_preview?.add(weight_painted_mesh, wireframe_mesh)\n",
      "        const weight_painted_mesh = Generators.create_weight_painted_mesh(\n          final_skin_indices, geometry_data, final_skin_weights, this.manual_weight_preview_bone_index\n        )\n        weight_painted_mesh.name = `Weight Painted Mesh ${idx}`\n        weight_painted_mesh.userData.weightMeshIndex = idx\n        weight_painted_mesh.userData.manualWeightSurface = true\n\n        const wireframe_mesh = Generators.create_wireframe_mesh_from_geometry(geometry_data)\n        wireframe_mesh.userData.manualWeightSurface = false\n        this.weight_painted_mesh_preview?.add(weight_painted_mesh, wireframe_mesh)\n",
      'StepWeightSkin preview metadata'
    )

    fs.writeFileSync(path, source)
  }
}

// --- Generators: selected-bone heatmap for manual painting ---
{
  const path = 'src/lib/Generators.ts'
  let source = fs.readFileSync(path, 'utf8')

  if (!source.includes('selected_bone_index: number | null')) {
    source = replaceOnce(
      source,
      "  static create_weight_painted_mesh (skin_indices: number[], orig_geometry: BufferGeometry): Mesh {\n",
      "  static create_weight_painted_mesh (\n    skin_indices: number[],\n    orig_geometry: BufferGeometry,\n    skin_weights: number[] = [],\n    selected_bone_index: number | null = null\n  ): Mesh {\n",
      'Generators signature'
    )

    const oldColorBlock = `      const bone_index = skin_indices[i * 4] // Primary bone assignment\n      let color = bone_colors[bone_index]\n\n      // this shouldn't happen now, but will be a fallback in case we add a skeleton with more than 120 bones\n      if (color == null || color === undefined) {\n        console.warn(\`No color found for bone index \${bone_index}. Using default color. Code needs to increase the number of bone colors generated\`)\n        color = new Vector3(1, 1, 1) // white color\n      }\n\n      colors[i * 3] = color.x // red\n      colors[i * 3 + 1] = color.y // green\n      colors[i * 3 + 2] = color.z // blue\n`

    const newColorBlock = `      if (selected_bone_index !== null && skin_weights.length >= (i + 1) * 4) {\n        let selected_weight = 0\n        for (let slot = 0; slot < 4; slot++) {\n          if (skin_indices[i * 4 + slot] === selected_bone_index) {\n            selected_weight += skin_weights[i * 4 + slot] ?? 0\n          }\n        }\n        selected_weight = Math.max(0, Math.min(1, selected_weight))\n        // Dark blue means no influence; bright magenta means full influence.\n        colors[i * 3] = 0.07 + selected_weight * 0.93\n        colors[i * 3 + 1] = 0.09 + selected_weight * 0.10\n        colors[i * 3 + 2] = 0.16 + selected_weight * 0.72\n      } else {\n        const bone_index = skin_indices[i * 4] // Primary bone assignment\n        let color = bone_colors[bone_index]\n\n        // fallback for skeletons with more bones than our deterministic palette\n        if (color == null || color === undefined) {\n          color = new Vector3(1, 1, 1)\n        }\n\n        colors[i * 3] = color.x\n        colors[i * 3 + 1] = color.y\n        colors[i * 3 + 2] = color.z\n      }\n`

    source = replaceOnce(source, oldColorBlock, newColorBlock, 'Generators heatmap')
    fs.writeFileSync(path, source)
  }
}

// --- create.html: tablet-friendly manual weight controls ---
{
  const path = 'src/create.html'
  let source = fs.readFileSync(path, 'utf8')

  if (!source.includes('id="manual-weight-editor"')) {
    const marker = `          <div class="styled-checkbox">\n            <input type="checkbox" id="mirror-skeleton" name="mirror-skeleton" value="mirror" checked>\n`
    const panel = `          <div id="manual-weight-editor" class="alternate-background-section" style="display: flex; flex-direction: column; gap: 0.5rem;">\n            <span class="pill-switch-label">Ручные веса</span>\n            <div class="styled-checkbox" style="margin: 0;">\n              <input type="checkbox" id="manual-weight-enabled" />\n              <label for="manual-weight-enabled">Кисть весов</label>\n            </div>\n            <label for="manual-weight-bone">Кость</label>\n            <select id="manual-weight-bone"></select>\n            <div class="pill-switch">\n              <input type="radio" id="manual-weight-add" name="manual-weight-mode" value="add" checked />\n              <label for="manual-weight-add">Добавить</label>\n              <input type="radio" id="manual-weight-remove" name="manual-weight-mode" value="remove" />\n              <label for="manual-weight-remove">Убрать</label>\n            </div>\n            <label for="manual-weight-radius">Размер кисти <span id="manual-weight-radius-value">8</span>%</label>\n            <input id="manual-weight-radius" type="range" min="0.02" max="0.30" step="0.01" value="0.08" />\n            <label for="manual-weight-strength">Сила <span id="manual-weight-strength-value">15</span>%</label>\n            <input id="manual-weight-strength" type="range" min="0.05" max="0.50" step="0.05" value="0.15" />\n            <button type="button" class="secondary-button" id="manual-weight-reset">Сбросить ручные правки</button>\n            <small id="manual-weight-status">Зафиксируйте риг, включите кисть и проведите пальцем по модели.</small>\n          </div>\n\n`
    source = replaceOnce(source, marker, panel + marker, 'create manual weight panel')
    fs.writeFileSync(path, source)
  }
}

// --- Mesh2MotionEngine: brush stroke collection + heatmap refresh ---
{
  const path = 'src/Mesh2MotionEngine.ts'
  let source = fs.readFileSync(path, 'utf8')

  if (!source.includes('manual_weight_stroke_vertices')) {
    source = replaceOnce(
      source,
      "  private rig_setup_group: Group | null = null\n  private rig_setup_locked_state: boolean = true\n",
      "  private rig_setup_group: Group | null = null\n  private rig_setup_locked_state: boolean = true\n  private manual_weight_stroke_vertices: Map<number, Set<number>> | null = null\n",
      'Engine manual stroke property'
    )

    source = replaceOnce(
      source,
      "    if (status !== null) {\n      status.textContent = this.rig_setup_locked_state\n        ? 'Риг зафиксирован: правьте суставы, обзор меняется только камерой.'\n        : 'Риг разблокирован: модель и скелет двигаются вместе.'\n    }\n  }\n\n  // --- Model position gizmo (step 2) ---\n",
      `    if (status !== null) {\n      status.textContent = this.rig_setup_locked_state\n        ? 'Риг зафиксирован: правьте суставы, обзор меняется только камерой.'\n        : 'Риг разблокирован: модель и скелет двигаются вместе.'\n    }\n\n    const weight_enabled = document.getElementById('manual-weight-enabled') as HTMLInputElement | null\n    if (weight_enabled !== null) {\n      weight_enabled.disabled = !this.rig_setup_locked_state\n      if (!this.rig_setup_locked_state) weight_enabled.checked = false\n    }\n  }\n\n  public refresh_manual_weight_editor (): void {\n    const select = document.getElementById('manual-weight-bone') as HTMLSelectElement | null\n    if (select === null) return\n\n    const previous = select.value\n    select.innerHTML = ''\n    this.edit_skeleton_step.skeleton().bones.forEach((bone, index) => {\n      const option = document.createElement('option')\n      option.value = index.toString()\n      option.textContent = bone.name || \`Bone \${index}\`\n      select.appendChild(option)\n    })\n\n    if ([...select.options].some(option => option.value === previous)) select.value = previous\n    else if (select.options.length > 0) select.selectedIndex = 0\n\n    const selected = Number.parseInt(select.value, 10)\n    this.weight_skin_step.set_manual_weight_preview_bone(Number.isFinite(selected) ? selected : null)\n    this.update_manual_weight_labels()\n  }\n\n  public is_manual_weight_editor_enabled (): boolean {\n    const enabled = document.getElementById('manual-weight-enabled') as HTMLInputElement | null\n    return this.process_step === ProcessStep.EditSkeleton &&\n      this.rig_setup_locked_state &&\n      (enabled?.checked ?? false)\n  }\n\n  public sync_manual_weight_editor (): void {\n    const enabled = document.getElementById('manual-weight-enabled') as HTMLInputElement | null\n    const status = document.getElementById('manual-weight-status')\n    if (enabled === null) return\n\n    if (!this.rig_setup_locked_state && enabled.checked) enabled.checked = false\n\n    const select = document.getElementById('manual-weight-bone') as HTMLSelectElement | null\n    const selected = select === null ? NaN : Number.parseInt(select.value, 10)\n    this.weight_skin_step.set_manual_weight_preview_bone(\n      enabled.checked && Number.isFinite(selected) ? selected : null\n    )\n\n    if (enabled.checked) {\n      this.mesh_preview_display_type = ModelPreviewDisplay.WeightPainted\n      this.changed_model_preview_display(ModelPreviewDisplay.WeightPainted)\n      if (status !== null) status.textContent = 'Проведите пальцем по модели. Цвет показывает влияние выбранной кости.'\n    } else if (status !== null) {\n      status.textContent = 'Зафиксируйте риг, включите кисть и проведите пальцем по модели.'\n    }\n\n    this.update_manual_weight_labels()\n  }\n\n  public update_manual_weight_labels (): void {\n    const radius = document.getElementById('manual-weight-radius') as HTMLInputElement | null\n    const strength = document.getElementById('manual-weight-strength') as HTMLInputElement | null\n    const radius_label = document.getElementById('manual-weight-radius-value')\n    const strength_label = document.getElementById('manual-weight-strength-value')\n    if (radius !== null && radius_label !== null) radius_label.textContent = Math.round(Number(radius.value) * 100).toString()\n    if (strength !== null && strength_label !== null) strength_label.textContent = Math.round(Number(strength.value) * 100).toString()\n  }\n\n  private collect_manual_weight_vertices (event: PointerEvent): boolean {\n    if (!this.is_manual_weight_editor_enabled() || this.manual_weight_stroke_vertices === null) return false\n\n    const group = this.weight_skin_step.weight_painted_mesh_group()\n    if (group === null || !group.visible) return false\n\n    const rect = this.renderer.domElement.getBoundingClientRect()\n    const pointer = new THREE.Vector2(\n      ((event.clientX - rect.left) / rect.width) * 2 - 1,\n      -((event.clientY - rect.top) / rect.height) * 2 + 1\n    )\n    const raycaster = new THREE.Raycaster()\n    raycaster.setFromCamera(pointer, this.camera)\n\n    const paint_surfaces = group.children.filter(child => child.userData.manualWeightSurface === true)\n    const hit = raycaster.intersectObjects(paint_surfaces, false)[0]\n    if (hit === undefined || !(hit.object instanceof THREE.Mesh)) return false\n\n    const mesh_index = Number(hit.object.userData.weightMeshIndex)\n    if (!Number.isInteger(mesh_index)) return false\n\n    const radius_input = document.getElementById('manual-weight-radius') as HTMLInputElement | null\n    const radius = Math.max(0.001, Number(radius_input?.value ?? 0.08))\n    const radius_squared = radius * radius\n    const local_point = hit.object.worldToLocal(hit.point.clone())\n    const positions = hit.object.geometry.getAttribute('position')\n    if (positions === undefined) return false\n\n    let vertices = this.manual_weight_stroke_vertices.get(mesh_index)\n    if (vertices === undefined) {\n      vertices = new Set<number>()\n      this.manual_weight_stroke_vertices.set(mesh_index, vertices)\n    }\n\n    const vertex = new THREE.Vector3()\n    for (let index = 0; index < positions.count; index++) {\n      vertex.fromBufferAttribute(positions, index)\n      if (vertex.distanceToSquared(local_point) <= radius_squared) vertices.add(index)\n    }\n\n    return true\n  }\n\n  public begin_manual_weight_stroke (event: PointerEvent): boolean {\n    if (!this.is_manual_weight_editor_enabled()) return false\n    this.manual_weight_stroke_vertices = new Map<number, Set<number>>()\n    this.enable_orbit_controls(false)\n    return this.collect_manual_weight_vertices(event)\n  }\n\n  public continue_manual_weight_stroke (event: PointerEvent): boolean {\n    if (this.manual_weight_stroke_vertices === null) return false\n    this.collect_manual_weight_vertices(event)\n    return true\n  }\n\n  public end_manual_weight_stroke (): boolean {\n    const stroke = this.manual_weight_stroke_vertices\n    if (stroke === null) return false\n    this.manual_weight_stroke_vertices = null\n    this.enable_orbit_controls(true)\n\n    const bone_select = document.getElementById('manual-weight-bone') as HTMLSelectElement | null\n    const strength_input = document.getElementById('manual-weight-strength') as HTMLInputElement | null\n    const remove = (document.getElementById('manual-weight-remove') as HTMLInputElement | null)?.checked ?? false\n    const bone_index = Number.parseInt(bone_select?.value ?? '', 10)\n    const strength = Math.max(0.01, Math.min(1, Number(strength_input?.value ?? 0.15)))\n    if (!Number.isFinite(bone_index)) return true\n\n    const delta = remove ? -strength : strength\n    stroke.forEach((vertices, mesh_index) => {\n      this.weight_skin_step.add_manual_weight_adjustment(mesh_index, [...vertices], bone_index, delta)\n    })\n\n    this.regenerate_weight_painted_preview_mesh()\n    return true\n  }\n\n  public reset_manual_weight_overrides (): void {\n    this.weight_skin_step.clear_manual_weight_overrides()\n    if (this.process_step === ProcessStep.EditSkeleton) this.regenerate_weight_painted_preview_mesh()\n  }\n\n  // --- Model position gizmo (step 2) ---\n`,
      'Engine manual weight methods'
    )

    source = replaceOnce(
      source,
      "      this.sync_skeleton_helper_joint_visibility()\n\n      this.changed_model_preview_display(this.mesh_preview_display_type) // show weight painted mesh by default\n",
      "      this.sync_skeleton_helper_joint_visibility()\n      this.refresh_manual_weight_editor()\n\n      this.changed_model_preview_display(this.mesh_preview_display_type) // show weight painted mesh by default\n",
      'Engine refresh editor on edit step'
    )

    source = replaceOnce(
      source,
      "      this.remove_imported_model()\n      this.load_model_step.clear_loaded_model_data()\n",
      "      this.remove_imported_model()\n      this.weight_skin_step.clear_manual_weight_overrides()\n      this.load_model_step.clear_loaded_model_data()\n",
      'Engine clear weights on new model'
    )

    fs.writeFileSync(path, source)
  }
}

// --- EventListeners: route single-finger paint strokes before bone dragging ---
{
  const path = 'src/lib/EventListeners.ts'
  let source = fs.readFileSync(path, 'utf8')

  if (!source.includes("manual-weight-enabled')?.addEventListener")) {
    source = replaceOnce(
      source,
      "    document.getElementById('rig-view-back')?.addEventListener('click', () => {\n      this.bootstrap.set_rig_camera_view('back')\n    })\n",
      `    document.getElementById('rig-view-back')?.addEventListener('click', () => {\n      this.bootstrap.set_rig_camera_view('back')\n    })\n\n    document.getElementById('manual-weight-enabled')?.addEventListener('change', () => {\n      this.bootstrap.sync_manual_weight_editor()\n    })\n    document.getElementById('manual-weight-bone')?.addEventListener('change', () => {\n      this.bootstrap.sync_manual_weight_editor()\n    })\n    document.getElementById('manual-weight-radius')?.addEventListener('input', () => {\n      this.bootstrap.update_manual_weight_labels()\n    })\n    document.getElementById('manual-weight-strength')?.addEventListener('input', () => {\n      this.bootstrap.update_manual_weight_labels()\n    })\n    document.getElementById('manual-weight-reset')?.addEventListener('click', () => {\n      this.bootstrap.reset_manual_weight_overrides()\n    })\n`,
      'EventListeners manual controls'
    )

    source = replaceOnce(
      source,
      "      if (this.bootstrap.is_transform_controls_dragging) {\n        this.bootstrap.handle_transform_controls_moving()\n      }\n\n      if (this.bootstrap.is_mesh_drag_mode_dragging) {\n",
      "      if (this.bootstrap.continue_manual_weight_stroke(event)) {\n        event.preventDefault()\n        return\n      }\n\n      if (this.bootstrap.is_transform_controls_dragging) {\n        this.bootstrap.handle_transform_controls_moving()\n      }\n\n      if (this.bootstrap.is_mesh_drag_mode_dragging) {\n",
      'EventListeners pointer move paint'
    )

    source = replaceOnce(
      source,
      "      if (this.bootstrap.process_step === ProcessStep.EditSkeleton && this.bootstrap.is_rig_setup_locked()) {\n",
      "      if (this.bootstrap.process_step === ProcessStep.EditSkeleton && this.bootstrap.is_rig_setup_locked() && !this.bootstrap.is_manual_weight_editor_enabled()) {\n",
      'EventListeners disable hover while paint'
    )

    source = replaceOnce(
      source,
      "    this.bootstrap.renderer.domElement.addEventListener('pointerdown', (event: PointerEvent) => {\n      const use_mesh_drag_mode =\n",
      `    this.bootstrap.renderer.domElement.addEventListener('pointerdown', (event: PointerEvent) => {\n      if (this.bootstrap.is_manual_weight_editor_enabled()) {\n        this.active_canvas_pointer_id = event.pointerId\n        this.bootstrap.renderer.domElement.setPointerCapture(event.pointerId)\n        event.preventDefault()\n        this.bootstrap.begin_manual_weight_stroke(event)\n        return\n      }\n\n      const use_mesh_drag_mode =\n`,
      'EventListeners pointer down paint'
    )

    source = replaceOnce(
      source,
      "      this.bootstrap.handle_mesh_drag_mode_mouse_up()\n\n      if (this.active_canvas_pointer_id !== null &&\n",
      "      const finished_weight_stroke = this.bootstrap.end_manual_weight_stroke()\n      if (!finished_weight_stroke) this.bootstrap.handle_mesh_drag_mode_mouse_up()\n\n      if (this.active_canvas_pointer_id !== null &&\n",
      'EventListeners pointer up paint'
    )

    // pointercancel has the same mouse-up call later; patch the remaining occurrence too.
    source = replaceOnce(
      source,
      "      this.bootstrap.handle_mesh_drag_mode_mouse_up()\n\n      if (this.active_canvas_pointer_id !== null &&\n",
      "      const finished_weight_stroke = this.bootstrap.end_manual_weight_stroke()\n      if (!finished_weight_stroke) this.bootstrap.handle_mesh_drag_mode_mouse_up()\n\n      if (this.active_canvas_pointer_id !== null &&\n",
      'EventListeners pointer cancel paint'
    )

    fs.writeFileSync(path, source)
  }
}

console.log('Manual weight editor patch applied')
