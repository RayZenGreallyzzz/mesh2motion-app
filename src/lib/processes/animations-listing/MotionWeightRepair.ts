import {
  AnimationMixer, BufferAttribute, Float32BufferAttribute, LoopOnce,
  Matrix4, type AnimationClip, type BufferGeometry, type Object3D, type SkinnedMesh, Vector3
} from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { JointVolumeSupport } from '../../solvers/JointVolumeSupport.ts'
import { type MotionWeightInput, type MotionWeightStats } from '../../solvers/AnimationWeightRefiner.ts'
import { RigRestPoseSnapshot } from './RigRestPoseSnapshot.ts'

export interface WeightBackup {
  geometry: BufferGeometry
  weights: Float32Array
  attribute: ReturnType<BufferGeometry['getAttribute']>
  version: number
}

const attributeVersion = (attribute: ReturnType<BufferGeometry['getAttribute']>): number =>
  attribute instanceof BufferAttribute ? attribute.version : attribute.data.version

/** Sample a detached copy. Playback, source clips, transforms and texture data
 * remain live and unchanged. Bone inverses are a fallback for imported rigs;
 * app-generated rigs use their exact captured editable bind pose.
 */
export function motion_weight_input (
  meshes: SkinnedMesh[], clips: AnimationClip[], backups = new Map<SkinnedMesh, WeightBackup>(), locks: Array<Set<number>> = []
): MotionWeightInput {
  const first = meshes[0]
  if (!first || clips.length === 0 || clips.length > 8) throw new Error('Выберите от одного до восьми движений, включая зеркальные варианты.')
  if (meshes.some(mesh => mesh.skeleton !== first.skeleton)) throw new Error('Проверка доступна для частей с общим скелетом.')
  if (new Set(meshes.map(mesh => mesh.geometry)).size !== meshes.length) throw new Error('Части модели должны иметь отдельную геометрию.')
  if (meshes.some(mesh => mesh.morphTargetInfluences?.some(value => Math.abs(value) > 1e-7))) throw new Error('Сначала отключите активные морфы модели.')
  if (clips.some(clip => clip.tracks.some(track => track.name.includes('morphTargetInfluences')))) throw new Error('Проверка весов не поддерживает движения с анимацией морфов.')
  const descendants = new Set<Object3D>(); first.traverse(object => descendants.add(object))
  if (first.skeleton.bones.some(bone => !descendants.has(bone))) throw new Error('Скелет должен находиться внутри первой части модели.')
  first.updateWorldMatrix(true, true)
  const suffix = first.matrixWorld.clone().multiply(first.bindMatrixInverse)
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false)
    const other = mesh.matrixWorld.clone().multiply(mesh.bindMatrixInverse)
    if (other.elements.some((v, i) => Math.abs(v - suffix.elements[i]) > 1e-6)) throw new Error('Части модели имеют несовместимые привязки.')
  }
  const copy = clone(first) as SkinnedMesh
  copy.matrix.copy(first.matrixWorld); copy.matrixAutoUpdate = false
  const remembered = new Set<Object3D>()
  function restoreCopies (source: Object3D, target: Object3D): void {
    if (source !== first && RigRestPoseSnapshot.restore_copy_pose(source, target)) remembered.add(target)
    source.children.forEach((child, i) => restoreCopies(child, target.children[i]))
  }
  restoreCopies(first, copy)
  copy.updateMatrixWorld(true)
  const skeleton = copy.skeleton
  const parentFirst = [...skeleton.bones].sort((a, b) => {
    const depth = (o: Object3D): number => { let d = 0; for (let p = o.parent; p; p = p.parent) d++; return d }
    return depth(a) - depth(b)
  })
  for (const bone of parentFirst) {
    if (remembered.has(bone)) { bone.updateWorldMatrix(true, false); continue }
    const i = skeleton.bones.indexOf(bone)
    const world = skeleton.boneInverses[i].clone().invert()
    const local = bone.parent ? bone.parent.matrixWorld.clone().invert().multiply(world) : world
    local.decompose(bone.position, bone.quaternion, bone.scale)
    bone.updateMatrix(); bone.updateWorldMatrix(true, false)
  }
  const rest: Array<{ object: Object3D, matrix: Matrix4 }> = []
  copy.traverse(object => { if (object !== copy) rest.push({ object, matrix: object.matrix.clone() }) })
  const restore = (): void => {
    for (const { object, matrix } of rest) { matrix.decompose(object.position, object.quaternion, object.scale); object.updateMatrix() }
    copy.updateMatrixWorld(true)
  }
  const total = meshes.reduce((s, mesh) => s + mesh.geometry.getAttribute('position').count, 0)
  const positions = new Float32Array(total * 3), indices = new Uint16Array(total * 4), weights = new Float32Array(total * 4), locked = new Uint8Array(total)
  const triangleCount = meshes.reduce((s, mesh) => s + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count), 0)
  const triangles = new Uint32Array(triangleCount)
  const point = new Vector3(); let offset = 0, triangleOffset = 0
  meshes.forEach((mesh, part) => {
    const geometry = mesh.geometry, position = geometry.getAttribute('position'), ii = geometry.getAttribute('skinIndex'), ww = geometry.getAttribute('skinWeight')
    if (!ii || !ww || ii.itemSize !== 4 || ww.itemSize !== 4 || ii.count !== position.count || ww.count !== position.count) throw new Error('У модели нет корректных весов.')
    const source = backups.get(mesh)?.weights
    for (let v = 0; v < position.count; v++) {
      point.fromBufferAttribute(position, v).applyMatrix4(mesh.bindMatrix).toArray(positions, (offset + v) * 3)
      for (let k = 0; k < 4; k++) { indices[(offset + v) * 4 + k] = ii.getComponent(v, k); weights[(offset + v) * 4 + k] = source?.[v * 4 + k] ?? ww.getComponent(v, k) }
      if (locks[part]?.has(v)) locked[offset + v] = 1
    }
    const index = geometry.index
    const length = index?.count ?? position.count
    if (length % 3 !== 0) throw new Error('Геометрия должна состоять из треугольников.')
    for (let i = 0; i < length; i++) triangles[triangleOffset++] = offset + (index ? index.getX(i) : i)
    offset += position.count
  })
  const boneCount = skeleton.bones.length, groups: number[] = []
  const matrices = new Float32Array(clips.length * 5 * boneCount * 16)
  const matrix = new Matrix4(), common = new Matrix4()
  let pose = 0
  clips.forEach((source, group) => {
    restore()
    const clip = source.clone(); JointVolumeSupport.updateClip(clip, skeleton)
    const mixer = new AnimationMixer(copy), action = mixer.clipAction(clip)
    action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play()
    for (const fraction of [0, .25, .5, .75, .9999]) {
      mixer.setTime(Math.max(0, clip.duration) * fraction)
      copy.updateMatrixWorld(true)
      common.copy(copy.matrixWorld).multiply(copy.bindMatrixInverse)
      skeleton.bones.forEach((bone, b) => {
        matrix.copy(common).multiply(bone.matrixWorld).multiply(skeleton.boneInverses[b])
        matrix.toArray(matrices, (pose * boneCount + b) * 16)
      })
      groups.push(group); pose++
    }
    mixer.stopAllAction(); mixer.uncacheRoot(copy)
  })
  return { positions, triangles, indices, weights, matrices, boneCount, groups, locked }
}

interface RepairContext {
  meshes: () => SkinnedMesh[]
  clips: () => AnimationClip[]
  key: () => string
  locks?: () => Array<Set<number>>
  worker?: () => Worker
}

/** Owns originals, cancellation and atomic publication to preview/export. */
export class MotionWeightRepairControl {
  private readonly backups = new Map<SkinnedMesh, WeightBackup>()
  private generation = 0
  private pending?: { worker: Worker, reject: (reason: Error) => void, key: string }
  private applied = false
  private readonly applyButton = document.getElementById('motion-weight-repair') as HTMLButtonElement | null
  private readonly undoButton = document.getElementById('motion-weight-undo') as HTMLButtonElement | null
  private readonly status = document.getElementById('motion-weight-status')

  constructor (private readonly context: RepairContext) {
    this.applyButton?.addEventListener('click', () => { void this.apply() })
    this.undoButton?.addEventListener('click', () => { this.undo() })
  }

  private text (value: string): void { if (this.status) this.status.textContent = value }
  private buttons (): void {
    if (this.applyButton) this.applyButton.disabled = Boolean(this.pending)
    if (this.undoButton) this.undoButton.disabled = !this.pending && !this.applied
  }
  private cancel (): void {
    this.generation++
    if (this.pending) { const pending = this.pending; this.pending = undefined; pending.worker.terminate(); pending.reject(new Error('Проверка отменена.')) }
    this.buttons()
  }
  private validBackup (mesh: SkinnedMesh, backup: WeightBackup): boolean {
    const attribute = mesh.geometry.getAttribute('skinWeight')
    return mesh.geometry === backup.geometry && attribute === backup.attribute && attributeVersion(attribute) === backup.version
  }
  private restore (): boolean {
    let skipped = false
    for (const [mesh, backup] of this.backups) {
      // Never overwrite a new mesh, re-skin or an intervening manual edit.
      if (!this.validBackup(mesh, backup)) { skipped = true; continue }
      const attribute = mesh.geometry.getAttribute('skinWeight')
      for (let v = 0; v < attribute.count; v++) attribute.setXYZW(v, ...backup.weights.subarray(v * 4, v * 4 + 4) as unknown as [number, number, number, number])
      attribute.needsUpdate = true; backup.version = attributeVersion(attribute)
    }
    this.applied = false
    return !skipped
  }
  public undo (): void {
    this.cancel()
    this.text(this.restore() ? 'Восстановлены исходные веса.' : 'Последующие правки сохранены. Для изменённых частей автоматическая отмена недоступна.')
    this.buttons()
  }
  public reset (): void { this.cancel(); this.restore(); this.backups.clear(); this.text(''); this.buttons() }
  public invalidate (): void { this.reset() }
  public checkContext (): void {
    if (this.pending && this.context.key() !== this.pending.key) { this.cancel(); this.text('Модель или выбор изменены. Запустите проверку заново.') }
  }

  public async apply (): Promise<void> {
    this.cancel()
    const generation = this.generation
    try {
      const meshes = [...this.context.meshes()], clips = this.context.clips()
      if (this.backups.size && (meshes.length !== this.backups.size || meshes.some(mesh => !this.backups.has(mesh) || !this.validBackup(mesh, this.backups.get(mesh)!)))) {
        this.backups.clear(); this.applied = false
      }
      for (const mesh of meshes) if (!this.backups.has(mesh)) {
        const attribute = mesh.geometry.getAttribute('skinWeight')
        if (!attribute) throw new Error('У модели нет весов.')
        const weights = new Float32Array(attribute.count * 4)
        for (let v = 0; v < attribute.count; v++) for (let k = 0; k < 4; k++) weights[v * 4 + k] = attribute.getComponent(v, k)
        this.backups.set(mesh, { geometry: mesh.geometry, weights, attribute, version: attributeVersion(attribute) })
      }
      const key = this.context.key()
      this.text('Подготавливаю пять поз для каждого движения…')
      // Yield once so the preparation status is visible on tablets.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      if (generation !== this.generation || key !== this.context.key()) return
      const input = motion_weight_input(meshes, clips, this.backups, this.context.locks?.())
      const worker = this.context.worker?.() ?? new Worker(new URL('../../solvers/AnimationWeightWorker.ts', import.meta.url), { type: 'module' })
      const result = await new Promise<{ weights: Float32Array, stats: MotionWeightStats }>((resolve, reject) => {
        this.pending = { worker, reject, key }; this.buttons()
        worker.onmessage = event => {
          if (generation !== this.generation || this.context.key() !== key) { this.checkContext(); return }
          const data = event.data
          if (data.type === 'progress') this.text(`Проверка деформаций: ${Math.round(Math.max(0, Math.min(1, data.fraction)) * 100)}%`)
          else if (data.type === 'error') reject(new Error(data.message))
          else if (data.type === 'result') resolve(data)
        }
        worker.onerror = event => reject(new Error(event.message || 'Не удалось выполнить проверку.'))
        const transfer = [input.positions.buffer, input.triangles.buffer, input.indices.buffer, input.weights.buffer, input.matrices.buffer, input.locked!.buffer]
        worker.postMessage(input, transfer)
      })
      worker.terminate(); this.pending = undefined
      if (generation !== this.generation || key !== this.context.key()) return
      const expected = meshes.reduce((s, mesh) => s + mesh.geometry.getAttribute('position').count * 4, 0)
      if (!(result.weights instanceof Float32Array) || result.weights.length !== expected || !result.weights.every(value => Number.isFinite(value) && value >= 0)) throw new Error('Некорректный результат проверки.')
      for (let v = 0; v < expected; v += 4) if (Math.abs(result.weights[v] + result.weights[v + 1] + result.weights[v + 2] + result.weights[v + 3] - 1) > 1e-5) throw new Error('Некорректная сумма весов.')
      if (!result.stats.improved) {
        this.restore(); this.text('Безопасного улучшения для выбранных поз не найдено. Сохранены исходные веса.'); this.buttons(); return
      }
      // Validate everything before touching any shared geometry attribute.
      const attributes = meshes.map(mesh => new Float32BufferAttribute(new Float32Array(mesh.geometry.getAttribute('position').count * 4), 4))
      let offset = 0
      meshes.forEach((mesh, i) => {
        const attribute = attributes[i]; attribute.array.set(result.weights.subarray(offset, offset + attribute.array.length)); offset += attribute.array.length
        mesh.geometry.setAttribute('skinWeight', attribute)
        const backup = this.backups.get(mesh)!; backup.attribute = attribute; backup.version = attribute.version
      })
      this.applied = true
      this.text(`Изменено вершин: ${result.stats.modifiedVertices}. Сильных растяжений в проверенных позах: ${result.stats.beforeOverstretch} → ${result.stats.afterOverstretch}. Можно отменить.`)
    } catch (error) {
      if (generation !== this.generation) return
      this.pending?.worker.terminate(); this.pending = undefined
      const message = error instanceof Error ? error.message : String(error)
      this.text(message.includes('memory budget') ? 'Недостаточно памяти для этого набора. Выберите меньше движений.' : message)
    } finally { if (generation === this.generation) this.buttons() }
  }
}
