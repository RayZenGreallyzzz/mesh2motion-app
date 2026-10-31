// @vitest-environment node
import { expect,it } from 'vitest'
import { continuous_skin_weights } from '../src/lib/solvers/ContinuousSkinWeights.ts'
it('keeps deformed neighbours continuous when the fourth influence changes bones',()=>{
 const positions=[0,.1,.2,1,-1],values:number[]=[]
 for(let i=-100;i<=100;i++){
  const d=i*.00001,weights=continuous_skin_weights([[0,.45],[1,.25],[2,.18],[3,.06+d],[4,.06-d]])
  expect(weights.length).toBeLessThanOrEqual(4);expect(weights.reduce((s,[,w])=>s+w,0)).toBeCloseTo(1,12)
  values.push(weights.reduce((s,[bone,w])=>s+positions[bone]*w,0))
 }
 const jumps=values.slice(1).map((v,i)=>Math.abs(v-values[i]))
 expect(Math.max(...jumps)).toBeLessThan(.0001)
})
it('retains an ordinary elbow blend and remains normalized at equal-weight and tiny-weight ties',()=>{
 expect(continuous_skin_weights([[2,.6],[3,.4]])).toEqual([[2,.6],[3,.4]])
 for(const entries of [[[0,1],[1,1],[2,1],[3,1],[4,1]],[[0,1e-15],[1,1e-15],[2,1e-15],[3,1e-15],[4,1e-15]]] as Array<Array<[number,number]>>){
  const weights=continuous_skin_weights(entries);expect(weights.every(([,w])=>Number.isFinite(w)&&w>=0)).toBe(true);expect(weights.reduce((s,[,w])=>s+w,0)).toBeCloseTo(1,12)
 }
})
