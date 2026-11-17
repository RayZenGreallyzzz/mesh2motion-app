import { AnimationMixer, Float32BufferAttribute, LoopOnce, Matrix4, Vector3, type BufferGeometry } from 'three'
import { restore_rig_pose } from '../my-rigs/RigAsset.ts'
import type { FittingBody } from './body.ts'
import { clothColliders, ClothMotion } from './cloth-motion.ts'
import type { Piece } from './garments.ts'

export type ClothTarget={piece:number,bone:number,decals:number[]}
export type BakedCloth={times:Float32Array,positions:Map<number,Float32BufferAttribute[]>}

type Sample={id:number,geometry:BufferGeometry,work:BufferGeometry,source?:number[]}
export async function bakeCloth(body:FittingBody,pieces:Piece[],targets:ClothTarget[],clipIndex:number):Promise<BakedCloth>{
  const clip=body.asset.clips[clipIndex]
  if(!clip||clip.duration<=0)throw new Error('Выберите анимацию для запекания ткани.')
  if(!targets.length)throw new Error('Включите «Ткань в движении» на надетой вещи.')
  const vertexCount=targets.reduce((count,target)=>count+[target.piece,...target.decals]
    .reduce((sum,i)=>sum+pieces[i].geometry.attributes.position.count,0),0)
  const snapshots=Math.min(Math.max(8,Math.ceil(clip.duration*18)+1),24,Math.floor(1000000/vertexCount))
  if(snapshots<4)throw new Error('Для запекания выберите меньше полотен или уменьшите их сетки.')
  const times=Float32Array.from({length:snapshots},(_,i)=>i*clip.duration/(snapshots-1))
  const positions=bakeFrames(pieces,targets)
  const physics=targets.map(({piece,bone,decals})=>({
    bone,solver:new ClothMotion(pieces[piece].geometry,body.height),frame:new Matrix4(),
    meshes:[piece,...decals].map(i=>positions.samples.get(i)!)
  }))
  const current=body.bones.map(()=>new Matrix4())
  const inv=body.rest.map(matrix=>matrix.clone().invert())
  const mixed=new Matrix4(), result=new Vector3(), base=new Vector3()
  const mixer=new AnimationMixer(body.asset.scene)
  restore_rig_pose(body.asset)
  const action=mixer.clipAction(clip).setLoop(LoopOnce,1)
  action.clampWhenFinished=true;action.play()
  let previous=0
  try{
    for(const [frame,time] of times.entries()){
      const steps=Math.max(1,Math.min(25,Math.ceil((time-previous)*60)))
      const dt=(time-previous)/steps
      for(let step=1;step<=steps;step++){
        mixer.setTime(previous+dt*step)
        body.asset.scene.updateMatrixWorld(true)
        const collision=clothColliders(body)
        for(const entry of physics){
          const world=body.bones[entry.bone].matrixWorld
          entry.solver.step(dt,entry.frame.multiplyMatrices(world,inv[entry.bone]),collision)
        }
      }
      previous=time
      for(let j=0;j<body.bones.length;j++)current[j].multiplyMatrices(body.bones[j].matrixWorld,inv[j])
      for(const {solver,meshes} of physics)for(const sample of meshes){
        solver.write(sample.work,sample.source,sample.source?sample.geometry:undefined)
        const {position,skinIndex,skinWeight}=sample.geometry.attributes
        const moved=sample.work.attributes.position
        const delta=new Float32Array(position.count*3)
        for(let i=0;i<position.count;i++){
          const matrix=mixed.elements
          matrix.fill(0)
          for(let axis=0;axis<4;axis++){
            const weight=skinWeight.getComponent(i,axis)
            if(weight<=0)continue
            const source=current[skinIndex.getComponent(i,axis)].elements
            for(let cell=0;cell<16;cell++)matrix[cell]+=source[cell]*weight
          }
          if(Math.abs(mixed.determinant())<1e-9)throw new Error('В этой позе вырождается привязка ткани. Выберите другой клип.')
          result.fromBufferAttribute(moved,i).applyMatrix4(mixed.invert()).sub(base.fromBufferAttribute(position,i))
          if(!Number.isFinite(result.lengthSq()))throw new Error('В клипе есть кость с нулевым масштабом. Выберите другой клип для ткани.')
          result.toArray(delta,i*3)
        }
        const target=new Float32BufferAttribute(delta,3)
        target.name='Ткань '+(frame+1)
        positions.frames.get(sample.id)!.push(target)
      }
      await new Promise<void>(resolve=>setTimeout(resolve,0))
    }
    return {times,positions:positions.frames}
  }finally{
    mixer.stopAllAction();mixer.uncacheRoot(body.asset.scene);restore_rig_pose(body.asset)
    for(const sample of positions.samples.values())sample.work.dispose()
  }
}
function bakeFrames(pieces:Piece[],targets:ClothTarget[]){
  const samples=new Map<number,Sample>(),frames=new Map<number,Float32BufferAttribute[]>()
  for(const {piece,decals} of targets)for(const i of [piece,...decals]){
    const geometry=pieces[i].geometry
    samples.set(i,{id:i,geometry,work:geometry.clone(),source:i===piece?undefined:geometry.userData.wardrobePrintVertices})
    frames.set(i,[])
  }
  return {samples,frames}
}
