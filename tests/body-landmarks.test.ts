import { PerspectiveCamera, Vector3 } from 'three'
import { expect,it,vi } from 'vitest'
import { automatic_body_depth, body_keys, HumanoidBodyReviewRequired, sample_body_depth, type BodyPoints } from '../src/my-rigs/HumanoidBodyLandmarks.ts'
import { BodyLandmarkOverlay } from '../src/my-rigs/BodyLandmarkOverlay.ts'

const uniform = (x: number,y: number,z: number) => Object.fromEntries(body_keys.map(name=>[name,[x,y,z]])) as BodyPoints

it('finds the depth of a moved guide in body coordinates independently of yaw', () => {
  const yaw = .7, vertical = new Vector3(0,1,0)
  const patch = Array.from({length:100}, (_,i) => new Vector3(.10+(i%10)*.001,.1+Math.floor(i/10)*.001, i%2 ? .09 : .15)
    .applyAxisAngle(vertical, yaw))
  const seed = new Vector3(.11,.09,.03).applyAxisAngle(vertical,yaw)
  const review = new HumanoidBodyReviewRequired(uniform(seed.x,seed.y,seed.z), sample_body_depth(patch,yaw), yaw,2)
  const target = new Vector3(.105,.105,-.25).applyAxisAngle(vertical,yaw)
  const actual = new Vector3(...automatic_body_depth(review,'calf_l',target.toArray())).applyAxisAngle(vertical,-yaw)
  expect(actual.x).toBeCloseTo(.105,8)
  expect(actual.y).toBeCloseTo(.105,8)
  expect(actual.z).toBeCloseTo(.12,6)
})

it('moves a circular touch guide and uses the side view as a depth preview', () => {
  const root = document.createElement('div'), cam = new PerspectiveCamera(45,1,.01,10)
  cam.position.z = 2; cam.updateMatrixWorld(true)
  const overlay = new BodyLandmarkOverlay(root,cam)
  const layer = root.firstElementChild as HTMLElement
  Object.defineProperties(layer,{clientWidth:{value:400},clientHeight:{value:400}})
  vi.spyOn(layer,'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({width:400,height:400}))
  const move=vi.fn(), select=vi.fn(), points=uniform(0,0,0)
  overlay.update({points,active:'pelvis',editable:true,move,select})
  expect(root.querySelectorAll('button.body-landmark-handle')).toHaveLength(8)
  const marker=root.querySelector<HTMLButtonElement>('[aria-label="Таз"]')!
  marker.setPointerCapture=vi.fn()
  const fire=(s:string,x:number)=>{
    const e=new MouseEvent(s,{clientX:x,clientY:200,button:0})
    Object.defineProperty(e,'pointerId',{value:3})
    marker.dispatchEvent(e)
  }
  fire('pointerdown',200);fire('pointermove',240)
  expect(select).toHaveBeenCalledWith('pelvis')
  expect(move.mock.calls[0][1][0]).toBeGreaterThan(.1)
  overlay.update({points,active:'pelvis',editable:false,move,select})
  fire('pointerdown',200);fire('pointermove',230)
  expect(move).toHaveBeenCalledTimes(1)
})
