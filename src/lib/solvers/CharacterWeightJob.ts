import { Bone, BufferAttribute, BufferGeometry, Float32BufferAttribute, Group, Vector3 } from 'three'
import SkinningAlgorithm from './SkinningAlgorithm.ts'
import { type SkeletonType } from '../enums/SkeletonType.ts'

export interface WeightConfig {
  type: SkeletonType
  head: boolean
  height: number
  bones: Array<{ name: string, parent: number, position: number[], non_deforming?: boolean }>
}
export interface WeightJob extends WeightConfig { positions: number[], triangles: number[] }
export interface PackedWeightJob extends WeightConfig { packed: true, positions: Float32Array<ArrayBuffer>, triangles: Uint32Array<ArrayBuffer> }
export type PackedWeights = [Uint16Array<ArrayBuffer>, Float32Array<ArrayBuffer>]

export function solve_weight_job (job: WeightJob | PackedWeightJob, progress?: (message: string) => void): number[][] {
  // Surface solver uses world endpoints/topology, not quaternion rest axes.
  const bones = job.bones.map(item => { const b = new Bone(); b.name = item.name; b.userData.rigNonDeforming = item.non_deforming; return b })
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
  if ('packed' in job) {
    geometry.setAttribute('position', new BufferAttribute(job.positions, 3))
    geometry.setIndex(new BufferAttribute(job.triangles, 1))
  } else {
    geometry.setAttribute('position', new Float32BufferAttribute(job.positions, 3))
    geometry.setIndex(job.triangles)
  }
  const solver = new SkinningAlgorithm(group, job.type)
  solver.set_geometry(geometry)
  solver.set_head_weight_correction_enabled(job.head)
  solver.set_preview_plane_height(job.height)
  try { return solver.calculate_indexes_and_weights(progress) }
  finally { geometry.dispose() }
}

export function solve_packed_weights (job: PackedWeightJob, progress?: (message: string) => void): PackedWeights {
  const [indices, weights] = solve_weight_job(job, progress)
  if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= job.bones.length || index > 65535)) {
    throw new Error('Неверный индекс кости в новом риге')
  }
  return [new Uint16Array(indices), new Float32Array(weights)]
}
