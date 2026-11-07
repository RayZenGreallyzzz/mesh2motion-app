import type { SkinnedMesh } from 'three'
import type { RigAsset } from './RigAsset.ts'

/** Reject unusable native output before replacing the model currently on screen. */
export function validate_native_skin(asset: RigAsset): void {
  let meshes = 0
  asset.scene.traverse(object => {
    const mesh = object as SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    meshes++
    const weights = mesh.geometry.getAttribute('skinWeight'), indices = mesh.geometry.getAttribute('skinIndex'), positions = mesh.geometry.getAttribute('position'), bones = mesh.skeleton.bones.length
    if (!weights || !indices || weights.itemSize !== 4 || indices.itemSize !== 4 || weights.count !== positions.count || indices.count !== positions.count || !bones) throw new Error('Движок вернул неполную привязку кожи. Исходная модель сохранена.')
    for (let vertex = 0; vertex < weights.count; vertex++) {
      let sum = 0
      for (let component = 0; component < 4; component++) {
        const weight = weights.getComponent(vertex, component), index = indices.getComponent(vertex, component)
        if (!Number.isFinite(weight) || weight < 0 || !Number.isInteger(index) || index < 0 || index >= bones) throw new Error('В результате риггера найдены неверные веса или индексы костей.')
        sum += weight
      }
      if (Math.abs(sum - 1) > 0.002) throw new Error('В результате риггера есть вершины без нормализованных весов.')
    }
  })
  if (!meshes) throw new Error('Движок не вернул модель с весами. Исходная модель остаётся на экране.')
}
