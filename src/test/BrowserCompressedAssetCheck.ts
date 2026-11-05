import {
  Mesh, MeshBasicMaterial, NearestFilter, OrthographicCamera, PlaneGeometry, Scene,
  WebGLRenderer, WebGLRenderTarget, type Texture
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { asset_decoder_path, register_asset_renderer, with_ktx2_textures } from '../lib/AssetCodecs.ts'
import { dispose_rig_scene } from '../my-rigs/RigAsset.ts'

/** Pixel comparison of the actual source KTX2 and files exported by the UI. */
export async function check_texture_roundtrip (source: number[], output: number[]) {
  const renderer = new WebGLRenderer({ antialias: false, alpha: true, premultipliedAlpha: false })
  register_asset_renderer(renderer)
  const draco = new DRACOLoader().setDecoderPath(asset_decoder_path('draco')).setWorkerLimit(1)
  const loader = with_ktx2_textures(new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder))
  const target = new WebGLRenderTarget(64, 64)
  const geometry = new PlaneGeometry(2, 2), scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, .1, 2)
  camera.position.z = 1
  const assets: Scene[] = []
  const read = async (bytes: number[]) => {
    const gltf = await loader.parseAsync(Uint8Array.from(bytes).buffer, '')
    assets.push(gltf.scene as unknown as Scene)
    let map: Texture | undefined
    gltf.scene.traverse(object => {
      const materials = (object as Mesh).material
      for (const material of Array.isArray(materials) ? materials : materials ? [materials] : []) {
        map ??= (material as MeshBasicMaterial).map ?? undefined
      }
    })
    if (!map) throw new Error('Texture was lost in export')
    map.minFilter = NearestFilter; map.magFilter = NearestFilter; map.needsUpdate = true
    const material = new MeshBasicMaterial({ map }), quad = new Mesh(geometry, material)
    scene.add(quad); renderer.setRenderTarget(target); renderer.render(scene, camera)
    const pixels = new Uint8Array(64 * 64 * 4)
    renderer.readRenderTargetPixels(target, 0, 0, 64, 64, pixels)
    scene.remove(quad); material.dispose()
    return { pixels, compressed: Boolean((map as Texture & { isCompressedTexture?: boolean }).isCompressedTexture),
      width: map.image.width, height: map.image.height, format: map.format }
  }
  try {
    const a = await read(source), b = await read(output)
    let maximum = 0, sum = 0
    for (let i = 0; i < a.pixels.length; i++) { const error = Math.abs(a.pixels[i] - b.pixels[i]); maximum = Math.max(maximum, error); sum += error }
    return { sourceCompressed: a.compressed, outputCompressed: b.compressed,
      width: a.width, height: a.height, format: a.format, maxPixelError: maximum, meanPixelError: sum / a.pixels.length }
  } finally {
    assets.forEach(dispose_rig_scene)
    renderer.setRenderTarget(null); target.dispose(); geometry.dispose(); draco.dispose()
    renderer.dispose(); renderer.forceContextLoss()
  }
}
