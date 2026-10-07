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
  source = source.replace(
    '    this.rigid_skin_test_enabled = false',
    '    this.rigid_skin_test_enabled = skeleton_type === SkeletonType.MobileFemale'
  )
  return source
})

update('src/Mesh2MotionEngine.ts', (source) => {
  source = source.replaceAll('АвтоРиг · 3D Depth v5.6', 'АвтоРиг · HARD SKIN v5.7')
  source = source.replaceAll('Clean Rig v5.6 3D · ', 'HARD SKIN v5.7 · ')
  return source
})

update('src/lib/RigConfig.ts', (source) => {
  source = source.replace(
    "rig_display_name: 'Humanoid 3D Depth v5.6 · Surface Skin',",
    "rig_display_name: 'Humanoid HARD SKIN v5.7 · Diagnostic',"
  )
  return source
})
