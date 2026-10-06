import fs from 'node:fs'

function update(path, transform) {
  const before = fs.readFileSync(path, 'utf8')
  const after = transform(before)
  if (after !== before) {
    fs.writeFileSync(path, after)
    console.log(`Updated ${path}`)
  } else {
    console.log(`No change needed: ${path}`)
  }
}

// 1) Keep MobileFemale on the exact same automatic skinning pipeline as browser Human.
update('src/lib/solvers/SkinningAlgorithm.ts', (source) => {
  source = source.replace("import { MobileFemaleWeightCorrector } from './MobileFemaleWeightCorrector.js'\n", '')
  source = source.replace(/\n\s*\/\/ Step 1d: Mobile Female[\s\S]*?mobile_female_corrector\.apply\(skin_indices, skin_weights\)\n\s*}\n/, '\n')
  return source
})

// 2) Mobile humanoid keeps a lightweight but articulated hand instead of one rigid hand bone.
update('src/lib/HumanoidSkeleton.ts', (source) => {
  source = source.replace(
`/**
 * Mobile Female intentionally forces the lightest hand setup so the generated
 * rig stays appropriate for mobile/WebGL characters. Regular Human keeps the
 * hand option selected in the UI.
 */
export function effective_hand_skeleton_type (
  type: SkeletonType | null | undefined,
  selected: HandSkeletonType
): HandSkeletonType {
  return type === SkeletonType.MobileFemale ? HandSkeletonType.SingleBone : selected
}`,
`/**
 * The mobile humanoid uses the simplified articulated hand. This keeps the rig
 * light enough for WebGL/Android while preserving fingers instead of collapsing
 * the whole hand into one rigid bone.
 */
export function effective_hand_skeleton_type (
  type: SkeletonType | null | undefined,
  selected: HandSkeletonType
): HandSkeletonType {
  return type === SkeletonType.MobileFemale ? HandSkeletonType.SimplifiedHand : selected
}`)
  return source
})

// 3) Make the preset name match what it actually does.
update('src/lib/RigConfig.ts', (source) => source.replace(
  "rig_display_name: 'Human · Mobile Female',",
  "rig_display_name: 'Humanoid AutoRig · Browser Skin',"
))

// 4) Add one-tap AutoRig button to the rig setup panel.
update('src/create.html', (source) => {
  if (source.includes('id="autorig-humanoid-button"')) return source
  const anchor = '            <small id="rig-setup-status">Риг разблокирован: модель и скелет двигаются вместе.</small>\n'
  if (!source.includes(anchor)) throw new Error('Rig setup status anchor not found')
  return source.replace(anchor,
`${anchor}            <button type="button" id="autorig-humanoid-button" class="secondary-button">АвтоРиг · Humanoid</button>
            <small>Автоматически подгоняет humanoid-скелет под модель. После этого проверьте таз, локти и колени.</small>
`)
})

// 5) Wire button to the engine.
update('src/lib/EventListeners.ts', (source) => {
  if (source.includes("getElementById('autorig-humanoid-button')")) return source
  const anchor = `    document.getElementById('rig-view-back')?.addEventListener('click', () => {\n      this.bootstrap.set_rig_camera_view('back')\n    })\n`
  if (!source.includes(anchor)) throw new Error('Rig view back listener anchor not found')
  return source.replace(anchor, `${anchor}
    document.getElementById('autorig-humanoid-button')?.addEventListener('click', () => {
      this.bootstrap.auto_fit_humanoid_rig()
    })
`)
})

// 6) Add geometry-driven humanoid autorig to the engine.
update('src/Mesh2MotionEngine.ts', (source) => {
  if (source.includes('public auto_fit_humanoid_rig (): void')) return source

  const anchor = `  public is_rig_setup_locked (): boolean {\n    return this.rig_setup_locked_state\n  }\n`
  if (!source.includes(anchor)) throw new Error('Rig setup lock anchor not found')

  const method = `  /**
   * Mixamo-style local AutoRig. This does not call any cloud service: it fits
   * the existing humanoid skeleton to the imported mesh using its geometry,
   * then leaves the joints editable for a final human check.
   */
  public auto_fit_humanoid_rig (): void {
    if (this.process_step !== ProcessStep.EditSkeleton) return
    if (!is_humanoid_skeleton_type(this.load_skeleton_step.skeleton_type())) return

    // Fit only after the shared model/rig transform has been baked. That gives
    // the autorigger stable world-space geometry and keeps Bind coordinates sane.
    if (!this.rig_setup_locked_state) this.lock_rig_setup()

    const model = this.load_model_step.model_meshes()
    const skeleton = this.edit_skeleton_step.skeleton()
    const bones = skeleton.bones
    if (bones.length === 0) return

    model.updateWorldMatrix(true, true)
    bones[0]?.updateWorldMatrix(true, true)

    // Sample the actual visible geometry instead of trusting only the bounding
    // box. High-poly characters are capped per mesh so this remains tablet-safe.
    const points: THREE.Vector3[] = []
    model.traverse((child: THREE.Object3D) => {
      const geometry = (child as any).geometry as THREE.BufferGeometry | undefined
      const positions = geometry?.getAttribute('position')
      if (positions === undefined) return

      const stride = Math.max(1, Math.ceil(positions.count / 7000))
      const p = new THREE.Vector3()
      for (let i = 0; i < positions.count; i += stride) {
        p.fromBufferAttribute(positions, i)
        child.localToWorld(p)
        points.push(p.clone())
      }
    })

    if (points.length < 32) return

    let minX = Infinity; let maxX = -Infinity
    let minY = Infinity; let maxY = -Infinity
    let minZ = Infinity; let maxZ = -Infinity
    for (const p of points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
    }

    const height = maxY - minY
    const width = maxX - minX
    const depth = maxZ - minZ
    if (!Number.isFinite(height) || height <= 0.0001 || width <= 0.0001) return

    const centerX = (minX + maxX) * 0.5
    const centerZ = (minZ + maxZ) * 0.5
    const yAt = (ratio: number): number => minY + height * ratio

    const normalize = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const byAliases = (aliases: string[]): Bone | undefined => {
      const wanted = aliases.map(normalize)
      return bones.find((bone) => {
        const n = normalize(bone.name)
        return wanted.some(alias => n === alias || n.endsWith(alias))
      })
    }

    const sideBone = (role: 'shoulder' | 'upperarm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'foot' | 'toe', side: 'l' | 'r'): Bone | undefined => {
      const left = side === 'l'
      const aliases: Record<typeof role, string[]> = {
        shoulder: left
          ? ['shoulder_l', 'leftshoulder', 'clavicle_l', 'leftclavicle', 'mixamorigleftshoulder']
          : ['shoulder_r', 'rightshoulder', 'clavicle_r', 'rightclavicle', 'mixamorigrightshoulder'],
        upperarm: left
          ? ['upperarm_l', 'leftarm', 'leftupperarm', 'mixamorigleftarm']
          : ['upperarm_r', 'rightarm', 'rightupperarm', 'mixamorigrightarm'],
        forearm: left
          ? ['forearm_l', 'leftforearm', 'lowerarm_l', 'leftlowerarm', 'mixamorigleftforearm']
          : ['forearm_r', 'rightforearm', 'lowerarm_r', 'rightlowerarm', 'mixamorigrightforearm'],
        hand: left
          ? ['hand_l', 'lefthand', 'mixamoriglefthand']
          : ['hand_r', 'righthand', 'mixamorigrighthand'],
        thigh: left
          ? ['thigh_l', 'leftupleg', 'leftupperleg', 'mixamorigleftupleg']
          : ['thigh_r', 'rightupleg', 'rightupperleg', 'mixamorigrightupleg'],
        shin: left
          ? ['shin_l', 'leftleg', 'leftlowerleg', 'calf_l', 'mixamorigleftleg']
          : ['shin_r', 'rightleg', 'rightlowerleg', 'calf_r', 'mixamorigrightleg'],
        foot: left
          ? ['foot_l', 'leftfoot', 'mixamorigleftfoot']
          : ['foot_r', 'rightfoot', 'mixamorigrightfoot'],
        toe: left
          ? ['toe_l', 'lefttoe', 'toebase_l', 'lefttoebase', 'mixamoriglefttoebase']
          : ['toe_r', 'righttoe', 'toebase_r', 'righttoebase', 'mixamorgrighttoebase']
      }
      return byAliases(aliases[role])
    }

    const pelvis = byAliases(['pelvis', 'hips', 'mixamorighips'])
    const neck = byAliases(['neck', 'mixamorigneck'])
    const head = byAliases(['head', 'mixamorighead'])

    // Uniformly scale all local bone offsets first so fingers/toes and any bones
    // we do not explicitly place inherit a sensible model-scale automatically.
    const boneWorldBefore = bones.map(b => b.getWorldPosition(new THREE.Vector3()))
    let boneMinY = Infinity; let boneMaxY = -Infinity
    let boneMinZ = Infinity; let boneMaxZ = -Infinity
    for (const p of boneWorldBefore) {
      boneMinY = Math.min(boneMinY, p.y); boneMaxY = Math.max(boneMaxY, p.y)
      boneMinZ = Math.min(boneMinZ, p.z); boneMaxZ = Math.max(boneMaxZ, p.z)
    }
    const boneHeight = Math.max(0.0001, boneMaxY - boneMinY)
    const uniformScale = height / boneHeight
    bones.forEach((bone, index) => {
      if (index === 0) return
      bone.position.multiplyScalar(uniformScale)
    })
    bones[0]?.updateWorldMatrix(true, true)

    const originalDepth = Math.max(0.0001, boneMaxZ - boneMinZ)
    const depthScale = depth > 0.0001 ? depth / originalDepth : 1
    const originalCenterZ = (boneMinZ + boneMaxZ) * 0.5
    const preservedZ = (bone: Bone): number => {
      const old = boneWorldBefore[bones.indexOf(bone)]
      if (old === undefined) return centerZ
      return centerZ + (old.z - originalCenterZ) * depthScale
    }

    const setWorld = (bone: Bone | undefined, x: number, y: number, z?: number): void => {
      if (bone === undefined || bone.parent === null) return
      bone.parent.updateWorldMatrix(true, false)
      const target = new THREE.Vector3(x, y, z ?? preservedZ(bone))
      bone.position.copy(bone.parent.worldToLocal(target))
      bone.updateWorldMatrix(true, true)
    }

    // Robust torso width estimate. A percentile of a horizontal slice ignores
    // most arm vertices, unlike a raw max-width box which is dominated by A/T arms.
    const sliceHalfWidth = (ratio: number, bandRatio = 0.025): number => {
      const y = yAt(ratio)
      const band = Math.max(height * bandRatio, 0.0001)
      const distances: number[] = []
      for (const p of points) {
        if (Math.abs(p.y - y) <= band) distances.push(Math.abs(p.x - centerX))
      }
      if (distances.length < 8) return width * 0.12
      distances.sort((a, b) => a - b)
      return distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.72))]
    }

    const shoulderHalf = Math.max(width * 0.08, sliceHalfWidth(0.79) * 0.95)
    const hipHalf = Math.max(width * 0.045, sliceHalfWidth(0.52) * 0.42)

    // Determine which world-X side the rig calls "left" from the current rig,
    // so this works even if the imported character faces the opposite direction.
    const lUpper = sideBone('upperarm', 'l')
    const rUpper = sideBone('upperarm', 'r')
    const lX = lUpper?.getWorldPosition(new THREE.Vector3()).x ?? 1
    const rX = rUpper?.getWorldPosition(new THREE.Vector3()).x ?? -1
    const leftSign = lX >= rX ? 1 : -1

    // Detect a T-pose from far-lateral geometry around shoulder height.
    const shoulderY = yAt(0.79)
    const sideReach = width * 0.5
    let shoulderFarPoints = 0
    for (const p of points) {
      if (Math.abs(p.y - shoulderY) < height * 0.035 && Math.abs(p.x - centerX) > sideReach * 0.62) {
        shoulderFarPoints++
      }
    }
    const tPose = shoulderFarPoints > Math.max(8, points.length * 0.002)

    this.edit_skeleton_step.store_bone_state_for_undo()

    // Centre chain.
    setWorld(pelvis, centerX, yAt(0.52), centerZ)

    const spineBones = bones
      .filter(b => {
        const n = normalize(b.name)
        return (n.includes('spine') || n.includes('chest')) && !n.includes('shoulder')
      })
      .sort((a, b) => a.getWorldPosition(new THREE.Vector3()).y - b.getWorldPosition(new THREE.Vector3()).y)

    spineBones.forEach((bone, index) => {
      const t = spineBones.length <= 1 ? 1 : index / (spineBones.length - 1)
      setWorld(bone, centerX, yAt(0.59 + 0.16 * t), centerZ)
    })
    setWorld(neck, centerX, yAt(0.84), centerZ)
    setWorld(head, centerX, yAt(0.91), centerZ)

    // Arms: fit A-pose by default, keep T-pose horizontal when geometry says so.
    for (const side of ['l', 'r'] as const) {
      const sign = side === 'l' ? leftSign : -leftSign
      const shoulder = sideBone('shoulder', side)
      const upper = sideBone('upperarm', side)
      const fore = sideBone('forearm', side)
      const hand = sideBone('hand', side)
      const sideEdge = sign > 0 ? maxX : minX
      const shoulderX = centerX + sign * shoulderHalf
      const handX = centerX + (sideEdge - centerX) * 0.91
      const elbowX = shoulderX + (handX - shoulderX) * 0.52
      const armY = yAt(0.785)
      const elbowY = tPose ? armY : yAt(0.69)
      const handY = tPose ? armY : yAt(0.60)

      setWorld(shoulder, centerX + sign * shoulderHalf * 0.58, yAt(0.79))
      setWorld(upper, shoulderX, armY)
      setWorld(fore, elbowX, elbowY)
      setWorld(hand, handX, handY)
    }

    // Legs.
    for (const side of ['l', 'r'] as const) {
      const sign = side === 'l' ? leftSign : -leftSign
      const thigh = sideBone('thigh', side)
      const shin = sideBone('shin', side)
      const foot = sideBone('foot', side)
      const toe = sideBone('toe', side)
      const xHip = centerX + sign * hipHalf
      const xKnee = centerX + sign * hipHalf * 0.88
      const xFoot = centerX + sign * hipHalf * 0.92

      setWorld(thigh, xHip, yAt(0.50))
      setWorld(shin, xKnee, yAt(0.285))
      setWorld(foot, xFoot, yAt(0.055))
      if (toe !== undefined) setWorld(toe, xFoot, yAt(0.025))
    }

    bones[0]?.updateWorldMatrix(true, true)
    this.regenerate_skeleton_helper(skeleton, 'Skeleton Helper')
    this.sync_skeleton_helper_joint_visibility()
    this.edit_skeleton_step.dispatchEvent(new CustomEvent('skeletonTransformed'))

    const status = document.getElementById('rig-setup-status')
    if (status !== null) {
      status.textContent = tPose
        ? 'АвтоРиг готов (T-pose). Проверьте таз, локти, колени и кисти.'
        : 'АвтоРиг готов (A-pose). Проверьте таз, локти, колени и кисти.'
    }
  }

`

  return source.replace(anchor, method + anchor)
})

console.log('v4.6 browser skinning + humanoid autorig patch complete')
