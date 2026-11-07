import { AnimationClip, Bone, Euler, Object3D, PropertyBinding, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'

export interface LocalPose { position: Vector3, quaternion: Quaternion, scale: Vector3 }
interface Offset { rotation: Quaternion, position: Vector3 }
interface Decorated { original: AnimationClip, apply: (clip: AnimationClip) => void }
const decorated = new WeakMap<AnimationClip, Decorated>()
const export_poses = new WeakMap<Object3D, LocalPose>()
const local = (o: Object3D): LocalPose => ({ position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() })
const copy_pose = (o: Object3D, p: LocalPose): void => { o.position.copy(p.position); o.quaternion.copy(p.quaternion); o.scale.copy(p.scale); o.updateMatrix() }
const copy_offsets = (map: Map<string, Offset>): Map<string, Offset> => new Map([...map].map(([id, p]) => [id, { rotation: p.rotation.clone(), position: p.position.clone() }]))

export function restore_calibrated_export_pose(source: Object3D, target: Object3D): boolean {
  const pose = export_poses.get(source); if (!pose) return false; copy_pose(target, pose); return true
}
export function clip_pose_calibration(clip: AnimationClip): Decorated | undefined { return decorated.get(clip) }
export function copy_clip_pose_calibration(from: AnimationClip, to: AnimationClip): void { const value = decorated.get(from); if (value) decorated.set(to, value) }

/** A local-pose calibration, independent of skin weights and inverse bind matrices. */
export class PoseCalibration {
  readonly bones: Bone[]
  readonly bind = new Map<string, LocalPose>()
  private readonly reference = new Map<string, LocalPose>()
  private readonly by_alias = new Map<string, Bone | null>()
  private committed = new Map<string, Offset>()
  private working = new Map<string, Offset>()
  get has_changes(): boolean { return this.committed.size > 0 }
  revision = 0
  reference_name = 'Поза привязки'
  editing = false

  constructor(bones: Bone[]) {
    this.bones = [...new Set(bones)]
    for (const bone of this.bones) {
      this.bind.set(bone.uuid, local(bone)); this.reference.set(bone.uuid, local(bone)); this.by_alias.set(bone.uuid, bone)
      if (bone.name) this.by_alias.set(bone.name, this.by_alias.has(bone.name) ? null : bone)
    }
  }
  private bone(track: string): Bone | undefined {
    try { const p = PropertyBinding.parseTrackName(track); return this.by_alias.get(String(p.objectName === 'bones' ? p.objectIndex : p.nodeName)) ?? undefined } catch { return }
  }
  set_reference_clip(clip?: AnimationClip): void {
    if (!clip || this.committed.size || this.editing) return
    for (const track of clip.tracks) {
      const bone = this.bone(track.name), pose = bone && this.reference.get(bone.uuid); if (!pose) continue
      const interpolation = (track as unknown as { createInterpolant(): { evaluate(t: number): ArrayLike<number> } }).createInterpolant()
      const value = interpolation.evaluate(0)
      if (track.name.endsWith('.quaternion') && value.length === 4) pose.quaternion.fromArray(Array.from(value)).normalize()
      if (track.name.endsWith('.position') && value.length === 3) pose.position.fromArray(Array.from(value))
    }
    this.reference_name = clip.name || 'Исходная поза'
  }
  begin(): void { this.working = copy_offsets(this.committed); this.editing = true; this.preview() }
  cancel(): void { this.working = copy_offsets(this.committed); this.editing = false; this.restore_bind() }
  commit(): void {
    this.committed = copy_offsets(this.working); this.editing = false; this.revision++
    for (const bone of this.bones) {
      if (this.committed.size) export_poses.set(bone, this.desired(bone, this.committed)); else export_poses.delete(bone)
    }
    this.restore_bind()
  }
  reset_working(): void { this.working.clear(); this.preview() }
  restore_bind(): void { for (const bone of this.bones) copy_pose(bone, this.bind.get(bone.uuid)!); this.update_world() }
  private update_world(): void { const set = new Set(this.bones); for (const bone of this.bones) if (!set.has(bone.parent as Bone)) bone.updateWorldMatrix(true, true) }
  private desired(bone: Bone, offsets: Map<string, Offset>): LocalPose {
    const base = this.reference.get(bone.uuid)!, o = offsets.get(bone.uuid)
    return { position: base.position.clone().add(o?.position ?? new Vector3()), quaternion: o ? o.rotation.clone().multiply(base.quaternion).normalize() : base.quaternion.clone(), scale: base.scale.clone() }
  }
  neutral_pose(): Map<Bone, LocalPose> { return new Map(this.bones.map(bone => [bone, this.desired(bone, this.committed)])) }
  preview(): void { for (const bone of this.bones) copy_pose(bone, this.desired(bone, this.working)); this.update_world() }
  values(bone: Bone): { rotation: number[], position: number[] } {
    const o = this.working.get(bone.uuid), e = new Euler().setFromQuaternion(o?.rotation ?? new Quaternion(), 'XYZ')
    return { rotation: [e.x, e.y, e.z].map(v => v * 180 / Math.PI), position: (o?.position ?? new Vector3()).toArray() }
  }
  set(bone: Bone, rotation: number[], position: number[]): void {
    if (!this.bind.has(bone.uuid) || rotation.length !== 3 || position.length !== 3 || [...rotation, ...position].some(v => !Number.isFinite(v))) throw new Error('Неверная поза кости')
    const value = { rotation: new Quaternion().setFromEuler(new Euler(...rotation.map(v => v * Math.PI / 180) as [number, number, number], 'XYZ')), position: new Vector3().fromArray(position) }
    this.put(bone, value); this.preview()
  }
  private put(bone: Bone, value: Offset): void {
    const empty = value.position.lengthSq() < 1e-16 && value.rotation.angleTo(new Quaternion()) < 1e-8
    if (empty) this.working.delete(bone.uuid); else this.working.set(bone.uuid, value)
    for (const helper of this.bones) {
      if (helper.name !== 'rig_volume_' + bone.name || helper.parent !== bone.parent) continue
      if (empty) this.working.delete(helper.uuid); else this.working.set(helper.uuid, { rotation: value.rotation.clone(), position: value.position.clone() })
    }
  }
  /** CCD in parent space also handles transformed armature roots. */
  lower_to_floor(selected: Bone, floor: number): { error: number, tip: Bone } {
    if (!/(foot|toe|leaf|ankle|hoof|paw|leg)/i.test(selected.name)) throw new Error('Выберите кость лапы, стопы или копыта')
    if (!Number.isFinite(floor)) throw new Error('Неверная высота пола')
    let tip = selected
    for (let i = 0; i < 5; i++) {
      const children = tip.children.filter(o => (o as Bone).isBone && !o.name.startsWith('rig_volume_')) as Bone[]
      if (children.length !== 1 || !/(foot|toe|leaf|ankle|hoof|paw)/i.test(tip.name)) break
      tip = children[0]
    }
    const joints: Bone[] = []; let ancestor = tip.parent
    while (ancestor && (ancestor as Bone).isBone && joints.length < 5 && !/^(root|hips|pelvis|spine(?:_\d+)?|chest|neck)$/i.test(ancestor.name)) { joints.push(ancestor as Bone); ancestor = ancestor.parent }
    if (!joints.length) throw new Error('Выберите кость лапы, стопы или копыта')
    this.update_world(); const target = tip.getWorldPosition(new Vector3()); target.y = floor
    for (let iteration = 0; iteration < 96; iteration++) {
      if (tip.getWorldPosition(new Vector3()).distanceTo(target) < 0.00001) break
      for (const joint of joints) {
        const parent = joint.parent; if (!parent) continue
        parent.updateWorldMatrix(true, false)
        const from = parent.worldToLocal(tip.getWorldPosition(new Vector3())).sub(joint.position), to = parent.worldToLocal(target.clone()).sub(joint.position)
        if (from.lengthSq() < 1e-16 || to.lengthSq() < 1e-16) continue
        const delta = new Quaternion().setFromUnitVectors(from.normalize(), to.normalize()), angle = delta.angleTo(new Quaternion())
        if (angle > 0.25) delta.slerpQuaternions(new Quaternion(), delta, 0.25 / angle)
        joint.quaternion.premultiply(delta).normalize(); joint.updateWorldMatrix(true, true)
      }
    }
    for (const joint of joints) {
      const base = this.reference.get(joint.uuid)!
      this.put(joint, { rotation: joint.quaternion.clone().multiply(base.quaternion.clone().invert()).normalize(), position: joint.position.clone().sub(base.position) })
    }
    this.preview(); return { error: tip.getWorldPosition(new Vector3()).distanceTo(target), tip }
  }
  apply_clip(clip: AnimationClip, uuid_tracks = false): void {
    if (!this.committed.size) return
    const offsets = copy_offsets(this.committed), bases = new Map(this.reference), bind = new Map(this.bind), bones = this.bones.slice(), aliases = new Map(this.by_alias)
    const apply = (target: AnimationClip): void => {
      const original = target.clone(), covered = new Set<string>()
      for (const track of target.tracks) {
        let name: string, property: string
        try { const p = PropertyBinding.parseTrackName(track.name); name = String(p.objectName === 'bones' ? p.objectIndex : p.nodeName); property = p.propertyName } catch { continue }
        const bone = aliases.get(name); if (!bone) continue
        const o = offsets.get(bone.uuid)
        const width = property === 'quaternion' ? 4 : property === 'position' ? 3 : 0; if (!width) continue
        const cubic = track.values.length === track.times.length * width * 3
        covered.add(bone.uuid + ':' + property)
        if (!o) continue
        for (let at = 0; at < track.values.length; at += width) {
          if (property === 'quaternion') {
            const q = new Quaternion().fromArray(track.values, at).premultiply(o.rotation)
            if (!cubic || (at / 4) % 3 === 1) q.normalize()
            q.toArray(track.values, at)
          } else if (!cubic || (at / 3) % 3 === 1) {
            track.values[at] += o.position.x; track.values[at + 1] += o.position.y; track.values[at + 2] += o.position.z
          }
        }
      }
      for (const bone of bones) {
        const o = offsets.get(bone.uuid) ?? { rotation: new Quaternion(), position: new Vector3() }
        const base = bases.get(bone.uuid)!, old = bind.get(bone.uuid)!, alias = uuid_tracks ? bone.uuid : bone.name
        if (!covered.has(bone.uuid + ':quaternion') && (o.rotation.angleTo(new Quaternion()) > 1e-8 || base.quaternion.angleTo(old.quaternion) > 1e-8)) target.tracks.push(new QuaternionKeyframeTrack(alias + '.quaternion', [0], o.rotation.clone().multiply(base.quaternion).normalize().toArray()))
        if (!covered.has(bone.uuid + ':position') && (o.position.lengthSq() > 1e-16 || base.position.distanceToSquared(old.position) > 1e-16)) target.tracks.push(new VectorKeyframeTrack(alias + '.position', [0], base.position.clone().add(o.position).toArray()))
      }
      decorated.set(target, { original, apply })
    }
    const existing = decorated.get(clip); if (existing) clip.tracks = existing.original.tracks.map(track => track.clone())
    apply(clip)
  }
}
