// @vitest-environment node
import { describe,it,expect } from 'vitest'
import { BoxGeometry, BufferGeometry,Float32BufferAttribute,Vector3 } from 'three'
import { ManualWeightEdits,setSelectedWeight,selectedWeight } from '../src/lib/weight-paint/ManualWeightEdits.ts'
import { SurfaceWeightBrush } from '../src/lib/weight-paint/SurfaceWeightBrush.ts'
const base={indices:[0,1,2,3],weights:[.4,.3,.2,.1]}
describe('manual weights',()=>{
 it('reaches exactly 100% for a previously absent bone without losing normalization',()=>{
  let v=base
  for(let i=0;i<10;i++){v=setSelectedWeight(v,8,selectedWeight(v,8)+.15,0);expect(v.weights.reduce((a,b)=>a+b,0)).toBeCloseTo(1,7);expect(v.weights.every(w=>w>=0&&Number.isFinite(w))).toBe(true)}
  expect(selectedWeight(v,8)).toBe(1)
  const removed=setSelectedWeight(v,8,0,1);expect(selectedWeight(removed,8)).toBe(0);expect(selectedWeight(removed,1)).toBe(1)
  expect(setSelectedWeight(v,8,0,8).weights).toEqual([1,0,0,0])
 })
 it('restores exact strokes, resets, and regenerated automatic baseline on undo/redo',()=>{
  const edits=new ManualWeightEdits(),one=setSelectedWeight(base,8,.7,0),two=setSelectedWeight(one,8,.9,0)
  edits.commit([{mesh:0,vertex:3,base,next:one}]);edits.commit([{mesh:0,vertex:3,base:one,next:two}]);expect(edits.current(0,3)).toEqual(two)
  edits.undo();expect(edits.current(0,3)).toEqual(one);edits.redo();expect(edits.current(0,3)).toEqual(two)
  edits.reset();expect(edits.current(0,3)).toEqual(base);edits.undo();expect(edits.current(0,3)).toEqual(two)
  const indices=new Array(20).fill(2),weights=new Array(20).fill(.25);edits.apply(0,indices,weights);expect(weights.slice(12,16)).toEqual(two.weights)
  edits.reset();expect(edits.current(0,3)?.weights).toEqual([.25,.25,.25,.25]);edits.undo();expect(edits.current(0,3)).toEqual(two)
  edits.clear();expect(edits.canUndo).toBe(false);expect(edits.canRedo).toBe(false)
 })
 it('smooths an isolated weight peak and keeps other influence ratios',()=>{
  const value=setSelectedWeight(base,0,.4+(.15-.4)*.5,1)
  expect(selectedWeight(value,0)).toBeCloseTo(.275)
  const w=(id:number)=>selectedWeight(value,id);expect(w(1)/w(2)).toBeCloseTo(1.5)
 })
 it('ignores empty strokes and invalidates redo after new editing',()=>{
  const e=new ManualWeightEdits();e.commit([]);expect(e.canUndo).toBe(false)
  e.commit([{mesh:0,vertex:0,base,next:setSelectedWeight(base,1,.9,0)}]);e.undo();expect(e.canRedo).toBe(true)
  e.commit([{mesh:0,vertex:0,base,next:setSelectedWeight(base,1,.8,0)}]);expect(e.canRedo).toBe(false)
 })
})
describe('surface brush',()=>{
 it('paints both copies of a seam and keeps the closest vertex when smoothing is capped', () => {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([
   -.15, 0, 0, 0, 0, 0, 0, .15, 0,
   0, 0, 0, .15, 0, 0, 0, 0, .15
  ], 3))
  geometry.setAttribute('normal', new Float32BufferAttribute([
   0, 0, 1, 0, 0, 1, 0, 0, 1,
   0, 1, 0, 0, 1, 0, 0, 1, 0
  ], 3))
  const brush = new SurfaceWeightBrush(geometry)
  const point = new Vector3(), view = new Vector3(0, 0, 1)
  const stroke = brush.query(point, .2, 1, view)
  expect(stroke.get(1)).toBe(1)
  expect(stroke.get(3)).toBe(1)
  expect(stroke.has(5)).toBe(false)
  expect([...brush.query(point, .2, 1, view, true, 1)]).toEqual([[1, 1]])
 })
 it('excludes disconnected nearby layers and the far side while retaining UV seam vertices',()=>{
  const g=new BoxGeometry(1,1,.1,8,8,1),brush=new SurfaceWeightBrush(g),p=g.getAttribute('position'),n=g.getAttribute('normal')
  const seed=Array.from({length:p.count},(_,i)=>i).find(i=>p.getZ(i)>.049 && n.getZ(i)>.5)!
  const result=brush.query(new Vector3(0,0,.05),.7,seed,new Vector3(0,0,1))
  expect(result.size).toBeGreaterThan(20);for(const i of result.keys())expect(p.getZ(i)).toBeCloseTo(.05)
  const all=brush.query(new Vector3(0,0,.05),.7,seed,new Vector3(0,0,1),false);expect(all.size).toBeGreaterThan(result.size)
  const a=new BufferGeometry();a.setAttribute('position',new Float32BufferAttribute([0,0,0,.1,0,0,0,.1,0,0,0,.01,.1,0,.01,0,.1,.01],3));a.setAttribute('normal',new Float32BufferAttribute(new Array(6).fill([0,0,1]).flat(),3));
  const r=new SurfaceWeightBrush(a).query(new Vector3(0,0,0),.2,0,new Vector3(0,0,1));expect([...r.keys()].sort()).toEqual([0,1,2])
 })
 it('is scale invariant and fades smoothly toward the edge',()=>{
  const g=new BoxGeometry(1,1,.1,8,8,1),p=g.getAttribute('position'),seed=Array.from({length:p.count},(_,i)=>i).find(i=>p.getZ(i)>.049 && g.getAttribute('normal').getZ(i)>.5)!
  const a=new SurfaceWeightBrush(g).query(new Vector3(0,0,.05),.4,seed,new Vector3(0,0,1)),b=new SurfaceWeightBrush(g.clone().scale(10,10,10)).query(new Vector3(0,0,.5),4,seed,new Vector3(0,0,1))
  expect([...a.keys()].sort()).toEqual([...b.keys()].sort());for(const [i,w] of a)expect(b.get(i)).toBeCloseTo(w,5)
  expect(Math.min(...a.values())).toBeLessThan(.1);expect(Math.max(...a.values())).toBeGreaterThan(.99)
 })
})
