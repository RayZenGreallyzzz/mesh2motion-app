// @vitest-environment node
import { Bone, BoxGeometry, Group, Mesh, Vector3 } from 'three'
import { expect, it } from 'vitest'
import { fit_digits_to_hand } from '../src/lib/processes/edit-skeleton/HumanoidHandFit.ts'

it('fits a moved wrist’s four digit chains to the individual finger lengths in the mesh', () => {
  const model = new Group()
  const box = (x0: number, x1: number, z: number, width: number, thickness: number) => {
    const mesh = new Mesh(new BoxGeometry(x1-x0,thickness,width))
    mesh.position.set((x0+x1)*.5,0,z)
    model.add(mesh)
  }
  box(0,.068,0,.074,.024)
  const tracks = [
    { name:'pinky', z:-.027, end:.119 },
    { name:'ring', z:-.009, end:.137 },
    { name:'middle', z:.009, end:.150 },
    { name:'index', z:.027, end:.140 },
    { name:'thumb', z:.050, end:.093 }
  ]
  for (const finger of tracks) box(finger.name === 'thumb' ? .028 : .068,finger.end,finger.z,.015,.018)
  const forearm = new Bone(), wrist = new Bone(), tips: Bone[] = []
  forearm.position.set(-.24,.003,0)
  wrist.position.x = .24
  forearm.add(wrist)
  for (const {name,z} of tracks) {
    let parent = wrist
    for (let i=1;i<=4;i++) {
      const bone = new Bone()
      bone.name = name + '_0' + i + (i===4 ? '_leaf_l' : '_l')
      bone.position.set(i===1 ? .06 : .022,i===1 ? .042 : 0,i===1 ? z : 0)
      parent.add(bone)
      parent=bone
    }
    tips.push(parent)
  }
  const pivot = wrist.getWorldPosition(new Vector3())
  expect(fit_digits_to_hand(model,wrist,forearm,'l',1.8)).toBe(true)
  expect(wrist.getWorldPosition(new Vector3())).toEqual(pivot)
  for (const [i,tip] of tips.slice(0,4).entries()) {
    const point=tip.getWorldPosition(new Vector3())
    expect(Math.abs(point.x-tracks[i].end)).toBeLessThan(.006)
    expect(Math.abs(point.y)).toBeLessThan(.011)
    expect(Math.abs(point.z-tracks[i].z)).toBeLessThan(.009)
  }
})
