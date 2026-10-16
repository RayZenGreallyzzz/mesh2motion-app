import { Bone, CylinderGeometry, Group } from 'three'
import { CharacterWeightField } from '../lib/solvers/CharacterWeightField.ts'
import SkinningAlgorithm from '../lib/solvers/SkinningAlgorithm.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'

export async function check_worker () {
  const root = new Group(), a = new Bone(), b = new Bone(), tip = new Bone()
  a.name = 'upperarm_l'; b.name = 'forearm_l'; tip.name = 'hand_leaf_l'
  root.add(a); a.add(b); b.add(tip); a.position.y = -1; b.position.y = 1; tip.position.y = 1
  root.rotation.z = .15; root.updateWorldMatrix(true, true)
  const geometries = [new CylinderGeometry(.2, .2, 2, 48, 64, true)]
  const solver = new SkinningAlgorithm(root, SkeletonType.Human), field = new CharacterWeightField()
  let ticks = 0
  const interval = setInterval(() => ticks++, 10)
  try { await field.prepare(geometries, solver) } finally { clearInterval(interval) }
  if (!ticks) throw new Error('Main thread did not remain responsive')
  const actual = field.calculate(geometries, solver)[0]
  const expected = new CharacterWeightField().calculate(geometries, solver)[0]
  for (let i = 0; i < actual[0].length; i++) if (actual[0][i] !== expected[0][i] || Math.abs(actual[1][i] - expected[1][i]) > 1e-5) throw new Error('Worker weights differ')
  await field.prepare(geometries.map(g => g.clone()), solver)
  return { ticks, vertices: geometries[0].getAttribute('position').count }
}
