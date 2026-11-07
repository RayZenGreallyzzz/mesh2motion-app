import { describe, it, expect } from 'vitest'
import { Bone, Box3, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three'
import { NativeRigClient, native_failure, native_points, type NativeReceipt } from '../src/my-rigs/NativeRigClient.ts'
import { validate_native_skin } from '../src/my-rigs/NativeRigValidation.ts'
import type { RigAsset } from '../src/my-rigs/RigAsset.ts'
import { room_layout } from '../src/my-rigs/StudioRoom.ts'

function glb(size = 220000): ArrayBuffer { const b = new ArrayBuffer(size), view = new DataView(b); view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, size, true); for (let i = 12; i < size; i++) view.setUint8(i, i % 251); return b }
class FakeBridge {
  chunks: Uint8Array[] = []; discarded: string[] = []; output = glb(); total?: number; fail = false
  async capabilities() { return { available: true } }
  async begin(_: { size: number }) { return { project: 'id' } }
  async append(o: { project: string, offset: number, data: string }) { expect(o.offset).toBe(this.chunks.reduce((n, a) => n + a.length, 0)); this.chunks.push(Uint8Array.from(atob(o.data), c => c.charCodeAt(0))) }
  async prepare() { if (this.fail) throw new Error('WebP decode failed'); return { ok: true } }
  async run(o: { command: string }) { return { receipt: { command: o.command, status: this.fail ? 'FAILED' : 'DONE', nativeReport: this.fail ? { status: 'FAILED', errorCode: 'UNSUPPORTED_GLTF_EXTENSION', detail: 'EXT_texture_webp' } : { status: 'DONE' } } } }
  async read(o: { offset: number, size: number }) { const part = new Uint8Array(this.output, o.offset, Math.min(o.size, this.output.byteLength - o.offset)); return { data: btoa(Array.from(part, n => String.fromCharCode(n)).join('')), offset: o.offset, total: this.total ?? this.output.byteLength } }
  async cancel() {}
  async discard(o: { project: string }) { this.discarded.push(o.project) }
  async addListener() { return { remove: async () => {} } }
}
describe('native engine transport and report boundary', () => {
  it('streams GLB without byte loss and reads large native output in ordered chunks', async () => {
    const api = new FakeBridge(), client = new NativeRigClient(api), bytes = glb()
    await client.prepare(bytes)
    expect(api.chunks.length).toBe(3)
    const all = new Uint8Array(bytes.byteLength); let at = 0; for (const a of api.chunks) { all.set(a, at); at += a.length }; expect(all).toEqual(new Uint8Array(bytes))
    expect(await client.result()).toEqual(api.output)
    await client.dispose(); expect(api.discarded).toEqual(['id'])
  })
  it('rejects changing result sizes and a non-GLB output', async () => {
    const api = new FakeBridge(), client = new NativeRigClient(api); client.project = 'id'; api.total = 1
    await expect(client.result()).rejects.toThrow('размер')
    api.total = undefined; new DataView(api.output).setUint32(0, 0)
    await expect(client.result()).rejects.toThrow('повреждённый GLB')
  })
  it('cleans a failed import and preserves the native failure receipt', async () => {
    const api = new FakeBridge(), client = new NativeRigClient(api); api.fail = true
    await expect(client.prepare(glb())).rejects.toThrow('WebP'); expect(client.project).toBeUndefined(); expect(api.discarded).toEqual(['id'])
    client.project = 'new-id'; await expect(client.run('INITIAL_BODY_GUIDES')).rejects.toThrow('EXT_texture_webp'); expect(client.receipts).toHaveLength(1)
  })
  it('understands point maps in actual stats envelopes without inventing coordinates', () => {
    const receipt = { command: 'INITIAL_BODY_GUIDES', status: 'DONE', nativeReport: { status: 'DONE', stats: { vertices: 100, meshes: 1 }, bodyPreview: { phase: 'BODY_GUIDES', points: { pelvis: [1, 2, 3], elbow_l: { x: 4, y: 5, z: 6 } } } } } satisfies NativeReceipt
    expect(native_points(receipt, 'points')).toEqual({ pelvis: [1, 2, 3], elbow_l: [4, 5, 6] })
    expect(() => native_points({ ...receipt, nativeReport: { stats: { points: { pelvis: [1, NaN, 0] } } } }, 'points')).toThrow('ориентир')
    expect(() => native_points({ ...receipt, nativeReport: {} }, 'points')).toThrow('не вернул')
    expect(native_failure({ status: 'NATIVE_CALL_RETURNED', command: 'ANALYZE' })).toContain('остановился')
  })
})
function asset(weights = [1, 0, 0, 0], index = 0): RigAsset {
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3)).setAttribute('skinWeight', new Float32BufferAttribute(weights, 4)).setAttribute('skinIndex', new Uint16BufferAttribute([index, 0, 0, 0], 4))
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial()), bone = new Bone(); mesh.add(bone); mesh.bind(new Skeleton([bone])); const scene = new Group(); scene.add(mesh)
  return { scene } as RigAsset
}
describe('native output never replaces a visible model with broken skin', () => {
  it('accepts usable weights and rejects missing skin, invalid bone indices and zero weights', () => {
    expect(() => validate_native_skin(asset())).not.toThrow()
    expect(() => validate_native_skin({ scene: new Group() } as RigAsset)).toThrow('не вернул')
    expect(() => validate_native_skin(asset([1, 0, 0, 0], 10))).toThrow('индексы')
    expect(() => validate_native_skin(asset([0, 0, 0, 0]))).toThrow('нормализованных')
    expect(() => validate_native_skin(asset([NaN, 0, 0, 0]))).toThrow('неверные веса')
  })
})
describe('display room follows model units without moving the model', () => {
  it('places the floor under translated feet and retains scale for tiny and large models', () => {
    const source = new Box3(new Vector3(10, -3, 4), new Vector3(12, 0, 6)), before = source.clone(), base = room_layout(source)
    expect(base.center.toArray()).toEqual([11, -1.5, 5]); expect(base.floor).toBeLessThan(-3); expect(source.equals(before)).toBe(true)
    for (const factor of [0.001, 1000]) {
      const scaled = room_layout(new Box3(source.min.clone().multiplyScalar(factor), source.max.clone().multiplyScalar(factor)))
      expect(scaled.unit / base.unit).toBeCloseTo(factor, 6); expect(scaled.floor / base.floor).toBeCloseTo(factor, 6)
    }
  })
})
