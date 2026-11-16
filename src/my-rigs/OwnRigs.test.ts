import { describe, expect, it } from 'vitest'
import { AnimationMixer, Bone, Group, Quaternion, Vector3, type Mesh, type SkinnedMesh } from 'three'
import { own_rig_fixture } from '../test/OwnRigFixture.ts'
import { inspect_glb } from './GlbEnvelope.ts'
import { load_rig_asset, export_rig_asset } from './RigAssetLoader.ts'
import { restore_rig_pose, dispose_rig_scene, type RigAsset } from './RigAsset.ts'
import { suggest_mapping, transfer_clips } from './RigMotionTransfer.ts'
import { write_humanoid65_glb } from './Humanoid65Writer.ts'

function document_glb (json: unknown, binary_size = 0): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const size = Math.ceil(text.length / 4) * 4
  const buffer = new ArrayBuffer(20 + size + (binary_size ? 8 + binary_size : 0)), view = new DataView(buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, buffer.byteLength, true)
  view.setUint32(12, size, true)
  view.setUint32(16, 0x4e4f534a, true)
  new Uint8Array(buffer, 20, size).fill(32)
  new Uint8Array(buffer, 20, text.length).set(text)
  if (binary_size) {
    view.setUint32(20 + size, binary_size, true)
    view.setUint32(24 + size, 0x004e4942, true)
  }
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
    expect(() => inspect_glb(document_glb({ ...base, extensionsRequired: ['KHR_texture_basisu', 'KHR_meshopt_compression'],
      images: [{ uri: 'data:image/ktx2;base64,q0tUWCAyMLs=' }] }))).not.toThrow()
    expect(() => inspect_glb(document_glb({ ...base, extensionsRequired: ['KHR_texture_basisu'],
      images: [{ uri: 'https://example.org/albedo.ktx2' }] }))).toThrow(/внешний/)
  })

  it('counts only loaded mesh instances when checking the Android vertex limit', () => {
    const mesh = { primitives: [{ attributes: { POSITION: 0 } }] }
    const document = {
      asset: { version: '2.0' }, scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ children: [1] }, { mesh: 1 }],
      meshes: [mesh, mesh],
      accessors: [{ count: 1_050_000 }]
    }
    // The 65-bone writer keeps the previous mesh definition alongside the new
    // one, while the scene references just the new mesh.
    expect(() => inspect_glb(document_glb(document))).not.toThrow()
    const instanced = {
      ...document, nodes: [{ children: [1, 2] }, { mesh: 1 }, { mesh: 1 }], meshes: [mesh, mesh]
    }
    expect(() => inspect_glb(document_glb(instanced))).toThrow(/2 млн вершин/)
    const animated = {
      ...document,
      nodes: [...document.nodes, { mesh: 0 }],
      animations: [{ channels: [{ target: { node: 2, path: 'translation' } }] }]
    }
    expect(() => inspect_glb(document_glb(animated))).toThrow(/2 млн вершин/)
  })

  it('writes and reopens a 65-bone GLB above one million vertices with the original geometry', async () => {
    const count = 1_050_000, byteLength = count * 12
    const original = document_glb({
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength }],
      bufferViews: [{ buffer: 0, byteLength }],
      accessors: [{ bufferView: 0, count, componentType: 5126, type: 'VEC3', min: [0, 0, 0], max: [1, 0, 0] }]
    }, byteLength)
    new DataView(original).setFloat32(original.byteLength - 12, 1, true)
    const asset = await load_rig_asset(original, 'Dense GLB')
    const mesh = asset.nodes.get('n0')!.object as Mesh
    const rig = new Group(), bones = Array.from({ length: 65 }, (_, i) => {
      const bone = new Bone()
      bone.name = i === 0 ? 'pelvis' : 'test_joint_' + i
      return bone
    })
    rig.add(bones[0]); bones[0].add(...bones.slice(1)); rig.updateMatrixWorld(true)
    const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) weights[i * 4] = 1
    const out = write_humanoid65_glb(asset, rig, bones, [{
      source: mesh, source_node: 0, primitive: 0, world: mesh.matrixWorld, indices, weights
    }], [])
    const reopened = await load_rig_asset(out, 'Reopened')
    expect(reopened.vertex_count).toBe(count)
    expect(inspect_glb(out).skins?.[0].joints.length).toBe(65)
    const positions = (reopened.nodes.get('n0')!.object as Mesh).geometry.getAttribute('position')
    expect(positions.getX(count - 1)).toBe(1)
    dispose_rig_scene(asset.scene)
    dispose_rig_scene(reopened.scene)
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

  it('rejects missing/duplicate mappings and preserves target lengths instead of copying limb translations', async () => {
    const bytes = await own_rig_fixture()
    const source = await load_rig_asset(bytes, 'Source'), target = await load_rig_asset(bytes, 'Target')
    const map = suggest_mapping(source, target)
    const jaw = [...source.nodes.values()].find(node => node.name === 'Jaw')!
    expect(() => transfer_clips(source, target, { ...map, [jaw.id]: '' }, [1])).toThrow(/соответствие/)
    expect(() => transfer_clips(source, target, { ...map, [jaw.id]: map[jaw.parent_id!] }, [1])).toThrow()
    const targetJaw = target.nodes.get(jaw.id)!
    targetJaw.position.y = -0.6
    restore_rig_pose(target)
    // Ordinary transfer now preserves limb proportions; positional deformation
    // is a separate explicit option. The old rejection assertion predates it.
    const [converted] = transfer_clips(source, target, map, [0])
    expect(converted.tracks.some(track => track.name === targetJaw.object.uuid + '.position')).toBe(false)
    const mixer = new AnimationMixer(target.scene)
    mixer.clipAction(converted).play(); mixer.update(0.5)
    expect(targetJaw.object.position.y).toBe(-0.6)
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
