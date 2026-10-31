import { AnimationClip, AnimationMixer, Bone, Box3, Group, LoopOnce, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type Mesh, type Object3D, type SkinnedMesh } from 'three'
import { load_rig_asset } from '../my-rigs/RigAssetLoader.ts'
import { dispose_rig_scene, restore_rig_pose, type RigAsset } from '../my-rigs/RigAsset.ts'
import { RigLibrary } from '../my-rigs/RigLibrary.ts'
import type { AnimalRigReference } from '../lib/processes/edit-skeleton/AnimalAutoFit.ts'

export interface PackRest { position: Vector3, quaternion: Quaternion, scale: Vector3, parent_name?: string }
export interface PackRigSource { armature: Group, clips: AnimationClip[], rest: Map<string, PackRest>, reference: AnimalRigReference }
const cache = new Map<string, Promise<PackRigSource>>()

export async function load_pack_rig (url: string): Promise<PackRigSource> {
  let promise = cache.get(url)
  if (!promise) {
    promise = (async () => {
      let bytes: ArrayBuffer
      if (url.startsWith('library-entry:')) bytes = await new RigLibrary().read(url.slice(14))
      else {
        const response = await fetch(new URL(url, new URL('/', location.href)))
        if (!response.ok) throw new Error('Набор скелета недоступен')
        bytes = await response.arrayBuffer()
      }
      const asset = await load_rig_asset(bytes, url)
      try { return await prepare_pack_rig(asset) } finally { dispose_rig_scene(asset.scene) }
    })()
    if (cache.size >= 2) cache.delete(cache.keys().next().value!)
    cache.set(url, promise)
  }
  try { return await promise } catch (error) { cache.delete(url); throw error }
}

export async function prepare_pack_rig (asset: RigAsset): Promise<PackRigSource> {
  restore_rig_pose(asset)
  const sets: Set<Bone>[] = [], weighted = new Set<Bone>()
  asset.scene.traverse(object => {
    const mesh = object as SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    sets.push(new Set(mesh.skeleton.bones))
    const weights = mesh.geometry.getAttribute('skinWeight'), indices = mesh.geometry.getAttribute('skinIndex')
    for (let i = 0; weights && indices && i < weights.count; i++) for (let j = 0; j < 4; j++) {
      if (weights.getComponent(i, j) > 1e-8) weighted.add(mesh.skeleton.bones[indices.getComponent(i, j)])
    }
  })
  if (!sets.length || !sets[0].size || sets[0].size > 256) throw new Error('Для подгонки нужен скелет от 1 до 256 костей')
  if (sets.some(set => set.size !== sets[0].size || [...set].some(bone => !sets[0].has(bone)))) {
    throw new Error('В файле несколько независимых скелетов. Откройте его в «Мои риги» или выделите один скелет в отдельный GLB.')
  }
  const nearest = (bone: Object3D): Bone | undefined => {
    for (let p = bone.parent; p; p = p.parent) if ((p as Bone).isBone) return p as Bone
  }
  const rootOf = (bone: Bone): Bone => { let p; while ((p = nearest(bone))) bone = p; return bone }
  const roots = new Set([...weighted].filter(Boolean).map(rootOf))
  const bones = [...sets[0]].filter(bone => roots.has(rootOf(bone)))
  if (!bones.length) throw new Error('В скелете нет костей с весами')
  const names = new Set<string>(['__pack_root'])
  for (const bone of bones) {
    if (!bone.name || /[.\[\]:/]/.test(bone.name) || names.has(bone.name)) throw new Error('Неоднозначное имя кости: ' + bone.name)
    names.add(bone.name)
  }
  const box = new Box3().setFromObject(asset.scene), height = box.max.y - box.min.y
  if (!Number.isFinite(height) || height < 1e-8) throw new Error('Не удалось определить размер исходного рига')
  const factor = 2 / height, center = box.getCenter(new Vector3())
  const normalize = new Matrix4().makeScale(factor, factor, factor).multiply(new Matrix4().makeTranslation(-center.x, -box.min.y, -center.z))
  const transforms = (bone: Bone): PackRest => {
    const parent = nearest(bone)
    const matrix = parent && bones.includes(parent) ? parent.matrixWorld.clone().invert().multiply(bone.matrixWorld) : normalize.clone().multiply(bone.matrixWorld)
    const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3()
    matrix.decompose(position, quaternion, scale)
    if (parent && bones.includes(parent)) position.multiplyScalar(factor)
    else scale.divideScalar(factor)
    if (![...position.toArray(), ...quaternion.toArray(), ...scale.toArray()].every(Number.isFinite)) throw new Error('Некорректный трансформ кости')
    return { position, quaternion: quaternion.normalize(), scale, parent_name: parent?.name }
  }
  const armature = new Group(), copies = new Map<Bone, Bone>(), rest = new Map<string, PackRest>()
  for (const bone of bones) {
    const copy = new Bone(), pose = transforms(bone)
    copy.name = bone.name; copy.position.copy(pose.position); copy.quaternion.copy(pose.quaternion); copy.scale.copy(pose.scale)
    copy.userData.rigNonDeforming = !weighted.has(bone)
    copies.set(bone, copy); rest.set(copy.name, pose)
  }
  const root = roots.size > 1 ? new Bone() : armature
  if (root !== armature) { root.name = '__pack_root'; root.userData.rigNonDeforming = true; armature.add(root) }
  for (const [bone, copy] of copies) (copies.get(nearest(bone)!) ?? root).add(copy)
  armature.updateMatrixWorld(true)
  const reference: AnimalRigReference = { points: [], joints: new Map() }
  for (const copy of copies.values()) reference.joints.set(copy.name, { position: copy.getWorldPosition(new Vector3()), rotation: copy.getWorldQuaternion(new Quaternion()) })
  asset.scene.traverse(object => {
    const mesh = object as Mesh, attribute = mesh.geometry?.getAttribute('position')
    if (!mesh.isMesh || !attribute) return
    for (let i = 0, step = Math.max(1, Math.ceil(attribute.count / 7000)); i < attribute.count; i += step) {
      reference.points.push(mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(normalize))
    }
  })
  const clips: AnimationClip[] = [], mixer = new AnimationMixer(asset.scene)
  try {
    for (const clip of asset.clips) {
      restore_rig_pose(asset)
      const keys = new Set<number>([0, clip.duration])
      for (const track of clip.tracks) for (const time of track.times) keys.add(time)
      if (clip.duration * 30 > 18000) throw new Error('Слишком длинная анимация для подгонки')
      for (let frame = 0; frame <= Math.ceil(clip.duration * 30); frame++) keys.add(Math.min(frame / 30, clip.duration))
      const times = [...keys].sort((a, b) => a - b)
      if (times.length * bones.length > 2_000_000) throw new Error('Слишком много ключей анимации')
      const data = bones.map(() => ({ p: [] as number[], q: [] as number[], s: [] as number[], previous: new Quaternion() }))
      const action = mixer.clipAction(clip); action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play()
      for (const time of times) {
        mixer.setTime(time); asset.scene.updateMatrixWorld(true)
        bones.forEach((bone, index) => {
          const pose = transforms(bone), values = data[index]
          if (values.q.length && values.previous.dot(pose.quaternion) < 0) pose.quaternion.set(-pose.quaternion.x, -pose.quaternion.y, -pose.quaternion.z, -pose.quaternion.w)
          values.p.push(...pose.position.toArray()); values.q.push(...pose.quaternion.toArray()); values.s.push(...pose.scale.toArray()); values.previous.copy(pose.quaternion)
        })
      }
      action.stop(); mixer.uncacheClip(clip)
      const tracks = bones.flatMap((bone, i) => [new VectorKeyframeTrack(bone.name + '.position', times, data[i].p), new QuaternionKeyframeTrack(bone.name + '.quaternion', times, data[i].q), new VectorKeyframeTrack(bone.name + '.scale', times, data[i].s)])
      clips.push(new AnimationClip(clip.name, clip.duration, tracks).optimize())
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  } finally { mixer.stopAllAction(); mixer.uncacheRoot(asset.scene); restore_rig_pose(asset) }
  return { armature, clips, rest, reference }
}
