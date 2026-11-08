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
  const find = (slot: BoneSlot, side?: BoneSide): RigNode | undefined => {
    const matches = [...nodes.values()].filter(n => { const r=roles.get(n.id);return r && !r.leaf && r.slot===slot && (side===undefined || r.side===side) })
    return matches.length === 1 ? matches[0] : undefined
  }
  const ancestor = (parent: RigNode, child: RigNode): boolean => {
    const seen = new Set<string>()
    for (let id=child.parent_id;id && !seen.has(id);id=nodes.get(id)?.parent_id ?? null) { if(id===parent.id)return true;seen.add(id) }
    return false
  }
  const headPresent=[...roles.values()].some(r=>r.slot===BoneSlot.Head && !r.leaf)
  const pelvis=find(BoneSlot.Pelvis), spine=find(BoneSlot.Spine), head=headPresent?find(BoneSlot.Head):find(BoneSlot.Neck)
  // Several spine segments are normal; choose a spine that connects hips/head.
  const torso=spine ?? [...nodes.values()].find(n=>roles.get(n.id)?.slot===BoneSlot.Spine && pelvis && head && ancestor(pelvis,n) && ancestor(n,head))
  if(!pelvis || !torso || !head || !ancestor(pelvis,torso) || !ancestor(torso,head))return 0
  for(const side of [BoneSide.Left,BoneSide.Right]) {
    const upper=find(BoneSlot.UpperArm,side),lower=find(BoneSlot.LowerArm,side),hand=find(BoneSlot.Hand,side),thigh=find(BoneSlot.Thigh,side),calf=find(BoneSlot.Calf,side),foot=find(BoneSlot.Foot,side)
    if(!upper||!lower||!hand||!thigh||!calf||!foot || !ancestor(torso,upper)||!ancestor(upper,lower)||!ancestor(lower,hand)||!ancestor(pelvis,thigh)||!ancestor(thigh,calf)||!ancestor(calf,foot))return 0
  }
  const candidates=[...nodes.values()].filter(n=>{const r=roles.get(n.id);return r && r.slot!==BoneSlot.Unknown && (n===pelvis || ancestor(pelvis,n))})
  const animated=new Set(clips.flatMap(c=>c.tracks.filter(t=>/\.(position|quaternion|scale)$/.test(t.name)).map(t=>t.name.slice(0,t.name.lastIndexOf('.')))))
  if(!candidates.some(n=>animated.has(n.object.uuid)||[...nodes.values()].some(p=>animated.has(p.object.uuid)&&ancestor(p,n))))return 0
  for(let p=pelvis.parent_id;p;p=nodes.get(p)?.parent_id??null){const node=nodes.get(p)!;if(!node.is_mesh && /^(root|reference|cog)$/i.test(node.name))candidates.push(node)}
  candidates.forEach(n=>{n.is_joint=true})
  return candidates.length
}
