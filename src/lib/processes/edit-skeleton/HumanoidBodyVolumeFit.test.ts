import { Bone, BoxGeometry, Group, Mesh, Vector3 } from 'three'
import { expect, it } from 'vitest'
import { fit_humanoid_body_volume } from './HumanoidBodyVolumeFit.ts'

it('moves unsupported pivots into their local volume without moving the fitted limbs', () => {
  const model = new Group(), rig = new Group()
  const part = (position: Vector3, size: Vector3) => {
    const mesh = new Mesh(new BoxGeometry(size.x, size.y, size.z))
    mesh.position.copy(position)
    model.add(mesh)
  }
  part(new Vector3(0, 1.17, 0), new Vector3(.52, .66, .32))
  for (const sign of [-1, 1]) {
    part(new Vector3(sign * .14, .43, 0), new Vector3(.22, .86, .28))
    part(new Vector3(sign * .49, 1.40, 0), new Vector3(.53, .22, .22))
  }
  const bones: Bone[] = []
  const joint = (name: string, xyz: [number, number, number], parent: Group | Bone = rig) => {
    const b = new Bone()
    b.name = name
    parent.add(b)
    b.position.copy(parent.worldToLocal(new Vector3(...xyz)))
    bones.push(b)
    return b
  }
  const pelvis = joint('pelvis', [0,.88,.24]), waist = joint('spine_01',[0,1.02,0],pelvis)
  const spine = joint('spine_02',[0,1.15,0],waist), chest = joint('spine_03',[0,1.30,0],spine)
  const knees: Bone[] = [], elbows: Bone[] = [], supported: Bone[] = [chest]
  const repaired: Bone[] = [pelvis]
  for (const side of ['l','r']) {
    const sign = side === 'l' ? 1 : -1
    const thigh = joint('thigh_' + side,[sign * .14,.80,.20],pelvis)
    knees.push(joint('calf_' + side,[sign * .14,.42,0],thigh))
    const shoulder = joint('upperarm_' + side,[sign * .24,1.47,.17],chest)
    elbows.push(joint('lowerarm_' + side,[sign * .49,1.40,0],shoulder))
    repaired.push(thigh, shoulder)
  }
  const retained = [...supported, ...knees, ...elbows]
  const before = retained.map(b => b.getWorldPosition(new Vector3()))
  const volume = fit_humanoid_body_volume(model,bones,null,1.51)
  for (const b of repaired) expect(volume.clearance(b.getWorldPosition(new Vector3()))).toBeGreaterThan(volume.step)
  retained.forEach((b, i) => expect(b.getWorldPosition(new Vector3()).distanceTo(before[i])).toBeLessThan(1e-8))
})
