import { AnimationClip, Bone, Group, Object3D, PropertyBinding, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type InterpolationModes, type KeyframeTrack } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { build_rig_asset, type RigAsset } from './RigAsset.ts'
import { dedupe_identical_keys } from './RigTrackSanitizer.ts'

export type MotionFormat = 'bvh' | 'fbx'
export interface MotionNode { name: string, parent: number, joint: boolean, position: number[], rotation: number[], scale: number[] }
export interface MotionTrack { node: number, property: 'position' | 'quaternion' | 'scale', interpolation: number, times: Float32Array, values: Float32Array }
export interface MotionClip { name: string, duration: number, tracks: MotionTrack[] }
export interface MotionDocument { version: 1, format: MotionFormat, name: string, nodes: MotionNode[], clips: MotionClip[], calibration_frame?: number, warnings: string[] }
export const MAX_MOTION_VALUES = 12_000_000

export function document_bytes (doc: MotionDocument): number {
  const buffers = new Set<ArrayBufferLike>()
  for (const clip of doc.clips) for (const track of clip.tracks) { buffers.add(track.times.buffer); buffers.add(track.values.buffer) }
  return [...buffers].reduce((sum, b) => sum + b.byteLength, 0) + JSON.stringify(doc.nodes).length * 2
}

export function validate_motion_document (doc: MotionDocument): void {
  if (doc.version !== 1 || !doc.nodes.length || doc.nodes.length > 4096 || !doc.nodes.some(n => n.joint)) throw new Error('В источнике не найден подходящий скелет')
  if (!doc.clips.length || doc.clips.length > 256) throw new Error('В файле должно быть от 1 до 256 движений')
  doc.nodes.forEach((node, index) => {
    if (!Number.isInteger(node.parent) || node.parent < -1 || node.parent >= index || node.position.length !== 3 || node.rotation.length !== 4 || node.scale.length !== 3 || ![...node.position, ...node.rotation, ...node.scale].every(Number.isFinite)) throw new Error('Повреждена иерархия источника')
    let depth = 0
    for (let p = node.parent; p >= 0; p = doc.nodes[p].parent) if (++depth > 128) throw new Error('Слишком глубокая иерархия')
  })
  let values = 0
  for (const clip of doc.clips) {
    if (!Number.isFinite(clip.duration) || clip.duration < 0 || clip.duration > 600 || !clip.tracks.length) throw new Error('Поддерживаются движения длительностью до 10 минут')
    const bindings = new Set<string>()
    for (const track of clip.tracks) {
      const width = track.property === 'quaternion' ? 4 : 3, binding = track.node + ':' + track.property
      if (!doc.nodes[track.node] || !['position', 'quaternion', 'scale'].includes(track.property) || bindings.has(binding)) throw new Error('Неоднозначная дорожка источника')
      bindings.add(binding); values += track.values.length + track.times.length
      if (values > MAX_MOTION_VALUES || !track.times.length || track.values.length !== track.times.length * width) throw new Error('Слишком много или некорректные ключи в одном файле')
      for (let i = 0; i < track.times.length; i++) if (!Number.isFinite(track.times[i]) || track.times[i] < 0 || track.times[i] > clip.duration + 1e-4 || i > 0 && track.times[i] <= track.times[i - 1]) throw new Error('Повреждён порядок ключей')
      if (!track.values.every(Number.isFinite)) throw new Error('Некорректные координаты в движении')
      if (track.property === 'quaternion') for (let i = 0; i < track.values.length; i += 4) if (Math.hypot(...track.values.subarray(i, i + 4)) < 1e-8) throw new Error('Нулевое вращение в движении')
    }
  }
}

export function asset_from_motion (doc: MotionDocument): RigAsset {
  validate_motion_document(doc)
  const scene = new Group(), objects = doc.nodes.map(n => { const o = n.joint ? new Bone() : new Group(); o.name = n.name; o.position.fromArray(n.position); o.quaternion.fromArray(n.rotation); o.scale.fromArray(n.scale); return o })
  doc.nodes.forEach((n, i) => (n.parent < 0 ? scene : objects[n.parent]).add(objects[i]))
  const animations = doc.clips.map(clip => new AnimationClip(clip.name, clip.duration, clip.tracks.map(track => {
    const name = objects[track.node].uuid + '.' + track.property
    return track.property === 'quaternion' ? new QuaternionKeyframeTrack(name, track.times, track.values, track.interpolation as InterpolationModes) : new VectorKeyframeTrack(name, track.times, track.values, track.interpolation as InterpolationModes)
  })))
  const associations = new Map(objects.map((o, i) => [o, { nodes: i }]))
  const asset = build_rig_asset({ scene, animations, parser: { associations } } as unknown as GLTF,
    { asset: { version: '2.0' }, nodes: doc.nodes.map(n => ({ name: n.name })), skins: [{ joints: doc.nodes.map((n, i) => n.joint ? i : -1).filter(i => i >= 0) }] }, new ArrayBuffer(0), doc.name)
  asset.skeleton_count = 1
  asset.motion_info = { format: doc.format, calibration_frame: doc.calibration_frame, warnings: doc.warnings }
  return asset
}

export function document_from_fbx_scene (scene: Group, name: string): MotionDocument {
  scene.updateWorldMatrix(true, true)
  // Shared FBX joints may be emitted as identity leaf aliases for a second
  // skinned mesh. Match numeric IDs and identity transforms, never names alone.
  const aliases = new Set<Object3D>()
  scene.traverse(object => {
    const joint = object as Bone & { ID?: number }, parent = object.parent as (Bone & { ID?: number }) | null
    if (joint.isBone && parent?.isBone && Number.isSafeInteger(joint.ID) && joint.ID === parent.ID && joint.name === parent.name && !joint.children.length && joint.position.lengthSq() < 1e-16 && joint.quaternion.clone().normalize().angleTo(new Quaternion()) < 1e-7 && joint.scale.distanceToSquared(new Vector3(1,1,1)) < 1e-16) aliases.add(joint)
  })
  const kept = new Set<Object3D>()
  scene.traverse(object => { if ((object as Bone).isBone && !aliases.has(object)) for (let p: Object3D | null = object; p; p = p.parent) { kept.add(p); if (p === scene) break } })
  const objects: Object3D[] = []; scene.traverse(o => { if (kept.has(o)) objects.push(o) })
  const ids = new Map(objects.map((o, i) => [o, i])), names = new Map<string, number>()
  scene.traverse(o => { if (!aliases.has(o)) names.set(o.name, (names.get(o.name) ?? 0) + 1) })
  let skipped = 0
  const clips = scene.animations.map(original => {
    const tracks: MotionTrack[] = []
    for (const raw of original.tracks) {
      const parsed = PropertyBinding.parseTrackName(raw.name), object = PropertyBinding.findNode(scene, parsed.nodeName) as Object3D | null
      if (!object || !ids.has(object) || !['position', 'quaternion', 'scale'].includes(parsed.propertyName)) { skipped++; continue }
      if (parsed.objectName || parsed.propertyIndex !== undefined || parsed.nodeName !== object.uuid && (names.get(parsed.nodeName) ?? 0) > 1) throw new Error('В FBX неоднозначное имя кости: ' + parsed.nodeName)
      const track = raw.clone(); dedupe_identical_keys(track)
      tracks.push({ node: ids.get(object)!, property: parsed.propertyName as MotionTrack['property'], interpolation: track.getInterpolation(), times: track.times as Float32Array, values: track.values as Float32Array })
    }
    return { name: original.name || name, duration: original.duration, tracks }
  }).filter(c => c.tracks.length)
  const doc: MotionDocument = { version: 1, format: 'fbx', name, nodes: objects.map(o => ({ name: o.name || 'Узел', parent: o.parent ? ids.get(o.parent) ?? -1 : -1, joint: (o as Bone).isBone === true, position: o.position.toArray(), rotation: o.quaternion.toArray(), scale: o.scale.toArray() })), clips, warnings: skipped ? ['Нескелетных дорожек пропущено: ' + skipped + '.'] : [] }
  if (aliases.size) doc.warnings.push('Объединены служебные копии одной FBX-кости: ' + aliases.size + '.')
  validate_motion_document(doc); return doc
}

export function detect_calibration_frame (doc: MotionDocument): number | undefined {
  if (doc.format !== 'bvh' || !['LHipJoint', 'LowerBack', 'Neck1'].every(name => doc.nodes.some(n => n.name === name))) return
  const tracks = doc.clips[0].tracks.filter(t => t.property === 'quaternion' && t.times.length >= 3)
  if (!tracks.length) return
  const q = new Quaternion(), p = new Quaternion(); let first = 0, next = 0, identity = 0
  for (const t of tracks) {
    q.fromArray(t.values, 0); p.fromArray(t.values, 4); first = Math.max(first, q.angleTo(p)); q.fromArray(t.values, 8); next = Math.max(next, q.angleTo(p))
    if (Math.abs(t.values[3]) > .99999) identity++
  }
  const root = doc.clips[0].tracks.find(t => t.node === 0 && t.property === 'position')
  if (!root || root.times.length < 3 || [0,1,2].some(i => Math.abs(root.values[i] - root.values[3 + i]) > 1e-5)) return
  if (identity >= tracks.length / 2 && first > .8 && next < first / 5) return tracks[0].times[1]
}
