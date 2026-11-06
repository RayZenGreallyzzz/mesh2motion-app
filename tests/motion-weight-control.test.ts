import { beforeEach, describe, expect, it } from 'vitest'
import {
  AnimationClip, AnimationMixer, Bone, BufferAttribute, BufferGeometry, Float32BufferAttribute,
  Group, LoopOnce, Matrix4, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, VectorKeyframeTrack
} from 'three'
import { motion_weight_input, MotionWeightRepairControl } from '../src/lib/processes/animations-listing/MotionWeightRepair.ts'
import { refineAnimationWeights } from '../src/lib/solvers/AnimationWeightRefiner.ts'
import { RigRestPoseSnapshot } from '../src/lib/processes/animations-listing/RigRestPoseSnapshot.ts'
import { StepWeightSkin } from '../src/lib/processes/weight-skin/StepWeightSkin.ts'
import { StepAnimationsListing } from '../src/lib/processes/animations-listing/StepAnimationsListing.ts'
import { copy_rigs_for_export } from '../src/lib/processes/export-to-file/ExportRigCopy.ts'
import { weightFixture } from './motion-weight-fixtures.ts'

function rig (armature = false): { mesh: SkinnedMesh, clip: AnimationClip } {
  const fixture = weightFixture(), geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(fixture.positions, 3))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(fixture.indices, 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(fixture.weights, 4))
  geometry.setIndex([...fixture.triangles])
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial()), root = new Bone(), child = new Bone()
  root.name = 'root'; child.name = 'child'; root.add(child)
  if (armature) { const parent = new Group(); parent.name = 'Armature'; parent.position.set(.3, -.2, .5); parent.rotation.y = .23; parent.add(root); mesh.add(parent) } else mesh.add(root)
  mesh.updateMatrixWorld(true); const skeleton = new Skeleton([root, child]); mesh.bind(skeleton)
  const clip = new AnimationClip('stretch', 1, [new VectorKeyframeTrack('child.position', [0, 1], [0, 0, 0, 2, 0, 0])])
  return { mesh, clip }
}

class TestWorker {
  static instances: TestWorker[] = []
  static hold = false
  onmessage?: (event: { data: unknown }) => void
  onerror?: (event: { message: string }) => void
  terminated = false
  input: unknown
  constructor () { TestWorker.instances.push(this) }
  postMessage (input: Parameters<typeof refineAnimationWeights>[0]): void {
    this.input = input
    if (!TestWorker.hold) queueMicrotask(() => {
      if (!this.terminated) this.onmessage?.({ data: { type: 'result', ...refineAnimationWeights(input) } })
    })
  }
  terminate (): void { this.terminated = true }
}

beforeEach(() => {
  document.body.innerHTML = '<button id="motion-weight-repair"></button><button id="motion-weight-undo" disabled></button><small id="motion-weight-status"></small>'
  TestWorker.instances = []; TestWorker.hold = false
})

describe('detached motion sampling and publication', () => {
  it('samples a nonidentity armature without changing live pose or source clips', () => {
    const { mesh, clip } = rig(true)
    const snapshot = new RigRestPoseSnapshot(); snapshot.remember(mesh.skeleton)
    mesh.skeleton.bones[1].rotation.z = .8; mesh.skeleton.bones[1].position.set(1, 2, 3); mesh.updateMatrixWorld(true)
    const live = mesh.skeleton.bones.map(bone => bone.matrixWorld.toArray()), clipData = clip.toJSON()
    const input = motion_weight_input([mesh], [clip])
    expect(input.groups).toEqual([0, 0, 0, 0, 0])
    expect(mesh.skeleton.bones.map(bone => bone.matrixWorld.toArray())).toEqual(live)
    expect(clip.toJSON()).toEqual(clipData)
    // Independently evaluate the live rig only after the immutability check.
    snapshot.restore(mesh.skeleton)
    const mixer = new AnimationMixer(mesh), action = mixer.clipAction(clip)
    action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play()
    for (const [p, fraction] of [0, .25, .5, .75, .9999].entries()) {
      mixer.setTime(fraction); mesh.updateMatrixWorld(true)
      const vertex = new Vector3().fromArray(input.positions, 3)
      const weighted = new Vector3()
      for (let k = 0; k < 4; k++) {
        const matrix = new Matrix4().fromArray(input.matrices, (p * input.boneCount + input.indices[4 + k]) * 16)
        weighted.add(vertex.clone().applyMatrix4(matrix).multiplyScalar(input.weights[4 + k]))
      }
      const expected = mesh.getVertexPosition(1, new Vector3()).applyMatrix4(mesh.matrixWorld)
      expect(weighted.distanceTo(expected)).toBeLessThan(1e-6)
    }
  })

  it('restores inverse binds parent-first when imported rigs have no captured rest pose', () => {
    const { mesh, clip } = rig(true)
    mesh.skeleton.bones[0].position.set(3, 2, 1); mesh.skeleton.bones[1].position.y = 2; mesh.updateMatrixWorld(true)
    const input = motion_weight_input([mesh], [clip])
    for (let bone = 0; bone < 2; bone++) {
      const matrix = new Matrix4().fromArray(input.matrices, bone * 16)
      expect(Math.max(...matrix.elements.map((x, i) => Math.abs(x - new Matrix4().elements[i])))).toBeLessThan(1e-6)
    }
  })

  it('publishes to preview and export, repeats from original weights, and undoes exactly', async () => {
    const { mesh, clip } = rig(), original = Array.from(mesh.geometry.getAttribute('skinWeight').array)
    const controller = new MotionWeightRepairControl({ meshes: () => [mesh], clips: () => [clip], key: () => 'same', worker: () => new TestWorker() as unknown as Worker })
    await controller.apply()
    const first = Array.from(mesh.geometry.getAttribute('skinWeight').array)
    expect(first).not.toEqual(original)
    expect(document.getElementById('motion-weight-status')!.textContent).toContain('Можно отменить')
    expect(copy_rigs_for_export([mesh])[0].geometry.getAttribute('skinWeight').array).toEqual(mesh.geometry.getAttribute('skinWeight').array)
    await controller.apply(); expect(Array.from(mesh.geometry.getAttribute('skinWeight').array)).toEqual(first)
    controller.undo(); expect(Array.from(mesh.geometry.getAttribute('skinWeight').array)).toEqual(original)
    expect((document.getElementById('motion-weight-undo') as HTMLButtonElement).disabled).toBe(true)
  })

  it('cancels pending work and ignores its late result when context changes', async () => {
    const { mesh, clip } = rig(), before = Array.from(mesh.geometry.getAttribute('skinWeight').array)
    let key = 'first'; TestWorker.hold = true
    const controller = new MotionWeightRepairControl({ meshes: () => [mesh], clips: () => [clip], key: () => key, worker: () => new TestWorker() as unknown as Worker })
    const task = controller.apply()
    await new Promise(resolve => setTimeout(resolve, 10))
    const worker = TestWorker.instances[0]; expect(worker).toBeDefined()
    key = 'second'; controller.checkContext(); await task
    expect(worker.terminated).toBe(true)
    worker.onmessage?.({ data: { type: 'result', weights: new Float32Array(16), stats: { improved: true } } })
    expect(Array.from(mesh.geometry.getAttribute('skinWeight').array)).toEqual(before)
    expect(document.getElementById('motion-weight-status')!.textContent).toContain('изменены')
  })

  it('keeps painted vertices and never undoes a later manual edit', async () => {
    const { mesh, clip } = rig(), original = Array.from(mesh.geometry.getAttribute('skinWeight').array)
    const controller = new MotionWeightRepairControl({ meshes: () => [mesh], clips: () => [clip], locks: () => [new Set([0])], key: () => 'same', worker: () => new TestWorker() as unknown as Worker })
    await controller.apply()
    const attribute = mesh.geometry.getAttribute('skinWeight') as BufferAttribute
    expect(Array.from(attribute.array).slice(0, 4)).toEqual(original.slice(0, 4))
    attribute.setXYZW(0, 1, 0, 0, 0); attribute.needsUpdate = true
    controller.undo(); expect(Array.from(attribute.array).slice(0, 4)).toEqual([1, 0, 0, 0])
  })

  it('rejects incompatible rigs, active morphs and excessive selections', () => {
    const { mesh, clip } = rig(), other = rig().mesh
    expect(() => motion_weight_input([mesh, other], [clip])).toThrow(/общим/)
    expect(() => motion_weight_input([mesh], Array(9).fill(clip))).toThrow(/восьми/)
    mesh.morphTargetInfluences = [.5]
    expect(() => motion_weight_input([mesh], [clip])).toThrow(/морфы/)
  })

  it('keeps the production editor entry points in the TypeScript dependency graph', () => {
    expect(StepWeightSkin.prototype.manual_weight_locks).toBeTypeOf('function')
    expect(StepAnimationsListing.prototype.set_manual_weight_locks_provider).toBeTypeOf('function')
  })
})
