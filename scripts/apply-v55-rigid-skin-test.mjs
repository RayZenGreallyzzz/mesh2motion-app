import fs from 'node:fs'

function update(path, transform) {
  const before = fs.readFileSync(path, 'utf8')
  const after = transform(before)
  if (after !== before) {
    fs.writeFileSync(path, after)
    console.log('Updated ' + path)
  } else {
    console.log('No change needed: ' + path)
  }
}

update('src/lib/processes/weight-skin/StepWeightSkin.ts', (source) => {
  if (!source.includes('private rigid_skin_test_enabled')) {
    source = source.replace(
      '  private clothing_weight_guard_enabled: boolean = false',
      '  private clothing_weight_guard_enabled: boolean = false\n  private rigid_skin_test_enabled: boolean = false'
    )
  }

  if (!source.includes('apply_rigid_skin_test')) {
    const anchor = '  public calculate_weights_for_all_mesh_data (regenerate_weight_painted_mesh: boolean = false): void {'
    if (!source.includes(anchor)) throw new Error('Rigid skin insertion anchor not found')

    const method = `
  private apply_rigid_skin_test (skin_indices: number[], skin_weights: number[]): void {
    if (!this.rigid_skin_test_enabled) return

    for (let offset = 0; offset + 3 < skin_weights.length; offset += 4) {
      let bestSlot = 0
      let bestWeight = Number(skin_weights[offset] ?? 0)

      for (let slot = 1; slot < 4; slot++) {
        const weight = Number(skin_weights[offset + slot] ?? 0)
        if (weight > bestWeight) {
          bestWeight = weight
          bestSlot = slot
        }
      }

      const winningBone = Number(skin_indices[offset + bestSlot] ?? 0)
      skin_indices[offset] = winningBone
      skin_indices[offset + 1] = 0
      skin_indices[offset + 2] = 0
      skin_indices[offset + 3] = 0

      skin_weights[offset] = 1
      skin_weights[offset + 1] = 0
      skin_weights[offset + 2] = 0
      skin_weights[offset + 3] = 0
    }
  }

`
    source = source.replace(anchor, method + anchor)
  }

  const oldCreate = `  public create_bone_formula_object (editable_armature: Object3D, skeleton_type: SkeletonType): void {
    // v5.4: the helper lines only prove JOINT POSITIONS are correct. AutoRig
    // and manual placement do not recompute local bone axes, so binding a clone
    // of the edit rig preserves stale mannequin rotations and explodes when an
    // animation plays. Rebuild the bind/rest axes from the final placed joints
    // in armature-local space before weight solving.
    if (skeleton_type === SkeletonType.MobileFemale) {
      this.skinning_armature = CleanMobileHumanoidRig.buildFromPlacedJoints(editable_armature)
    } else {
      this.skinning_armature = editable_armature.clone(true)
    }
    this.skinning_armature.name = 'Armature for skinning · Rest v5.4'

    this.bone_skinning_formula = new SkinningAlgorithm(this.skinning_armature.children[0], skeleton_type)
  }`
  const newCreate = `  public create_bone_formula_object (editable_armature: Object3D, skeleton_type: SkeletonType): void {
    // v5.4: rebuild the bind/rest axes from final joint positions.
    if (skeleton_type === SkeletonType.MobileFemale) {
      this.skinning_armature = CleanMobileHumanoidRig.buildFromPlacedJoints(editable_armature)
    } else {
      this.skinning_armature = editable_armature.clone(true)
    }
    this.skinning_armature.name = 'Armature for skinning · Rest v5.4'

    // v5.5 diagnostic: remove ALL multi-bone blending for Mobile Female.
    // If stretching/flattening disappears, the fault is weight blending/LBS,
    // not joint placement, bind transforms or animation retargeting.
    this.rigid_skin_test_enabled = skeleton_type === SkeletonType.MobileFemale

    this.bone_skinning_formula = new SkinningAlgorithm(this.skinning_armature.children[0], skeleton_type)
  }`

  if (!source.includes(newCreate)) {
    if (!source.includes(oldCreate)) throw new Error('v5.4 create_bone_formula_object anchor not found')
    source = source.replace(oldCreate, newCreate)
  }

  const oldFlow = `      this.apply_clothing_component_guard(geometry_data, final_skin_indices, final_skin_weights)
      // Manual paint intentionally runs last so the artist can override the guard.
      this.apply_manual_weight_adjustments(idx, final_skin_indices, final_skin_weights)

      geometry_data.setAttribute('skinIndex', new Uint16BufferAttribute(final_skin_indices, 4))`
  const newFlow = `      this.apply_clothing_component_guard(geometry_data, final_skin_indices, final_skin_weights)
      // Manual paint stays available for normal builds, but v5.5 deliberately
      // collapses the final result to one bone per vertex AFTER every adjustment.
      this.apply_manual_weight_adjustments(idx, final_skin_indices, final_skin_weights)
      this.apply_rigid_skin_test(final_skin_indices, final_skin_weights)

      geometry_data.setAttribute('skinIndex', new Uint16BufferAttribute(final_skin_indices, 4))`

  if (!source.includes(newFlow)) {
    if (!source.includes(oldFlow)) throw new Error('Rigid skin flow anchor not found')
    source = source.replace(oldFlow, newFlow)
  }

  return source
})

update('src/lib/RigConfig.ts', (source) => {
  source = source.replace(
    "rig_display_name: 'Humanoid Rest Axes v5.4 · Surface Skin',",
    "rig_display_name: 'Humanoid v5.5 · RIGID SKIN TEST',"
  )
  return source
})

update('src/Mesh2MotionEngine.ts', (source) => {
  source = source.replaceAll('АвтоРиг · Rest Axes v5.4', 'АвтоРиг · RIGID TEST v5.5')
  source = source.replaceAll('Clean Rig v5.4 REST · ', 'RIGID SKIN v5.5 · ')
  return source
})
