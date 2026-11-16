/** Offline diagnostic: user assets stay on the machine running this bundle. */
import { readFileSync, writeFileSync } from 'node:fs'
import { AnimationMixer, Vector3, type Bone, type SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { build_rig_asset, restore_rig_pose } from '../src/my-rigs/RigAsset.ts'
import { create_asset_pose_calibration, commit_asset_pose } from '../src/my-rigs/RigPoseCalibration.ts'
import { write_clips_glb } from '../src/my-rigs/GlbClipWriter.ts'
function parts(bytes: ArrayBuffer) {
  const view = new DataView(bytes), length = view.getUint32(12, true)
  return { doc: JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length))), bin: new Uint8Array(bytes, 28 + length) }
}
async function load(bytes: ArrayBuffer) {
  const { doc, bin } = parts(bytes), clean = structuredClone(doc)
  delete clean.images; delete clean.textures; delete clean.materials
  for (const mesh of clean.meshes ?? []) for (const primitive of mesh.primitives) delete primitive.material
  const json = new TextEncoder().encode(JSON.stringify(clean)), padded = Math.ceil(json.length / 4) * 4
  const stripped = new ArrayBuffer(28 + padded + bin.length), out = new DataView(stripped), target = new Uint8Array(stripped)
  out.setUint32(0, 0x46546c67, true); out.setUint32(4, 2, true); out.setUint32(8, stripped.byteLength, true); out.setUint32(12, padded, true); out.setUint32(16, 0x4e4f534a, true)
  target.fill(32, 20, 20 + padded); target.set(json, 20); out.setUint32(20 + padded, bin.length, true); out.setUint32(24 + padded, 0x004e4942, true); target.set(bin, 28 + padded)
  const gltf = await new GLTFLoader().parseAsync(stripped, '')
  return build_rig_asset(gltf, doc, bytes, 'Horse pose check')
}
const [input, output, boneName = 'front_leg_leaf_r', leftName = 'front_leg_leaf_l'] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: node pose-check.mjs input.glb output.glb [foot-name] [ground-foot-name]')
const data = readFileSync(input), bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
const asset = await load(bytes), original = new Uint8Array(bytes).slice(), calibration = create_asset_pose_calibration(asset)
const selected = calibration.bones.find(b => b.name === boneName)!, left = calibration.bones.find(b => b.name === leftName)!
if (!selected || !left) throw new Error('Foot not found')
calibration.begin(); const before = selected.getWorldPosition(new Vector3()).toArray(), floor = left.getWorldPosition(new Vector3()).y
const result = calibration.lower_to_floor(selected, floor), after = result.tip.getWorldPosition(new Vector3()).toArray()
if (result.error > .003) throw new Error('Foot target residual: ' + result.error)
calibration.commit(); commit_asset_pose(asset, calibration)
const saved = write_clips_glb(asset, asset.clips.map((_, i) => i)); if (!saved) throw new Error('Lossless writer unavailable')
const { doc: a, bin: ab } = parts(bytes), { doc: b, bin: bb } = parts(saved)
if (ab.slice(0, a.buffers[0].byteLength).some((v, i) => v !== bb[i])) throw new Error('Original binary data changed')
if (JSON.stringify(a.skins) !== JSON.stringify(b.skins) || JSON.stringify(a.meshes) !== JSON.stringify(b.meshes)) throw new Error('Skin/geometry declarations changed')
if (original.some((v, i) => v !== new Uint8Array(bytes)[i])) throw new Error('Input mutated')
const reloaded = await load(saved), bone = [...reloaded.nodes.values()].find(n => n.name === boneName)!.object as Bone
const neutralY = bone.getWorldPosition(new Vector3()).y
if (Math.abs(neutralY - floor) > .003) throw new Error('Roundtrip default pose mismatch')
const mixer = new AnimationMixer(reloaded.scene), samples: Record<string, number[][]> = {}
for (const clip of reloaded.clips) {
  mixer.stopAllAction(); restore_rig_pose(reloaded); const action = mixer.clipAction(clip).play(); samples[clip.name] = []
  for (const t of [0, .25, .5, .75]) {
    action.time = Math.max(clip.duration * t, 0); mixer.update(0); reloaded.scene.updateWorldMatrix(true, true)
    const v = bone.getWorldPosition(new Vector3()); if (!v.toArray().every(Number.isFinite)) throw new Error('Nonfinite animated bone')
    samples[clip.name].push(v.toArray())
    reloaded.scene.traverse(o => { const mesh = o as SkinnedMesh; if (mesh.isSkinnedMesh) { mesh.skeleton.update(); for (let i = 0; i < Math.min(mesh.geometry.attributes.position.count, 150); i++) if (!mesh.applyBoneTransform(i, new Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i)).toArray().every(Number.isFinite)) throw new Error('Nonfinite skin') } })
  }
}
writeFileSync(output, new Uint8Array(saved))
console.log(JSON.stringify({ before, after, floor, residual: result.error, neutralY, clips: reloaded.clips.map(c => ({ name: c.name, tracks: c.tracks.length, duration: c.duration })), samples, binaryPrefixPreserved: true, skinPreserved: true, inputUnchanged: true }, null, 2))
