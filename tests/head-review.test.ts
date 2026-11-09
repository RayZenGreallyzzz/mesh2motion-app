// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Bone, Box3, LatheGeometry, Mesh, Vector2, Vector3 } from 'three'
import { fit_humanoid_head, fit_humanoid_head_surface } from '../src/lib/processes/edit-skeleton/HumanoidHeadFit.ts'
import { joint_fit_surface } from '../src/lib/processes/edit-skeleton/HumanoidJointFit.ts'
import { validate_head_landmarks, type HeadLandmarks } from '../src/my-rigs/HumanoidHeadReview.ts'

function skeleton() {
  const pelvis = new Bone(); pelvis.name = 'pelvis'
  const neck = new Bone(); neck.name = 'neck_01'; neck.position.y = 1.5; pelvis.add(neck)
  const head = new Bone(); head.name = 'head'; head.position.y = .25; neck.add(head)
  const tip = new Bone(); tip.name = 'head_leaf'; tip.position.y = .3; head.add(tip)
  const arms = ['l', 'r'].map((side, i) => { const b = new Bone(); b.name = 'upperarm_' + side; b.position.set(i ? -.3 : .3, 1.5, 0); pelvis.add(b); return b })
  pelvis.updateWorldMatrix(true, true)
  return [pelvis, neck, head, tip, ...arms]
}
function sparseNeck(open = false) {
  const geometry = new LatheGeometry([[.15, 0], [.25, 1.45], [.06, 1.55], [.06, 1.7], [.14, 1.78], [.1, 2.05]].map(([r, y]) => new Vector2(r, y)), 6, 0, open ? Math.PI : Math.PI * 2)
  return new Mesh(geometry)
}
describe('head landmarks independent of tessellation', () => {
  it('does not fit a cropped thick chest as the skull base', () => {
    const rings: Vector2[] = []
    const shape = [[.18, 0], [.30, 1.5], [.23, 1.69], [.07, 1.80], [.07, 1.84], [.11, 1.92], [.07, 2.05]]
    for (let i=0;i<shape.length-1;i++) for(let j=0;j<18;j++){const t=j/18;rings.push(new Vector2(shape[i][0]*(1-t)+shape[i+1][0]*t,shape[i][1]*(1-t)+shape[i+1][1]*t))}
    rings.push(new Vector2(...shape.at(-1)! as [number,number]))
    const mesh = new Mesh(new LatheGeometry(rings, 32)), bones = skeleton(), pos = mesh.geometry.attributes.position
    const points = Array.from({length:pos.count},(_,i)=>new Vector3().fromBufferAttribute(pos,i))
    expect(fit_humanoid_head(points,bones,null,2)).toBe(true)
    expect(bones[2].getWorldPosition(new Vector3()).y).toBeGreaterThan(1.77)
    expect(Math.abs(bones[2].getWorldPosition(new Vector3()).z)).toBeLessThan(.015)
    expect(bones[3].getWorldPosition(new Vector3()).y).toBeCloseTo(2.05)
    mesh.geometry.dispose()
  })
  it('retains complete contours when a caller disables triangle striding', () => {
    const mesh = sparseNeck()
    expect(fit_humanoid_head_surface(joint_fit_surface(mesh,null,1),skeleton(),null,2)).toBe(false)
    expect(fit_humanoid_head_surface(joint_fit_surface(mesh,null,Infinity),skeleton(),null,2)).toBe(true)
    mesh.geometry.dispose()
  })
  it('finds a neck in a closed sparse surface without near-neck vertices', () => {
    const mesh = sparseNeck(), bones = skeleton(), pos = mesh.geometry.attributes.position
    const points = Array.from({ length: pos.count }, (_, i) => new Vector3().fromBufferAttribute(pos, i))
    expect(fit_humanoid_head(points, bones, null, 2)).toBe(false)
    expect(fit_humanoid_head_surface(joint_fit_surface(mesh, null), bones, null, 2)).toBe(true)
    const y = bones[2].getWorldPosition(new Vector3()).y
    expect(y).toBeGreaterThan(1.55); expect(y).toBeLessThan(1.72)
    expect(bones[3].getWorldPosition(new Vector3()).y).toBeCloseTo(2.05)
    mesh.geometry.dispose()
  })
  it('requests review for open or absent geometry without changing bones', () => {
    const mesh = sparseNeck(true), bones = skeleton(), before = bones.map(b => b.position.toArray())
    expect(fit_humanoid_head_surface(joint_fit_surface(mesh, null), bones, null, 2)).toBe(false)
    expect(fit_humanoid_head_surface(new Float32Array(), bones, null, 2)).toBe(false)
    expect(bones.map(b => b.position.toArray())).toEqual(before); mesh.geometry.dispose()
  })
  it('checks manual coordinates, order and bounds before computing weights', () => {
    const bounds = new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1)), good: HeadLandmarks = { neck: [0, 1.5, 0], head: [0, 1.6, 0], head_end: [0, 1.9, 0] }
    expect(() => validate_head_landmarks(good, bounds)).not.toThrow()
    for (const bad of [{ ...good, head: [0, 1.4, 0] }, { ...good, neck: [NaN, 1.5, 0] }, { ...good, head_end: [100, 1.9, 0] }, { ...good, head_end: good.head }])
      expect(() => validate_head_landmarks(bad as HeadLandmarks, bounds)).toThrow()
  })
})
