import { Box3, Matrix4, Mesh, Object3D, Quaternion, Skeleton, Vector3 } from 'three'
import profiles from '../../../library/marker-profiles.json'
import type { AnimalRigReference } from './AnimalAutoFit.ts'
type Point = number[]
interface MarkerProfile {
  id: string; title: string; kind: string; recommendedRig: string
  vertices: number; indices: number; indexHash: number
  basis: Array<{ index: number, point: Point }>; checks: Array<{ index: number, point: Point }>
  joints: Record<string, Point | Point[]>
}
export interface MarkerMatch { profile: MarkerProfile; transform: Matrix4 }
const vec = (p: Point): Vector3 => new Vector3().fromArray(p)
const key = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '')
/** Reviewed landmarks for eight known mannequins. Topology and independent
 * geometry samples guard the profile; no filename or general color guessing.
 * Four non-coplanar anchors recover editor-baked translation, rotation and scale.
 */
export class MannequinMarkerFit {
  public static recognize (model: Object3D): MarkerMatch | null {
    const meshes: Mesh[] = []; model.traverse(o => { if ((o as Mesh).isMesh) meshes.push(o as Mesh) })
    if (meshes.length !== 1) return null
    const mesh = meshes[0], position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index
    if (!position || !index) return null
    const candidates = (profiles as unknown as MarkerProfile[]).filter(p => p.vertices === position.count && p.indices === index.count)
    if (!candidates.length) return null
    let hash = 2166136261
    for (let i = 0; i < index.count; i++) hash = Math.imul(hash ^ index.getX(i), 16777619) >>> 0
    const basis = (p: Vector3[]): Matrix4 => new Matrix4().makeBasis(p[1].clone().sub(p[0]), p[2].clone().sub(p[0]), p[3].clone().sub(p[0])).setPosition(p[0])
    for (const profile of candidates) {
      if (hash !== profile.indexHash) continue
      const canonical = basis(profile.basis.map(p => vec(p.point))), actual = basis(profile.basis.map(p => new Vector3().fromBufferAttribute(position, p.index)))
      if (Math.abs(actual.determinant()) < 1e-15) continue
      const local = actual.multiply(canonical.invert()), tolerance = Math.max(...new Vector3().setFromMatrixScale(local).toArray()) * 2e-4
      if (!profile.checks.every(p => vec(p.point).applyMatrix4(local).distanceTo(new Vector3().fromBufferAttribute(position, p.index)) <= tolerance)) continue
      mesh.updateWorldMatrix(true, false); return { profile, transform: mesh.matrixWorld.clone().multiply(local) }
    }
    return null
  }
  public static compatible (match: MarkerMatch, skeleton: Skeleton): boolean {
    const names = new Set(skeleton.bones.map(b => key(b.name))), all = (...list: string[]): boolean => list.every(n => names.has(n))
    if (match.profile.kind === 'humanoid') return all('pelvis', 'upperarml', 'upperarmr', 'thighl', 'thighr')
    if (match.profile.kind === 'winged-quadruped') return all('wing1l', 'wing1r', 'frontlegl', 'frontlegr', 'backlegl', 'backlegr')
    // Independent IK feet in donor packs require their own trajectory solver.
    return all('frontlegupperl', 'frontlegupperr', 'backlegupperl', 'backlegupperr')
  }
  public static apply (match: MarkerMatch, skeleton: Skeleton, reference: AnimalRigReference, before: () => void): string {
    if (!this.compatible(match, skeleton)) throw new Error('Несовместимый скелет для профиля меток')
    const j = match.profile.joints, targets = new Map<string, Vector3>()
    const p = (name: string): Vector3 => vec(j[name] as Point), set = (name: string, v: Vector3): void => { targets.set(key(name), v.clone()) }
    const at = (name: string, landmark: string): void => set(name, p(landmark)), mix = (a: string, b: string, t: number): Vector3 => p(a).lerp(p(b), t)
    const chain = (names: string[], points: Vector3[]): void => {
      const lengths = [0]; for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]))
      names.forEach((name, i) => { const d = lengths[lengths.length - 1] * i / Math.max(1, names.length - 1); let k = 1; while (k < lengths.length - 1 && lengths[k] < d) k++; set(name, points[k - 1].clone().lerp(points[k], (d - lengths[k - 1]) / Math.max(1e-8, lengths[k] - lengths[k - 1]))) })
    }
    set('root', new Vector3())
    if (match.profile.kind === 'humanoid') {
      at('pelvis', 'pelvis'); at('head', 'head'); at('head_leaf', 'headTip'); at('neck_01', 'neck')
      for (let i = 1; i <= 3; i++) set('spine_0' + i, mix('pelvis', 'chest', i / 3))
      for (const s of ['L', 'R']) {
        set('clavicle_' + s, mix('chest', 'shoulder' + s, .28))
        for (const [bone, point] of [['upperarm', 'shoulder'], ['lowerarm', 'elbow'], ['hand', 'wrist'], ['thigh', 'hip'], ['calf', 'knee'], ['foot', 'ankle'], ['ball', 'toe'], ['ball_leaf', 'toeTip']]) at(bone + '_' + s, point + s)
      }
    } else if (match.profile.kind === 'winged-quadruped') {
      at('hips', 'pelvis'); set('spine_0', mix('pelvis', 'chest', .20)); set('spine_1', mix('pelvis', 'chest', .65)); at('spine_2', 'chest'); at('spine_3', 'neck'); set('spine_4', mix('neck', 'head', .65)); at('head', 'head')
      set('stomach', mix('pelvis', 'chest', .65)); set('stomach_tip', mix('pelvis', 'chest', .6).add(new Vector3(0, -.17, 0)))
      set('mouth_upper', mix('head', 'nose', .4)); at('mouth_upper_tip', 'nose'); set('mouth_lower', mix('head', 'nose', .35).add(new Vector3(0, -.10, 0))); set('mouth_lower_tip', p('nose').add(new Vector3(0, -.045, 0)))
      chain(['tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5', 'tail_6', 'tail_tip'], (j.tail as Point[]).map(vec))
      for (const s of ['L', 'R']) {
        set('collar_anchor_' + s, p('chest')); set('front_leg_collar_' + s, mix('chest', 'shoulder' + s, .65)); set('hips_anchor_' + s, p('pelvis')); set('back_leg_hip_' + s, mix('pelvis', 'hip' + s, .6))
        for (const [bone, point] of [['front_leg', 'shoulder'], ['front_ankle', 'elbow'], ['front_foot', 'wrist'], ['front_toes', 'paw'], ['back_leg', 'hip'], ['back_ankle', 'knee'], ['back_foot', 'hock'], ['back_toes', 'ankle'], ['back_toes_tip', 'backPaw']]) at(bone + '_' + s, point + s)
        set('front_toes_tip_' + s, p('paw' + s).add(new Vector3(0, 0, .10))); set('horn_base_' + s, p('head')); at('horn_' + s, 'ear' + s); at('horn_tip_' + s, 'earTip' + s)
        const wing = (j['wing' + s] as Point[]).map(vec), edge = (j['wingEdge' + s] as Point[]).map(vec)
        for (const [i, name] of ['shoulder', 'wing_1', 'wing_2', 'wing_3', 'wing_4', 'wing_5', 'wing_tip'].entries()) set(name + '_' + s, wing[i])
        for (let i = 1; i <= 5; i++) { set(`wing_feather_${i}_0_${s}`, wing[i]); set(`wing_feather_${i}_1_${s}`, wing[i].clone().lerp(edge[i - 1], .5)); set(`wing_feather_${i}_tip_${s}`, edge[i - 1]) }
      }
    } else {
      at('Hips', 'pelvis'); set('Spine_1', mix('pelvis', 'chest', .3)); set('Spine_2', mix('pelvis', 'chest', .6)); at('Spine_2.001', 'chest'); set('Spine_3', mix('chest', 'neck', .45)); at('Spine_4', 'neck'); at('Head', 'head')
      set('Nose', mix('head', 'nose', .65)); at('Head.tip', 'nose'); set('Chin', mix('head', 'nose', .4).add(new Vector3(0, -.09, 0))); set('Chin_Tip', p('nose').add(new Vector3(0, -.04, 0)))
      set('Stomach', mix('pelvis', 'chest', .5)); set('Stomach_tip', mix('pelvis', 'chest', .5).add(new Vector3(0, -.15, 0)))
      chain(['Tail_Base', 'Tail_Mid', 'Tail_Mid.001', 'Tail_End', 'Tail_Tip'], (j.tail as Point[]).map(vec))
      for (const s of ['L', 'R']) {
        set('Front_Leg_Shoulder_' + s, mix('chest', 'shoulder' + s, .45)); set('Back_Leg_Pelvis_' + s, mix('pelvis', 'hip' + s, .45))
        for (const [bone, point] of [['Front_Leg_Upper', 'shoulder'], ['Front_Leg_Lower', 'elbow'], ['Front_Leg_Ankle', 'wrist'], ['Front_Leg_Foot', 'paw'], ['Back_Leg_Upper', 'hip'], ['Back_Leg_Lower', 'knee'], ['Back_Leg_Ankle', 'hock'], ['Back_Leg_Foot', 'ankle'], ['Back_Leg_Foot_1', 'backPaw'], ['Ear', 'ear'], ['Ear_Tip', 'earTip']]) at(bone + '_' + s, point + s)
        set('Front_Leg_Tip_' + s, p('paw' + s).add(new Vector3(0, 0, .08))); set('Back_Leg_Tip_' + s, p('backPaw' + s).add(new Vector3(0, 0, .07)))
      }
    }
    const source = new Map([...reference.joints].map(([name, value]) => [key(name), value])), scale = 2 / Math.max(1e-5, new Box3().setFromPoints(reference.points).getSize(new Vector3()).y)
    if (match.profile.kind === 'humanoid') for (const s of ['L', 'R']) {
      const hand = source.get('hand' + s.toLowerCase()), tip = source.get('middle04leaf' + s.toLowerCase()) ?? source.get('middle03' + s.toLowerCase())
      if (!hand || !tip) continue
      const from = tip.position.clone().sub(hand.position), to = p('handTip' + s).sub(p('wrist' + s)), rotation = new Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize()), handScale = to.length() / Math.max(1e-6, from.length())
      for (const bone of skeleton.bones) if (/^(thumb|index|middle|ring|pinky)/i.test(bone.name) && key(bone.name).endsWith(s.toLowerCase())) { const rest = source.get(key(bone.name)); if (rest) set(bone.name, rest.position.clone().sub(hand.position).applyQuaternion(rotation).multiplyScalar(handScale).add(p('wrist' + s))) }
    }
    // Unmapped descendants follow their nearest landmark using the immutable
    // reference, making repeated fitting independent of the current edited pose.
    for (const bone of skeleton.bones) {
      if (targets.has(key(bone.name))) continue
      let parent = bone.parent
      while (parent?.type === 'Bone' && !targets.has(key(parent.name))) parent = parent.parent
      const anchor = parent?.type === 'Bone' ? targets.get(key(parent.name)) : p('pelvis'), a = parent ? source.get(key(parent.name)) : undefined, b = source.get(key(bone.name))
      if (anchor && b) targets.set(key(bone.name), b.position.clone().sub(a?.position ?? new Vector3()).multiplyScalar(scale).add(anchor))
    }
    const frameRotation = new Quaternion(); match.transform.decompose(new Vector3(), frameRotation, new Vector3())
    const desired = skeleton.bones.map(b => ({ bone: b, position: targets.get(key(b.name))?.clone().applyMatrix4(match.transform), rotation: source.get(key(b.name))?.rotation.clone().premultiply(frameRotation) }))
    if (desired.some(x => !x.position || !x.rotation || !x.position.toArray().every(Number.isFinite) || !x.rotation.toArray().every(Number.isFinite))) throw new Error('Неполный профиль суставов')
    before(); const depth = (b: Object3D): number => b.parent ? 1 + depth(b.parent) : 0; desired.sort((a, b) => depth(a.bone) - depth(b.bone))
    for (const { bone, position, rotation } of desired) {
      bone.parent?.updateWorldMatrix(true, false); bone.position.copy(bone.parent ? bone.parent.worldToLocal(position!) : position!)
      bone.quaternion.copy((bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion()).invert().multiply(rotation!)).normalize()
      bone.userData.rigMarkerProfile = match.profile.id; bone.userData.rigMarkerKind = match.profile.kind; bone.updateWorldMatrix(false, false)
    }
    skeleton.bones.forEach(b => b.updateWorldMatrix(true, false))
    return `${match.profile.title}: профиль суставов по меткам (${skeleton.bones.length} костей)`
  }
}
