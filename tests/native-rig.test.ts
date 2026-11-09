import { describe, it, expect, vi } from 'vitest'
import { Bone, Box3, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three'
import { NativeRigClient, NativeRigError, native_failure, native_points, type NativeReceipt } from '../src/my-rigs/NativeRigClient.ts'
import { validate_native_skin } from '../src/my-rigs/NativeRigValidation.ts'
import type { RigAsset } from '../src/my-rigs/RigAsset.ts'
import { NativeRigPanel } from '../src/my-rigs/NativeRigPanel.ts'
import type { RigViewer } from '../src/my-rigs/RigViewer.ts'
import { room_layout } from '../src/my-rigs/StudioRoom.ts'

function glb(size = 220000): ArrayBuffer { const b = new ArrayBuffer(size), view = new DataView(b); view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, size, true); for (let i = 12; i < size; i++) view.setUint8(i, i % 251); return b }
class FakeBridge {
  chunks: Uint8Array[] = []; discarded: string[] = []; output = glb(); total?: number; fail = false; failureCode = 'UNSUPPORTED_GLTF_EXTENSION'
  async capabilities() { return { available: true } }
  async begin(_: { size: number }) { return { project: 'id' } }
  async append(o: { project: string, offset: number, data: string }) { expect(o.offset).toBe(this.chunks.reduce((n, a) => n + a.length, 0)); this.chunks.push(Uint8Array.from(atob(o.data), c => c.charCodeAt(0))) }
  async prepare() { if (this.fail) throw new Error('WebP decode failed'); return { ok: true } }
  async run(o: { command: string }) { return { receipt: { command: o.command, status: this.fail ? 'FAILED' : 'DONE', nativeReport: this.fail ? { status: 'FAILED', errorCode: this.failureCode, detail: this.failureCode === 'MESH_TOO_COMPLEX_FOR_LOCAL_RIG' ? 'POSITION limit or type' : 'EXT_texture_webp' } : { status: 'DONE' } } } }
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

  it('keeps a typed complexity failure and its raw receipt for a recoverable UI', async () => {
    const api=new FakeBridge(),client=new NativeRigClient(api);api.fail=true;api.failureCode='MESH_TOO_COMPLEX_FOR_LOCAL_RIG';client.project='input'
    const error=await client.run('INITIAL_BODY_GUIDES').catch(error=>error)
    expect(error).toBeInstanceOf(NativeRigError);expect(error.code).toBe('MESH_TOO_COMPLEX_FOR_LOCAL_RIG')
    expect(error.message).toContain('65 костей');expect(error.receipt).toBe(client.receipts[0]);expect(client.project).toBe('input')
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
  it('places a two-step stage under translated feet and scales it with the model', () => {
    const source = new Box3(new Vector3(10, -3, 4), new Vector3(12, 0, 6)), before = source.clone(), base = room_layout(source)
    expect(base.center.toArray()).toEqual([11, -1.5, 5])
    expect(base.stage_top).toBeCloseTo(source.min.y, 2)
    expect(base.floor + base.step_height * 2).toBeCloseTo(base.stage_top, 8)
    expect(base.stage_radius).toBeGreaterThan(Math.hypot(2, 2) / 2)
    expect(base.base_radius).toBeGreaterThan(base.stage_radius)
    expect(source.equals(before)).toBe(true)
    for (const factor of [0.001, 1000]) {
      const scaled = room_layout(new Box3(source.min.clone().multiplyScalar(factor), source.max.clone().multiplyScalar(factor)))
      expect(scaled.unit / base.unit).toBeCloseTo(factor, 6); expect(scaled.floor / base.floor).toBeCloseTo(factor, 6)
      expect(scaled.stage_top / base.stage_top).toBeCloseTo(factor, 6)
      expect(scaled.base_radius / base.base_radius).toBeCloseTo(factor, 6)
    }
  })
})


describe('native complexity recovery keeps the original asset',()=>{
  async function setup(code='MESH_TOO_COMPLEX_FOR_LOCAL_RIG'){
    const api=new FakeBridge(),client=new NativeRigClient(api),source=glb(),copy=new Uint8Array(source).slice();let current={scene:new Group(),source_bytes:source}as RigAsset
    const viewer={stop:vi.fn(),set_native_points:vi.fn(),set_native_bones:vi.fn(),native_view:vi.fn()};const host=document.createElement('div');document.body.replaceChildren(host)
    const full=vi.fn(async()=>{}),show=vi.fn(async()=>{}),status=vi.fn()
    const panel=new NativeRigPanel(host,{viewer:viewer as unknown as RigViewer,asset:()=>current,operation:async(_,task)=>{try{await task()}catch{}},show,status,startFullRig:full},client)
    panel.setAsset(current)
    const button=(label:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===label)!
    const start=button('1. Найти ориентиры тела'),fallback=button('Продолжить полным ригом · 65 костей')
    await vi.waitFor(()=>expect(start.disabled).toBe(false));api.failureCode=code
    // Prepare succeeds; only the native geometry check fails, as in the report.
    api.run=async(o:{command:string})=>({receipt:{command:o.command,status:'FAILED',nativeReport:{status:'FAILED',errorCode:code,detail:'POSITION limit or type'}}})
    start.click();await vi.waitFor(()=>expect(start.disabled).toBe(false));await vi.waitFor(()=>expect(client.receipts.length).toBe(1))
    return{panel,full,show,status,fallback,source,copy,replace:()=>{current={scene:new Group(),source_bytes:glb(1000)}as RigAsset;panel.setAsset(current)}}
  }
  it('offers a one-click full-resolution rig only after the native complexity failure',async()=>{
    const s=await setup();expect(s.fallback.hidden).toBe(false);expect(s.full).not.toHaveBeenCalled();expect(s.show).not.toHaveBeenCalled();expect(new Uint8Array(s.source)).toEqual(s.copy)
    s.panel.refreshControls(true);expect(s.fallback.disabled).toBe(true);s.panel.refreshControls(false)
    s.fallback.click();await vi.waitFor(()=>expect(s.full).toHaveBeenCalledTimes(1));expect(s.fallback.hidden).toBe(true);expect(new Uint8Array(s.source)).toEqual(s.copy)
  })
  it('does not offer that recovery for unrelated failures',async()=>{
    const s=await setup('UNSUPPORTED_GLTF_EXTENSION');expect(s.fallback.hidden).toBe(true);expect(s.full).not.toHaveBeenCalled();expect(s.show).not.toHaveBeenCalled()
  })
  it('clears recovery when a different model is opened',async()=>{
    const s=await setup();expect(s.fallback.hidden).toBe(false);s.replace();expect(s.fallback.hidden).toBe(true);expect(s.full).not.toHaveBeenCalled()
  })
})
