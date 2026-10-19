import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { winged_creature_fixture } from './WingedCreatureFixture.ts'

export async function creature_fixture_url (): Promise<string> {
  const binary = await new GLTFExporter().parseAsync(winged_creature_fixture(), { binary: true })
  return URL.createObjectURL(new Blob([binary as ArrayBuffer], { type: 'model/gltf-binary' }))
}
