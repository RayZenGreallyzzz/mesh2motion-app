import type { WebGLRenderer } from 'three'
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

let renderer: WebGLRenderer | undefined
let textures: KTX2Loader | undefined

/** Both the dev module in /lib and the built chunk in /assets live one level
 * below the app root. This also works below a hosting prefix and in Capacitor. */
export function asset_decoder_path (codec: 'basis' | 'draco'): string {
  const module_url = import.meta.url
  return new URL('../' + codec + '/', module_url).href
}

export function register_asset_renderer (value: WebGLRenderer): void {
  if (renderer === value) return
  textures?.dispose()
  textures = undefined
  renderer = value
}

/** One transcoder/worker per page, using the actual viewport's GPU support.
 * Ordinary GLB remains usable in headless numerical tests without a renderer. */
export function with_ktx2_textures (loader: GLTFLoader): GLTFLoader {
  if (!renderer) return loader
  textures ??= new KTX2Loader()
    .setTranscoderPath(asset_decoder_path('basis'))
    .setWorkerLimit(1)
    .detectSupport(renderer)
  return loader.setKTX2Loader(textures)
}
