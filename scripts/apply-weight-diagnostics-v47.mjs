import fs from 'node:fs'

const lines = (...items) => items.join('\n') + '\n'

const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`v4.7 patch marker not found: ${label}`)
  return source.replace(from, to)
}

// 1) Clear selected-bone heatmap: navy -> blue -> green -> yellow -> red.
{
  const path = 'src/lib/Generators.ts'
  let source = fs.readFileSync(path, 'utf8')
  if (!source.includes('Diagnostic heatmap for one selected bone')) {
    const oldBlock = lines(
      '        // Dark blue = no influence, bright magenta = full influence.',
      '        colors[i * 3] = 0.07 + selected_weight * 0.93',
      '        colors[i * 3 + 1] = 0.09 + selected_weight * 0.10',
      '        colors[i * 3 + 2] = 0.16 + selected_weight * 0.72'
    )
    const newBlock = lines(
      '        // Diagnostic heatmap for one selected bone:',
      '        // 0% navy -> 25% blue -> 50% green -> 75% yellow -> 100% red.',
      '        let r = 0; let g = 0; let b = 0',
      '        if (selected_weight < 0.25) {',
      '          const t = selected_weight / 0.25',
      '          r = 0.02 * (1 - t)',
      '          g = 0.04 + (0.25 - 0.04) * t',
      '          b = 0.15 + (1.0 - 0.15) * t',
      '        } else if (selected_weight < 0.5) {',
      '          const t = (selected_weight - 0.25) / 0.25',
      '          r = 0',
      '          g = 0.25 + (1.0 - 0.25) * t',
      '          b = 1.0 + (0.30 - 1.0) * t',
      '        } else if (selected_weight < 0.75) {',
      '          const t = (selected_weight - 0.5) / 0.25',
      '          r = t',
      '          g = 1.0',
      '          b = 0.30 * (1 - t)',
      '        } else {',
      '          const t = (selected_weight - 0.75) / 0.25',
      '          r = 1.0',
      '          g = 1.0 * (1 - t) + 0.05 * t',
      '          b = 0',
      '        }',
      '        colors[i * 3] = r',
      '        colors[i * 3 + 1] = g',
      '        colors[i * 3 + 2] = b'
    )
    source = replaceRequired(source, oldBlock, newBlock, 'Generators selected heatmap')
    fs.writeFileSync(path, source)
  }
}

// 2) Weight step: conservative component-aware clothing guard + statistics.
{
  const path = 'src/lib/processes/weight-skin/StepWeightSkin.ts'
  let source = fs.readFileSync(path, 'utf8')

  if (!source.includes('private clothing_weight_guard_enabled')) {
    const marker = '  private manual_weight_preview_bone_index: number | null = null\n'
    source = replaceRequired(source, marker, marker + '  private clothing_weight_guard_enabled: boolean = true\n', 'StepWeightSkin guard field')
  }

  if (!source.includes('public get_bone_weight_stats')) {
    const marker = lines(
      '  public clear_manual_weight_overrides (): void {',
      '    this.manual_weight_deltas.clear()',
      '  }'
    )
    const methods = lines(
      '  public set_clothing_weight_guard_enabled (enabled: boolean): void {',
      '    this.clothing_weight_guard_enabled = enabled',
      '  }',
      '',
      '  public clothing_weight_guard_is_enabled (): boolean {',
      '    return this.clothing_weight_guard_enabled',
      '  }',
      '',
      '  public get_bone_weight_stats (bone_index: number): { boneName: string, influenced: number, total: number, average: number, max: number } {',
      "    const boneName = this.binding_skeleton?.bones[bone_index]?.name ?? ('Bone ' + bone_index.toString())",
      '    let influenced = 0',
      '    let total = 0',
      '    let weightSum = 0',
      '    let max = 0',
      '',
      '    for (const geometry of this.all_mesh_geometry) {',
      "      const skinIndex = geometry.getAttribute('skinIndex')",
      "      const skinWeight = geometry.getAttribute('skinWeight')",
      "      const positions = geometry.getAttribute('position')",
      '      if (skinIndex === undefined || skinWeight === undefined || positions === undefined) continue',
      '      total += positions.count',
      '      const indexArray = skinIndex.array',
      '      const weightArray = skinWeight.array',
      '      for (let vertex = 0; vertex < positions.count; vertex++) {',
      '        let selectedWeight = 0',
      '        const offset = vertex * 4',
      '        for (let slot = 0; slot < 4; slot++) {',
      '          if (Number(indexArray[offset + slot]) === bone_index) selectedWeight += Number(weightArray[offset + slot] ?? 0)',
      '        }',
      '        if (selectedWeight > 0.0001) {',
      '          influenced++',
      '          weightSum += selectedWeight',
      '          max = Math.max(max, selectedWeight)',
      '        }',
      '      }',
      '    }',
      '',
      '    return { boneName, influenced, total, average: influenced === 0 ? 0 : weightSum / influenced, max }',
      '  }',
      '',
      marker.trimEnd()
    )
    source = replaceRequired(source, marker, methods, 'StepWeightSkin public guard/stat methods')
  }

  if (!source.includes('private apply_clothing_component_guard')) {
    const marker = '  public calculate_weights_for_all_mesh_data (regenerate_weight_painted_mesh: boolean = false): void {\n'
    const helpers = lines(
      '  private bone_weight_family (bone_index: number): string {',
      "    const raw = this.binding_skeleton?.bones[bone_index]?.name ?? ''",
      "    const n = raw.toLowerCase().replace(/[^a-z0-9]/g, '')",
      "    if (n.includes('root')) return 'root'",
      '',
      "    const left = n.includes('left') || n.endsWith('l')",
      "    const right = n.includes('right') || n.endsWith('r')",
      "    const arm = /(shoulder|clavicle|upperarm|forearm|lowerarm|hand|wrist|finger|thumb|arm)/.test(n)",
      "    const leg = /(thigh|upleg|upperleg|shin|calf|foot|toe|leg)/.test(n)",
      "    if (arm && left) return 'armL'",
      "    if (arm && right) return 'armR'",
      "    if (leg && left) return 'legL'",
      "    if (leg && right) return 'legR'",
      "    if (/(pelvis|hips|hip)/.test(n)) return 'lowerCore'",
      "    if (/(spine|chest)/.test(n)) return 'upperCore'",
      "    if (/(neck|head)/.test(n)) return 'head'",
      "    return 'other'",
      '  }',
      '',
      '  private apply_clothing_component_guard (geometry: BufferGeometry, skin_indices: number[], skin_weights: number[]): void {',
      '    if (!this.clothing_weight_guard_enabled || this.binding_skeleton === undefined) return',
      "    const positions = geometry.getAttribute('position')",
      '    const vertexCount = positions?.count ?? 0',
      '    if (vertexCount < 24) return',
      '',
      '    // Build connected components for indexed GLBs. For non-indexed data,',
      '    // use one component; the family-diversity test keeps full bodies safe.',
      '    const parent = new Int32Array(vertexCount)',
      '    for (let i = 0; i < vertexCount; i++) parent[i] = i',
      '    const find = (value: number): number => {',
      '      let x = value',
      '      while (parent[x] !== x) {',
      '        parent[x] = parent[parent[x]]',
      '        x = parent[x]',
      '      }',
      '      return x',
      '    }',
      '    const union = (a: number, b: number): void => {',
      '      const ra = find(a)',
      '      const rb = find(b)',
      '      if (ra !== rb) parent[rb] = ra',
      '    }',
      '',
      '    const index = geometry.index',
      '    if (index !== null) {',
      '      for (let i = 0; i + 2 < index.count; i += 3) {',
      '        const a = index.getX(i)',
      '        const b = index.getX(i + 1)',
      '        const c = index.getX(i + 2)',
      '        union(a, b)',
      '        union(b, c)',
      '      }',
      '    } else {',
      '      for (let i = 1; i < vertexCount; i++) parent[i] = 0',
      '    }',
      '',
      '    const totals = new Map<number, Map<string, number>>()',
      '    const counts = new Map<number, number>()',
      '    for (let vertex = 0; vertex < vertexCount; vertex++) {',
      '      const root = find(vertex)',
      '      counts.set(root, (counts.get(root) ?? 0) + 1)',
      '      let familyMap = totals.get(root)',
      '      if (familyMap === undefined) {',
      '        familyMap = new Map<string, number>()',
      '        totals.set(root, familyMap)',
      '      }',
      '      const offset = vertex * 4',
      '      for (let slot = 0; slot < 4; slot++) {',
      '        const w = skin_weights[offset + slot] ?? 0',
      '        if (w <= 0.00001) continue',
      '        const family = this.bone_weight_family(skin_indices[offset + slot])',
      '        familyMap.set(family, (familyMap.get(family) ?? 0) + w)',
      '      }',
      '    }',
      '',
      '    const allowed = new Map<number, Set<string>>()',
      '    for (const [root, familyMap] of totals) {',
      '      if ((counts.get(root) ?? 0) < 24) continue',
      '      const sorted = [...familyMap.entries()].sort((a, b) => b[1] - a[1])',
      '      const total = sorted.reduce((sum, entry) => sum + entry[1], 0)',
      '      if (total <= 0 || sorted.length < 2) continue',
      '',
      '      const keep = new Set<string>()',
      '      let cumulative = 0',
      '      for (const [family, value] of sorted) {',
      '        keep.add(family)',
      '        cumulative += value / total',
      '        if (cumulative >= 0.90 || keep.size >= 3) break',
      '      }',
      '',
      '      // Only coherent accessory/clothing components are protected.',
      '      // A whole humanoid body normally needs more than three families.',
      '      if (keep.size <= 3 && cumulative >= 0.86) allowed.set(root, keep)',
      '    }',
      '',
      '    if (allowed.size === 0) return',
      '    for (let vertex = 0; vertex < vertexCount; vertex++) {',
      '      const keep = allowed.get(find(vertex))',
      '      if (keep === undefined) continue',
      '      const offset = vertex * 4',
      '      let sum = 0',
      '      const nextWeights = [0, 0, 0, 0]',
      '      for (let slot = 0; slot < 4; slot++) {',
      '        const family = this.bone_weight_family(skin_indices[offset + slot])',
      '        const w = skin_weights[offset + slot] ?? 0',
      '        if (keep.has(family)) {',
      '          nextWeights[slot] = w',
      '          sum += w',
      '        }',
      '      }',
      '      if (sum <= 0.00001) continue',
      '      for (let slot = 0; slot < 4; slot++) skin_weights[offset + slot] = nextWeights[slot] / sum',
      '    }',
      '  }',
      '',
      marker.trimEnd()
    )
    source = replaceRequired(source, marker, helpers, 'StepWeightSkin component guard helpers')
  }

  if (!source.includes('Manual paint intentionally runs last')) {
    const oldApply = lines(
      '      const [final_skin_indices, final_skin_weights]: number[][] = this.calculate_weights()',
      '      this.apply_manual_weight_adjustments(idx, final_skin_indices, final_skin_weights)'
    )
    const newApply = lines(
      '      const [final_skin_indices, final_skin_weights]: number[][] = this.calculate_weights()',
      '      this.apply_clothing_component_guard(geometry_data, final_skin_indices, final_skin_weights)',
      '      // Manual paint intentionally runs last so the artist can override the guard.',
      '      this.apply_manual_weight_adjustments(idx, final_skin_indices, final_skin_weights)'
    )
    source = replaceRequired(source, oldApply, newApply, 'StepWeightSkin guard application order')
  }

  fs.writeFileSync(path, source)
}

// 3) Engine: selected-bone preview independent from brush + Root/Pelvis diagnostics.
{
  const path = 'src/Mesh2MotionEngine.ts'
  let source = fs.readFileSync(path, 'utf8')

  const oldRefresh = lines(
    "    const selected = Number.parseInt(select.value, 10)",
    "    const weight_enabled = document.getElementById('manual-weight-enabled') as HTMLInputElement | null",
    '    this.weight_skin_step.set_manual_weight_preview_bone(',
    '      (weight_enabled?.checked ?? false) && Number.isFinite(selected) ? selected : null',
    '    )'
  )
  const newRefresh = lines(
    '    const selected = Number.parseInt(select.value, 10)',
    '    this.weight_skin_step.set_manual_weight_preview_bone(Number.isFinite(selected) ? selected : null)'
  )
  if (source.includes(oldRefresh)) source = source.replace(oldRefresh, newRefresh)

  const oldSync = lines(
    '    this.weight_skin_step.set_manual_weight_preview_bone(',
    '      enabled.checked && Number.isFinite(selected) ? selected : null',
    '    )'
  )
  const newSync = '    this.weight_skin_step.set_manual_weight_preview_bone(Number.isFinite(selected) ? selected : null)\n'
  if (source.includes(oldSync)) source = source.replace(oldSync, newSync)

  if (!source.includes('const pelvis = [...select.options].find')) {
    const oldFallback = lines(
      '    if ([...select.options].some(option => option.value === previous)) select.value = previous',
      '    else if (select.options.length > 0) select.selectedIndex = 0'
    )
    const newFallback = lines(
      '    if ([...select.options].some(option => option.value === previous)) select.value = previous',
      '    else {',
      "      const pelvis = [...select.options].find(option => /pelvis|hips/i.test(option.textContent ?? ''))",
      '      if (pelvis !== undefined) select.value = pelvis.value',
      '      else if (select.options.length > 0) select.selectedIndex = 0',
      '    }'
    )
    source = replaceRequired(source, oldFallback, newFallback, 'Engine pelvis default selection')
  }

  if (!source.includes('public preview_selected_weight_bone')) {
    const marker = '  public update_manual_weight_labels (): void {\n'
    const methods = lines(
      '  public preview_selected_weight_bone (): void {',
      '    if (this.process_step !== ProcessStep.WeightSkin) return',
      "    const select = document.getElementById('manual-weight-bone') as HTMLSelectElement | null",
      "    const selected = Number.parseInt(select?.value ?? '', 10)",
      '    this.weight_skin_step.set_manual_weight_preview_bone(Number.isFinite(selected) ? selected : null)',
      '    this.changed_model_preview_display(ModelPreviewDisplay.WeightPainted)',
      '    this.update_weight_debug_status(false)',
      '  }',
      '',
      '  public sync_clothing_weight_guard (): void {',
      "    const checkbox = document.getElementById('clothing-weight-guard') as HTMLInputElement | null",
      '    this.weight_skin_step.set_clothing_weight_guard_enabled(checkbox?.checked ?? true)',
      '    if (this.process_step === ProcessStep.WeightSkin) {',
      '      this.regenerate_weight_painted_preview_mesh()',
      '      this.update_weight_debug_status(false)',
      '    }',
      '  }',
      '',
      '  public update_weight_debug_status (includeRig: boolean = true): void {',
      "    const output = document.getElementById('weight-debug-status')",
      '    if (output === null || this.process_step !== ProcessStep.WeightSkin) return',
      '    const skeleton = this.weight_skin_step.skeleton()',
      "    if (skeleton === undefined) { output.textContent = 'Скелет не найден.'; return }",
      '',
      "    const select = document.getElementById('manual-weight-bone') as HTMLSelectElement | null",
      "    const selected = Number.parseInt(select?.value ?? '', 10)",
      '    const fmt = (index: number): string => {',
      "      if (!Number.isFinite(index) || index < 0) return '—'",
      '      const s = this.weight_skin_step.get_bone_weight_stats(index)',
      "      return s.boneName + ': ' + s.influenced.toString() + '/' + s.total.toString() + ' вершин · avg ' + Math.round(s.average * 100).toString() + '% · max ' + Math.round(s.max * 100).toString() + '%'",
      '    }',
      '',
      "    const rootIndex = skeleton.bones.findIndex(bone => /root/i.test(bone.name))",
      "    const pelvisIndex = skeleton.bones.findIndex(bone => /pelvis|hips/i.test(bone.name))",
      "    const outputLines = ['Выбрано — ' + fmt(selected), 'Root — ' + fmt(rootIndex), 'Pelvis — ' + fmt(pelvisIndex)]",
      '',
      '    if (includeRig) {',
      '      const deg = (value: number): number => Math.round(value * 180 / Math.PI)',
      '      const describe = (index: number): string => {',
      '        const bone = skeleton.bones[index]',
      "        if (bone === undefined) return '—'",
      "        return bone.name + ': pos(' + bone.position.x.toFixed(2) + ', ' + bone.position.y.toFixed(2) + ', ' + bone.position.z.toFixed(2) + ') rot(' + deg(bone.rotation.x).toString() + '°, ' + deg(bone.rotation.y).toString() + '°, ' + deg(bone.rotation.z).toString() + '°)'",
      '      }',
      "      outputLines.push('Bind Root — ' + describe(rootIndex))",
      "      outputLines.push('Bind Pelvis — ' + describe(pelvisIndex))",
      '    }',
      "    output.textContent = outputLines.join('\\n')",
      '  }',
      '',
      marker.trimEnd()
    )
    source = replaceRequired(source, marker, methods, 'Engine v4.7 diagnostic methods')
  }

  if (!source.includes('this.update_weight_debug_status(false)\n    return true')) {
    const oldEnd = lines(
      '    this.regenerate_weight_painted_preview_mesh()',
      '    return true',
      '  }',
      '',
      '  public reset_manual_weight_overrides'
    )
    const newEnd = lines(
      '    this.regenerate_weight_painted_preview_mesh()',
      '    this.update_weight_debug_status(false)',
      '    return true',
      '  }',
      '',
      '  public reset_manual_weight_overrides'
    )
    source = replaceRequired(source, oldEnd, newEnd, 'Engine update stats after brush')
  }

  if (!source.includes('this.update_weight_debug_status(false)\n    }\n  }\n\n  // --- Model position gizmo')) {
    const oldReset = lines(
      '    if (this.process_step === ProcessStep.WeightSkin) this.regenerate_weight_painted_preview_mesh()',
      '  }',
      '',
      '  // --- Model position gizmo'
    )
    const newReset = lines(
      '    if (this.process_step === ProcessStep.WeightSkin) {',
      '      this.regenerate_weight_painted_preview_mesh()',
      '      this.update_weight_debug_status(false)',
      '    }',
      '  }',
      '',
      '  // --- Model position gizmo'
    )
    source = replaceRequired(source, oldReset, newReset, 'Engine update stats after reset')
  }

  fs.writeFileSync(path, source)
}

// 4) Events.
{
  const path = 'src/lib/EventListeners.ts'
  let source = fs.readFileSync(path, 'utf8')

  const oldBoneChange = lines(
    "    document.getElementById('manual-weight-bone')?.addEventListener('change', () => {",
    '      this.bootstrap.sync_manual_weight_editor()',
    '    })'
  )
  const newBoneChange = lines(
    "    document.getElementById('manual-weight-bone')?.addEventListener('change', () => {",
    '      this.bootstrap.preview_selected_weight_bone()',
    '    })'
  )
  if (source.includes(oldBoneChange)) source = source.replace(oldBoneChange, newBoneChange)

  if (!source.includes("document.getElementById('clothing-weight-guard')")) {
    const resetListener = lines(
      "    document.getElementById('manual-weight-reset')?.addEventListener('click', () => {",
      '      this.bootstrap.reset_manual_weight_overrides()',
      '    })'
    )
    const listeners = resetListener + lines(
      "    document.getElementById('clothing-weight-guard')?.addEventListener('change', () => {",
      '      this.bootstrap.sync_clothing_weight_guard()',
      '    })',
      "    document.getElementById('weight-root-pelvis-debug')?.addEventListener('click', () => {",
      '      this.bootstrap.update_weight_debug_status(true)',
      '    })'
    )
    source = replaceRequired(source, resetListener, listeners, 'EventListeners v4.7 controls')
  }

  fs.writeFileSync(path, source)
}

// 5) Weight panel UI.
{
  const path = 'src/create.html'
  let html = fs.readFileSync(path, 'utf8')
  if (!html.includes('id="clothing-weight-guard"')) {
    const status = '            <small id="manual-weight-status">Включите кисть, выберите кость и проведите пальцем по модели.</small>\n'
    const panel = status + lines(
      '            <div style="display: flex; flex-direction: column; gap: 0.25rem;">',
      '              <span class="pill-switch-label">Влияние выбранной кости</span>',
      '              <div style="height: 10px; border-radius: 5px; background: linear-gradient(90deg, #050a26 0%, #0040ff 25%, #00ff4d 50%, #ffff00 75%, #ff0d00 100%);"></div>',
      '              <div style="display:flex; justify-content:space-between; font-size:0.72rem;"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>',
      '            </div>',
      '            <div class="styled-checkbox" style="margin: 0;">',
      '              <input type="checkbox" id="clothing-weight-guard" checked />',
      '              <label for="clothing-weight-guard">Защита одежды</label>',
      '            </div>',
      '            <small>Убирает слабые случайные веса с отдельных плащей, юбок и аксессуаров. Ручная кисть имеет приоритет.</small>',
      '            <button type="button" class="secondary-button" id="weight-root-pelvis-debug">Проверить Root / Pelvis</button>',
      '            <small id="weight-debug-status" style="white-space: pre-line; line-height: 1.35;">Выберите кость — здесь появится статистика влияния.</small>'
    )
    html = replaceRequired(html, status, panel, 'create.html v4.7 weight diagnostics')
    fs.writeFileSync(path, html)
  }
}

console.log('Applied v4.7 selected-bone heatmap, Root/Pelvis diagnostics and clothing component guard')
