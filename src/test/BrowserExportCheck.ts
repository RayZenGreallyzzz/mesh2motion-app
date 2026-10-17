import { ExportFileSaver } from '../lib/processes/export-to-file/ExportFileSaver'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type AnimationClip, type SkinnedMesh } from 'three'
import { type StepExportToFile } from '../lib/processes/export-to-file/StepExportToFile.ts'
import { type DownloadSettings } from '../lib/processes/export-to-file/DownloadSettings.ts'

export async function check_export (exporter: StepExportToFile, meshes: SkinnedMesh[], clip: AnimationClip, settings: DownloadSettings) {
  exporter.set_animation_clips_to_export([clip], [{ animation_index: 0, mirror_export_mode: 'none' }])
  let buffer: ArrayBuffer | undefined
  const save = ExportFileSaver.prototype.save
  ExportFileSaver.prototype.save = async function (blob, filename) {
    buffer = await blob.arrayBuffer()
    await save.call(this, blob, filename)
  }
  const parents = meshes.map(m => m.parent)
  try { await exporter.export(meshes, 'flow-check', settings) }
  finally { ExportFileSaver.prototype.save = save }
  if (meshes.some((mesh, i) => mesh.parent !== parents[i])) throw new Error('Export changed scene ownership')
  const imported = await new GLTFLoader().parseAsync(buffer!, '')
  let supports = 0, skinned = 0
  imported.scene.traverse(object => {
    if (object.type === 'SkinnedMesh') skinned++
    if (object.type === 'Bone' && object.name.startsWith('rig_volume_')) supports++
  })
  return { bytes: buffer!.byteLength, clips: imported.animations.length, tracks: imported.animations[0].tracks.length, supports, skinned }
}
