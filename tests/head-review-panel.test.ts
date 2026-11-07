import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { Humanoid65Panel } from '../src/my-rigs/Humanoid65Panel.ts'
import { HumanoidHeadReviewRequired, type HeadLandmarks } from '../src/my-rigs/HumanoidHeadReview.ts'
import type { RigAsset } from '../src/my-rigs/RigAsset.ts'
import type { RigViewer } from '../src/my-rigs/RigViewer.ts'
const { build } = vi.hoisted(() => ({ build: vi.fn() }))
vi.mock('../src/my-rigs/Humanoid65Builder.ts', () => ({ build_humanoid65: build }))
const points: HeadLandmarks = { neck: [.2, 1.5, 0], head: [.2, 1.6, 0], head_end: [.2, 1.9, 0] }
function asset(): RigAsset {
 const scene = new Group(); scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
 return { scene, source_bytes: new ArrayBuffer(32), nodes: new Map(), clips: [], name: 'source', signature: '', skeleton_count: 0, vertex_count: 8, dirty: false }
}
function setup() {
 let original = asset()
 const viewer = { stop: vi.fn(), fit: vi.fn(), set_asset: vi.fn(), set_native_points: vi.fn(), set_native_bones: vi.fn(), native_view: vi.fn(), focus_points: vi.fn() }
 const container = document.createElement('div'); document.body.replaceChildren(container)
 const show = vi.fn(async () => {})
 const panel = new Humanoid65Panel(container, { viewer: viewer as unknown as RigViewer, asset: () => original, operation: async (_, task) => task(), show, status: vi.fn() })
 const button = (name: string) => [...container.querySelectorAll('button')].find(b => b.textContent === name)!
 const checked = () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!
 return { panel, original, viewer, show, container, button, checked, replace: () => { original = asset(); panel.refresh(); return original } }
}
beforeEach(() => {
 build.mockReset(); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))
})
describe('native BODY23 head review handoff', () => {
 it('holds pending output, adapts marker coordinates, invalidates review after edits and resumes that output', async () => {
  const s = setup(), body = asset(), disposed = vi.fn(); (body.scene.children[0] as Mesh).geometry.addEventListener('dispose', disposed)
  build.mockRejectedValueOnce(new HumanoidHeadReviewRequired(points)).mockResolvedValueOnce({ bytes: new ArrayBuffer(64), report: { joints: [] } })
  expect(await s.panel.complete_native(body)).toBe(false); expect(s.panel.reviewing).toBe(true); expect(s.show).not.toHaveBeenCalled(); expect(disposed).not.toHaveBeenCalled()
  expect(s.viewer.set_asset).toHaveBeenLastCalledWith(body)
  const markerCall = s.viewer.set_native_points.mock.calls.at(-1)!
  expect(markerCall[0].head).toEqual([-.2, 1.6, 0])
  expect(s.checked().disabled).toBe(true)
  s.button('Голова спереди').click(); s.button('Голова сбоку').click(); s.checked().click()
  expect(s.button('Продолжить с этой головой').disabled).toBe(false)
  markerCall[1]('head', [-.25, 1.6, .02])
  expect(s.checked().checked).toBe(false); expect(s.button('Продолжить с этой головой').disabled).toBe(true)
  expect(s.viewer.set_native_points.mock.calls.at(-1)).toBe(markerCall)
  s.button('Голова спереди').click(); s.button('Голова сбоку').click(); s.checked().click(); s.button('Продолжить с этой головой').click()
  await vi.waitFor(() => expect(s.show).toHaveBeenCalledTimes(1))
  expect(build.mock.calls[1][0]).toBe(body); expect(build.mock.calls[1][1].head_landmarks.head).toEqual([.25, 1.6, .02])
  expect(s.viewer.set_asset).toHaveBeenLastCalledWith(s.original); expect(disposed).toHaveBeenCalledTimes(1); expect(s.panel.reviewing).toBe(false)
 })
 it('cancels the pending native result and restores the original without committing', async () => {
  const s = setup(), body = asset(), disposed = vi.fn(); (body.scene.children[0] as Mesh).geometry.addEventListener('dispose', disposed)
  build.mockRejectedValue(new HumanoidHeadReviewRequired(points)); await s.panel.complete_native(body)
  s.button('Отменить уточнение головы').click()
  expect(s.show).not.toHaveBeenCalled(); expect(disposed).toHaveBeenCalledTimes(1); expect(s.viewer.set_asset).toHaveBeenLastCalledWith(s.original); expect(s.panel.reviewing).toBe(false)
 })
 it('invalidates old review when the source is replaced', async () => {
  const s = setup(), body = asset(); build.mockRejectedValue(new HumanoidHeadReviewRequired(points)); await s.panel.complete_native(body)
  const replacement = s.replace(); expect(s.panel.reviewing).toBe(false); expect(s.viewer.set_asset).toHaveBeenLastCalledWith(replacement); expect(s.show).not.toHaveBeenCalled()
 })
})
