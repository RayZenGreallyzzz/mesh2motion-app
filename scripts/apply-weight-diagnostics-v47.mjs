import fs from 'node:fs'

const replaceOnce = (source, from, to, label) => {
  if (source.includes(to)) return source
  if (!source.includes(from)) throw new Error(`v4.7 patch marker not found: ${label}`)
  return source.replace(from, to)
}

// 1) Clear selected-bone heatmap: navy -> blue -> green -> yellow -> red.
{
  const path = 'src/lib/Generators.ts'
  let source = fs.readFileSync(path, 'utf8')
  const oldBlock = `        // Dark blue = no influence, bright magenta = full influence.\n        colors[i * 3] = 0.07 + selected_weight * 0.93\n        colors[i * 3 + 1] = 0.09 + selected_weight * 0.10\n        colors[i * 3 + 2] = 0.16 + selected_weight * 0.72\n`
  const newBlock = `        // Diagnostic heatmap for one selected bone:\n        // 0% navy -> 25% blue -> 50% green -> 75% yellow -> 100% red.\n        let r = 0; let g = 0; let b = 0\n        if (selected_weight < 0.25) {\n          const t = selected_weight / 0.25\n          r = 0.02 * (1 - t)\n          g = 0.04 + (0.25 - 0.04) * t\n          b = 0.15 + (1.0 - 0.15) * t\n        } else if (selected_weight < 0.5) {\n          const t = (selected_weight - 0.25) / 0.25\n          r = 0\n          g = 0.25 + (1.0 - 0.25) * t\n          b = 1.0 + (0.30 - 1.0) * t\n        } else if (selected_weight < 0.75) {\n          const t = (selected_weight - 0.5) / 0.25\n          r = t\n          g = 1.0\n          b = 0.30 * (1 - t)\n        } else {\n          const t = (selected_weight - 0.75) / 0.25\n          r = 1.0\n          g = 1.0 * (1 - t) + 0.05 * t\n          b = 0\n        }\n        colors[i * 3] = r\n        colors[i * 3 + 1] = g\n        colors[i * 3 + 2] = b\n`
  source = replaceOnce(source, oldBlock, newBlock, 'Generators selected heatmap')
  fs.writeFileSync(path, source)
}

// 2) Weight step: conservative component-aware clothing guard + statistics.
{
  const path = 'src/lib/processes/weight-skin/StepWeightSkin.ts'
  let source = fs.readFileSync(path, 'utf8')

  const fieldMarker = `  private manual_weight_preview_bone_index: number | null = null\n`
  const fieldPatch = `${fieldMarker}  private clothing_weight_guard_enabled: boolean = true\n`
  source = replaceOnce(source, fieldMarker, fieldPatch, 'StepWeightSkin guard field')

  const methodMarker = `  public clear_manual_weight_overrides (): void {\n    this.manual_weight_deltas.clear()\n  }\n`
  const methods = `  public set_clothing_weight_guard_enabled (enabled: boolean): void {\n    this.clothing_weight_guard_enabled = enabled\n  }\n\n  public clothing_weight_guard_is_enabled (): boolean {\n    return this.clothing_weight_guard_enabled\n  }\n\n  public get_bone_weight_stats (bone_index: number): { boneName: string, influenced: number, total: number, average: number, max: number } {\n    const boneName = this.binding_skeleton?.bones[bone_index]?.name ?? \\`Bone \\${bone_index}\\`\n    let influenced = 0\n    let total = 0\n    let weightSum = 0\n    let max = 0\n\n    for (const geometry of this.all_mesh_geometry) {\n      const skinIndex = geometry.getAttribute('skinIndex')\n      const skinWeight = geometry.getAttribute('skinWeight')\n      const positions = geometry.getAttribute('position')\n      if (skinIndex === undefined || skinWeight === undefined || positions === undefined) continue\n      total += positions.count\n      for (let vertex = 0; vertex < positions.count; vertex++) {\n        let selectedWeight = 0\n        for (let slot = 0; slot < 4; slot++) {\n          if (skinIndex.getComponent(vertex, slot) === bone_index) selectedWeight += skinWeight.getComponent(vertex, slot)\n        }\n        if (selectedWeight > 0.0001) {\n          influenced++\n          weightSum += selectedWeight\n          max = Math.max(max, selectedWeight)\n        }\n      }\n    }\n\n    return { boneName, influenced, total, average: influenced === 0 ? 0 : weightSum / influenced, max }\n  }\n\n${methodMarker}`
  source = replaceOnce(source, methodMarker, methods, 'StepWeightSkin public guard/stat methods')

  const calcMarker = `  public calculate_weights_for_all_mesh_data (regenerate_weight_painted_mesh: boolean = false): void {\n`
  const helpers = `  private bone_weight_family (bone_index: number): string {\n    const raw = this.binding_skeleton?.bones[bone_index]?.name ?? ''\n    const n = raw.toLowerCase().replace(/[^a-z0-9]/g, '')\n    if (n.includes('root')) return 'root'\n\n    const left = n.includes('left') || n.endsWith('l')\n    const right = n.includes('right') || n.endsWith('r')\n    const arm = /(shoulder|clavicle|upperarm|forearm|lowerarm|hand|wrist|finger|thumb|arm)/.test(n)\n    const leg = /(thigh|upleg|upperleg|shin|calf|foot|toe|leg)/.test(n)\n    if (arm && left) return 'armL'\n    if (arm && right) return 'armR'\n    if (leg && left) return 'legL'\n    if (leg && right) return 'legR'\n    if (/(pelvis|hips|hip)/.test(n)) return 'lowerCore'\n    if (/(spine|chest)/.test(n)) return 'upperCore'\n    if (/(neck|head)/.test(n)) return 'head'\n    return 'other'\n  }\n\n  private apply_clothing_component_guard (geometry: BufferGeometry, skin_indices: number[], skin_weights: number[]): void {\n    if (!this.clothing_weight_guard_enabled || this.binding_skeleton === undefined) return\n    const positions = geometry.getAttribute('position')\n    const vertexCount = positions?.count ?? 0\n    if (vertexCount < 24) return\n\n    // Indexed GLBs let us identify disconnected pieces (cape, skirt, belts, etc.).\n    // Non-indexed meshes are treated as one component; the family-diversity test\n    // below prevents a full humanoid body from being over-corrected.\n    const parent = new Int32Array(vertexCount)\n    for (let i = 0; i < vertexCount; i++) parent[i] = i\n    const find = (value: number): number => {\n      let x = value\n      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }\n      return x\n    }\n    const union = (a: number, b: number): void => {\n      const ra = find(a); const rb = find(b)\n      if (ra !== rb) parent[rb] = ra\n    }\n\n    const index = geometry.index\n    if (index !== null) {\n      for (let i = 0; i + 2 < index.count; i += 3) {\n        const a = index.getX(i); const b = index.getX(i + 1); const c = index.getX(i + 2)\n        union(a, b); union(b, c)\n      }\n    } else {\n      for (let i = 1; i < vertexCount; i++) parent[i] = 0\n    }\n\n    const totals = new Map<number, Map<string, number>>()\n    const counts = new Map<number, number>()\n    for (let vertex = 0; vertex < vertexCount; vertex++) {\n      const root = find(vertex)\n      counts.set(root, (counts.get(root) ?? 0) + 1)\n      let familyMap = totals.get(root)\n      if (familyMap === undefined) { familyMap = new Map<string, number>(); totals.set(root, familyMap) }\n      const offset = vertex * 4\n      for (let slot = 0; slot < 4; slot++) {\n        const w = skin_weights[offset + slot] ?? 0\n        if (w <= 0.00001) continue\n        const family = this.bone_weight_family(skin_indices[offset + slot])\n        familyMap.set(family, (familyMap.get(family) ?? 0) + w)\n      }\n    }\n\n    const allowed = new Map<number, Set<string>>()\n    for (const [root, familyMap] of totals) {\n      if ((counts.get(root) ?? 0) < 24) continue\n      const sorted = [...familyMap.entries()].sort((a, b) => b[1] - a[1])\n      const total = sorted.reduce((sum, entry) => sum + entry[1], 0)\n      if (total <= 0 || sorted.length < 2) continue\n\n      const keep = new Set<string>()\n      let cumulative = 0\n      for (const [family, value] of sorted) {\n        keep.add(family)\n        cumulative += value / total\n        if (cumulative >= 0.90 || keep.size >= 3) break\n      }\n\n      // Only protect a component when at most three coherent bone families\n      // explain nearly all of it. Whole-body meshes remain untouched.\n      if (keep.size <= 3 && cumulative >= 0.86) allowed.set(root, keep)\n    }\n\n    if (allowed.size === 0) return\n    for (let vertex = 0; vertex < vertexCount; vertex++) {\n      const keep = allowed.get(find(vertex))\n      if (keep === undefined) continue\n      const offset = vertex * 4\n      let sum = 0\n      const nextWeights = [0, 0, 0, 0]\n      for (let slot = 0; slot < 4; slot++) {\n        const family = this.bone_weight_family(skin_indices[offset + slot])\n        const w = skin_weights[offset + slot] ?? 0\n        if (keep.has(family)) { nextWeights[slot] = w; sum += w }\n      }\n      if (sum <= 0.00001) continue\n      for (let slot = 0; slot < 4; slot++) skin_weights[offset + slot] = nextWeights[slot] / sum\n    }\n  }\n\n${calcMarker}`
  source = replaceOnce(source, calcMarker, helpers, 'StepWeightSkin component guard helpers')

  const applyMarker = `      const [final_skin_indices, final_skin_weights]: number[][] = this.calculate_weights()\n      this.apply_manual_weight_adjustments(idx, final_skin_indices, final_skin_weights)\n`
  const applyPatch = `      const [final_skin_indices, final_skin_weights]: number[][] = this.calculate_weights()\n      this.apply_clothing_component_guard(geometry_data, final_skin_indices, final_skin_weights)\n      // Manual paint intentionally runs last so the artist can override the guard.\n      this.apply_manual_weight_adjustments(idx, final_skin_indices, final_skin_weights)\n`
  source = replaceOnce(source, applyMarker, applyPatch, 'StepWeightSkin guard application order')

  fs.writeFileSync(path, source)
}

// 3) Engine: selected-bone preview independent from brush + Root/Pelvis diagnostics.
{
  const path = 'src/Mesh2MotionEngine.ts'
  let source = fs.readFileSync(path, 'utf8')

  source = source.replace(
    `    this.weight_skin_step.set_manual_weight_preview_bone(\n      (weight_enabled?.checked ?? false) && Number.isFinite(selected) ? selected : null\n    )`,
    `    this.weight_skin_step.set_manual_weight_preview_bone(Number.isFinite(selected) ? selected : null)`
  )
  source = source.replace(
    `    this.weight_skin_step.set_manual_weight_preview_bone(\n      enabled.checked && Number.isFinite(selected) ? selected : null\n    )`,
    `    this.weight_skin_step.set_manual_weight_preview_bone(Number.isFinite(selected) ? selected : null)`
  )

  const selectFallback = `    if ([...select.options].some(option => option.value === previous)) select.value = previous\n    else if (select.options.length > 0) select.selectedIndex = 0\n`
  const selectFallbackPatch = `    if ([...select.options].some(option => option.value === previous)) select.value = previous\n    else {\n      const pelvis = [...select.options].find(option => /pelvis|hips/i.test(option.textContent ?? ''))\n      if (pelvis !== undefined) select.value = pelvis.value\n      else if (select.options.length > 0) select.selectedIndex = 0\n    }\n`
  source = replaceOnce(source, selectFallback, selectFallbackPatch, 'Engine pelvis default selection')

  const insertMarker = `  public update_manual_weight_labels (): void {\n`
  const methods = `  public preview_selected_weight_bone (): void {\n    if (this.process_step !== ProcessStep.WeightSkin) return\n    const select = document.getElementById('manual-weight-bone') as HTMLSelectElement | null\n    const selected = Number.parseInt(select?.value ?? '', 10)\n    this.weight_skin_step.set_manual_weight_preview_bone(Number.isFinite(selected) ? selected : null)\n    this.changed_model_preview_display(ModelPreviewDisplay.WeightPainted)\n    this.update_weight_debug_status(false)\n  }\n\n  public sync_clothing_weight_guard (): void {\n    const checkbox = document.getElementById('clothing-weight-guard') as HTMLInputElement | null\n    this.weight_skin_step.set_clothing_weight_guard_enabled(checkbox?.checked ?? true)\n    if (this.process_step === ProcessStep.WeightSkin) {\n      this.regenerate_weight_painted_preview_mesh()\n      this.update_weight_debug_status(false)\n    }\n  }\n\n  public update_weight_debug_status (includeRig: boolean = true): void {\n    const output = document.getElementById('weight-debug-status')\n    if (output === null || this.process_step !== ProcessStep.WeightSkin) return\n    const skeleton = this.weight_skin_step.skeleton()\n    if (skeleton === undefined) { output.textContent = 'Скелет не найден.'; return }\n\n    const select = document.getElementById('manual-weight-bone') as HTMLSelectElement | null\n    const selected = Number.parseInt(select?.value ?? '', 10)\n    const fmt = (index: number): string => {\n      if (!Number.isFinite(index) || index < 0) return '—'\n      const s = this.weight_skin_step.get_bone_weight_stats(index)\n      return \\`\\${s.boneName}: \\${s.influenced}/\\${s.total} вершин · avg \\${Math.round(s.average * 100)}% · max \\${Math.round(s.max * 100)}%\\`\n    }\n\n    const rootIndex = skeleton.bones.findIndex(bone => /root/i.test(bone.name))\n    const pelvisIndex = skeleton.bones.findIndex(bone => /pelvis|hips/i.test(bone.name))\n    const lines = [\\`Выбрано — \\${fmt(selected)}\\`, \\`Root — \\${fmt(rootIndex)}\\`, \\`Pelvis — \\${fmt(pelvisIndex)}\\`]\n\n    if (includeRig) {\n      const deg = (value: number): number => Math.round(value * 180 / Math.PI)\n      const describe = (index: number): string => {\n        const bone = skeleton.bones[index]\n        if (bone === undefined) return '—'\n        return \\`\\${bone.name}: pos(\\${bone.position.x.toFixed(2)}, \\${bone.position.y.toFixed(2)}, \\${bone.position.z.toFixed(2)}) rot(\\${deg(bone.rotation.x)}°, \\${deg(bone.rotation.y)}°, \\${deg(bone.rotation.z)}°)\\`\n      }\n      lines.push(\\`Bind Root — \\${describe(rootIndex)}\\`)\n      lines.push(\\`Bind Pelvis — \\${describe(pelvisIndex)}\\`)\n    }\n    output.textContent = lines.join('\\n')\n  }\n\n${insertMarker}`
  source = replaceOnce(source, insertMarker, methods, 'Engine v4.7 diagnostic methods')

  source = source.replace(
    `    this.regenerate_weight_painted_preview_mesh()\n    return true\n  }\n\n  public reset_manual_weight_overrides`,
    `    this.regenerate_weight_painted_preview_mesh()\n    this.update_weight_debug_status(false)\n    return true\n  }\n\n  public reset_manual_weight_overrides`
  )
  source = source.replace(
    `    if (this.process_step === ProcessStep.WeightSkin) this.regenerate_weight_painted_preview_mesh()\n  }\n\n  // --- Model position gizmo`,
    `    if (this.process_step === ProcessStep.WeightSkin) {\n      this.regenerate_weight_painted_preview_mesh()\n      this.update_weight_debug_status(false)\n    }\n  }\n\n  // --- Model position gizmo`
  )

  fs.writeFileSync(path, source)
}

// 4) Events.
{
  const path = 'src/lib/EventListeners.ts'
  let source = fs.readFileSync(path, 'utf8')
  source = source.replace(
    `    document.getElementById('manual-weight-bone')?.addEventListener('change', () => {\n      this.bootstrap.sync_manual_weight_editor()\n    })`,
    `    document.getElementById('manual-weight-bone')?.addEventListener('change', () => {\n      this.bootstrap.preview_selected_weight_bone()\n    })`
  )

  const resetListener = `    document.getElementById('manual-weight-reset')?.addEventListener('click', () => {\n      this.bootstrap.reset_manual_weight_overrides()\n    })\n`
  const extraListeners = `${resetListener}    document.getElementById('clothing-weight-guard')?.addEventListener('change', () => {\n      this.bootstrap.sync_clothing_weight_guard()\n    })\n    document.getElementById('weight-root-pelvis-debug')?.addEventListener('click', () => {\n      this.bootstrap.update_weight_debug_status(true)\n    })\n`
  source = replaceOnce(source, resetListener, extraListeners, 'EventListeners v4.7 controls')
  fs.writeFileSync(path, source)
}

// 5) Weight panel UI.
{
  const path = 'src/create.html'
  let html = fs.readFileSync(path, 'utf8')
  const status = `            <small id="manual-weight-status">Включите кисть, выберите кость и проведите пальцем по модели.</small>\n`
  const panel = `${status}            <div style="display: flex; flex-direction: column; gap: 0.25rem;">\n              <span class="pill-switch-label">Влияние выбранной кости</span>\n              <div style="height: 10px; border-radius: 5px; background: linear-gradient(90deg, #050a26 0%, #0040ff 25%, #00ff4d 50%, #ffff00 75%, #ff0d00 100%);"></div>\n              <div style="display:flex; justify-content:space-between; font-size:0.72rem;"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>\n            </div>\n            <div class="styled-checkbox" style="margin: 0;">\n              <input type="checkbox" id="clothing-weight-guard" checked />\n              <label for="clothing-weight-guard">Защита одежды</label>\n            </div>\n            <small>Убирает слабые случайные веса с отдельных плащей, юбок и аксессуаров. Ручная кисть имеет приоритет.</small>\n            <button type="button" class="secondary-button" id="weight-root-pelvis-debug">Проверить Root / Pelvis</button>\n            <small id="weight-debug-status" style="white-space: pre-line; line-height: 1.35;">Выберите кость — здесь появится статистика влияния.</small>\n`
  html = replaceOnce(html, status, panel, 'create.html v4.7 weight diagnostics')
  fs.writeFileSync(path, html)
}

console.log('Applied v4.7 selected-bone heatmap, Root/Pelvis diagnostics and clothing component guard')
