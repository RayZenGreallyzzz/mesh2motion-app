import { describe, expect, it } from 'vitest'
import { AnimationMixer, Quaternion, Vector3, type Mesh, type SkinnedMesh } from 'three'
import { own_rig_fixture } from '../test/OwnRigFixture.ts'
import { inspect_glb } from './GlbEnvelope.ts'
import { load_rig_asset, export_rig_asset } from './RigAssetLoader.ts'
import { restore_rig_pose, dispose_rig_scene, type RigAsset } from './RigAsset.ts'
import { suggest_mapping, transfer_clips } from './RigMotionTransfer.ts'

function document_glb (json: unknown): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const size = Math.ceil(text.length / 4) * 4
  const buffer = new ArrayBuffer(20 + size), view = new DataView(buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, buffer.byteLength, true)
  view.setUint32(12, size, true)
  view.setUint32(16, 0x4e4f534a, true)
  new Uint8Array(buffer, 20).fill(32)
  new Uint8Array(buffer, 20, text.length).set(text)
  return buffer
}

function skin_snapshot (asset: RigAsset): unknown {
  const result: unknown[] = []
  asset.scene.traverse(object => {
    const mesh = object as SkinnedMesh
    if (mesh.isSkinnedMesh) result.push({
      name: mesh.name, bones: mesh.skeleton.bones.map(bone => bone.name),
      weights: Array.from(mesh.geometry.getAttribute('skinWeight').array),
      indices: Array.from(mesh.geometry.getAttribute('skinIndex').array),
      inverses: mesh.skeleton.boneInverses.map(matrix => matrix.toArray()),
      morph: mesh.morphTargetInfluences?.slice()
    })
  })
  return result
}

describe('Own rigs import and offline envelope', () => {
  it('rejects truncation, external files, cycles and unsupported weight sets before decoding', () => {
    expect(() => inspect_glb(new ArrayBuffer(32))).toThrow()
    const base = { asset: { version: '2.0' } }
    expect(() => inspect_glb(document_glb({ ...base, images: [{ uri: 'https://example.org/texture.png' }] }))).toThrow(/внешний/)
    expect(() => inspect_glb(document_glb({ ...base, nodes: [{ children: [1] }, { children: [0] }] }))).toThrow(/Цикл/)
    expect(() => inspect_glb(document_glb({ ...base, meshes: [{ primitives: [{ attributes: { JOINTS_1: 0 } }] }] }))).toThrow(/четырёх/)
    expect(() => inspect_glb(document_glb({ ...base, extensionsRequired: ['KHR_animation_pointer'] }))).toThrow(/расширение/)
  })

  it('preserves both skins, partial clips, position, scale and morph channels', async () => {
    const asset = await load_rig_asset(await own_rig_fixture(), 'Creature.glb')
    expect(asset.skeleton_count).toBe(2)
    expect(asset.clips.map(clip => clip.tracks.length)).toEqual([4, 1])
    expect(asset.clips[0].tracks.map(track => track.name.split('.').pop()).sort())
      .toEqual(['morphTargetInfluences', 'position', 'quaternion', 'scale'])
    const mixer = new AnimationMixer(asset.scene)
    mixer.clipAction(asset.clips[0]).play()
    mixer.update(0.5)
    const body = [...asset.nodes.values()].find(node => node.name === 'CreatureBody')!.object as Mesh
    expect(body.morphTargetInfluences![0]).toBeCloseTo(0.8)
    mixer.stopAllAction()
    restore_rig_pose(asset)
    expect(body.morphTargetInfluences![0]).toBeCloseTo(0.15)
    dispose_rig_scene(asset.scene)
  })

  it('exports while playing without changing the live pose or bind matrices', async () => {
    const asset = await load_rig_asset(await own_rig_fixture(), 'Creature')
    const baseline = skin_snapshot(asset)
    const mixer = new AnimationMixer(asset.scene)
    mixer.clipAction(asset.clips[0]).play()
    mixer.update(0.5)
    const before = [...asset.nodes.values()].map(node => [node.object.position.toArray(), node.object.quaternion.toArray(), node.object.scale.toArray()])
    const reopened = await load_rig_asset(await export_rig_asset(asset), 'Roundtrip')
    expect([...asset.nodes.values()].map(node => [node.object.position.toArray(), node.object.quaternion.toArray(), node.object.scale.toArray()])).toEqual(before)
    expect(skin_snapshot(reopened)).toEqual(baseline)
    expect(reopened.clips.map(clip => clip.tracks.length)).toEqual([4, 1])
    expect(reopened.clips[0].tracks.map(track => Array.from(track.values)))
      .toEqual(asset.clips[0].tracks.map(track => Array.from(track.values)))
    expect(transfer_clips(asset, reopened, suggest_mapping(asset, reopened), [0])[0].tracks).toHaveLength(4)
    expect(reopened.nodes.size).toBe(asset.nodes.size)
    dispose_rig_scene(asset.scene)
    dispose_rig_scene(reopened.scene)
  })

  it('copies every channel on the exact same rig and gives incoming clips unique names', async () => {
    const bytes = await own_rig_fixture()
    const source = await load_rig_asset(bytes, 'Source'), target = await load_rig_asset(bytes, 'Target')
    const clips = transfer_clips(source, target, suggest_mapping(source, target), [0, 1])
    expect(clips.map(clip => clip.name)).toEqual(['Creature_AllChannels (2)', 'Jaw_Partial (2)'])
    expect(clips[0].tracks).toHaveLength(4)
    expect(clips[0].tracks[0].name).not.toBe(source.clips[0].tracks[0].name)
    expect(clips[0].tracks[0].values).toEqual(source.clips[0].tracks[0].values)
    expect(target.clips).toHaveLength(2)
    dispose_rig_scene(source.scene)
    dispose_rig_scene(target.scene)
  })

  it('rejects missing/duplicate parents and incompatible channels without mutating the target', async () => {
    const bytes = await own_rig_fixture()
    const source = await load_rig_asset(bytes, 'Source'), target = await load_rig_asset(bytes, 'Target')
    const map = suggest_mapping(source, target)
    const jaw = [...source.nodes.values()].find(node => node.name === 'Jaw')!
    expect(() => transfer_clips(source, target, { ...map, [jaw.id]: '' }, [1])).toThrow(/соответствие/)
    expect(() => transfer_clips(source, target, { ...map, [jaw.id]: map[jaw.parent_id!] }, [1])).toThrow()
    target.nodes.get(jaw.id)!.position.y = -0.6
    expect(() => transfer_clips(source, target, map, [0])).toThrow(/position/)
    expect(target.clips).toHaveLength(2)
    dispose_rig_scene(source.scene)
    dispose_rig_scene(target.scene)
  })

  it('corrects different rest axes and retains the target bone length', async () => {
    const bytes = await own_rig_fixture()
    const source = await load_rig_asset(bytes, 'Source'), target = await load_rig_asset(bytes, 'Target')
    const map = suggest_mapping(source, target)
    const node = [...target.nodes.values()].find(node => node.name === 'Jaw')!
    const rest = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
    node.rotation.copy(rest)
    node.world_rotation.copy(rest)
    node.position.y = -0.5
    target.signature = 'changed rest axes'
    restore_rig_pose(target)
    const clip = transfer_clips(source, target, map, [1])[0]
    const mixer = new AnimationMixer(target.scene)
    mixer.clipAction(clip).play()
    mixer.update(0)
    expect(node.object.quaternion.clone().normalize().angleTo(rest)).toBeLessThan(1e-6)
    mixer.update(0.5)
    const expected = new Quaternion(0.2, 0, 0, Math.sqrt(0.96)).multiply(rest)
    expect(node.object.quaternion.angleTo(expected)).toBeLessThan(1e-3)
    expect(node.object.position.y).toBe(-0.5)
    dispose_rig_scene(source.scene)
    dispose_rig_scene(target.scene)
  })
})
