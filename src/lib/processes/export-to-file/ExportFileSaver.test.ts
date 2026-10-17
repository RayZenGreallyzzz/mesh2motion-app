import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  platform: vi.fn(), begin: vi.fn(), append: vi.fn(), finish: vi.fn(), abort: vi.fn()
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: mocks.platform }, registerPlugin: () => mocks }))
import { ExportCancelledError, ExportFileSaver } from './ExportFileSaver'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.platform.mockReturnValue('android')
  mocks.begin.mockResolvedValue({ id: 'session' })
  mocks.append.mockResolvedValue(undefined)
  mocks.finish.mockResolvedValue({ status: 'saved' })
  mocks.abort.mockResolvedValue(undefined)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('streams every byte in bounded ordered chunks and waits for native confirmation', async () => {
  const bytes = Uint8Array.from({ length: 700001 }, (_, i) => (i * 13) % 256)
  let confirm!: (value: { status: string }) => void
  mocks.finish.mockImplementation(() => new Promise(resolve => { confirm = resolve }))
  let saved = false
  const pending = new ExportFileSaver().save(new Blob([bytes]), 'monster.glb').then(() => { saved = true })
  await vi.waitFor(() => expect(mocks.finish).toHaveBeenCalledOnce())
  expect(saved).toBe(false)
  const chunks = mocks.append.mock.calls.map(([chunk]) => chunk)
  expect(chunks.map(c => c.offset)).toEqual([0, 262144, 524288])
  expect(chunks.every(c => c.data.length <= 349528 && c.id === 'session')).toBe(true)
  const restored = Uint8Array.from(chunks.map(c => atob(c.data)).join(''), c => c.charCodeAt(0))
  expect(restored).toEqual(bytes)
  confirm({ status: 'saved' })
  await pending
  expect(mocks.abort).toHaveBeenCalledWith({ id: 'session' })
})
it('does not open the document picker for incomplete data and cleans up after bridge failure', async () => {
  mocks.append.mockRejectedValueOnce(new Error('Disk full'))
  await expect(new ExportFileSaver().save(new Blob(['abc']), 'monster.fbx')).rejects.toThrow('Disk full')
  expect(mocks.finish).not.toHaveBeenCalled()
  expect(mocks.abort).toHaveBeenCalledOnce()
})
it('treats cancelling the Android picker separately from a write error', async () => {
  mocks.finish.mockResolvedValueOnce({ status: 'cancelled' })
  await expect(new ExportFileSaver().save(new Blob(['abc']), 'monster.glb')).rejects.toBeInstanceOf(ExportCancelledError)
  mocks.finish.mockRejectedValueOnce(new Error('Provider denied write'))
  await expect(new ExportFileSaver().save(new Blob(['abc']), 'monster.glb')).rejects.toThrow('Provider denied write')
  expect(mocks.abort).toHaveBeenCalledTimes(2)
})
it('rejects empty exports before contacting Android', async () => {
  await expect(new ExportFileSaver().save(new Blob([]), 'monster.glb')).rejects.toThrow('пустой')
  expect(mocks.begin).not.toHaveBeenCalled()
})
it('keeps browser downloads working without a pre-existing hidden link and releases the URL later', async () => {
  mocks.platform.mockReturnValue('web')
  vi.useFakeTimers()
  const create = vi.fn(() => 'blob:test'), revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  let captured: HTMLAnchorElement | undefined
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { captured = this })
  await new ExportFileSaver().save(new Blob(['abc']), 'monster.glb')
  expect(captured?.download).toBe('monster.glb')
  expect(captured?.href).toBe('blob:test')
  expect(captured?.isConnected).toBe(false)
  expect(mocks.begin).not.toHaveBeenCalled()
  expect(revoke).not.toHaveBeenCalled()
  vi.advanceTimersByTime(60000)
  expect(revoke).toHaveBeenCalledWith('blob:test')
})
