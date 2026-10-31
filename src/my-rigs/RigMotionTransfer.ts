import { AnimationClip, InterpolateDiscrete, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type Interpolant, type KeyframeTrack, type Mesh } from 'three'
import { BoneSide, BoneSlot } from '../retarget/bone-automap/BoneTypes.ts'
import { parse_bone_name } from '../retarget/bone-automap/BoneNameTokenizer.ts'
import { resolve_slot } from '../retarget/bone-automap/BoneSlotVocabulary.ts'
import type { RigAsset, RigNode } from './RigAsset.ts'
import { animated_nodes, is_volume_node, joint_roles, ordered_nodes, type JointRole, type RigMapping } from './RigBoneMapping.ts'
export { animated_nodes, mapping_key, suggest_mapping, type RigMapping } from './RigBoneMapping.ts'
export interface TransferOptions { match_pose?: boolean, in_place?: boolean, anchor_motion?: boolean, skip_first_frame?: boolean, deformation?: boolean }
export interface TransferReport { exact: boolean, source_bones: number, target_bones: number, mapped_bones: number, skipped_source: string[], retained_target: string[], warnings: string[], scale: number }
interface Frame { node: RigNode, parent?: Frame, p: Vector3, q: Quaternion, s: Vector3, wp: Vector3, wq: Quaternion, ws: Vector3, baseP: Vector3, baseQ: Quaternion, baseS: Vector3 }
interface Pair { from: Frame, to: Frame, correction: Quaternion, translate: boolean, attachment?: { parent: Frame, offset: Vector3 } }
interface Support { frame: Frame, child: Frame }
interface Plan { source: RigAsset, target: RigAsset, mapping: RigMapping, options: TransferOptions, sf: Frame[], tf: Frame[], pairs: Pair[], supports: Support[], align: Quaternion, up: Vector3, scale: number, report: TransferReport }
type SampleTrack = KeyframeTrack & { createInterpolant: (() => Interpolant) & { isInterpolantFactoryMethodGLTFCubicSpline?: boolean } }
const EPS = 1e-6, MAX_TRANSFORM_KEYS = 2_000_000
function update_world (f: Frame): void {
  const p = f.parent?.wp ?? f.baseP, q = f.parent?.wq ?? f.baseQ, s = f.parent?.ws ?? f.baseS
  f.wq.copy(q).multiply(f.q).normalize(); f.ws.copy(s).multiply(f.s); f.wp.copy(f.p).multiply(s).applyQuaternion(q).add(p)
}
function frames (asset: RigAsset): Frame[] {
  const byId = new Map<string, Frame>()
  return ordered_nodes(asset).map(node => {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined
    const f: Frame = { node, parent, p: node.position.clone(), q: node.rotation.clone(), s: node.scale.clone(), wp: new Vector3(), wq: new Quaternion(), ws: new Vector3(), baseP: parent ? new Vector3() : node.object.parent?.getWorldPosition(new Vector3()) ?? new Vector3(), baseQ: node.parent_rotation.clone(), baseS: node.world_scale.clone().divide(node.scale) }
    byId.set(node.id, f); update_world(f); return f
  })
}
function reset_frame (f: Frame): void { f.p.copy(f.node.position); f.q.copy(f.node.rotation); f.s.copy(f.node.scale) }
function is_ancestor (asset: RigAsset, ancestor: string, child: string): boolean {
  for (let id = asset.nodes.get(child)?.parent_id; id; id = asset.nodes.get(id)?.parent_id) if (id === ancestor) return true
  return false
}
function role_frame (fs: Frame[], roles: Map<string, JointRole>, slot: BoneSlot, side?: BoneSide): Frame | undefined {
  return fs.find(f => { const r = roles.get(f.node.id); return r?.slot === slot && !r.leaf && !r.chain && (side === undefined || r.side === side) })
}
function body_basis (fs: Frame[], roles: Map<string, JointRole>): Quaternion | undefined {
  const hips = role_frame(fs, roles, BoneSlot.Pelvis), head = role_frame(fs, roles, BoneSlot.Neck) ?? role_frame(fs, roles, BoneSlot.Head)
  const left = role_frame(fs, roles, BoneSlot.UpperArm, BoneSide.Left) ?? role_frame(fs, roles, BoneSlot.Thigh, BoneSide.Left), right = role_frame(fs, roles, BoneSlot.UpperArm, BoneSide.Right) ?? role_frame(fs, roles, BoneSlot.Thigh, BoneSide.Right)
  if (!hips || !head || !left || !right) return
  const y = head.wp.clone().sub(hips.wp), x = right.wp.clone().sub(left.wp)
  if (y.lengthSq() < EPS || x.lengthSq() < EPS) return
  y.normalize(); x.addScaledVector(y, -x.dot(y)).normalize()
  const z = new Vector3().crossVectors(x, y).normalize(); if (z.lengthSq() < 0.5) return
  x.crossVectors(y, z).normalize(); return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
}
function motion_scale (sf: Frame[], tf: Frame[], sr: Map<string, JointRole>, tr: Map<string, JointRole>, pairs: Pair[]): number {
  const lengths = (fs: Frame[], roles: Map<string, JointRole>): number => {
    let total = 0, count = 0
    for (const side of [BoneSide.Left, BoneSide.Right]) {
      const a = role_frame(fs, roles, BoneSlot.Thigh, side), b = role_frame(fs, roles, BoneSlot.Calf, side), c = role_frame(fs, roles, BoneSlot.Foot, side)
      if (a && b && c) { total += a.wp.distanceTo(b.wp) + b.wp.distanceTo(c.wp); count++ }
    }
    return count ? total / count : 0
  }
  const a = lengths(sf, sr), b = lengths(tf, tr); if (a > EPS && b > EPS) return b / a
  const ratios: number[] = []
  for (const pair of pairs) {
    let parent: Pair | undefined
    for (let f = pair.from.parent; f && !parent; f = f.parent) parent = pairs.find(p => p.from === f)
    if (!parent) continue
    const from = pair.from.wp.distanceTo(parent.from.wp), to = pair.to.wp.distanceTo(parent.to.wp)
    if (from > EPS && to > EPS) ratios.push(to / from)
  }
  ratios.sort((a, b) => a - b); return ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1
}
function has_motion (track: KeyframeTrack): boolean {
  const cubic = Boolean((track as SampleTrack).createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline), stride = track.getValueSize(), width = cubic ? stride / 3 : stride, base = cubic ? width : 0
  for (let i = 0; i < track.times.length; i++) for (let j = 0; j < width; j++) if (Math.abs(track.values[i * stride + base + j] - track.values[base + j]) > EPS) return true
  return false
}
function sample_times (clip: AnimationClip): number[] {
  if (!Number.isFinite(clip.duration) || clip.duration < 0 || clip.duration > 600) throw new Error('Для переноса выберите клипы не длиннее 10 минут')
  const times = new Set<number>([0, clip.duration])
  for (let f = 1; f < Math.ceil(clip.duration * 30); f++) times.add(f / 30)
  for (const track of clip.tracks) for (let i = 0; i < track.times.length; i++) {
    const time = track.times[i]
    if (time < 0 || time > clip.duration + EPS || !Number.isFinite(time)) throw new Error('Повреждены ключевые кадры: ' + clip.name)
    times.add(time)
    if (track.getInterpolation() === InterpolateDiscrete && i > 0) times.add(Math.max(track.times[i - 1], time - Math.min(1 / 6000, (time - track.times[i - 1]) / 100)))
    if (times.size > 40_000) throw new Error('Слишком много ключей в одном клипе. Разделите анимацию.')
  }
  return [...times].sort((a, b) => a - b)
}
function plan_transfer (source: RigAsset, target: RigAsset, mapping: RigMapping, indices: number[], options: TransferOptions): Plan {
  if (!indices.length) throw new Error('Выберите хотя бы одну анимацию')
  if (new Set(indices).size !== indices.length || indices.some(i => !Number.isInteger(i) || !source.clips[i])) throw new Error('Неверный список анимаций')
  if (target.clips.length + indices.length > 256) throw new Error('В одном файле поддерживается до 256 анимаций')
  const required = animated_nodes(source, indices), used = new Set<string>()
  for (const node of required) {
    const id = mapping[node.id]; if (!id) continue
    const other = target.nodes.get(id)
    if (!other) throw new Error('Не найден узел персонажа для «' + node.name + '»')
    if (used.has(id)) throw new Error('Одну кость нельзя назначить двум узлам источника')
    used.add(id)
    if (node.is_joint !== other.is_joint || node.is_mesh !== other.is_mesh) throw new Error('Сопоставьте кость с костью: ' + node.name)
  }
  const identical = source.nodes.size === target.nodes.size && [...source.nodes.values()].every(node => {
    const other = target.nodes.get(mapping[node.id])
    return other && (node.parent_id ? mapping[node.parent_id] : null) === other.parent_id && node.is_joint === other.is_joint && node.is_mesh === other.is_mesh && node.position.distanceTo(other.position) < EPS && node.scale.distanceTo(other.scale) < EPS && node.rotation.clone().normalize().angleTo(other.rotation.clone().normalize()) < EPS && node.world_scale.distanceTo(other.world_scale) < EPS && node.world_rotation.clone().normalize().angleTo(other.world_rotation.clone().normalize()) < EPS
  })
  const sf = frames(source), tf = frames(target), toId = new Map(tf.map(f => [f.node.id, f])), pairs: Pair[] = [], usedJoints = new Set<string>()
  for (const f of sf) {
    if (!f.node.is_joint || is_volume_node(f.node) || !mapping[f.node.id]) continue
    const to = toId.get(mapping[f.node.id])
    if (!to?.node.is_joint || is_volume_node(to.node)) throw new Error('Неверное соответствие кости «' + f.node.name + '»')
    if (usedJoints.has(to.node.id)) throw new Error('Одну кость нельзя назначить двум узлам источника')
    usedJoints.add(to.node.id); pairs.push({ from: f, to, correction: new Quaternion(), translate: false })
  }
  const report: TransferReport = { exact: identical && !options.in_place, source_bones: sf.filter(f => f.node.is_joint).length, target_bones: tf.filter(f => f.node.is_joint).length, mapped_bones: pairs.length, skipped_source: sf.filter(f => f.node.is_joint && !mapping[f.node.id] && !is_volume_node(f.node)).map(f => f.node.name), retained_target: tf.filter(f => f.node.is_joint && !usedJoints.has(f.node.id) && !is_volume_node(f.node)).map(f => f.node.name), warnings: [], scale: 1 }
  const plan: Plan = { source, target, mapping, options, sf, tf, pairs, supports: [], align: new Quaternion(), up: new Vector3(0, 1, 0), scale: 1, report }
  if (report.exact) {
    for (const i of indices) for (const track of source.clips[i].tracks) if (track.name.endsWith('.morphTargetInfluences')) {
      const from = sf.find(f => track.name.startsWith(f.node.object.uuid + '.'))!.node, to = target.nodes.get(mapping[from.id])!
      if (from.morph_weights?.length !== to.morph_weights?.length || JSON.stringify((from.object as Mesh).morphTargetDictionary) !== JSON.stringify((to.object as Mesh).morphTargetDictionary)) throw new Error('Не совпадают морфы у «' + from.name + '»')
    }
    return plan
  }
  if (!target.skeleton_count || !pairs.length) throw new Error('Нужно соответствие хотя бы одной кости готового рига')
  const animatedIds = new Set(indices.flatMap(i => source.clips[i].tracks.filter(t => /\.(quaternion|position|scale)$/.test(t.name)).map(t => t.name.slice(0, t.name.lastIndexOf('.')))))
  if (!pairs.some(pair => { for (let f: Frame | undefined = pair.from; f; f = f.parent) if (animatedIds.has(f.node.object.uuid)) return true; return false })) throw new Error('Укажите соответствие для движущихся костей')
  const sr = joint_roles(source), tr = joint_roles(target)
  const sourcePairs = new Map(pairs.map(p => [p.from.node.id, p]))
  for (const pair of pairs) for (let p = pair.from.parent; p; p = p.parent) {
    const matched = sourcePairs.get(p.node.id); if (!matched) continue
    if (!is_ancestor(target, matched.to.node.id, pair.to.node.id)) {
      const a = sr.get(pair.from.node.id), b = tr.get(pair.to.node.id), pa = sr.get(matched.from.node.id), pb = tr.get(matched.to.node.id)
      // A baked IK rig may put a skinned foot/hand directly under the root.
      // Follow its anatomical limb in virtual FK, retaining native hierarchy.
      const terminal = a?.slot === BoneSlot.Foot && pa?.slot === BoneSlot.Calf || a?.slot === BoneSlot.Hand && pa?.slot === BoneSlot.LowerArm
      const sameLimb = terminal && a && b && pa && pb && a.slot === b.slot && pa.slot === pb.slot && a.side === b.side && a.side === pa.side && a.side === pb.side && a.chain === b.chain && a.chain === pa.chain && a.chain === pb.chain
      if (!sameLimb || is_ancestor(target, pair.to.node.id, matched.to.node.id)) throw new Error('Проверьте цепочку «' + pair.from.node.name + '»: родитель назначен другой конечности')
      pair.attachment = { parent: matched.to, offset: pair.to.wp.clone().sub(matched.to.wp).applyQuaternion(matched.to.wq.clone().invert()).divide(matched.to.ws) }
    }
    break
  }
  for (const fs of [sf, tf]) {
    const affecting = new Set<Frame>()
    for (const f of fs) if (f.node.is_joint) for (let p: Frame | undefined = f; p; p = p.parent) affecting.add(p)
    for (const f of affecting) {
      const min = Math.min(f.ws.x, f.ws.y, f.ws.z), max = Math.max(f.ws.x, f.ws.y, f.ws.z)
      if (!Number.isFinite(max) || min <= 0 || max - min > 1e-4 * max) throw new Error('У скелета неравномерный или отрицательный масштаб. Примените масштаб до переноса.')
    }
  }
  const sb = body_basis(sf, sr), tb = body_basis(tf, tr)
  if (sb && tb) { plan.align.copy(tb).multiply(sb.invert()); plan.up.applyQuaternion(tb) }
  plan.scale = motion_scale(sf, tf, sr, tr, pairs); report.scale = plan.scale
  if (!Number.isFinite(plan.scale) || plan.scale < 0.0001 || plan.scale > 10000) throw new Error('Не удалось сопоставить размеры скелетов')
  if (options.deformation) {
    // Squash/stretch uses local axes, so it is only well-defined for matching
    // joint chains. Never guess how an X scale belongs on a differently aimed Y.
    const bySource = new Map(pairs.map(p => [p.from.node.object.uuid, p]))
    for (const pair of pairs) {
      const sp = pair.from.parent, tp = pair.to.parent
      if ((sp?.node.is_joint || tp?.node.is_joint) && (!sp || !tp || mapping[sp.node.id] !== tp.node.id) || pair.attachment || pair.from.node.rotation.clone().normalize().angleTo(pair.to.node.rotation.clone().normalize()) > .001) {
        throw new Error('Деформация требует одинаковых цепочек и локальных осей: ' + pair.from.node.name + '. Используйте обычный перенос или исправьте соответствия.')
      }
    }
    for (const i of indices) for (const track of source.clips[i].tracks) {
      if (!/\.(position|quaternion|scale)$/.test(track.name) || !has_motion(track)) continue
      if (!bySource.has(track.name.slice(0, track.name.lastIndexOf('.')))) throw new Error('Для деформации сопоставьте движущуюся кость: ' + (sf.find(f => track.name.startsWith(f.node.object.uuid + '.'))?.node.name ?? track.name))
    }
    report.warnings.push('Деформация включена: переносятся локальные смещения и масштаб костей. Проверьте сжатие и прыжок в предпросмотре.')
  }
  for (const pair of pairs) {
    const role = sr.get(pair.from.node.id)
    pair.translate = role?.slot === BoneSlot.Pelvis || role?.slot === 'root' || !pairs.some(p => is_ancestor(source, p.from.node.id, pair.from.node.id))
    // Calibrate the anatomical direction, keeping all original local axes/bind data.
    if (!options.deformation && options.match_pose !== false && role && !role.leaf && role.slot !== 'root' && role.slot !== BoneSlot.Pelvis && role.slot !== BoneSlot.Unknown) {
      const children = pairs.filter(p => p !== pair && is_ancestor(source, pair.from.node.id, p.from.node.id) && (is_ancestor(target, pair.to.node.id, p.to.node.id) || p.attachment?.parent === pair.to) && p.from.wp.distanceToSquared(pair.from.wp) > EPS && p.to.wp.distanceToSquared(pair.to.wp) > EPS)
      children.sort((a, b) => a.from.wp.distanceToSquared(pair.from.wp) - b.from.wp.distanceToSquared(pair.from.wp))
      const child = children[0]
      if (child) pair.correction.setFromUnitVectors(child.to.wp.clone().sub(pair.to.wp).normalize(), child.from.wp.clone().sub(pair.from.wp).applyQuaternion(plan.align).normalize())
    }
  }
  for (const frame of tf.filter(f => is_volume_node(f.node))) {
    const name = frame.node.object.userData.rigJointVolume?.source ?? frame.node.name.replace(/^rig_volume_/, '')
    let child = tf.find(f => f.node.name === name && f.parent === frame.parent)
    if (!child) {
      const parsed = parse_bone_name(name), slot = resolve_slot(parsed, parsed.side), matches = tf.filter(f => !is_volume_node(f.node) && f.parent === frame.parent && tr.get(f.node.id)?.slot === slot && tr.get(f.node.id)?.side === parsed.side)
      if (matches.length === 1) child = matches[0]
    }
    if (child) plan.supports.push({ frame, child }); else report.warnings.push('Не найден сустав для поддержки объёма: ' + frame.node.name)
  }
  let transforms = 0, scales = 0, morphs = 0, translations = 0
  const byUuid = new Map(sf.map(f => [f.node.object.uuid, f]))
  for (const i of indices) {
    transforms += sample_times(source.clips[i]).length * (pairs.length + plan.supports.length)
    for (const track of source.clips[i].tracks) {
      const prop = track.name.slice(track.name.lastIndexOf('.') + 1), f = byUuid.get(track.name.slice(0, track.name.lastIndexOf('.')))
      if (prop === 'scale' && has_motion(track)) scales++
      if (prop === 'morphTargetInfluences' && has_motion(track)) morphs++
      if (prop === 'position' && f?.node.is_joint && !pairs.find(p => p.from === f)?.translate && has_motion(track)) translations++
    }
  }
  if (transforms > MAX_TRANSFORM_KEYS) throw new Error('Выбрано слишком много движений для одного переноса. Добавляйте их небольшими группами.')
  if (scales && !options.deformation) report.warnings.push('Изменение масштаба из источника не переносится. Для слаймов с совместимыми цепочками включите «Деформация».')
  if (morphs) report.warnings.push('Морфы разных моделей не переносятся.')
  if (translations && !options.deformation) report.warnings.push('Положения костей конечностей сохраняются; переносится движение корня и таза.')
  if (pairs.some(p => p.attachment)) report.warnings.push('Отдельные кисти или стопы следуют своей конечности; исходная иерархия сохраняется.')
  if (report.skipped_source.length) report.warnings.push('Без соответствия в источнике: ' + report.skipped_source.length + '. Их движение учитывается у сопоставленных потомков.')
  return plan
}
export function inspect_transfer (source: RigAsset, target: RigAsset, mapping: RigMapping, indices: number[], options: TransferOptions = {}): TransferReport { return plan_transfer(source, target, mapping, indices, options).report }
function bake_clip (plan: Plan, index: number): AnimationClip {
  const { source, target, sf, tf, pairs, supports, align, scale, options } = plan
  const original = options.skip_first_frame && source.motion_info?.format === 'bvh' ? skip_first_sample(source.clips[index]) : source.clips[index]
  if (plan.report.exact) {
    const clip = original.clone(), byUuid = new Map([...source.nodes.values()].map(n => [n.object.uuid, n]))
    clip.tracks.forEach(track => { const dot = track.name.lastIndexOf('.'), node = byUuid.get(track.name.slice(0, dot))!; track.name = target.nodes.get(plan.mapping[node.id])!.object.uuid + track.name.slice(dot) }); return clip
  }
  sf.forEach(f => { reset_frame(f); update_world(f) }); tf.forEach(f => { reset_frame(f); update_world(f) })
  const restS = new Map(sf.map(f => [f, { p: f.wp.clone(), inverseQ: f.wq.clone().invert() }])), restT = new Map(tf.map(f => [f, { p: f.wp.clone(), q: f.wq.clone() }])), byUuid = new Map(sf.map(f => [f.node.object.uuid, f]))
  const samplers = original.tracks.flatMap(track => {
    const dot = track.name.lastIndexOf('.'), prop = track.name.slice(dot + 1), f = byUuid.get(track.name.slice(0, dot))
    return f && ['position', 'quaternion', ...(options.deformation ? ['scale'] : [])].includes(prop) ? [{ f, prop, interpolant: (track as SampleTrack).createInterpolant() }] : []
  })
  const times = sample_times(original), byTarget = new Map(pairs.map(p => [p.to, p])), data = new Map<Frame, { q: number[], p: number[], s: number[], previous: Quaternion }>()
  for (const f of [...pairs.map(p => p.to), ...supports.map(p => p.frame)]) data.set(f, { q: [], p: [], s: [], previous: new Quaternion() })
  const inverseAlign = align.clone().invert(), desired = new Quaternion(), inverseParent = new Quaternion(), worldP = new Vector3(), delta = new Vector3()
  const sample = (time: number): void => {
    sf.forEach(reset_frame)
    for (const sampler of samplers) {
      const values = sampler.interpolant.evaluate(time)
      if (sampler.prop === 'quaternion') sampler.f.q.fromArray(values).normalize()
      else if (sampler.prop === 'scale') {
        if ([...values].some(v => !Number.isFinite(v) || v <= 0)) throw new Error('Нулевой или отрицательный масштаб в движении: ' + sampler.f.node.name)
        sampler.f.s.fromArray(values)
      } else sampler.f.p.fromArray(values)
    }
    sf.forEach(update_world)
  }
  const origin = new Vector3()
  if (options.anchor_motion !== false) {
    sample(0)
    const reference = pairs.find(pair => pair.translate)
    if (reference) {
      origin.copy(reference.from.wp).sub(restS.get(reference.from)!.p).applyQuaternion(align).multiplyScalar(scale)
      origin.addScaledVector(plan.up, -origin.dot(plan.up))
      const roles = joint_roles(source), feet = sf.filter(f => [BoneSlot.Foot, BoneSlot.Ball].includes(roles.get(f.node.id)?.slot as BoneSlot))
      if (feet.length) {
        const initial = Math.min(...feet.map(f => f.wp.clone().applyQuaternion(align).dot(plan.up)))
        const rest = Math.min(...feet.map(f => restS.get(f)!.p.clone().applyQuaternion(align).dot(plan.up)))
        origin.addScaledVector(plan.up, (initial - rest) * scale)
      }
    }
  }
  for (const time of times) {
    sample(time)
    for (const f of tf) {
      reset_frame(f); const pair = byTarget.get(f)
      if (pair) {
        desired.copy(align).multiply(pair.from.wq).multiply(restS.get(pair.from)!.inverseQ).multiply(inverseAlign).multiply(pair.correction).multiply(restT.get(f)!.q)
        inverseParent.copy(f.parent?.wq ?? f.baseQ).invert(); f.q.copy(inverseParent).multiply(desired).normalize()
        if (options.deformation) {
          f.s.copy(pair.from.s).divide(pair.from.node.scale).multiply(f.node.scale)
          if (!pair.translate) {
            const a = pair.from.node.position.length(), b = f.node.position.length()
            f.p.copy(pair.from.p).sub(pair.from.node.position).multiplyScalar(a > EPS && b > EPS ? b / a : scale).add(f.node.position)
          }
        }
        if (pair.translate) {
          delta.copy(pair.from.wp).sub(restS.get(pair.from)!.p).applyQuaternion(align).multiplyScalar(scale).sub(origin)
          if (options.in_place) { const vertical = delta.dot(plan.up); delta.copy(plan.up).multiplyScalar(vertical) }
          worldP.copy(restT.get(f)!.p).add(delta); f.p.copy(worldP).sub(f.parent?.wp ?? f.baseP).applyQuaternion(inverseParent).divide(f.parent?.ws ?? f.baseS)
        }
      }
      update_world(f)
    }
    // Detached end joints may occur before their limb in the real node order.
    for (const f of tf) {
      const attachment = byTarget.get(f)?.attachment
      if (attachment) {
        worldP.copy(attachment.offset).multiply(attachment.parent.ws).applyQuaternion(attachment.parent.wq).add(attachment.parent.wp)
        f.p.copy(worldP).sub(f.parent?.wp ?? f.baseP).applyQuaternion(inverseParent.copy(f.parent?.wq ?? f.baseQ).invert()).divide(f.parent?.ws ?? f.baseS)
      }
      update_world(f)
    }
    for (const { frame, child } of supports) frame.q.copy(child.node.rotation).slerp(child.q, 0.5).multiply(child.node.rotation.clone().invert()).multiply(frame.node.rotation).normalize()
    for (const [f, values] of data) {
      if (values.q.length && values.previous.dot(f.q) < 0) f.q.set(-f.q.x, -f.q.y, -f.q.z, -f.q.w)
      values.q.push(f.q.x, f.q.y, f.q.z, f.q.w); values.previous.copy(f.q)
      if (byTarget.get(f)?.translate || byTarget.get(f)?.attachment || options.deformation && byTarget.has(f)) values.p.push(f.p.x, f.p.y, f.p.z)
      if (options.deformation && byTarget.has(f)) values.s.push(f.s.x, f.s.y, f.s.z)
    }
  }
  const tracks: KeyframeTrack[] = []
  for (const [f, values] of data) { tracks.push(new QuaternionKeyframeTrack(f.node.object.uuid + '.quaternion', times, values.q)); if (values.p.length) tracks.push(new VectorKeyframeTrack(f.node.object.uuid + '.position', times, values.p)); if (values.s.length) tracks.push(new VectorKeyframeTrack(f.node.object.uuid + '.scale', times, values.s)) }
  return new AnimationClip(original.name, original.duration, tracks).optimize()
}
// BVH has one shared, dense sampling grid. Keep the saved document untouched.
function skip_first_sample (original: AnimationClip): AnimationClip {
  const second = original.tracks.find(t => t.times.length > 1)?.times[1]
  if (!second || second >= original.duration) return original
  const clip = original.clone()
  for (const track of clip.tracks) {
    if (track.times.length === 1) { track.times[0] = 0; continue }
    const width = track.getValueSize(); let first = 0
    while (first < track.times.length - 1 && track.times[first] < second) first++
    track.times = track.times.slice(first).map(t => Math.max(0, t - second))
    track.values = track.values.slice(first * width)
  }
  clip.duration = original.duration - second
  return clip
}
function unique_name (clip: AnimationClip, names: Set<string>): void { const base = clip.name || 'Движение'; let name = base; for (let n = 2; names.has(name); n++) name = base + ' (' + n + ')'; clip.name = name; names.add(name) }
export function transfer_clips (source: RigAsset, target: RigAsset, mapping: RigMapping, indices: number[], options: TransferOptions = {}): AnimationClip[] {
  const plan = plan_transfer(source, target, mapping, indices, options), names = new Set(target.clips.map(c => c.name))
  return indices.map(index => { const clip = bake_clip(plan, index); unique_name(clip, names); return clip })
}
export async function transfer_clips_async (source: RigAsset, target: RigAsset, mapping: RigMapping, indices: number[], options: TransferOptions = {}, progress: (done: number, total: number) => void = () => {}, signal?: AbortSignal): Promise<AnimationClip[]> {
  const plan = plan_transfer(source, target, mapping, indices, options), names = new Set(target.clips.map(c => c.name)), clips: AnimationClip[] = []
  for (const index of indices) { if (signal?.aborted) throw new Error('Перенос отменён'); progress(clips.length, indices.length); await new Promise(resolve => setTimeout(resolve, 0)); const clip = bake_clip(plan, index); unique_name(clip, names); clips.push(clip) }
  progress(clips.length, indices.length); return clips
}
