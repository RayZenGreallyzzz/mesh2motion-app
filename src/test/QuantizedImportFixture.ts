// Re-export through Vite so browser checks do not depend on optimized module paths.
export { Box3, Vector3 } from 'three'

/** Original tiny glTF fixture matching gltfpack's integer-position + node-scale encoding. */
export function quantized_import_fixture (): ArrayBuffer {
  const positions = new Uint16Array([
    0, 0, 0, 0, 16383, 0, 0, 0, 16383, 0, 16383, 16383,
    16383, 0, 0, 16383, 16383, 0, 16383, 0, 16383, 16383, 16383, 16383
  ])
  const indices = new Uint16Array([
    0, 2, 1, 2, 3, 1, 4, 5, 6, 5, 7, 6,
    0, 4, 2, 4, 6, 2, 1, 3, 5, 3, 7, 5,
    0, 1, 4, 1, 5, 4, 2, 6, 3, 6, 7, 3
  ])
  const binary = new Uint8Array(positions.byteLength + indices.byteLength)
  binary.set(new Uint8Array(positions.buffer))
  binary.set(new Uint8Array(indices.buffer), positions.byteLength)
  const json = {
    asset: { version: '2.0', generator: 'Rig Studio quantized import regression fixture' },
    extensionsRequired: ['KHR_mesh_quantization'], extensionsUsed: ['KHR_mesh_quantization'],
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, scale: [1.8 / 16383, 1.8 / 16383, 1.8 / 16383], translation: [-0.9, -0.9, -0.9] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.05, 0.9, 0.08, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }, { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength }],
    accessors: [
      { bufferView: 0, componentType: 5123, count: 8, type: 'VEC3', min: [0, 0, 0], max: [16383, 16383, 16383] },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' }
    ]
  }
  const encoded = new TextEncoder().encode(JSON.stringify(json))
  const json_length = Math.ceil(encoded.length / 4) * 4
  const bytes = new ArrayBuffer(20 + json_length + 8 + binary.byteLength), view = new DataView(bytes)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.byteLength, true)
  view.setUint32(12, json_length, true)
  view.setUint32(16, 0x4e4f534a, true)
  new Uint8Array(bytes, 20, json_length).fill(32)
  new Uint8Array(bytes, 20, encoded.length).set(encoded)
  view.setUint32(20 + json_length, binary.byteLength, true)
  view.setUint32(24 + json_length, 0x004e4942, true)
  new Uint8Array(bytes, 28 + json_length).set(binary)
  return bytes
}
