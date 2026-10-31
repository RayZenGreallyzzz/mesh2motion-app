// @vitest-environment node
import fs from 'node:fs'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { AnimationMixer, Quaternion, Vector3 } from 'three'
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js'
import { parse_bvh_motion } from '../src/my-rigs/BvhMotionReader.ts'
import { parse_fbx_motion, validate_fbx_budget } from '../src/my-rigs/FbxMotionReader.ts'
import { asset_from_motion, document_bytes } from '../src/my-rigs/MotionDocument.ts'
import { archive_input, open_motion_archive } from '../src/my-rigs/MotionArchive.ts'
import { import_motion_input, unpack_motion_input } from '../src/my-rigs/MotionImportCore.ts'
import { suggest_mapping, transfer_clips } from '../src/my-rigs/RigMotionTransfer.ts'
import { mapping_family_key, mapping_key } from '../src/my-rigs/RigBoneMapping.ts'
import { bytes, sampleDir } from './motion-fixtures.ts'

const small = (angle = 0) => `HIERARCHY
ROOT Hips
{
 OFFSET 1 2 3
 CHANNELS 6 Zposition Xposition Yposition Zrotation Xrotation Yrotation
 JOINT LeftUpLeg
 {
  OFFSET 2 -4 1
  CHANNELS 3 Yrotation Zrotation Xrotation
  End Site
  {
   OFFSET 0 -4 0
  }
 }
}
MOTION
Frames: 3
Frame Time: 0.0333333333
0 0 0 0 0 0 0 0 0
1 2 3 ${angle} 10 20 30 40 50
2 4 6 25 15 20 35 45 55
`
const report: Record<string, unknown> = {}
beforeAll(() => { vi.stubGlobal('window', { URL: { createObjectURL: () => 'data:application/octet-stream;base64,' }, innerWidth: 1, innerHeight: 1 }) })
afterAll(() => { vi.unstubAllGlobals(); fs.writeFileSync('checks/motion-import-tests.json', JSON.stringify(report, null, 2)) })

function compare (text: string) {
 const doc = parse_bvh_motion(text, 'motion'), parsed = new BVHLoader().parse(text), native = asset_from_motion(doc)
 const mix = new AnimationMixer(native.scene), reference = new AnimationMixer(parsed.skeleton.bones[0]); mix.clipAction(native.clips[0]).play(); reference.clipAction(parsed.clip).play()
 expect(doc.nodes.length).toBe(parsed.skeleton.bones.length)
 let maxAngle = 0, maxPosition = 0
 for (const t of [0, .0333333333, .1, .39, .72, .99].map(f => Math.min(f * doc.clips[0].duration, doc.clips[0].duration - 1e-7))) {
  mix.setTime(t); reference.setTime(t); native.scene.updateMatrixWorld(true); parsed.skeleton.bones[0].updateMatrixWorld(true)
  for (let i = 0; i < doc.nodes.length; i++) {
   const actual = native.nodes.get('n' + i)!.object, expected = parsed.skeleton.bones[i]
   maxPosition = Math.max(maxPosition, actual.getWorldPosition(new Vector3()).distanceTo(expected.getWorldPosition(new Vector3())))
   maxAngle = Math.max(maxAngle, actual.getWorldQuaternion(new Quaternion()).normalize().angleTo(expected.getWorldQuaternion(new Quaternion()).normalize()))
  }
 }
 expect(maxAngle).toBeLessThan(0.00001); expect(maxPosition).toBeLessThan(0.0001)
 mix.stopAllAction(); reference.stopAllAction(); return { name: doc.name, bones: doc.nodes.length, maxAngle, maxPosition, calibration: doc.calibration_frame, bytes: document_bytes(doc) }
}

describe('Bounded offline motion import', () => {
 it('preserves BVH channel order, offsets, translation and rotation against the reference loader', () => { compare(small(17)) })
 it('matches all 14 uploaded BVHs and identifies their calibration samples without deleting them', async () => {
  const values = []
  for (let i = 1; i <= 14; i++) {
   const name = '01_' + String(i).padStart(2, '0'), zip = await JSZip.loadAsync(fs.readFileSync(sampleDir + '/' + name + '.zip')), text = await zip.file(name + '.bvh')!.async('string')
   const result = compare(text); expect(result.calibration, name).toBeCloseTo(.0083333, 6); values.push({ ...result, name })
  }
  report.bvhParity = values
 }, 60000)
 it('rejects incomplete BVH, extra samples, NaN and an excessive frame declaration before allocating', () => {
  for (const invalid of [small().replace('Frames: 3', 'Frames: 300000000'), small().replace('1 2 3 0 10', '1 2 NaN 0 10'), small() + '1', small().slice(0, -12)]) expect(() => parse_bvh_motion(invalid, 'bad')).toThrow()
 })
 it('imports both real FBX clips as skeleton and tracks without geometry or texture dependencies', () => {
  const input = bytes(fs.readFileSync(sampleDir + '/Walking_01_01.fbx')), doc = parse_fbx_motion(input, 'Walking'), asset = asset_from_motion(doc)
  expect(doc.clips.map(c => c.name)).toEqual(['mixamo.com', 'Walking_01_01.retargeted']); expect(doc.nodes.filter(n => n.joint)).toHaveLength(41)
  expect(asset.vertex_count).toBe(0); expect([...asset.nodes.values()].some(n => n.is_mesh)).toBe(false); expect(document_bytes(doc)).toBeLessThan(input.byteLength / 10)
  for (const clip of doc.clips) for (const track of clip.tracks) expect(track.times.every((t, i) => !i || t > track.times[i - 1])).toBe(true)
  report.fbx = { bones: 41, clips: doc.clips.map(c => c.name), sourceBytes: input.byteLength, storedBytes: document_bytes(doc), vertices: asset.vertex_count }
 }, 30000)
 it('rejects oversized FBX array declarations in the preflight', () => {
  const data = new ArrayBuffer(27 + 25 + 13), view = new DataView(data)
  new Uint8Array(data).set(new TextEncoder().encode('Kaydara FBX Binary  \0\x1a\0')); view.setUint32(23, 7700, true)
  view.setBigUint64(27, BigInt(data.byteLength), true); view.setBigUint64(35, 1n, true); view.setBigUint64(43, 13n, true)
  view.setUint8(52, 'd'.charCodeAt(0)); view.setUint32(53, 100_000_000, true); view.setUint32(57, 1, true)
  expect(() => validate_fbx_budget(data)).toThrow(/массив/)
 })
 it('trims a BVH first sample only in the new transfer and reuses mappings for the same hierarchy', () => {
  const doc = parse_bvh_motion(small(), 'sample'), source = asset_from_motion(doc), target = asset_from_motion(doc), map = suggest_mapping(source, target)
  const original = source.clips[0].tracks.map(t => Array.from(t.values)), copied = transfer_clips(source, target, map, [0], { skip_first_frame: true })[0]
  expect(copied.duration).toBeCloseTo(source.clips[0].duration - source.clips[0].tracks[0].times[1], 7)
  for (let i = 0; i < copied.tracks.length; i++) expect(Array.from(copied.tracks[i].values)).toEqual(original[i].slice(source.clips[0].tracks[i].getValueSize()))
  expect(source.clips[0].tracks.map(t => Array.from(t.values))).toEqual(original)
  const changed = structuredClone(doc); changed.nodes[1].position[1] *= 2; const variant = asset_from_motion(changed)
  expect(mapping_key(variant, target)).not.toBe(mapping_key(source, target)); expect(mapping_family_key(variant, target)).toBe(mapping_family_key(source, target))
  changed.nodes[1].parent = -1; expect(mapping_family_key(asset_from_motion(changed), target)).not.toBe(mapping_family_key(source, target))
 })
 it('reads compressed and stored ZIP entries, verifies CRC, skips unsupported entries and hashes duplicates', async () => {
  const zip = new JSZip(); zip.file('Папка/Ходьба.bvh', small(), { compression: 'DEFLATE' }); zip.file('other.BVH', small(44), { compression: 'STORE' }); zip.file('ignore.txt', 'ignored'); zip.file('bad.bvh', 'malformed')
  const file = new Blob([bytes(await zip.generateAsync({ type: 'uint8array' }))]), catalog = await open_motion_archive(file)
  expect(catalog.entries).toHaveLength(3); expect(catalog.ignored).toBe(1); expect(catalog.entries[0].path).toBe('Папка/Ходьба.bvh')
  const input = await archive_input(file, catalog.entries[0]), output = await import_motion_input(input)
  expect(output.kind).toBe('motion'); expect((await import_motion_input(input, [output.id])).kind).toBe('duplicate')
  await expect(unpack_motion_input({ ...input, compressed: { ...input.compressed!, crc: 0 } })).rejects.toThrow(/CRC/)
  await expect(unpack_motion_input({ ...input, size: 10 })).rejects.toThrow(/размер/i)
  await expect(import_motion_input(await archive_input(file, catalog.entries[2]))).rejects.toThrow()
  expect((await import_motion_input(await archive_input(file, catalog.entries[1]))).kind).toBe('motion')
 })
 it('indexes 1300 motions in a virtual 1.1 GB ZIP by small slices, without reading the full archive', async () => {
  const zip = new JSZip(); for (let i = 0; i < 1300; i++) zip.file('pack/motion_' + String(i).padStart(4, '0') + '.bvh', small(i), { compression: 'DEFLATE' })
  const original = await zip.generateAsync({ type: 'uint8array' }), shifted = original.slice(), view = new DataView(shifted.buffer), eocd = shifted.length - 22, central = view.getUint32(eocd + 16, true), gap = 1100 * 1024 * 1024
  let p = central
  while (p < eocd) { view.setUint32(p + 42, view.getUint32(p + 42, true) + gap, true); p += 46 + view.getUint16(p + 28, true) + view.getUint16(p + 30, true) + view.getUint16(p + 32, true) }
  view.setUint32(eocd + 16, central + gap, true)
  let largestRead = 0, totalRead = 0
  const virtual = { size: gap + shifted.length, arrayBuffer: () => { throw Error('Whole archive must not be read') }, slice: (start: number, end = gap + shifted.length) => { const bytes = shifted.slice(Math.max(0, start - gap), end - gap); largestRead = Math.max(largestRead, bytes.length); totalRead += bytes.length; return new Blob([bytes]) } } as unknown as Blob
  const catalog = await open_motion_archive(virtual); expect(catalog.entries).toHaveLength(1300)
  const last = await import_motion_input(await archive_input(virtual, catalog.entries[1299])); expect(last.kind).toBe('motion'); expect(largestRead).toBeLessThan(200000); expect(totalRead).toBeLessThan(300000)
  report.largeZip = { entries: 1300, archiveBytes: virtual.size, largestRead, totalRead }
  fs.writeFileSync('checks/stress-1300.zip', original)
 })
})
