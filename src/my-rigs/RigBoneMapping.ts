import { BoneSide, BoneSlot } from '../retarget/bone-automap/BoneTypes.ts'
import { parse_bone_name, normalized_lookup_key } from '../retarget/bone-automap/BoneNameTokenizer.ts'
import { resolve_slot, is_proportional_chain_slot } from '../retarget/bone-automap/BoneSlotVocabulary.ts'
import type { RigAsset, RigNode } from './RigAsset.ts'
export type RigMapping = Record<string, string>
export interface JointRole { slot: BoneSlot | 'root', side: BoneSide, chain: string, leaf: boolean }
export function ordered_nodes (asset: RigAsset): RigNode[] {
  const result: RigNode[] = [], seen = new Set<string>(), visiting = new Set<string>()
  const visit = (node: RigNode): void => {
    if (seen.has(node.id)) return
    if (visiting.has(node.id)) throw new Error('Цикл в иерархии скелета')
    visiting.add(node.id)
    const parent = node.parent_id ? asset.nodes.get(node.parent_id) : undefined
    if (parent) visit(parent)
    visiting.delete(node.id); seen.add(node.id); result.push(node)
  }
  asset.nodes.forEach(visit); return result
}
export function is_volume_node (node: RigNode): boolean {
  return /^rig_volume_/i.test(node.name) || node.object.userData.rigJointVolume?.version === 1
}
export function joint_roles (asset: RigAsset): Map<string, JointRole> {
  const result = new Map<string, JointRole>()
  for (const node of ordered_nodes(asset)) {
    if (!node.is_joint || is_volume_node(node)) continue
    const parsed = parse_bone_name(node.name), parent = node.parent_id ? result.get(node.parent_id) : undefined
    const side = parsed.side === BoneSide.Unknown ? parent?.side ?? BoneSide.Unknown : parsed.side
    const key = normalized_lookup_key(node.name)
    const slot = /^(lowerback|upperback|back)\d*$/.test(key) ? BoneSlot.Spine : parsed.tokens.length === 1 && /^(root|reference|cog)$/.test(parsed.tokens[0]) ? 'root' : resolve_slot(parsed, side)
    const limb = [BoneSlot.Thigh, BoneSlot.Calf, BoneSlot.Foot, BoneSlot.Ball, BoneSlot.Clavicle, BoneSlot.UpperArm, BoneSlot.LowerArm, BoneSlot.Hand].includes(slot as BoneSlot)
    const chain = (limb ? parsed.tokens.filter(token => /^(front|back|hind|rear)$/.test(token)).join('.') : '') || parent?.chain || ''
    result.set(node.id, { slot, side, chain, leaf: parsed.is_leaf })
  }
  // A creature's "Hips" can be a torso bone above the actual leg parent.
  const ancestor = (parent: string, child: string): boolean => {
    for (let id: string | null | undefined = child; id; id = asset.nodes.get(id)?.parent_id) if (id === parent) return true
    return false
  }
  const find = (slot: BoneSlot, side?: BoneSide): string | undefined => [...result].find(([, r]) => r.slot === slot && !r.leaf && !r.chain && (side === undefined || r.side === side))?.[0]
  const left = find(BoneSlot.Thigh, BoneSide.Left), right = find(BoneSlot.Thigh, BoneSide.Right), pelvis = find(BoneSlot.Pelvis)
  if (left && right && pelvis && !(ancestor(pelvis, left) && ancestor(pelvis, right))) {
    let common = asset.nodes.get(left)?.parent_id
    while (common && !ancestor(common, right)) common = asset.nodes.get(common)?.parent_id
    const role = common ? result.get(common) : undefined
    const torso = [...result].filter(([, r]) => [BoneSlot.Spine, BoneSlot.Neck, BoneSlot.Head].includes(r.slot as BoneSlot))
    if (common && role?.slot === BoneSlot.Unknown && ancestor(common, pelvis) && torso.some(([id]) => ancestor(pelvis, id))) {
      result.set(common, { ...role, slot: BoneSlot.Pelvis })
      result.set(pelvis, { ...result.get(pelvis)!, slot: BoneSlot.Spine })
    }
  }
  return result
}
export function suggest_mapping (source: RigAsset, target: RigAsset): RigMapping {
  const result: RigMapping = {}
  if (source.signature === target.signature) { for (const id of source.nodes.keys()) if (target.nodes.has(id)) result[id] = id; return result }
  const source_roles = joint_roles(source), target_roles = joint_roles(target)
  // A semantic group can contain several branches (wing fingers, extra necks).
  // Preserve unambiguous names before using anatomical/proportional guesses.
  // Require uniqueness on BOTH sides: duplicate source names are not evidence.
  const key = (node: RigNode) => [node.is_joint, node.is_mesh, normalized_lookup_key(node.name)].join('|')
  const sourceNames = new Map<string, RigNode[]>(), targetNames = new Map<string, RigNode[]>()
  for (const [asset, names] of [[source, sourceNames], [target, targetNames]] as const) {
    for (const node of asset.nodes.values()) {
      if (is_volume_node(node) || !normalized_lookup_key(node.name)) continue
      const k = key(node); names.set(k, [...(names.get(k) ?? []), node])
    }
  }
  const reserved = new Set<string>()
  const linear_proportional = (asset: RigAsset, roles: Map<string, JointRole>, node: RigNode): boolean => {
    const role=roles.get(node.id)
    if(!role||role.slot==='root'||!is_proportional_chain_slot(role.slot))return false
    const chain=ordered_nodes(asset).filter(n=>{const r=roles.get(n.id);return r&&!r.leaf&&r.slot===role.slot&&r.side===role.side&&r.chain===role.chain})
    return chain.every((n,i)=>{
      if(!i)return true
      for(let id=n.parent_id;id;id=asset.nodes.get(id)?.parent_id??null)if(id===chain[i-1].id)return true
      return false
    })
  }
  const shadowed = (asset: RigAsset, roles: Map<string, JointRole>, node: RigNode): boolean => {
    const role=roles.get(node.id)
    if (!role || node.position.lengthSq()>1e-12 || role.slot==='root' || role.slot===BoneSlot.Pelvis || role.slot===BoneSlot.Unknown || is_proportional_chain_slot(role.slot)) return false
    return [...asset.nodes.values()].some(other=>{
      const r=roles.get(other.id)
      if (!r || r.slot!==role.slot || r.side!==role.side || r.chain!==role.chain || other.position.lengthSq()<=1e-12) return false
      for(let id=other.parent_id;id;id=asset.nodes.get(id)?.parent_id??null)if(id===node.id)return true
      return false
    })
  }
  for (const [k, a] of sourceNames) {
    const b = targetNames.get(k)
    if (a.length !== 1 || b?.length !== 1) continue
    if (shadowed(source,source_roles,a[0]) || shadowed(target,target_roles,b[0])) continue
    const ar = source_roles.get(a[0].id), br = target_roles.get(b[0].id)
    if (ar && br && ar.slot !== BoneSlot.Unknown && br.slot !== BoneSlot.Unknown && (ar.slot !== br.slot || ar.side !== br.side || ar.chain !== br.chain)) continue
    // CMU LowerBack/Spine/Spine1 corresponds to Mixamo Spine/Spine1/Spine2.
    // Anchoring the shared spelling shifts the whole chain and leaves its base
    // unmapped. Linear anatomical chains use relative order; named branches
    // (including wing fingers) still retain exact-name priority.
    if(linear_proportional(source,source_roles,a[0])&&linear_proportional(target,target_roles,b[0]))continue
    result[a[0].id] = b[0].id; reserved.add(b[0].id)
  }
  const groups = (asset: RigAsset, roles: Map<string, JointRole>): Map<string, RigNode[]> => {
    const map = new Map<string, RigNode[]>()
    for (const node of ordered_nodes(asset)) {
      const role = roles.get(node.id)
      if (!role || role.slot === BoneSlot.Unknown || role.leaf) continue
      const key = [role.slot, role.side, role.chain].join('|'), group = map.get(key) ?? []
      group.push(node); map.set(key, group)
    }
    // CMU BVH inserts zero-offset HipJoint/Neck helpers before the real joints.
    // Prefer their anatomical descendants; their rotations still contribute via FK.
    for (const [key, group] of map) {
      const slot = roles.get(group[0].id)!.slot
      if (slot === 'root' || slot === BoneSlot.Pelvis || is_proportional_chain_slot(slot)) continue
      map.set(key, group.filter(node => node.position.lengthSq() > 1e-12 || !group.some(other => {
        if (other === node || other.position.lengthSq() <= 1e-12) return false
        for (let id = other.parent_id; id; id = asset.nodes.get(id)?.parent_id ?? null) if (id === node.id) return true
        return false
      })))
    }
    return map
  }
  const from = groups(source, source_roles), to = groups(target, target_roles)
  for (const [key, a] of from) {
    const b = to.get(key); if (!b?.length) continue
    const slot = source_roles.get(a[0].id)!.slot, proportional = slot !== 'root' && is_proportional_chain_slot(slot), count = Math.min(a.length, b.length)
    for (let i = 0; i < count; i++) {
      const f = count > 1 ? i / (count - 1) : 0
      const first = a[proportional ? Math.round(f * (a.length - 1)) : i], second = b[proportional ? Math.round(f * (b.length - 1)) : i]
      if (!result[first.id] && !reserved.has(second.id)) { result[first.id] = second.id; reserved.add(second.id) }
    }
  }
  // Exact names were already considered above. A second name-only fallback
  // would bypass ambiguity, helper and anatomical checks that rejected them.
  return result
}
export function mapping_key (source: RigAsset, target: RigAsset): string { return JSON.stringify([4, source.signature, target.signature]) }
export function mapping_family_key (source: RigAsset, target: RigAsset): string {
  // Reuse user-approved assignments for the same names/IDs/hierarchy. Pose and
  // proportions still get recalculated for each donor by plan_transfer.
  return JSON.stringify(['family-1', [...source.nodes.values()].map(n => [n.id, n.name, n.parent_id, n.is_joint, n.is_mesh]), target.signature])
}
export function animated_nodes (source: RigAsset, clip_indices: number[]): RigNode[] {
  const uuids = new Set(clip_indices.flatMap(index => {
    const clip = source.clips[index]; if (!clip) throw new Error('Анимация больше не существует')
    return clip.tracks.map(track => track.name.slice(0, track.name.lastIndexOf('.')))
  }))
  const ids = new Set<string>()
  for (const node of source.nodes.values()) {
    if (!uuids.has(node.object.uuid)) continue
    let current: RigNode | undefined = node
    while (current && !ids.has(current.id)) { ids.add(current.id); current = current.parent_id ? source.nodes.get(current.parent_id) : undefined }
  }
  return ordered_nodes(source).filter(node => ids.has(node.id))
}
