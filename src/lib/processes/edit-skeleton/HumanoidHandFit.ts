import {
  BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, Quaternion, Vector3, type Bone, type Object3D
} from 'three'
import { CreatureVolume } from './CreatureVolume.ts'
import { visit_fit_geometry } from './HumanoidJointFit.ts'

function hand_surface (model: Object3D, to_hand: Matrix4, height: number): BufferGeometry | undefined {
  const vertices: number[] = [], point = new Vector3()
  model.updateWorldMatrix(true, true)
  visit_fit_geometry(model, (mesh, geometry) => {
    const attr = geometry.attributes.position
    const matrix = to_hand.clone().multiply(mesh.matrixWorld)
    const coordinates = new Float32Array(attr.count * 3), nearby = new Uint8Array(attr.count)
    for (let id = 0; id < attr.count; id++) {
      point.fromBufferAttribute(attr,id).applyMatrix4(matrix)
      if (point.y < -height * .023 || point.y > height * .16 ||
        Math.abs(point.x) > height * .064 || Math.abs(point.z) > height * .064) continue
      point.toArray(coordinates,id * 3)
      nearby[id] = 1
    }
    const index = geometry.index, count = index?.count ?? attr.count
    for (let i = 0; i + 2 < count; i += 3) {
      const a = index?.getX(i) ?? i, b = index?.getX(i+1) ?? i+1, c = index?.getX(i+2) ?? i+2
      if (!nearby[a] || !nearby[b] || !nearby[c]) continue
      for (const id of [a,b,c]) vertices.push(coordinates[id*3],coordinates[id*3+1],coordinates[id*3+2])
    }
  })
  if (vertices.length < 90) return
  return new BufferGeometry().setAttribute('position',new Float32BufferAttribute(vertices,3))
}

const fingers = ['pinky','ring','middle','index'] as const
const world = (bone: Bone): Vector3 => bone.getWorldPosition(new Vector3())

/** Place the digit chains in the actual hand volume, keeping the manual wrist
 * pivot and the authored bone rotation bases. Each hand is fitted separately. */
export function fit_digits_to_hand (
  model: Object3D, hand: Bone, forearm: Bone, side: 'l' | 'r', height: number
): boolean {
  const bones = new Map<string,Bone>()
  hand.traverse(object => { if ((object as Bone).isBone) bones.set(object.name,object as Bone) })
  const chain = (name: string) => [1,2,3,4].map(i => bones.get(name + '_0' + i + (i === 4 ? '_leaf_' : '_') + side))
  const chains = [...fingers,'thumb'].map(chain)
  if (chains.some(digit => digit.some(bone => !bone))) return false
  const wrist = world(hand), forward = wrist.clone().sub(world(forearm)).normalize()
  const spread = world(chains[3][0]!).sub(world(chains[0][0]!))
  spread.addScaledVector(forward,-spread.dot(forward)).normalize()
  if (forward.lengthSq() < .99 || spread.lengthSq() < .99) return false
  const thickness = new Vector3().crossVectors(forward,spread)
  const from_hand = new Matrix4().makeBasis(thickness,forward,spread).setPosition(wrist)
  const geometry = hand_surface(model,from_hand.clone().invert(),height)
  if (!geometry) return false
  let volume: CreatureVolume
  try { volume = new CreatureVolume(new Mesh(geometry, []),null,new Quaternion(),[],132) }
  finally { geometry.dispose() }
  const step = volume.step
  const cells = volume.cells.map(id => ({ point:volume.point(id), radius:volume.radius[id] * step }))
  const distal = cells.filter(({point}) => point.y > 0)
  if (distal.length < 40) return false
  let reach = 0
  for (const {point} of distal) reach = Math.max(reach,point.y)
  if (reach < height * .025 || reach > height * .14) return false
  let lower = Infinity, upper = -Infinity
  for (const {point} of distal) {
    if (point.y < reach * .65 || point.y > reach * .71) continue
    lower = Math.min(lower,point.z); upper = Math.max(upper,point.z)
  }
  const width = upper - lower
  if (!(width > step * 9) || width > reach) return false
  const best = (score: (point: Vector3,radius: number) => number): Vector3 | undefined => {
    let high = -Infinity, found: Vector3 | undefined
    for (const {point,radius} of distal) {
      const value = score(point,radius)
      if (value > high) { high = value; found = point }
    }
    return found
  }
  const inside = (target: Vector3, across: number, along: number) => best((p,r) =>
    Math.abs(p.y-target.y) <= along && Math.abs(p.z-target.z) <= across
      ? r * 2 - Math.abs(p.y-target.y) * 2.6 - Math.abs(p.z-target.z) * 3.3 - Math.abs(p.x-target.x) * .05
      : -Infinity)
  const positions: Vector3[][] = []
  for (const fraction of [.12,.38,.63,.87]) {
    const z = lower + width * fraction
    const tip = best((p,r) => p.y >= reach*.58 && Math.abs(p.z-z)<width*.09 ?
      p.y + r*.3 - Math.abs(p.z-z)*1.45 : -Infinity)
    if (!tip) return false
    const digit = [.43,.65,.83,1].map(r => r === 1 ? tip : inside(
      new Vector3(tip.x,tip.y*r,z),width*.13,Math.max(step*2,reach*.048)))
    if (digit.some(p => !p)) return false
    positions.push(digit as Vector3[])
  }
  const thumbTip = best((p,r) => p.y > reach*.20 && p.y < reach*.76 && p.z > upper+step*2
    ? p.z + p.y*.32 + r*.3 : -Infinity)
  if (thumbTip) {
    const base = inside(new Vector3(thumbTip.x,thumbTip.y*.26,upper-width*.10),width*.20,reach*.085)
    if (base) {
      const thumb = [base,...[.36,.72].map(f => inside(base.clone().lerp(thumbTip,f),width*.21,reach*.07)),thumbTip]
      if (thumb.every(p => p)) positions.push(thumb as Vector3[])
    }
  }
  // Leave an inseparable thumb at its template shape. The four fingers use
  // their measured palm width and individual reach.
  for (const [i, digit] of positions.entries()) {
    for (const [j, point] of digit.entries()) {
      const bone = chains[i][j]!, target = point.clone().applyMatrix4(from_hand)
      bone.position.copy(bone.parent!.worldToLocal(target))
      bone.updateWorldMatrix(false,true)
    }
  }
  return true
}
