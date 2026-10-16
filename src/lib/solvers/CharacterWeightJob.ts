import { Bone, BufferGeometry, Float32BufferAttribute, Group, Vector3 } from 'three'
import SkinningAlgorithm from './SkinningAlgorithm.ts'
import { type SkeletonType } from '../enums/SkeletonType.ts'

export interface WeightConfig {
  type: SkeletonType
  head: boolean
  height: number
  bones: Array<{ name: string, parent: number, position: number[] }>
}
export interface WeightJob extends WeightConfig { positions: number[], triangles: number[] }

export function solve_weight_job (job: WeightJob): number[][] {
  // Surface solver uses world endpoints/topology, not quaternion rest axes.
  const bones = job.bones.map(item => { const b = new Bone(); b.name = item.name; return b })
  const group = new Group()
  job.bones.forEach((item, i) => {
    bones[i].position.fromArray(item.position)
    if (item.parent >= 0) {
      bones[i].position.sub(new Vector3().fromArray(job.bones[item.parent].position))
      bones[item.parent].add(bones[i])
    } else group.add(bones[i])
  })
  group.updateWorldMatrix(true, true)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(job.positions, 3))
  geometry.setIndex(job.triangles)
  const solver = new SkinningAlgorithm(group, job.type)
  solver.set_geometry(geometry)
  solver.set_head_weight_correction_enabled(job.head)
  solver.set_preview_plane_height(job.height)
  const result = solver.calculate_indexes_and_weights()
  geometry.dispose()
  return result
}
