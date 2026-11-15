import { PerspectiveCamera, Vector3 } from 'three'
import { readFileSync } from 'node:fs'
import { expect,it,vi } from 'vitest'
import { automatic_body_depth, body_keys, HumanoidBodyReviewRequired, mirror_body_points, move_body_point, sample_body_depth, type BodyPoints } from '../src/my-rigs/HumanoidBodyLandmarks.ts'
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

  points.calf_l = [.07,0,0]
  overlay.update({points,active:'pelvis',editable:true,move,select})
  fire('pointerdown',217);fire('pointermove',227)
  expect(move.mock.calls[1][0]).toBe('calf_l')

  for (const event of ['contextmenu','selectstart','dragstart']) {
    expect(marker.dispatchEvent(new Event(event,{bubbles:true,cancelable:true}))).toBe(false)
  }
})

it('draws small transparent rings with five colors shared by landmark type', () => {
  const root = document.createElement('div'), style = document.createElement('style')
  style.textContent = readFileSync('src/my-rigs/studio-workspace.css','utf8')
  document.head.append(style); document.body.append(root)
  try {
    const overlay = new BodyLandmarkOverlay(root, new PerspectiveCamera())
    overlay.update({points:uniform(0,0,0),active:'pelvis',editable:false,move:vi.fn(),select:vi.fn()})
    const markers = [...root.querySelectorAll<HTMLButtonElement>('button.body-landmark-handle')]
    expect(markers).toHaveLength(8)
    const colors = markers.map(marker => marker.style.getPropertyValue('--landmark-color'))
    expect(new Set(colors).size).toBe(5)
    for (const i of [2,4,6]) expect(colors[i]).toBe(colors[i+1])
    for (const marker of markers) {
      expect(marker.textContent).toBe('')
      expect(getComputedStyle(marker).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      const ring = getComputedStyle(marker.querySelector('.body-landmark-ring')!)
      expect(ring.width).toBe('32px')
      expect(ring.height).toBe('32px')
      expect(ring.boxSizing).toBe('border-box')
      expect(ring.backgroundColor).toBe('rgba(0, 0, 0, 0)')
      expect(getComputedStyle(marker).width).toBe('48px')
    }
  } finally { root.remove(); style.remove() }
})

it('sets and drags mirrored pairs about the offset, rotated body plane', () => {
  const yaw = .6, up = new Vector3(0,1,0)
  const world = (x:number,y:number,z:number) => new Vector3(x,y,z).applyAxisAngle(up,yaw).toArray()
  const initial = Object.fromEntries(body_keys.map(name=>[name,world(.2,0,0)])) as BodyPoints
  initial.calf_l = world(.31, -.4, .10)
  initial.calf_r = world(.08, -.36, .04)
  const review = new HumanoidBodyReviewRequired(initial,new Float32Array(),yaw,2)
  const coords = (name:'calf_l'|'calf_r') => new Vector3(...review.points[name]).applyAxisAngle(up,-yaw)
  mirror_body_points(review)
  expect(coords('calf_l').x + coords('calf_r').x).toBeCloseTo(.4,8)
  expect(coords('calf_l').y).toBeCloseTo(coords('calf_r').y,8)
  expect(coords('calf_l').z).toBeCloseTo(coords('calf_r').z,8)
  move_body_point(review,'calf_l',world(.35,-.33,.2),true)
  expect(coords('calf_r').x).toBeCloseTo(.05,8)
  expect(coords('calf_r').y).toBeCloseTo(-.33,8)
  expect(coords('calf_r').z).toBeCloseTo(coords('calf_l').z,8)
  const before = [...review.points.calf_r]
  move_body_point(review,'calf_l',world(.28,-.27,.1),false)
  expect(review.points.calf_r).toEqual(before)
})
