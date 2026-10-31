import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { Box3, Group, Mesh, Skeleton, Vector3, Float32BufferAttribute, type BufferGeometry } from 'three'
import { load_without_textures } from './chest-fixtures.ts'
import { Utility } from '../src/lib/Utilities.ts'
import { HandHelper } from '../src/lib/processes/load-skeleton/HandHelper.ts'
import { HandSkeletonType } from '../src/lib/enums/SkeletonType.ts'
export const woman_files = [
 { id:'woman-a',file:'../upload/ЧернокожаяМодель_android_512px.glb' },
 { id:'woman-b',file:'../upload/Светлокожая женщина в очках_android_512px.glb' }
]
export async function woman_fixture(file:string, rotation=-Math.PI/2){
 const source=await load_without_textures(file),model=new Group(),geometries:BufferGeometry[]=[]
 source.scene.updateMatrixWorld(true)
 source.scene.traverse(o=>{if(!(o as Mesh).isMesh)return;const g=(o as Mesh).geometry.clone(),p=g.getAttribute('position');if(!(p.array instanceof Float32Array)||p.normalized){const a=new Float32Array(p.count*3);for(let i=0;i<p.count;i++){a[i*3]=p.getX(i);a[i*3+1]=p.getY(i);a[i*3+2]=p.getZ(i)}g.setAttribute('position',new Float32BufferAttribute(a,3))}g.applyMatrix4(o.matrixWorld);g.rotateY(rotation);geometries.push(g);model.add(new Mesh(g))})
 const box=new Box3().setFromObject(model),scale=2/(box.max.y-box.min.y)
 for(const g of geometries){g.translate(0,-box.min.y,0);g.scale(scale,scale,scale)}
 const rig=await load_without_textures('baseline/rigs/rig-human.glb')
 new HandHelper().modify_hand_skeleton(rig.scene,HandSkeletonType.FiveFingers)
 const bones=Utility.bone_list_from_hierarchy(rig.scene),skeleton=new Skeleton(bones)
 return {model,geometries,rig:rig.scene,skeleton,bones,hash:createHash('sha256').update(fs.readFileSync(file)).digest('hex')}
}
export function joint_positions(skeleton:Skeleton){return Object.fromEntries(skeleton.bones.map(b=>[b.name,b.getWorldPosition(new Vector3()).toArray()]))}
