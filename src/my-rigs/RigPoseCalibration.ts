import { Quaternion, type Bone, type SkinnedMesh, Vector3 } from 'three'
import { PoseCalibration } from '../lib/pose/PoseCalibration.ts'
import { restore_rig_pose, type RigAsset } from './RigAsset.ts'

export function create_asset_pose_calibration(asset: RigAsset): PoseCalibration {
  restore_rig_pose(asset)
  const bones: Bone[] = []
  asset.scene.traverse(object => { const mesh = object as SkinnedMesh; if (mesh.isSkinnedMesh) bones.push(...mesh.skeleton.bones) })
  const calibration = new PoseCalibration(bones)
  calibration.set_reference_clip(asset.clips.find(clip => /^(rest[ _-]?pose|t[ _-]?pose)$/i.test(clip.name)))
  return calibration
}

/** Bake an extra calibration onto the current asset, preserving original skin data. */
export function commit_asset_pose(asset: RigAsset, calibration: PoseCalibration): void {
  if (!calibration.has_changes) return
  // Current clips may already contain a prior calibration. This new session is
  // relative to that saved pose, so clone without the classic editor metadata.
  const clips = asset.clips.map(clip => { const copy = clip.clone(); calibration.apply_clip(copy, true); return copy })
  const neutral = calibration.neutral_pose()
  const overrides = new Set(asset.pose_overrides)
  for (const node of asset.nodes.values()) {
    const pose = neutral.get(node.object as Bone); if (!pose) continue
    node.position.copy(pose.position); node.rotation.copy(pose.quaternion); node.scale.copy(pose.scale)
    overrides.add(node.id)
  }
  restore_rig_pose(asset)
  for (const node of asset.nodes.values()) {
    node.world_rotation.copy(node.object.getWorldQuaternion(new Quaternion()))
    node.parent_rotation.copy(node.object.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion())
    node.world_scale.copy(node.object.getWorldScale(new Vector3()))
  }
  asset.signature = JSON.stringify([...asset.nodes.values()].map(node => [node.id, node.name, node.parent_id, node.position.toArray(), node.rotation.toArray(), node.scale.toArray(), node.is_joint, node.is_mesh]))
  asset.clips = clips; asset.pose_overrides = overrides; asset.dirty = true
}
