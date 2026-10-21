import { LoadingManager, Scene, type Mesh, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { inspect_glb } from './GlbEnvelope.ts'
import { build_rig_asset, dispose_rig_scene, type RigAsset } from './RigAsset.ts'

export async function load_rig_asset (bytes: ArrayBuffer, name: string): Promise<RigAsset> {
  const document = inspect_glb(bytes)
  const manager = new LoadingManager()
  const decoder_url = new URL('../draco/', globalThis.location?.href ?? 'http://localhost/my-rigs/').href
  manager.setURLModifier(url => {
    if (/^(blob:|data:)/i.test(url) || url.startsWith(decoder_url)) return url
    throw new Error('Внешние ресурсы запрещены: загрузите GLB со встроенными текстурами')
  })
  const draco = new DRACOLoader(manager).setDecoderPath(decoder_url)
  draco.setWorkerLimit(1)
  const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder)
  let gltf
  try {
    gltf = await loader.parseAsync(bytes, '')
    return build_rig_asset(gltf, document, bytes, name.replace(/\.glb$/i, ''))
  } catch (error) {
    if (gltf) dispose_rig_scene(gltf.scene)
    throw error
  } finally {
    draco.dispose()
  }
}

// Export a private hierarchy: an active animation must never become the bind pose.
export async function export_rig_asset (asset: RigAsset, clip_indices?: number[]): Promise<ArrayBuffer> {
  const copy = clone(asset.scene)
  const objects = new Map<Object3D, Object3D>(), uuids = new Map<string, string>()
  const pair = (source: Object3D, target: Object3D): void => {
    objects.set(source, target)
    uuids.set(source.uuid, target.uuid)
    source.children.forEach((child, index) => pair(child, target.children[index]))
  }
  pair(asset.scene, copy)
  for (const node of asset.nodes.values()) {
    const object = objects.get(node.object)!
    object.position.copy(node.position)
    object.quaternion.copy(node.rotation)
    object.scale.copy(node.scale)
    const weights = (object as Mesh).morphTargetInfluences
    if (weights && node.morph_weights) weights.splice(0, weights.length, ...node.morph_weights)
  }
  copy.updateMatrixWorld(true)
  // GLTFLoader's scene Group is a container, not a glTF node. Do not add
  // another parent on every roundtrip (which would break retarget topology).
  const export_scene = new Scene()
  export_scene.name = copy.name
  export_scene.userData = copy.userData
  export_scene.add(...copy.children)
  export_scene.updateMatrixWorld(true)
  const clips = (clip_indices ?? asset.clips.map((_, i) => i)).map(index => {
    const clip = asset.clips[index]
    if (!clip) throw new Error('Анимация больше не существует')
    const result = clip.clone()
    result.tracks.forEach(track => {
      const separator = track.name.lastIndexOf('.')
      const uuid = uuids.get(track.name.slice(0, separator))
      if (!uuid) throw new Error('Не найдена цель дорожки при экспорте')
      track.name = uuid + track.name.slice(separator)
    })
    return result
  })
  const result = await new GLTFExporter().parseAsync(export_scene, {
    binary: true, animations: clips, onlyVisible: false
  })
  if (!(result instanceof ArrayBuffer)) throw new Error('Экспорт не вернул GLB')
  inspect_glb(result)
  return result
}
