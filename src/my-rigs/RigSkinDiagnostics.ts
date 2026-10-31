import type { SkinnedMesh } from 'three'
import type { RigAsset } from './RigAsset.ts'
import { joint_roles } from './RigBoneMapping.ts'
import { BoneSlot } from '../retarget/bone-automap/BoneTypes.ts'

export interface SkinDiagnostics { checked_vertices: number, cross_limb_vertices: number }

// Read-only warning, never an automatic weight repair. Anatomical labels are
// evidence of a possible problem; garments/creature membranes can be intentional.
export function inspect_skin_weights (asset: RigAsset): SkinDiagnostics {
  const roles = joint_roles(asset), groups = new Map<string, number>()
  const arms = new Set([BoneSlot.Clavicle, BoneSlot.UpperArm, BoneSlot.LowerArm, BoneSlot.Hand, BoneSlot.FingerThumb, BoneSlot.FingerIndex, BoneSlot.FingerMiddle, BoneSlot.FingerRing, BoneSlot.FingerPinky])
  const legs = new Set([BoneSlot.Thigh, BoneSlot.Calf, BoneSlot.Foot, BoneSlot.Ball])
  for (const node of asset.nodes.values()) {
    if (!node.is_joint) continue
    let group = 0
    for (let id: string | null = node.id; id; id = asset.nodes.get(id)?.parent_id ?? null) {
      const slot = roles.get(id)?.slot
      if (arms.has(slot as BoneSlot)) { group = 1; break }
      if (legs.has(slot as BoneSlot)) { group = 2; break }
      if (slot === BoneSlot.Pelvis || slot === BoneSlot.Spine || slot === 'root') break
    }
    groups.set(node.object.uuid, group)
  }
  const report: SkinDiagnostics = { checked_vertices: 0, cross_limb_vertices: 0 }
  asset.scene.traverse(object => {
    const mesh = object as SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight')
    if (!indices || !weights) return
    const bone_groups = mesh.skeleton.bones.map(bone => groups.get(bone.uuid) ?? 0)
    for (let vertex = 0; vertex < weights.count; vertex++) {
      let arm = 0, leg = 0
      for (let c = 0; c < Math.min(indices.itemSize, weights.itemSize); c++) {
        const group = bone_groups[indices.getComponent(vertex, c)], weight = weights.getComponent(vertex, c)
        if (group === 1) arm += weight
        else if (group === 2) leg += weight
      }
      report.checked_vertices++
      if (arm >= 0.1 && leg >= 0.1) report.cross_limb_vertices++
    }
  })
  return report
}
