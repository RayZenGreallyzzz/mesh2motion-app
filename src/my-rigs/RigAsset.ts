import {
  AnimationClip, Object3D, PropertyBinding, Quaternion, Vector3,
  type Group, type Material, type Mesh, type SkinnedMesh, type Texture
} from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GlbDocument } from './GlbEnvelope.ts'

export interface RigNode {
  id: string
  name: string
  parent_id: string | null
  object: Object3D
  position: Vector3
  rotation: Quaternion
  scale: Vector3
  world_rotation: Quaternion
  parent_rotation: Quaternion
  world_scale: Vector3
  is_joint: boolean
  is_mesh: boolean
  morph_weights?: number[]
}

export interface RigAsset {
  name: string
  scene: Group
  nodes: Map<string, RigNode>
  clips: AnimationClip[]
  source_bytes: ArrayBuffer
  signature: string
  skeleton_count: number
  vertex_count: number
  dirty: boolean
}

export function build_rig_asset (gltf: GLTF, document: GlbDocument, buffer: ArrayBuffer, name: string): RigAsset {
  const scene = gltf.scene
  scene.updateWorldMatrix(true, true)
  const nodes = new Map<string, RigNode>(), by_object = new Map<Object3D, string>()
  const joints = new Set((document.skins ?? []).flatMap(skin => skin.joints))
  scene.traverse(object => {
    const index = gltf.parser.associations.get(object)?.nodes
    if (index !== undefined) by_object.set(object, 'n' + index)
  })
  // A primitive split may have unassociated child meshes targeted by morph clips.
  scene.traverse(object => {
    if (!by_object.has(object)) {
      const parent_id = object.parent ? by_object.get(object.parent) : undefined
      if (parent_id) by_object.set(object, parent_id + '/p' + object.parent!.children.indexOf(object))
    }
  })
  for (const [object, id] of by_object) {
    nodes.set(id, {
      id, name: object.name || ('Узел ' + id), object,
      parent_id: object.parent ? by_object.get(object.parent) ?? null : null,
      position: object.position.clone(), rotation: object.quaternion.clone(), scale: object.scale.clone(),
      world_rotation: object.getWorldQuaternion(new Quaternion()),
      parent_rotation: object.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion(),
      world_scale: object.getWorldScale(new Vector3()),
      is_joint: joints.has(Number(id.slice(1))), is_mesh: (object as Mesh).isMesh === true,
      morph_weights: (object as Mesh).morphTargetInfluences?.slice()
    })
  }
  const clips = gltf.animations.map(clip => {
    const copy = clip.clone()
    for (const track of copy.tracks) {
      const parts = PropertyBinding.parseTrackName(track.name)
      const object = PropertyBinding.findNode(scene, parts.nodeName) as Object3D | null
      if (!object || !by_object.has(object) || parts.objectName || parts.propertyIndex !== undefined ||
          !['position', 'quaternion', 'scale', 'morphTargetInfluences'].includes(parts.propertyName)) {
        throw new Error('Не удалось однозначно связать дорожку анимации: ' + track.name)
      }
      if (track.times.length > 200_000 || !track.times.length || track.times.some((time, index) =>
        !Number.isFinite(time) || time < 0 || (index > 0 && time <= track.times[index - 1])) ||
        track.values.some(value => !Number.isFinite(value))) {
        throw new Error('Повреждены ключевые кадры: ' + clip.name)
      }
      track.name = object.uuid + '.' + parts.propertyName
    }
    if (!Number.isFinite(copy.duration) || copy.duration < 0 || copy.duration > 3600) {
      throw new Error('Некорректная длительность анимации')
    }
    return copy
  })
  const skeletons = new Set<unknown>()
  let vertex_count = 0
  scene.traverse(object => {
    if ((object as SkinnedMesh).isSkinnedMesh) skeletons.add((object as SkinnedMesh).skeleton)
    if ((object as Mesh).isMesh) vertex_count += (object as Mesh).geometry.getAttribute('position')?.count ?? 0
  })
  // Exact descriptor, not a lossy hash: name collisions cannot imply compatibility.
  const signature = JSON.stringify([...nodes.values()].map(node => [
    node.id, node.name, node.parent_id, node.position.toArray(), node.rotation.toArray(),
    node.scale.toArray(), node.is_joint, node.is_mesh
  ]))
  return { name, scene, nodes, clips, signature, source_bytes: buffer, skeleton_count: skeletons.size, vertex_count, dirty: false }
}

export function restore_rig_pose (asset: RigAsset): void {
  for (const node of asset.nodes.values()) {
    node.object.position.copy(node.position)
    node.object.quaternion.copy(node.rotation)
    node.object.scale.copy(node.scale)
    const weights = (node.object as Mesh).morphTargetInfluences
    if (weights && node.morph_weights) weights.splice(0, weights.length, ...node.morph_weights)
  }
  asset.scene.updateWorldMatrix(true, true)
}

export function dispose_rig_scene (scene: Object3D): void {
  const geometries = new Set<Mesh['geometry']>(), materials = new Set<Material>(), textures = new Set<Texture>()
  const skeletons = new Set<SkinnedMesh['skeleton']>()
  scene.traverse(object => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    if ((mesh as SkinnedMesh).isSkinnedMesh) skeletons.add((mesh as SkinnedMesh).skeleton)
    geometries.add(mesh.geometry)
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && (value as Texture).isTexture) textures.add(value as Texture)
      }
    }
  })
  geometries.forEach(geometry => geometry.dispose())
  skeletons.forEach(skeleton => skeleton.dispose())
  materials.forEach(material => material.dispose())
  textures.forEach(texture => {
    const bitmap = texture.source?.data
    if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap) bitmap.close()
    texture.dispose()
  })
  scene.removeFromParent()
}
