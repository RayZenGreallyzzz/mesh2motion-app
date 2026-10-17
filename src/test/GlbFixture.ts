import { readFileSync } from 'node:fs'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Geometry/rig fixture: remove image decoding only; preserve all transforms. */
export async function read_glb (path: string) {
  const data = readFileSync(path)
  const length = data.readUInt32LE(12)
  const json = JSON.parse(data.subarray(20, 20 + length).toString())
  delete json.images
  delete json.textures
  delete json.materials
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) delete primitive.material
  const text = Buffer.from(JSON.stringify(json))
  const padded = Math.ceil(text.length / 4) * 4
  const binary = data.subarray(20 + length)
  const result = Buffer.alloc(20 + padded + binary.length, 32)
  data.copy(result, 0, 0, 12)
  result.writeUInt32LE(result.length, 8)
  result.writeUInt32LE(padded, 12)
  result.writeUInt32LE(0x4e4f534a, 16)
  text.copy(result, 20)
  binary.copy(result, 20 + padded)
  const array = new ArrayBuffer(result.length)
  new Uint8Array(array).set(result)
  return await new GLTFLoader().parseAsync(array, '')
}
