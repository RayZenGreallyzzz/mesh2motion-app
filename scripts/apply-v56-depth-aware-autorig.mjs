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

update('src/Mesh2MotionEngine.ts', (source) => {
  if (!source.includes('const depthCenterAt = (')) {
    const anchor = `    const setWorld = (bone: Bone | undefined, x: number, y: number, z?: number): void => {
      if (bone === undefined || bone.parent === null) return
      bone.parent.updateWorldMatrix(true, false)
      const target = new THREE.Vector3(x, y, z ?? preservedZ(bone))
      bone.position.copy(bone.parent.worldToLocal(target))
      bone.updateWorldMatrix(true, true)
    }
`
    if (!source.includes(anchor)) throw new Error('AutoRig setWorld anchor not found')

    const replacement = `    const depthCenterAt = (
      x: number,
      y: number,
      fallback: number = centerZ,
      radiusX: number = Math.max(width * 0.035, 0.0001),
      radiusY: number = Math.max(height * 0.025, 0.0001)
    ): number => {
      const candidates: number[] = []
      for (const p of points) {
        const dx = (p.x - x) / radiusX
        const dy = (p.y - y) / radiusY
        if (dx * dx + dy * dy <= 1) candidates.push(p.z)
      }

      if (candidates.length < 8) {
        // Expand once for thin limbs / sparse sampling.
        for (const p of points) {
          const dx = (p.x - x) / (radiusX * 1.8)
          const dy = (p.y - y) / (radiusY * 1.8)
          if (dx * dx + dy * dy <= 1) candidates.push(p.z)
        }
      }

      if (candidates.length < 4) return fallback
      candidates.sort((a, b) => a - b)

      // Use robust inner front/back percentiles instead of raw extremes so hair,
      // capes and armor spikes do not drag a joint out of the body volume.
      const lo = candidates[Math.floor((candidates.length - 1) * 0.15)]
      const hi = candidates[Math.floor((candidates.length - 1) * 0.85)]
      return (lo + hi) * 0.5
    }

    const setWorld = (bone: Bone | undefined, x: number, y: number, z?: number): void => {
      if (bone === undefined || bone.parent === null) return
      bone.parent.updateWorldMatrix(true, false)
      const target = new THREE.Vector3(x, y, z ?? depthCenterAt(x, y, preservedZ(bone)))
      bone.position.copy(bone.parent.worldToLocal(target))
      bone.updateWorldMatrix(true, true)
    }
`
    source = source.replace(anchor, replacement)
  }

  // Center-chain joints must also use a real local depth slice, not one global centerZ.
  source = source.replace(
    '    setWorld(pelvis, centerX, yAt(0.52), centerZ)',
    '    setWorld(pelvis, centerX, yAt(0.52), depthCenterAt(centerX, yAt(0.52), centerZ, width * 0.12, height * 0.035))'
  )
  source = source.replace(
    '      setWorld(bone, centerX, yAt(0.59 + 0.16 * t), centerZ)',
    '      { const yy = yAt(0.59 + 0.16 * t); setWorld(bone, centerX, yy, depthCenterAt(centerX, yy, centerZ, width * 0.10, height * 0.03)) }'
  )
  source = source.replace(
    '    setWorld(neck, centerX, yAt(0.84), centerZ)',
    '    setWorld(neck, centerX, yAt(0.84), depthCenterAt(centerX, yAt(0.84), centerZ, width * 0.08, height * 0.025))'
  )
  source = source.replace(
    '    setWorld(head, centerX, yAt(0.91), centerZ)',
    '    setWorld(head, centerX, yAt(0.91), depthCenterAt(centerX, yAt(0.91), centerZ, width * 0.09, height * 0.035))'
  )

  // Arms: explicitly compute joint depth from the local arm slice.
  source = source.replace(
    `      setWorld(shoulder, centerX + sign * shoulderHalf * 0.58, yAt(0.79))
      setWorld(upper, shoulderX, armY)
      setWorld(fore, elbowX, elbowY)
      setWorld(hand, handX, handY)`,
    `      const shoulderJointX = centerX + sign * shoulderHalf * 0.58
      const shoulderJointY = yAt(0.79)
      setWorld(shoulder, shoulderJointX, shoulderJointY,
        depthCenterAt(shoulderJointX, shoulderJointY, centerZ, width * 0.055, height * 0.03))
      setWorld(upper, shoulderX, armY,
        depthCenterAt(shoulderX, armY, preservedZ(upper ?? shoulder!), width * 0.045, height * 0.025))
      setWorld(fore, elbowX, elbowY,
        depthCenterAt(elbowX, elbowY, preservedZ(fore ?? upper!), width * 0.035, height * 0.025))
      setWorld(hand, handX, handY,
        depthCenterAt(handX, handY, preservedZ(hand ?? fore!), width * 0.03, height * 0.025))`
  )

  // Legs: same 3D local-slice depth fitting.
  source = source.replace(
    `      setWorld(thigh, xHip, yAt(0.50))
      setWorld(shin, xKnee, yAt(0.285))
      setWorld(foot, xFoot, yAt(0.055))
      if (toe !== undefined) setWorld(toe, xFoot, yAt(0.025))`,
    `      const hipY = yAt(0.50)
      const kneeY = yAt(0.285)
      const footY = yAt(0.055)
      const toeY = yAt(0.025)
      setWorld(thigh, xHip, hipY,
        depthCenterAt(xHip, hipY, preservedZ(thigh ?? pelvis!), width * 0.045, height * 0.035))
      setWorld(shin, xKnee, kneeY,
        depthCenterAt(xKnee, kneeY, preservedZ(shin ?? thigh!), width * 0.035, height * 0.03))
      setWorld(foot, xFoot, footY,
        depthCenterAt(xFoot, footY, preservedZ(foot ?? shin!), width * 0.04, height * 0.025))
      if (toe !== undefined) setWorld(toe, xFoot, toeY,
        depthCenterAt(xFoot, toeY, preservedZ(toe), width * 0.04, height * 0.02))`
  )

  source = source.replaceAll('АвтоРиг · Rest Axes v5.4', 'АвтоРиг · 3D Depth v5.6')
  source = source.replaceAll('Clean Rig v5.4 REST · ', 'Clean Rig v5.6 3D · ')

  return source
})

update('src/lib/processes/weight-skin/StepWeightSkin.ts', (source) => {
  source = source.replace(
    '    this.rigid_skin_test_enabled = skeleton_type === SkeletonType.MobileFemale',
    '    this.rigid_skin_test_enabled = false'
  )
  return source
})

update('src/lib/RigConfig.ts', (source) => {
  source = source.replace(
    "rig_display_name: 'Humanoid Rest Axes v5.4 · Surface Skin',",
    "rig_display_name: 'Humanoid 3D Depth v5.6 · Surface Skin',"
  )
  return source
})
