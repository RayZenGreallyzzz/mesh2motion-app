import { expect, it, vi } from 'vitest'
import { AnimationClip, Bone, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, QuaternionKeyframeTrack, Scene, Skeleton, SkinnedMesh, Uint16BufferAttribute } from 'three'
import { ExportFileSaver } from '../lib/processes/export-to-file/ExportFileSaver.ts'
import { StepExportToFile } from '../lib/processes/export-to-file/StepExportToFile.ts'
import { DownloadSettings } from '../lib/processes/export-to-file/DownloadSettings.ts'
it('returns model and rig to original parent when export rejects', async () => {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial()), bone = new Bone(), scene = new Scene()
  bone.name = 'hips'; mesh.add(bone); mesh.bind(new Skeleton([bone])); scene.add(mesh)
  const exporter = new StepExportToFile()
  exporter.set_animation_clips_to_export([new AnimationClip('idle', 1, [new QuaternionKeyframeTrack('hips.quaternion', [0], [0, 0, 0, 1])])], [{ animation_index: 0, mirror_export_mode: 'none' }])
  vi.spyOn(ExportFileSaver.prototype, 'save').mockRejectedValueOnce(new Error('Disk full'))
  await expect(exporter.export([mesh], 'test', new DownloadSettings())).rejects.toThrow('Disk full')
  expect(mesh.parent).toBe(scene)
  expect(bone.parent).toBe(mesh)
  expect(bone.name).toBe('hips')
})
