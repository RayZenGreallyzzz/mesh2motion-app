import { describe, expect, it, vi } from 'vitest'
import { AnimationClip, Bone, QuaternionKeyframeTrack, Scene, Skeleton, SkinnedMesh } from 'three'
import { StepExportToFile } from './StepExportToFile'
import { DownloadSettings } from './DownloadSettings'

describe('cancelled export', () => {
  it('returns the model and skeleton to the editor when native saving is cancelled', async () => {
    const scene = new Scene()
    const mesh = new SkinnedMesh()
    const bone = new Bone()
    bone.name = 'pelvis'
    mesh.add(bone)
    mesh.bind(new Skeleton([bone]))
    scene.add(mesh)
    const clip = new AnimationClip('Idle', 1, [new QuaternionKeyframeTrack('pelvis.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])])
    const exporter = new StepExportToFile()
    exporter.set_animation_clips_to_export([clip], [{ animation_index: 0, mirror_export_mode: 'none' }])
    vi.spyOn(exporter, 'export_scene').mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    await expect(exporter.export([mesh], 'character', new DownloadSettings())).rejects.toMatchObject({ name: 'AbortError' })
    expect(mesh.parent).toBe(scene)
    expect(bone.parent).toBe(mesh)
    expect(bone.name).toBe('pelvis')
  })
})
