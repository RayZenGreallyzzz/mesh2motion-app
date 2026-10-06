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

update('src/lib/mobile-rig/CleanMobileHumanoidRig.ts', (source) => {
  if (!source.includes('public static buildFromPlacedJoints')) {
    const anchor = `
  private static isDeformBone (bone: Bone): boolean {
`
    if (!source.includes(anchor)) throw new Error('CleanMobileHumanoidRig insertion anchor not found')

    const method = `
  /**
   * v5.4 — rebuild the FINAL bind/rest skeleton from the joints after the user
   * (or AutoRig) has finished moving them.
   *
   * Joint placement edits positions, not bone quaternions. If we bind the mesh
   * with those stale quaternions, the helper looks correct because it draws
   * parent-to-child lines, while animation still rotates around the OLD local
   * axes. The result is the "mutant" deformation seen in v5.3.
   *
   * Everything here is converted into editedArmature-local coordinates first.
   * That deliberately removes Rig Setup Group/world transforms, so the skinning
   * solver compares bones and raw geometry in the same coordinate system.
   */
  public static buildFromPlacedJoints (editedArmature: Object3D): Group {
    editedArmature.updateWorldMatrix(true, true)

    const sourceBones: Bone[] = []
    editedArmature.traverse((object) => {
      if (object instanceof Bone && this.isDeformBone(object)) sourceBones.push(object)
    })
    if (sourceBones.length === 0) {
      throw new Error('Clean Mobile Humanoid Rig v5.4: placed rig has no deform bones')
    }

    const sourceSet = new Set(sourceBones)
    const armatureInverse = new Matrix4().copy(editedArmature.matrixWorld).invert()

    const localMatrixOf = (object: Object3D): Matrix4 => {
      object.updateWorldMatrix(true, false)
      return new Matrix4().multiplyMatrices(armatureInverse, object.matrixWorld)
    }

    const localPositionOf = (object: Object3D): Vector3 => {
      const p = new Vector3()
      const q = new Quaternion()
      const s = new Vector3()
      localMatrixOf(object).decompose(p, q, s)
      return p
    }

    const localQuaternionOf = (object: Object3D): Quaternion => {
      const p = new Vector3()
      const q = new Quaternion()
      const s = new Vector3()
      localMatrixOf(object).decompose(p, q, s)
      return q.normalize()
    }

    const result = new Group()
    result.name = 'Clean Mobile Humanoid Bind Armature v5.4'

    const sourceMotionRoot = editedArmature.getObjectByName('root')
    const motionRoot = new Object3D()
    motionRoot.name = 'root'
    result.add(motionRoot)

    if (sourceMotionRoot !== undefined) {
      const p = new Vector3()
      const q = new Quaternion()
      const s = new Vector3()
      localMatrixOf(sourceMotionRoot).decompose(p, q, s)
      motionRoot.position.copy(p)
      motionRoot.quaternion.copy(q)
      motionRoot.scale.set(1, 1, 1)
    } else {
      motionRoot.position.set(0, 0, 0)
      motionRoot.quaternion.identity()
      motionRoot.scale.set(1, 1, 1)
    }
    motionRoot.updateWorldMatrix(true, false)

    const targetBySource = new Map<Bone, Bone>()
    for (const sourceBone of sourceBones) {
      const targetBone = new Bone()
      targetBone.name = sourceBone.name
      targetBone.scale.set(1, 1, 1)
      targetBySource.set(sourceBone, targetBone)
    }

    // Recreate the exact hierarchy the artist edited.
    for (const sourceBone of sourceBones) {
      const targetBone = targetBySource.get(sourceBone)!
      let cursor: Object3D | null = sourceBone.parent
      let targetParent: Object3D = motionRoot

      while (cursor !== null && cursor !== editedArmature) {
        if (cursor instanceof Bone) {
          const mapped = targetBySource.get(cursor)
          if (mapped !== undefined) {
            targetParent = mapped
            break
          }
        }
        cursor = cursor.parent
      }
      targetParent.add(targetBone)
    }

    // Recalculate each rest axis from the FINAL joint positions. Use the old
    // quaternion only as a twist reference, never as the axis direction.
    for (const sourceBone of sourceBones) {
      const targetBone = targetBySource.get(sourceBone)!
      const parent = targetBone.parent
      if (parent === null) continue

      const desiredPosition = localPositionOf(sourceBone)
      const oldQuaternion = localQuaternionOf(sourceBone)
      const child = this.preferredDeformChild(sourceBone, sourceSet)

      let desiredQuaternion = oldQuaternion
      if (child !== undefined) {
        const childPosition = localPositionOf(child)
        const direction = childPosition.sub(desiredPosition)
        if (direction.lengthSq() > 1e-10) {
          direction.normalize()
          const oldAxis = new Vector3(0, 1, 0).applyQuaternion(oldQuaternion).normalize()
          const axisFix = new Quaternion().setFromUnitVectors(oldAxis, direction)
          desiredQuaternion = axisFix.multiply(oldQuaternion).normalize()
        }
      }

      parent.updateWorldMatrix(true, false)
      const desiredMatrix = new Matrix4().compose(
        desiredPosition,
        desiredQuaternion,
        new Vector3(1, 1, 1)
      )
      const localMatrix = new Matrix4().copy(parent.matrixWorld).invert().multiply(desiredMatrix)
      localMatrix.decompose(targetBone.position, targetBone.quaternion, targetBone.scale)
      targetBone.scale.set(1, 1, 1)
      targetBone.updateWorldMatrix(true, false)
    }

    result.userData.cleanMobileHumanoidRig = true
    result.userData.restAxesFromPlacedJoints = true
    result.userData.rigEngineVersion = '5.4'
    result.updateWorldMatrix(true, true)

    console.log(`Clean Mobile Humanoid Rig v5.4: rebuilt rest axes for ${sourceBones.length} placed deform bones`)
    return result
  }

`
    source = source.replace(anchor, method + anchor)
  }
  return source
})

update('src/lib/processes/weight-skin/StepWeightSkin.ts', (source) => {
  source = replaceRequired(
    source,
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
    `    // v5.4: the helper lines only prove JOINT POSITIONS are correct. AutoRig
    // and manual placement do not recompute local bone axes, so binding a clone
    // of the edit rig preserves stale mannequin rotations and explodes when an
    // animation plays. Rebuild the bind/rest axes from the final placed joints
    // in armature-local space before weight solving.
    if (skeleton_type === SkeletonType.MobileFemale) {
      this.skinning_armature = CleanMobileHumanoidRig.buildFromPlacedJoints(editable_armature)
    } else {
      this.skinning_armature = editable_armature.clone(true)
    }
    this.skinning_armature.name = 'Armature for skinning · Rest v5.4'`,
    'StepWeightSkin v5.4 placed rest rebuild'
  )

  source = source.replace(
    '  private clothing_weight_guard_enabled: boolean = true',
    '  private clothing_weight_guard_enabled: boolean = false'
  )
  return source
})

update('src/Mesh2MotionEngine.ts', (source) => {
  source = source.replace(
    "autorig.textContent = 'АвтоРиг · Clean v5.3 LIVE'",
    "autorig.textContent = 'АвтоРиг · Rest Axes v5.4'"
  )
  source = source.replaceAll('Clean Rig v5.3 LIVE · ', 'Clean Rig v5.4 REST · ')

  // On the weight stage show the BIND skeleton names/indices, not the edit copy.
  const before = `    this.edit_skeleton_step.skeleton().bones.forEach((bone, index) => {
      const option = document.createElement('option')
      option.value = index.toString()
      option.textContent = bone.name || \`Bone \${index}\`
      select.appendChild(option)
    })`
  const after = `    const weightEditorSkeleton = this.process_step === ProcessStep.WeightSkin
      ? this.weight_skin_step.skeleton()
      : this.edit_skeleton_step.skeleton()
    weightEditorSkeleton?.bones.forEach((bone, index) => {
      const option = document.createElement('option')
      option.value = index.toString()
      option.textContent = bone.name || \`Bone \${index}\`
      select.appendChild(option)
    })`
  if (!source.includes(after) && source.includes(before)) source = source.replace(before, after)

  return source
})

update('src/lib/RigConfig.ts', (source) => {
  source = source.replace(
    "rig_display_name: 'Humanoid Clean Rig v5.3 LIVE · Retarget',",
    "rig_display_name: 'Humanoid Rest Axes v5.4 · Surface Skin',"
  )
  return source
})
