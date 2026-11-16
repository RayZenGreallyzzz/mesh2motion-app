// @vitest-environment node
import { expect, it } from 'vitest'
import { Bone, BufferGeometry, Float32BufferAttribute, Group, Matrix4, Quaternion, SphereGeometry, Vector3 } from 'three'
import { protect_humanoid_chest } from '../src/lib/solvers/ChestWeightGuard.ts'

it('removes clavicle/arm leakage from anterior chest while preserving arms and existing torso support', () => {
  const root=new Group(),bones:Bone[]=[]
  const add=(name:string,parent:Group|Bone,p:number[])=>{const b=new Bone();b.name=name;b.position.fromArray(p);parent.add(b);bones.push(b);return b}
  const pelvis=add('pelvis',root,[0,1,0]),spine=add('spine_01',pelvis,[0,.2,0]),chest=add('spine_03',spine,[0,.3,0])
  for(const [side,sign] of [['l',1],['r',-1]] as const){const clavicle=add('clavicle_'+side,chest,[sign*.1,.05,0]),upper=add('upperarm_'+side,clavicle,[sign*.13,0,0]),lower=add('lowerarm_'+side,upper,[sign*.25,0,0]);add('hand_'+side,lower,[sign*.22,0,0])}
  root.updateMatrixWorld(true)
  const positions:number[]=[]
  for(const sign of [-1,1]){const s=new SphereGeometry(.13,24,16).translate(sign*.12,1.34,.14);positions.push(...s.attributes.position.array);s.dispose()}
  positions.push(.5,1.55,0,-.5,1.55,0,0,1.1,-.1)
  const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3)),ids:number[]=[],weights:number[]=[],clavicle=bones.findIndex(b=>b.name==='clavicle_l'),arm=bones.findIndex(b=>b.name==='upperarm_l')
  for(let i=0;i<positions.length/3;i++){ids.push(clavicle,arm,bones.indexOf(chest),bones.indexOf(spine));weights.push(.4,.3,.2,.1)}
  const beforeIds=ids.slice(),beforeWeights=weights.slice(),changed=protect_humanoid_chest(geometry,bones,ids,weights)
  expect(changed).toBeGreaterThan(100)
  let protectedCount=0
  for(let i=0;i<positions.length/3;i++){
    const at=i*4,total=weights.slice(at,at+4).reduce((a,b)=>a+b,0),leak=weights.slice(at,at+4).reduce((s,w,k)=>s+([clavicle,arm].includes(ids[at+k])?w:0),0)
    expect(total).toBeCloseTo(1,6);expect(weights.slice(at,at+4).every(w=>Number.isFinite(w)&&w>=0)).toBe(true)
    if(leak<1e-6)protectedCount++
  }
  expect(protectedCount).toBeGreaterThan(100)
  expect(ids.slice(-12)).toEqual(beforeIds.slice(-12));expect(weights.slice(-12)).toEqual(beforeWeights.slice(-12))
  const rotation=new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),1.2),matrix=new Matrix4().compose(new Vector3(4,-3,2),rotation,new Vector3(3,3,3))
  root.position.set(4,-3,2);root.quaternion.copy(rotation);root.scale.setScalar(3);root.updateMatrixWorld(true);geometry.applyMatrix4(matrix)
  const rotatedIds=beforeIds.slice(),rotatedWeights=beforeWeights.slice();protect_humanoid_chest(geometry,bones,rotatedIds,rotatedWeights)
  for(let i=0;i<weights.length;i++){
    const expected=weights[i];expect(rotatedWeights[i]).toBeCloseTo(expected,5);if(expected>1e-5)expect(rotatedIds[i]).toBe(ids[i])
  }
})
