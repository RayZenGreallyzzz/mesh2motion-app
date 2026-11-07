import { Group, type Object3D, type SkinnedMesh } from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { ExportHierarchyService } from './ExportHierarchyService.ts'
import { RigRestPoseSnapshot } from '../animations-listing/RigRestPoseSnapshot.ts'

import { restore_calibrated_export_pose } from '../../pose/PoseCalibration.ts'

/** Clone every connected mesh and bone together without reparenting live objects. */
export function copy_rigs_for_export (meshes: SkinnedMesh[]): SkinnedMesh[] {
  const source = new Group()
  source.children = ExportHierarchyService.collect_objects_to_export(meshes, false)
  const copy = clone(source), pairs = new Map<Object3D, Object3D>()
  const pair = (original: Object3D, target: Object3D): void => {
    pairs.set(original, target)
    RigRestPoseSnapshot.restore_copy_pose(original, target)
    restore_calibrated_export_pose(original, target)
    original.children.forEach((child, index) => pair(child, target.children[index]))
  }
  pair(source, copy); copy.updateMatrixWorld(true)
  return meshes.map(mesh => pairs.get(mesh) as SkinnedMesh)
}

