import fs from 'node:fs'

function update (path, transform) {
  const before = fs.readFileSync(path, 'utf8')
  const after = transform(before)
  if (after !== before) {
    fs.writeFileSync(path, after)
    console.log(`Updated ${path}`)
  } else {
    console.log(`No change needed: ${path}`)
  }
}

function replaceRequired (source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`${label}: anchor not found`)
  return source.replace(before, after)
}

// v5.3: the clean deform rig is now the rig the user edits. v5.2 created
// a second clean rig only after Bind, which meant the edit helper and the
// binding skeleton were two different hierarchies. It also let world-space
// setup transforms leak into the rebuilt rig while geometry stayed local.
update('src/lib/processes/load-skeleton/StepLoadSkeleton.ts', (source) => {
  source = source.replace(
    "import { MobileHumanoidRigV2 } from '../../mobile-rig/MobileHumanoidRigV2.ts'",
    "import { CleanMobileHumanoidRig } from '../../mobile-rig/CleanMobileHumanoidRig.ts'"
  )

  source = replaceRequired(
    source,
    `      // Mobile Humanoid v2 keeps the stock human rest frames for animation
      // compatibility, then prunes/augments the hierarchy into the 27-bone game rig.
      if (this.skeleton_file_path() === SkeletonType.MobileFemale) {
        MobileHumanoidRigV2.apply(this.loaded_armature)
      }`,
    `      // v5.3: build the final deform hierarchy NOW, before the user edits it.
      // The exact same clean rig is later cloned for skinning, so Edit, Bind and
      // animation all operate on one coordinate system and one bone ordering.
      if (this.skeleton_file_path() === SkeletonType.MobileFemale) {
        this.loaded_armature = CleanMobileHumanoidRig.build(this.loaded_armature)
        this.loaded_armature.name = 'Loaded Clean Mobile Armature v5.3'
      }`,
    'StepLoadSkeleton live clean rig'
  )

  // Replay-safe: v5.1 may add MobileHumanoidRigV2 again on every CI run,
  // and replacing that import with CleanMobileHumanoidRig used to leave two
  // identical imports. Collapse duplicates before returning the generated file.
  const cleanImport = "import { CleanMobileHumanoidRig } from '../../mobile-rig/CleanMobileHumanoidRig.ts'"
  const cleanLines = source.split('\n')
  let seenCleanImport = false
  source = cleanLines.filter((line) => {
    if (line !== cleanImport) return true
    if (seenCleanImport) return false
    seenCleanImport = true
    return true
  }).join('\n')

  return source
})

update('src/lib/processes/weight-skin/StepWeightSkin.ts', (source) => {
  // v5.4 supersedes the v5.3 clone behavior with a final rest-axis rebuild.
  // If that newer form is already committed, this replay step is complete.
  if (source.includes('buildFromPlacedJoints')) return source

  source = replaceRequired(
    source,
    `    // Mobile Female no longer binds the edited stock mannequin hierarchy. Build
    // a fresh deform rig from the exact joint positions the user placed.
    this.skinning_armature = skeleton_type === SkeletonType.MobileFemale
      ? CleanMobileHumanoidRig.build(editable_armature)
      : editable_armature.clone()
    this.skinning_armature.name = 'Armature for skinning'`,
    `    // v5.3: Mobile Female edits the final clean deform rig directly.
    // Clone that exact hierarchy for Bind instead of rebuilding from world-space
    // joint positions. This keeps model geometry and bones in the same local
    // coordinate system and guarantees identical bone ordering for weight paint.
    if (skeleton_type === SkeletonType.MobileFemale) {
      this.skinning_armature = editable_armature.userData.cleanMobileHumanoidRig === true
        ? editable_armature.clone(true)
        : CleanMobileHumanoidRig.build(editable_armature)
    } else {
      this.skinning_armature = editable_armature.clone(true)
    }
    this.skinning_armature.name = 'Armature for skinning'`,
    'StepWeightSkin clone live clean rig'
  )
  return source
})

update('src/lib/RigConfig.ts', (source) => {
  source = source.replace(
    "rig_display_name: 'Humanoid Clean Rig · Retarget',",
    "rig_display_name: 'Humanoid Clean Rig v5.3 LIVE · Retarget',"
  )
  return source
})

update('src/Mesh2MotionEngine.ts', (source) => {
  // v5.4 owns the newer visible status/button text. Never make an older replay
  // search for v5.3 anchors once Rest Axes has already been committed.
  if (source.includes('АвтоРиг · Rest Axes v5.4') || source.includes('АвтоРиг · 3D Depth v5.6')) return source

  const anchor = `    const bind = document.getElementById('action_bind_pose') as HTMLButtonElement | null
`
  const inject = `    const bind = document.getElementById('action_bind_pose') as HTMLButtonElement | null
    const autorig = document.getElementById('autorig-humanoid-button') as HTMLButtonElement | null
`
  if (!source.includes(inject)) {
    if (!source.includes(anchor)) throw new Error('Mesh2MotionEngine autorig button anchor not found')
    source = source.replace(anchor, inject)
  }

  const before = `    if (bind !== null) bind.disabled = !this.rig_setup_locked_state
    if (status !== null) {
      status.textContent = this.rig_setup_locked_state
        ? 'Риг зафиксирован: правьте суставы, обзор меняется только камерой.'
        : 'Риг разблокирован: модель и скелет двигаются вместе.'
    }`
  const after = `    if (bind !== null) bind.disabled = !this.rig_setup_locked_state
    if (autorig !== null && this.load_skeleton_step.skeleton_type() === SkeletonType.MobileFemale) {
      autorig.textContent = 'АвтоРиг · Clean v5.3 LIVE'
    }
    if (status !== null) {
      const cleanLive = this.load_skeleton_step.skeleton_type() === SkeletonType.MobileFemale
        ? 'Clean Rig v5.3 LIVE · '
        : ''
      status.textContent = this.rig_setup_locked_state
        ? cleanLive + 'риг зафиксирован: правьте суставы, обзор меняется только камерой.'
        : cleanLive + 'риг разблокирован: модель и скелет двигаются вместе.'
    }`
  if (!source.includes(after)) {
    if (!source.includes(before)) throw new Error('Mesh2MotionEngine status anchor not found')
    source = source.replace(before, after)
  }
  return source
})
