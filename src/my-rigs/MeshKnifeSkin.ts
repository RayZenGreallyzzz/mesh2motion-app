import { Vector3, type BufferGeometry, type Mesh, type SkinnedMesh } from 'three'
import { BoneSide, BoneSlot } from '../retarget/bone-automap/BoneTypes.ts'
import { joint_roles } from './RigBoneMapping.ts'
import type { RigAsset } from './RigAsset.ts'

type Side = -1 | 1
export interface KnifeLegSkin { sides: readonly number[], feet: readonly [Vector3, Vector3] }

export function knife_leg_skin (asset: RigAsset, object: Mesh): KnifeLegSkin | undefined {
  const mesh = object as SkinnedMesh
  if (!mesh.isSkinnedMesh) return
  const roles = joint_roles(asset)
  const joints = new Map([...asset.nodes.values()].map(node => [node.object, roles.get(node.id)]))
  const feet = new Map<BoneSide, Vector3>()
  const sides = mesh.skeleton.bones.map(bone => {
    const role = joints.get(bone)
    if (!role || role.chain || ![BoneSlot.Thigh, BoneSlot.Calf, BoneSlot.Foot, BoneSlot.Ball].includes(role.slot as BoneSlot)) return 0
    if (role.slot === BoneSlot.Foot && !role.leaf) feet.set(role.side, bone.getWorldPosition(new Vector3()))
    if (role.side === BoneSide.Left) return 1
    return role.side === BoneSide.Right ? -1 : 0
  })
  const left = feet.get(BoneSide.Left), right = feet.get(BoneSide.Right)
  if (left && right) return { sides, feet: [left, right] }
}

export function at_foot_bridge (skin: KnifeLegSkin, point: Vector3, span: number): boolean {
  const [left, right] = skin.feet
  const across = right.clone().sub(left).setY(0)
  if (across.lengthSq() < (span * .01) ** 2) return false
  const offset = point.clone().sub(left).setY(0), fraction = offset.dot(across) / across.lengthSq()
  return fraction > .20 && fraction < .80 &&
    offset.addScaledVector(across, -fraction).length() < span * .105 &&
    point.y >= Math.min(left.y, right.y) - span * .08 &&
    point.y <= Math.max(left.y, right.y) + span * .06
}

/** The old welded bridge can have carried cross-leg weights into surviving
 * vertices on both feet. Learn which chain supports each bank away from the
 * incision, then remove only the other chain's weights near that bank. */
export function repair_knife_leg_weights (
  geometry: BufferGeometry, rims: readonly [number[], number[]],
  component: (id: number, axis: number) => number, dimensions: Vector3, skin: KnifeLegSkin
): void {
  const weights = geometry.attributes.skinWeight, joints = geometry.attributes.skinIndex
  if (!weights || !joints || !rims.every(vertices => vertices.length)) return
  const reach = Math.max(dimensions.y, dimensions.z) * .66 / dimensions.x
  const banks = rims.map((rim, i) => {
    let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const id of rim) {
      const y = component(id, 1), z = component(id, 2)
      y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      z0 = Math.min(z0, z); z1 = Math.max(z1, z)
    }
    const sign: Side = i === 0 ? -1 : 1
    return { sign, y0, y1, z0, z1, left: 0, right: 0, samples: 0, jointSide: 0 }
  })
  const verticalPad = .36, depthPad = .5
  const candidates: { id: number, bank: typeof banks[number], strength: number }[] = []
  for (let id = 0; id < weights.count; id++) {
    const x = component(id, 0)
    if (Math.abs(x) < .5 - 1e-6 || Math.abs(x) > .5 + reach) continue
    const bank = banks[x < 0 ? 0 : 1], y = component(id, 1), z = component(id, 2)
    const offset = (Math.abs(x) - .5) / reach
    const outsideY = Math.max(0, bank.y0 - y, y - bank.y1) / verticalPad
    const outsideZ = Math.max(0, bank.z0 - z, z - bank.z1) / depthPad
    const edge = Math.max(offset, outsideY, outsideZ)
    if (edge >= 1) continue
    if (offset >= .45 && outsideY < .4 && outsideZ < .4) {
      bank.samples++
      for (let i = 0; i < 4; i++) {
        const side = skin.sides[joints.getComponent(id, i)]
        const weight = weights.getComponent(id, i)
        if (side === 1) bank.left += weight
        else if (side === -1) bank.right += weight
      }
    }
    const fade = Math.max(0, (edge - .7) / .3)
    candidates.push({ id, bank, strength: 1 - fade * fade * (3 - 2 * fade) })
  }
  for (const bank of banks) {
    if (bank.samples < 3) return
    const best = Math.max(bank.left, bank.right) / bank.samples
    if (best < .76) return
    bank.jointSide = bank.left > bank.right ? 1 : -1
  }
  if (banks[0].jointSide === banks[1].jointSide) return
  for (const { id, bank, strength } of candidates) {
    const scores = Array.from({length: 4}, (_, slot) => {
      const other = skin.sides[joints.getComponent(id, slot)] === -bank.jointSide
      return weights.getComponent(id, slot) * (other ? 1 - strength : 1)
    })
    const sum = scores.reduce((a,b) => a + b, 0)
    const own = scores.some((w, slot) => w > 0 && skin.sides[joints.getComponent(id, slot)] === bank.jointSide)
    if (own && sum > 1e-6 && sum < 1 - 1e-6) weights.setXYZW(id, scores[0]/sum, scores[1]/sum, scores[2]/sum, scores[3]/sum)
  }
}
