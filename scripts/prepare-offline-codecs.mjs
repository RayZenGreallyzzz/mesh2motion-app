import { mkdirSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Copy from the exact Three.js dependency used by this build, without a CDN.
for (const [folder, files] of [
  ['basis', ['basis_transcoder.js', 'basis_transcoder.wasm']],
  ['draco/gltf', ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']]
]) {
  const target = folder.startsWith('draco') ? 'draco' : folder
  mkdirSync(resolve('static', target), { recursive: true })
  for (const file of files) copyFileSync(resolve('node_modules/three/examples/jsm/libs', folder, file), resolve('static', target, file))
}
