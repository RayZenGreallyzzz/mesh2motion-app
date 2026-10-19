import { WingedCreatureAutoFit } from './WingedCreatureAutoFit.ts'
import { AnimalCrossSection } from './AnimalCrossSection.ts'
import { Box3, Matrix4, Object3D, Quaternion, Skeleton, Vector3, type Bone, type Mesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RigConfig } from '../../RigConfig.ts'
import { type SkeletonType } from '../../enums/SkeletonType.ts'

export interface AnimalRigReference {
  points: Vector3[]
  joints: Map<string, { position: Vector3, rotation: Quaternion }>
}

/** Template-specific rest fitting. The shared scene transform never enters the fit. */
export class AnimalAutoFit {
  private static references = new Map<SkeletonType, Promise<AnimalRigReference>>()

  public static sample (model: Object3D, frame: Object3D | null = null): Vector3[] {
    frame?.updateWorldMatrix(true, true)
    model.updateWorldMatrix(true, true)
    const inverse = frame?.matrixWorld.clone().invert() ?? new Matrix4()
    const points: Vector3[] = []
    model.traverse(object => {
      const positions = (object as Mesh).geometry?.getAttribute('position')
      if (!positions) return
      const transform = inverse.clone().multiply(object.matrixWorld)
      const stride = Math.max(1, Math.ceil(positions.count / 7000))
      for (let i = 0; i < positions.count; i += stride) {
        points.push(new Vector3().fromBufferAttribute(positions, i).applyMatrix4(transform))
      }
    })
    return points
  }

  public static reference (model: Object3D, rig: Object3D): AnimalRigReference {
    rig.updateWorldMatrix(true, true)
    const joints: AnimalRigReference['joints'] = new Map()
    rig.traverse(object => {
      if (object.type === 'Bone') joints.set(object.name, {
        position: object.getWorldPosition(new Vector3()),
        rotation: object.getWorldQuaternion(new Quaternion()).normalize()
      })
    })
    return { points: this.sample(model), joints }
  }

  public static async load_reference (type: SkeletonType): Promise<AnimalRigReference> {
    let promise = this.references.get(type)
    if (!promise) {
      promise = (async () => {
        const config = RigConfig.all.find(item => item.skeleton_type === type)
        if (!config) throw new Error('No animal reference: ' + type)
        const loader = new GLTFLoader()
        const [model, rig] = await Promise.all([loader.loadAsync(config.model_file), loader.loadAsync(config.rig_file)])
        const result = this.reference(model.scene, rig.scene)
        model.scene.traverse(object => {
          const mesh = object as Mesh
          mesh.geometry?.dispose()
          const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
          for (const material of materials) {
            for (const value of Object.values(material)) if (value?.isTexture) value.dispose()
            material.dispose()
          }
        })
        return result
      })()
      this.references.set(type, promise)
    }
    try { return await promise } catch (error) { this.references.delete(type); throw error }
  }

  public static fit (model: Object3D, skeleton: Skeleton, frame: Object3D | null,
    reference: AnimalRigReference, before_apply: () => void, creature_mode: 'auto' | 'template' | 'upright-winged' = 'auto'): string | null {
    const target = this.sample(model, frame)
    if (target.length < 32 || reference.points.length < 32) return null
    const target_box = new Box3().setFromPoints(target)
    const target_size = target_box.getSize(new Vector3())
    if (Math.min(target_size.x, target_size.y, target_size.z) < 1e-6) return null
    const target_center = target_box.getCenter(new Vector3())
    let best: { yaw: Quaternion, box: Box3, scale: Vector3, points: Vector3[], score: number } | undefined
    // Compare shape AND required horizontal aspect distortion. Normalizing each
    // axis alone makes a long animal fit sideways into its own narrow width.
    for (let quarter = 0; quarter < 4; quarter++) {
      const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), quarter * Math.PI / 2)
      const points = reference.points.map(p => p.clone().applyQuaternion(yaw))
      const box = new Box3().setFromPoints(points)
      const size = box.getSize(new Vector3())
      const scale = target_size.clone().divide(size)
      const center = box.getCenter(new Vector3())
      const mapped = points.map(p => p.sub(center).multiply(scale).add(target_center))
      const score = this.shape_cost(mapped, target, target_size) + 0.025 * Math.log(scale.x / scale.z) ** 2
      if (!best || score < best.score) best = { yaw, box, scale, points: mapped, score }
    }
    if (!best) return null
    const fit = best
    const inverse_yaw = fit.yaw.clone().invert()
    const canonical_target = target.map(p => p.clone().applyQuaternion(inverse_yaw))
    const canonical_source = fit.points.map(p => p.clone().applyQuaternion(inverse_yaw))
    const size = new Box3().setFromPoints(canonical_target).getSize(new Vector3())
    const center = new Box3().setFromPoints(canonical_target).getCenter(new Vector3())
    const source_center = fit.box.getCenter(new Vector3())
    const identical_shape = this.shape_cost(fit.points, target, target_size) < 1e-10
    const winged = reference.joints.has('wing_1_l') && reference.joints.has('front_leg_l')
    const creature = !identical_shape && winged && creature_mode !== 'template' &&
      (creature_mode === 'upright-winged' || size.y / size.x > .65)
      ? WingedCreatureAutoFit.propose(model, frame, fit.yaw, canonical_target) : null
    if (creature_mode === 'upright-winged' && !creature) return null
    const quadruped = reference.joints.has('Front_Leg_Upper_L') && reference.joints.has('Back_Leg_Upper_L')
    const source_feet = quadruped ? this.foot_centers(canonical_source, size) : null
    const target_feet = quadruped ? this.foot_centers(canonical_target, size) : null
    const box = new Box3().setFromPoints(canonical_target)
    const map_z = (z: number): number => {
      if (identical_shape || !source_feet || !target_feet) return z
      const from = [box.min.z, source_feet[0], source_feet[1], box.max.z]
      const to = [box.min.z, target_feet[0], target_feet[1], box.max.z]
      const i = z < from[1] ? 0 : z < from[2] ? 1 : 2
      return to[i] + (z - from[i]) * (to[i + 1] - to[i]) / Math.max(1e-6, from[i + 1] - from[i])
    }
    const cross_section = !identical_shape && quadruped ? new AnimalCrossSection(model, frame, fit.yaw, canonical_target) : null
    const frame_rotation = frame?.getWorldQuaternion(new Quaternion()).normalize() ?? new Quaternion()
    const targets = new Map<string, { position: Vector3, rotation: Quaternion }>()
    for (const [name, joint] of reference.joints) {
      const position = joint.position.clone().applyQuaternion(fit.yaw).sub(source_center).multiply(fit.scale).add(target_center)
      const canonical = position.clone().applyQuaternion(inverse_yaw)
      // Compare homologous local sections instead of treating horns, ears or a
      // raised tail as the top of every part of the animal's torso.
      const source_section = this.section(canonical_source, canonical.z, size, center)
      canonical.z = map_z(canonical.z)
      const target_section = this.section(canonical_target, canonical.z, size, center)
      const body_section = cross_section?.center(canonical.z)
      if (body_section && source_section) {
        const lower = name.toLowerCase()
        if (/hips|spine|neck|head|stomach|shoulder|pelvis|tail/.test(lower)) canonical.y = body_section.y
        else if (/leg/.test(lower)) {
          const source_top = (source_section.low + source_section.high) / 2
          const floor = box.min.y
          const t = Math.max(0, Math.min(1, (canonical.y - floor) / Math.max(size.y * .15, source_top - floor)))
          canonical.y = floor + t * (body_section.y - floor)
        } else if (/nose|chin|ear/.test(lower)) {
          canonical.y = body_section.y + Math.max(-size.y * .06, Math.min(size.y * .1,
            canonical.y - (source_section.low + source_section.high) / 2))
          canonical.x = center.x + Math.max(-body_section.radius, Math.min(body_section.radius, canonical.x - center.x))
        }
      } else if (!identical_shape && source_section && target_section) {
        const source_mid = (source_section.low + source_section.high) / 2
        const target_mid = (target_section.low + target_section.high) / 2
        const desired = canonical.y + target_mid - source_mid
        const name_lower = name.toLowerCase()
        const body = /hips|spine|neck|head|tail|jaw|ear/.test(name_lower)
        if (body) canonical.y = desired
        else {
          // Lower limbs interpolate floor to local torso height, preserving the
          // reference bend and avoiding proportional scaling by a raised tail.
          const floor = target_box.min.y
          const source_top = (source_section.low + source_section.high) / 2
          const target_top = (target_section.low + target_section.high) / 2
          const t = Math.max(0, Math.min(1, (canonical.y - floor) / Math.max(1e-6, source_top - floor)))
          canonical.y += (target_top - source_top) * t
        }
      }
      position.copy(canonical.applyQuaternion(fit.yaw))
      if (frame) position.applyMatrix4(frame.matrixWorld)
      targets.set(name, { position, rotation: frame_rotation.clone().multiply(fit.yaw).multiply(joint.rotation).normalize() })
    }
    if (cross_section) {
      const names = [...reference.joints.keys()].filter(name => /tail/i.test(name))
      const first = targets.get(names[0])
      if (first) {
        const start = first.position.clone()
        if (frame) start.applyMatrix4(frame.matrixWorld.clone().invert())
        start.applyQuaternion(inverse_yaw)
        const hips = targets.get('Hips')
        if (hips) {
          const hip = hips.position.clone()
          if (frame) hip.applyMatrix4(frame.matrixWorld.clone().invert())
          hip.applyQuaternion(inverse_yaw)
          start.y = hip.y
        }
        const posterior_top = Math.max(...canonical_target.filter(p => p.z < start.z).map(p => p.y))
        const allow_curl = posterior_top - start.y > size.y * .5
        const path = cross_section.tail(start, names.length, allow_curl)
        if (path) path.forEach((p, i) => {
          p.applyQuaternion(fit.yaw)
          if (frame) p.applyMatrix4(frame.matrixWorld)
          targets.get(names[i])!.position.copy(p)
        })
      }
    }
    if (creature) {
      for (const [name, point] of creature) {
        const joint = targets.get(name)
        if (!joint) continue
        joint.position.copy(point).applyQuaternion(fit.yaw)
        if (frame) joint.position.applyMatrix4(frame.matrixWorld)
      }
    }
    before_apply()
    // Parent before child, independent of Skeleton.bones array ordering.
    const bones = [...skeleton.bones].sort((a, b) => this.depth(a) - this.depth(b))
    for (const bone of bones) {
      const target_joint = targets.get(bone.name)
      if (!target_joint || !bone.parent) continue
      bone.parent.updateWorldMatrix(true, false)
      bone.position.copy(bone.parent.worldToLocal(target_joint.position.clone()))
      bone.quaternion.copy(bone.parent.getWorldQuaternion(new Quaternion()).normalize().invert().multiply(target_joint.rotation)).normalize()
      bone.updateWorldMatrix(true, true)
    }
    return creature ? 'двуногий дракон; цепочки внутри тела, шеи и хвоста; крылья и поднятые лапы отдельно'
      : 'шаблон животного; лапы, спина и хвост требуют проверки'
  }

  private static depth (object: Object3D): number {
    let result = 0
    for (let parent = object.parent; parent; parent = parent.parent) result++
    return result
  }

  private static section (points: Vector3[], z: number, size: Vector3, center: Vector3): { low: number, high: number } | null {
    const values = points.filter(p => Math.abs(p.z - z) < size.z * 0.055 && Math.abs(p.x - center.x) < size.x * 0.24).map(p => p.y).sort((a, b) => a - b)
    if (values.length < 8) return null
    // These are surface samples: a gap between top and underside is the body
    // interior, not evidence of disconnected anatomy.
    return { low: values[Math.floor((values.length - 1) * 0.12)], high: values[Math.floor((values.length - 1) * 0.88)] }
  }

  private static foot_centers (points: Vector3[], size: Vector3): [number, number] | null {
    const floor = Math.min(...points.map(p => p.y))
    const feet = points.filter(p => p.y < floor + size.y * 0.14)
    if (feet.length < 16) return null
    let back = Math.min(...feet.map(p => p.z)), front = Math.max(...feet.map(p => p.z))
    for (let iteration = 0; iteration < 8; iteration++) {
      const a = feet.filter(p => Math.abs(p.z - back) < Math.abs(p.z - front))
      const b = feet.filter(p => Math.abs(p.z - back) >= Math.abs(p.z - front))
      if (!a.length || !b.length) return null
      back = a.reduce((sum, p) => sum + p.z, 0) / a.length
      front = b.reduce((sum, p) => sum + p.z, 0) / b.length
    }
    return front - back > size.z * 0.15 ? [back, front] : null
  }

  private static shape_cost (a: Vector3[], b: Vector3[], size: Vector3): number {
    const sample = (p: Vector3[]) => p.filter((_, i) => i % Math.max(1, Math.ceil(p.length / 300)) === 0).map(p => p.clone().divide(size))
    const first = sample(a), second = sample(b)
    const cost = (from: Vector3[], to: Vector3[]) => from.reduce((sum, p) => sum + Math.min(...to.map(q => p.distanceToSquared(q))), 0) / from.length
    return cost(first, second) + cost(second, first)
  }
}
