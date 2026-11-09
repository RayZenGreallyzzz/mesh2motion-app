import {Vector3, type SkinnedMesh} from 'three'
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


/** Final output contract, separate from the native BODY intermediate. */
export function validate_humanoid65(asset:RigAsset):void {
  validate_native_skin(asset)
  const joints=[...asset.nodes.values()].filter(n=>n.is_joint)
  if(joints.length!==65)throw new Error('Полный гуманоидный риг должен содержать 65 костей. Исходный персонаж сохранён.')
  const names=new Set(joints.map(n=>n.name))
  for(const side of ['l','r'])for(const digit of ['thumb','index','middle','ring','pinky'])for(const segment of ['01','02','03','04_leaf'])if(!names.has(digit+'_'+segment+'_'+side))throw new Error('В результате отсутствует часть пальцев. Исходный персонаж сохранён.')
  if(!names.has('head')||!names.has('neck_01'))throw new Error('Не найдены кости головы и шеи')
  asset.scene.updateWorldMatrix(true,true)
  asset.scene.traverse(object=>{
    const mesh=object as SkinnedMesh;if(!mesh.isSkinnedMesh)return
    const bones=mesh.skeleton.bones,head=bones.find(b=>b.name==='head')!,neck=bones.find(b=>b.name==='neck_01')!,tip=bones.find(b=>b.name==='head_leaf')!
    if(!head||!neck||!tip)throw new Error('Неполная цепочка головы')
    const base=head.getWorldPosition(new Vector3()),end=tip.getWorldPosition(new Vector3()),neckPoint=neck.getWorldPosition(new Vector3()),axis=end.clone().sub(base),length=axis.length(),neckLength=base.distanceTo(neckPoint)
    if(length<1e-6||neckLength<1e-6)throw new Error('Суставы головы совпали')
    axis.divideScalar(length);mesh.skeleton.update()
    const positions=mesh.geometry.getAttribute('position'),indices=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight'),p=new Vector3(),rest=new Vector3(),moved=new Vector3(),rel=new Vector3()
    for(let i=0;i<positions.count;i++){
      p.fromBufferAttribute(positions,i);rest.copy(p).applyMatrix4(mesh.matrixWorld);mesh.applyBoneTransform(i,moved.copy(p)).applyMatrix4(mesh.matrixWorld)
      if(rest.distanceTo(moved)>Math.max(length*1e-5,1e-6))throw new Error('Новая привязка меняет исходную геометрию. Исходный персонаж сохранён.')
      rel.copy(rest).sub(base);const height=rel.dot(axis),radial=rel.addScaledVector(axis,-height).length()
      if(height<Math.max(neckLength*.5,length*.2)||height>length*1.35||radial>length*.45)continue
      let rigidHead=0,foreign=0
      for(let c=0;c<4;c++){const name=bones[indices.getComponent(i,c)].name,w=weights.getComponent(i,c);if(name==='head')rigidHead+=w;else if(/^(clavicle|upperarm|lowerarm|hand|spine)/.test(name))foreign+=w}
      if(foreign>.05||rigidHead<.9)throw new Error('Веса головы зависят от плеч или туловища. Такой риг не будет принят.')
    }
  })
}
