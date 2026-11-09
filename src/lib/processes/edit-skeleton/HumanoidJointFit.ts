import { Matrix4, Vector3, type Bone, type BufferGeometry, type Object3D } from 'three'
import { capture_hand_shape, place_hand_shape } from './HandPose.ts'

export interface LimbChain {
  start: Bone
  joint: Bone
  end: Bone
  kind: 'elbow' | 'knee'
}

interface Section {
  center: Vector3
  radius: number
}

export interface JointEstimate {
  point: Vector3
  fraction: number
  confidence: number
  evidence: 'constriction' | 'bend'
}

export function visit_fit_geometry (model: Object3D, visit: (child: Object3D, geometry: BufferGeometry) => void): void {
  model.traverse(child => {
    // The editor can hide the model root when displaying its normal/wireframe
    // preview. Child visibility still excludes disabled clothing/accessories.
    for (let node: Object3D | null = child; node && node !== model; node = node.parent) if (!node.visible) return
    const geometry = (child as Object3D & { geometry?: BufferGeometry }).geometry
    if (geometry?.getAttribute('position')) visit(child, geometry)
  })
}

// Intersect the surface, rather than counting vertices near a guessed joint.
// A low-poly limb, a subdivided limb and duplicated UV seams must describe the
// same shape. The bounded triangle snapshot is shared by all four limbs.
export function joint_fit_surface (model: Object3D, frame: Object3D | null, maxTriangles = 150000): Float32Array {
  model.updateWorldMatrix(true, true)
  frame?.updateWorldMatrix(true, false)
  const inverse = frame?.matrixWorld.clone().invert() ?? new Matrix4()
  const meshes: Array<{ geometry: BufferGeometry, matrix: Matrix4, start: number, count: number }> = []
  let total = 0
  visit_fit_geometry(model, (child, geometry) => {
    const available = geometry.index?.count ?? geometry.getAttribute('position').count
    const start = Math.max(0, geometry.drawRange.start)
    const count = Math.floor(Math.max(0, Math.min(available - start, geometry.drawRange.count)) / 3)
    if (!count) return
    meshes.push({ geometry, matrix: inverse.clone().multiply(child.matrixWorld), start, count })
    total += count
  })
  // Closed-contour fitting must retain every triangle. Callers doing that pass
  // Infinity; the limb estimator keeps its bounded sampling by default.
  const stride = Math.max(1, Math.ceil(total / Math.max(1, maxTriangles)))
  const count = meshes.reduce((n, mesh) => n + Math.ceil(mesh.count / stride), 0)
  const triangles = new Float32Array(count * 9)
  const point = new Vector3()
  let cursor = 0
  for (const { geometry, matrix, start, count } of meshes) {
    const positions = geometry.getAttribute('position')
    for (let face = 0; face < count; face += stride) {
      for (let corner = 0; corner < 3; corner++) {
        const index = start + face * 3 + corner
        point.fromBufferAttribute(positions, geometry.index ? geometry.index.getX(index) : index).applyMatrix4(matrix)
        triangles[cursor++] = point.x; triangles[cursor++] = point.y; triangles[cursor++] = point.z
      }
      for (let i = cursor - 9; i < cursor; i++) {
        if (!Number.isFinite(triangles[i])) { cursor -= 9; break }
      }
    }
  }
  return triangles.subarray(0, cursor)
}

/** Locate evidence of a joint along an already isolated arm or leg. There is
 * deliberately no claim of an anatomical landmark on an unbroken cylinder or
 * a limb hidden by a skirt: leave the editable fallback in those cases. */
export function estimate_limb_joint (
  surface: Float32Array,
  start: Vector3,
  end: Vector3,
  fallback: Vector3,
  centerX: number,
  kind: LimbChain['kind'] = 'elbow',
  search?: { max_fraction?: number, max_shift?: number }
): JointEstimate | null {
  const axis = end.clone().sub(start), length = axis.length()
  if (!Number.isFinite(length) || length < 1e-5) return null
  axis.divideScalar(length)
  const u = Math.abs(axis.x) < .8 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)
  u.addScaledVector(axis, -u.dot(axis)).normalize()
  const v = new Vector3().crossVectors(axis, u).normalize()
  const sign = Math.sign((start.x + end.x) * .5 - centerX)
  const bins = 105, first = .04, step = .01, corridor = length * .28
  const lowU = new Float64Array(bins).fill(Infinity), highU = new Float64Array(bins).fill(-Infinity)
  const lowV = new Float64Array(bins).fill(Infinity), highV = new Float64Array(bins).fill(-Infinity)
  const hits = new Uint32Array(bins)
  const normals = new Uint16Array(bins), clipped = new Uint8Array(bins)
  const xyz = [new Vector3(), new Vector3(), new Vector3()]
  const normal = new Vector3(), edgeVector = new Vector3()
  const projection = [0, 0, 0]
  for (let offset = 0; offset < surface.length; offset += 9) {
    for (let corner = 0; corner < 3; corner++) {
      xyz[corner].fromArray(surface, offset + corner * 3).sub(start)
      projection[corner] = xyz[corner].dot(axis) / length
    }
    const lo = Math.max(0, Math.ceil((Math.min(projection[0], projection[1], projection[2]) - first) / step - 1e-6))
    const hi = Math.min(bins - 1, Math.floor((Math.max(projection[0], projection[1], projection[2]) - first) / step + 1e-6))
    let normalBit: number | undefined
    for (let bin = lo; bin <= hi; bin++) {
      const fraction = first + bin * step
      let accepted = 0, rejected = 0
      for (let edge = 0; edge < 3; edge++) {
        const next = (edge + 1) % 3, denominator = projection[next] - projection[edge]
        if (Math.abs(denominator) < 1e-10) continue
        const t = (fraction - projection[edge]) / denominator
        if (t < -1e-6 || t > 1 + 1e-6) continue
        const a = xyz[edge], b = xyz[next]
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t
        if (sign && (x + start.x - centerX) * sign <= length * .012) { rejected++; continue }
        const pu = x * u.x + y * u.y + z * u.z, pv = x * v.x + y * v.y + z * v.z
        if (pu * pu + pv * pv > corridor * corridor) { rejected++; continue }
        lowU[bin] = Math.min(lowU[bin], pu); highU[bin] = Math.max(highU[bin], pu)
        lowV[bin] = Math.min(lowV[bin], pv); highV[bin] = Math.max(highV[bin], pv)
        hits[bin]++
        accepted++
      }
      if (accepted) {
        if (normalBit === undefined) {
          normal.subVectors(xyz[1], xyz[0]).cross(edgeVector.subVectors(xyz[2], xyz[0]))
          const nu = normal.dot(u), nv = normal.dot(v)
          normalBit = nu * nu + nv * nv > 1e-20
            ? 1 << (Math.floor((Math.atan2(nv, nu) + Math.PI) / (Math.PI * 2) * 16) % 16) : 0
        }
        normals[bin] |= normalBit
      }
      if (accepted && rejected) clipped[bin] = 1
    }
  }
  const raw: Array<Section | null> = Array.from({ length: bins }, (_, i) => {
    if (hits[i] < 6 || clipped[i]) return null
    // A small patch or a half-open surface cannot define an inside centre.
    // Surface normal directions work even when the tentative axis is off-centre.
    let gap = 0, longestGap = 0
    for (let sector = 0; sector < 32; sector++) {
      gap = normals[i] & (1 << (sector % 16)) ? 0 : gap + 1
      longestGap = Math.max(longestGap, gap)
    }
    if (longestGap >= 7) return null
    const du = highU[i] - lowU[i], dv = highV[i] - lowV[i]
    if (Math.min(du, dv) < length * .012 || Math.max(du, dv) > length * .5) return null
    const cu = (highU[i] + lowU[i]) * .5, cv = (highV[i] + lowV[i]) * .5
    // Clipped contours cannot provide a trustworthy inside centre.
    if (Math.hypot(cu, cv) + Math.max(du, dv) * .5 > corridor * 1.05) return null
    return { center: start.clone().addScaledVector(axis, (first + i * step) * length)
      .addScaledVector(u, cu).addScaledVector(v, cv), radius: Math.sqrt(du * dv) * .5 }
  })
  // Small median window suppresses isolated spikes without moving a landmark.
  const profile = raw.map((section, i): Section | null => {
    if (!section || i === 0 || i === bins - 1 || !raw[i - 1] || !raw[i + 1]) return null
    const window = raw.slice(i - 1, i + 2) as Section[]
    const median = (numbers: number[]) => numbers.sort((a, b) => a - b)[1]
    return { radius: median(window.map(s => s.radius)), center: new Vector3(
      median(window.map(s => s.center.x)), median(window.map(s => s.center.y)), median(window.map(s => s.center.z))) }
  })
  const prior = Math.max(.22, Math.min(.88, fallback.clone().sub(start).dot(axis) / length))
  // The ankle/boot rim is often a stronger constriction than the knee. Exclude
  // the distal end of a leg and implausibly large shifts of its coarse landmark.
  // These are search bounds along this limb, never a fixed percentage of height.
  const maxFraction = search?.max_fraction ?? (kind === 'knee' ? .74 : .88)
  let best: JointEstimate | null = null, bestScore = 0
  for (let i = 18; i <= 84; i++) {
    const section = profile[i], fraction = first + i * step
    if (!section || fraction < .22 || fraction > maxFraction || Math.abs(fraction - prior) > (search?.max_shift ?? (kind === 'knee' ? .23 : 1))) continue
    const before = profile.slice(i - 14, i - 5).filter((s): s is Section => s !== null)
    const after = profile.slice(i + 6, i + 15).filter((s): s is Section => s !== null)
    if (before.length < 6 || after.length < 6) continue
    const near = profile.slice(i - 3, i + 4).filter((s): s is Section => s !== null)
    if (near.length !== 7) continue
    const proximal = Math.max(...before.map(s => s.radius)), distal = Math.max(...after.map(s => s.radius))
    const prominence = Math.min(proximal, distal) - section.radius
    const contrast = prominence / section.radius
    const minimum = Math.min(...near.map(s => s.radius))
    let score = 0, evidence: JointEstimate['evidence'] = 'constriction'
    if (contrast >= .075 && prominence >= length * .004 && section.radius <= minimum * 1.025) {
      score = Math.min(1, contrast) - Math.abs(fraction - prior) * .12
    }
    // A bent, constant-radius limb still has a landmark: its centreline changes
    // direction. Use coherent sections on both sides, not one noisy surface row.
    const a = profile[i - 12], b = profile[i - 6], c = profile[i + 6], d = profile[i + 12]
    if (a && b && c && d) {
      const incoming = b.center.clone().sub(a.center).normalize(), outgoing = d.center.clone().sub(c.center).normalize()
      const angle = incoming.angleTo(outgoing)
      const incomingNear = section.center.clone().sub(b.center).normalize()
      const outgoingNear = c.center.clone().sub(section.center).normalize()
      const coherence = Math.max(incoming.angleTo(incomingNear), outgoing.angleTo(outgoingNear))
      const bendScore = angle > .22 && angle < 1.4 && coherence < .18
        ? angle * .55 - coherence - Math.abs(fraction - prior) * .12 : 0
      if (bendScore > score) { score = bendScore; evidence = 'bend' }
    }
    if (score > bestScore + 1e-7 || (score > 0 && Math.abs(score - bestScore) < 1e-7 &&
      Math.abs(fraction - prior) < Math.abs((best?.fraction ?? prior) - prior))) {
      bestScore = score
      best = { point: section.center.clone(), fraction, confidence: Math.min(1, score), evidence }
    }
  }
  return bestScore >= .055 ? best : null
}

/** Run after the Woman shoulder pass, which must not overwrite these joints. */
export function refine_humanoid_joints (model: Object3D, chains: LimbChain[], frame: Object3D | null, centerX: number, search?: Partial<Record<LimbChain['kind'], { max_fraction?: number, max_shift?: number }>>): void {
  const surface = joint_fit_surface(model, frame)
  const inverse = frame?.matrixWorld.clone().invert() ?? new Matrix4()
  const at = (bone: Bone) => bone.getWorldPosition(new Vector3()).applyMatrix4(inverse)
  const place = (bone: Bone, point: Vector3) => {
    bone.parent?.updateWorldMatrix(true, false)
    const world = frame ? point.clone().applyMatrix4(frame.matrixWorld) : point.clone()
    bone.position.copy(bone.parent ? bone.parent.worldToLocal(world) : world)
    bone.updateWorldMatrix(true, true)
  }
  for (const chain of chains) {
    const { start, joint, end, kind } = chain
    const estimate = estimate_limb_joint(surface, at(start), at(end), at(joint), centerX, kind, search?.[kind])
    joint.userData.rigJointFit = estimate ? { source: 'surface', evidence: estimate.evidence, confidence: estimate.confidence } : { source: 'fallback' }
    if (!estimate) { joint.userData.rigFitWarning = true; continue }
    delete joint.userData.rigFitWarning
    const endpoint = at(end)
    const shape = kind === 'elbow' ? capture_hand_shape(end, joint) : null
    place(joint, estimate.point)
    // Changing a parent offset must not translate the wrist, ankle or toes.
    place(end, endpoint)
    if (shape) place_hand_shape(end, shape, end.getWorldPosition(new Vector3()).sub(joint.getWorldPosition(new Vector3())))
  }
}
