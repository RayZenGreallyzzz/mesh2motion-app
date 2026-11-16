import { BoneSide, BoneSlot } from '../retarget/bone-automap/BoneTypes.ts'
import { parse_bone_name } from '../retarget/bone-automap/BoneNameTokenizer.ts'
import { resolve_slot } from '../retarget/bone-automap/BoneSlotVocabulary.ts'
import type { AnimationClip } from 'three'
import type { RigNode } from './RigAsset.ts'

/** Animation-only glTF files may contain a skeleton hierarchy without a skin.
 * glTF has no separate bone-node type: require an unambiguous connected human
 * body and animated ancestors before treating its transforms as source joints.
 * Ordinary scene animation and ambiguous/disconnected names are not inferred.
 */
export function infer_animation_skeleton (nodes: Map<string, RigNode>, clips: AnimationClip[]): number {
  if (!clips.length || [...nodes.values()].some(n => n.is_joint)) return 0
  const roles = new Map([...nodes.values()].filter(n => !n.is_mesh).map(n => {
    const parsed = parse_bone_name(n.name)
    return [n.id, { slot: resolve_slot(parsed, parsed.side), side: parsed.side, leaf: parsed.is_leaf }]
  }))
  let body = [...nodes.values()]
  const matches = (slot: BoneSlot, side?: BoneSide): RigNode[] => body.filter(n => {
    const r = roles.get(n.id)
    return r && !r.leaf && r.slot === slot && (side === undefined || r.side === side)
  })
  const find = (slot: BoneSlot, side?: BoneSide): RigNode | undefined => {
    const candidates = matches(slot, side)
    return candidates.length === 1 ? candidates[0] : undefined
  }
  const ancestor = (parent: RigNode, child: RigNode): boolean => {
    const seen = new Set<string>()
    for (let id=child.parent_id;id && !seen.has(id);id=nodes.get(id)?.parent_id ?? null) { if(id===parent.id)return true;seen.add(id) }
    return false
  }
  const pelvis = find(BoneSlot.Pelvis)
  if (!pelvis) return 0
  body = body.filter(n => n === pelvis || ancestor(pelvis, n))
  const head = matches(BoneSlot.Head).length ? find(BoneSlot.Head) : find(BoneSlot.Neck)
  const spine = find(BoneSlot.Spine)
  // Several spine segments are normal; choose a spine that connects hips/head.
  const torso = spine ?? body.find(n => roles.get(n.id)?.slot === BoneSlot.Spine && head && ancestor(n, head))
  if (!torso || !head || !ancestor(torso, head)) return 0
  const wristDrivers = new Set<string>()
  for(const side of [BoneSide.Left,BoneSide.Right]) {
    const hands = matches(BoneSlot.Hand, side)
    // Rigs such as KayKit have both wrist and hand in the same chain. Use
    // the distal joint as the hand; its animated ancestors still drive it.
    const hand = hands.find(node => hands.every(other => other === node || ancestor(other, node)))
    for (const candidate of hands) if (candidate !== hand) wristDrivers.add(candidate.id)
    const upper=find(BoneSlot.UpperArm,side),lower=find(BoneSlot.LowerArm,side),thigh=find(BoneSlot.Thigh,side),calf=find(BoneSlot.Calf,side),foot=find(BoneSlot.Foot,side)
    if(!upper||!lower||!hand||!thigh||!calf||!foot || !ancestor(torso,upper)||!ancestor(upper,lower)||!ancestor(lower,hand)||!ancestor(pelvis,thigh)||!ancestor(thigh,calf)||!ancestor(calf,foot))return 0
    if (hands.some(node => !ancestor(lower, node))) return 0
  }
  const candidates = body.filter(n => {
    const role = roles.get(n.id)
    return role && role.slot !== BoneSlot.Unknown && !wristDrivers.has(n.id)
  })
  const animated=new Set(clips.flatMap(c=>c.tracks.filter(t=>/\.(position|quaternion|scale)$/.test(t.name)).map(t=>t.name.slice(0,t.name.lastIndexOf('.')))))
  if(!candidates.some(n=>animated.has(n.object.uuid)||[...nodes.values()].some(p=>animated.has(p.object.uuid)&&ancestor(p,n))))return 0
  for(let p=pelvis.parent_id;p;p=nodes.get(p)?.parent_id??null){const node=nodes.get(p)!;if(!node.is_mesh && /^(root|reference|cog)$/i.test(node.name))candidates.push(node)}
  candidates.forEach(n=>{n.is_joint=true})
  return candidates.length
}
