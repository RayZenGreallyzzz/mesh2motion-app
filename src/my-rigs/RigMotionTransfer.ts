import { AnimationClip, Quaternion, type Mesh } from 'three'
import type { RigAsset, RigNode } from './RigAsset.ts'

// Source node ID -> target node ID. UUIDs are ephemeral and are never persisted.
export type RigMapping = Record<string, string>

export function suggest_mapping (source: RigAsset, target: RigAsset): RigMapping {
  const result: RigMapping = {}
  if (source.signature === target.signature) {
    for (const id of source.nodes.keys()) result[id] = id
    return result
  }
  const canonical = (name: string): string => name.replace(/^mixamorig[:_]?/i, '').toLowerCase()
  for (const node of source.nodes.values()) {
    const matches = [...target.nodes.values()].filter(other => canonical(other.name) === canonical(node.name))
    if (matches.length === 1 && !Object.values(result).includes(matches[0].id)) result[node.id] = matches[0].id
  }
  return result
}

export function mapping_key (source: RigAsset, target: RigAsset): string {
  return JSON.stringify([1, source.signature, target.signature])
}

export function animated_nodes (source: RigAsset, clip_indices: number[]): RigNode[] {
  const uuids = new Set(clip_indices.flatMap(index => source.clips[index].tracks.map(track =>
    track.name.slice(0, track.name.lastIndexOf('.')))))
  // Include ancestors: matching only a wrist cannot establish compatible topology.
  const ids = new Set<string>()
  for (const node of source.nodes.values()) {
    if (!uuids.has(node.object.uuid)) continue
    let current: RigNode | undefined = node
    while (current && !ids.has(current.id)) {
      ids.add(current.id)
      current = current.parent_id ? source.nodes.get(current.parent_id) : undefined
    }
  }
  return [...source.nodes.values()].filter(node => ids.has(node.id))
}

export function transfer_clips (
  source: RigAsset, target: RigAsset, mapping: RigMapping, clip_indices: number[]
): AnimationClip[] {
  if (!clip_indices.length) throw new Error('Выберите хотя бы одну анимацию')
  if (target.clips.length + clip_indices.length > 256) throw new Error('В одном файле поддерживается до 256 анимаций')
  const required = animated_nodes(source, clip_indices)
  const used = new Set<string>()
  for (const node of required) {
    const other = target.nodes.get(mapping[node.id])
    if (!other) throw new Error('Укажите соответствие для «' + node.name + '»')
    if (used.has(other.id)) throw new Error('Одну кость нельзя назначить двум узлам источника')
    used.add(other.id)
    if ((node.parent_id ? mapping[node.parent_id] : null) !== other.parent_id) {
      throw new Error('Разная иерархия у «' + node.name + '». В этой версии нужны одинаковые цепочки родителей.')
    }
  }
  // Exporters may reorder node indices or rename nodes without changing the rig.
  // Compare mapped local rest transforms, not UUIDs or raw document indices.
  const identical = required.every(node => {
    const other = target.nodes.get(mapping[node.id])!
    return node.is_joint === other.is_joint && node.is_mesh === other.is_mesh &&
      node.position.distanceTo(other.position) < 1e-6 && node.scale.distanceTo(other.scale) < 1e-6 &&
      node.rotation.clone().normalize().angleTo(other.rotation.clone().normalize()) < 1e-6
  })
  const by_uuid = new Map([...source.nodes.values()].map(node => [node.object.uuid, node]))
  const names = new Set(target.clips.map(clip => clip.name))
  return clip_indices.map(index => {
    const clip = source.clips[index].clone()
    let name = clip.name || 'Движение'
    for (let suffix = 2; names.has(name); suffix++) name = (clip.name || 'Движение') + ' (' + suffix + ')'
    clip.name = name
    names.add(name)
    clip.tracks.forEach(track => {
      const separator = track.name.lastIndexOf('.'), property = track.name.slice(separator + 1)
      const source_node = by_uuid.get(track.name.slice(0, separator))!
      const target_node = target.nodes.get(mapping[source_node.id])!
      if (property === 'morphTargetInfluences' &&
          (source_node.morph_weights?.length !== target_node.morph_weights?.length ||
           JSON.stringify((source_node.object as Mesh).morphTargetDictionary) !==
           JSON.stringify((target_node.object as Mesh).morphTargetDictionary))) {
        throw new Error('Не совпадают морфы у «' + source_node.name + '»')
      }
      if (!identical) {
        if (property !== 'quaternion') {
          throw new Error('Клип «' + clip.name + '» содержит ' + property +
            '. Перенос таких дорожек сейчас доступен только на точно такой же риг. Для разных ригов загрузите клип вращений.')
        }
        for (const node of [source_node, target_node]) {
          if (Math.min(node.world_scale.x, node.world_scale.y, node.world_scale.z) <= 0 ||
              Math.max(node.world_scale.x, node.world_scale.y, node.world_scale.z) -
              Math.min(node.world_scale.x, node.world_scale.y, node.world_scale.z) > 1e-5) {
            throw new Error('Ретаргет вращений требует равномерного положительного масштаба костей')
          }
        }
        const left = target_node.parent_rotation.clone().invert().multiply(source_node.parent_rotation)
        const right = source_node.world_rotation.clone().invert().multiply(target_node.world_rotation)
        const cubic = Boolean((track as unknown as { createInterpolant: { isInterpolantFactoryMethodGLTFCubicSpline?: boolean } })
          .createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline)
        const stride = cubic ? 12 : 4
        for (let offset = 0; offset < track.values.length; offset += 4) {
          const value = new Quaternion().fromArray(track.values, offset)
          value.premultiply(left).multiply(right)
          // Cubic tangents are derivatives, not unit rotations.
          if (!cubic || offset % stride === 4) value.normalize()
          value.toArray(track.values, offset)
        }
      }
      track.name = target_node.object.uuid + '.' + property
    })
    return clip
  })
}
