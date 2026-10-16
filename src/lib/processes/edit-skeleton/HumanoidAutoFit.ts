import * as THREE from 'three'
import type { Bone, Object3D, Skeleton } from 'three'
import { estimate_arm_pose } from './AutoRigArmPoseEstimator.ts'

export function fit_humanoid_rig (model: Object3D, skeleton: Skeleton, frame: Object3D | null, before_apply: () => void): 'T-pose' | 'A-pose' | null {
    const bones = skeleton.bones
    if (bones.length === 0) return null

    frame?.updateWorldMatrix(true, true)
    const inverse_frame = frame?.matrixWorld.clone().invert() ?? new THREE.Matrix4()
    const position = (b: Bone): THREE.Vector3 => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse_frame)
    model.updateWorldMatrix(true, true)
    bones[0]?.updateWorldMatrix(true, true)

    // Sample the actual visible geometry instead of trusting only the bounding
    // box. High-poly characters are capped per mesh so this remains tablet-safe.
    const points: THREE.Vector3[] = []
    model.traverse((child: THREE.Object3D) => {
      const geometry = (child as any).geometry as THREE.BufferGeometry | undefined
      const positions = geometry?.getAttribute('position')
      if (positions === undefined) return null

      const stride = Math.max(1, Math.ceil(positions.count / 7000))
      const p = new THREE.Vector3()
      for (let i = 0; i < positions.count; i += stride) {
        p.fromBufferAttribute(positions, i)
        child.localToWorld(p).applyMatrix4(inverse_frame)
        points.push(p.clone())
      }
    })

    if (points.length < 32) return null

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
    if (!Number.isFinite(height) || height <= 0.0001 || width <= 0.0001) return null

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
    const boneWorldBefore = bones.map(b => position(b))
    let boneMinY = Infinity; let boneMaxY = -Infinity
    let boneMinZ = Infinity; let boneMaxZ = -Infinity
    for (const p of boneWorldBefore) {
      boneMinY = Math.min(boneMinY, p.y); boneMaxY = Math.max(boneMaxY, p.y)
      boneMinZ = Math.min(boneMinZ, p.z); boneMaxZ = Math.max(boneMaxZ, p.z)
    }
    const boneHeight = Math.max(0.0001, boneMaxY - boneMinY)
    const uniformScale = height / boneHeight
    before_apply()
    bones.forEach((bone, index) => {
      if (index === 0) return null
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

    const depthCenterAt = (
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
      if (bone === undefined || bone.parent === null) return null
      bone.parent.updateWorldMatrix(true, false)
      const target = new THREE.Vector3(x, y, z ?? depthCenterAt(x, y, preservedZ(bone)))
      if (frame !== null) target.applyMatrix4(frame.matrixWorld)
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
    const lX = lUpper ? position(lUpper).x : 1
    const rX = rUpper ? position(rUpper).x : -1
    const leftSign = lX >= rX ? 1 : -1

    // v6.4: locate real arm heights from the lateral mesh before falling
    // back to Y=79%. Giant cat ears and hair otherwise move the assumed
    // shoulder slice ABOVE a real T-pose and create false A-pose rigs.
    const armEstimate = estimate_arm_pose(points, centerX, width, minY, height)
    const shoulderY = armEstimate?.shoulderY ?? yAt(0.79)
    const sideReach = width * 0.5
    let shoulderFarPoints = 0
    if (armEstimate === null) {
      for (const p of points) {
        if (Math.abs(p.y - shoulderY) < height * 0.035 &&
            Math.abs(p.x - centerX) > sideReach * 0.62) {
          shoulderFarPoints++
        }
      }
    }
    const tPose = armEstimate?.tPose ??
      (shoulderFarPoints > Math.max(8, points.length * 0.002))


    // Centre chain.
    setWorld(pelvis, centerX, yAt(0.52), depthCenterAt(centerX, yAt(0.52), centerZ, width * 0.12, height * 0.035))

    const spineBones = bones
      .filter(b => {
        const n = normalize(b.name)
        return (n.includes('spine') || n.includes('chest')) && !n.includes('shoulder')
      })
      .sort((a, b) => position(a).y - position(b).y)

    spineBones.forEach((bone, index) => {
      const t = spineBones.length <= 1 ? 1 : index / (spineBones.length - 1)
      { const yy = yAt(0.59 + 0.16 * t); setWorld(bone, centerX, yy, depthCenterAt(centerX, yy, centerZ, width * 0.10, height * 0.03)) }
    })
    setWorld(neck, centerX, yAt(0.84), depthCenterAt(centerX, yAt(0.84), centerZ, width * 0.08, height * 0.025))
    setWorld(head, centerX, yAt(0.91), depthCenterAt(centerX, yAt(0.91), centerZ, width * 0.09, height * 0.035))

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
      const armY = armEstimate?.shoulderY ?? yAt(0.785)
      const handY = armEstimate?.handY ?? (tPose ? armY : yAt(0.60))
      const elbowY = armEstimate !== null
        ? (armY + handY) * 0.5
        : (tPose ? armY : yAt(0.69))

      const shoulderJointX = centerX + sign * shoulderHalf * 0.58
      const shoulderJointY = shoulderY
      setWorld(shoulder, shoulderJointX, shoulderJointY,
        depthCenterAt(shoulderJointX, shoulderJointY, centerZ, width * 0.055, height * 0.03))
      setWorld(upper, shoulderX, armY,
        depthCenterAt(shoulderX, armY, preservedZ(upper ?? shoulder!), width * 0.045, height * 0.025))
      setWorld(fore, elbowX, elbowY,
        depthCenterAt(elbowX, elbowY, preservedZ(fore ?? upper!), width * 0.035, height * 0.025))
      setWorld(hand, handX, handY,
        depthCenterAt(handX, handY, preservedZ(hand ?? fore!), width * 0.03, height * 0.025))
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

      const hipY = yAt(0.50)
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
        depthCenterAt(xFoot, toeY, preservedZ(toe), width * 0.04, height * 0.02))
    }

    bones[0]?.updateWorldMatrix(true, true)
    return tPose ? 'T-pose' : 'A-pose'
}
