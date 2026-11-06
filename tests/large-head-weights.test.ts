// @vitest-environment node
import { expect, it } from 'vitest'
import { Bone, BufferGeometry, Float32BufferAttribute, Group, Vector3 } from 'three'
import { protect_humanoid_head } from '../src/lib/solvers/HumanoidHeadWeights.ts'

it('keeps a broad ear on a large head while protecting a hand held beside it', () => {
  const root = new Group(), bones: Bone[] = []
  const add = (name: string, p: Vector3, parent: Group | Bone = root) => {
    const b = new Bone(); b.name = name; parent.add(b); root.updateMatrixWorld(true); b.position.copy(parent.worldToLocal(p.clone())); root.updateMatrixWorld(true); bones.push(b); return b
  }
  const pelvis = add('pelvis', new Vector3(0, .4, 0))
  const neck = add('neck_01', new Vector3(0, .85, 0), pelvis)
  const head = add('head', new Vector3(0, .95, 0), neck)
  add('head_leaf', new Vector3(0, 1.85, 0), head)
  const upper = add('upperarm_l', new Vector3(.2, .8, 0), pelvis)
  const lower = add('lowerarm_l', new Vector3(.45, 1.1, 0), upper)
  const hand = add('hand_l', new Vector3(.7, 1.4, 0), lower)
  add('index_01_l', new Vector3(.72, 1.5, 0), hand)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([-1.2, 1.45, 0, .7, 1.4, 0], 3))
  const handId = bones.indexOf(hand), headId = bones.indexOf(head)
  const ids = [handId,0,0,0, handId,0,0,0], weights = [1,0,0,0, 1,0,0,0]
  protect_humanoid_head(geometry, bones, ids, weights)
  const at = (vertex: number, bone: number) => weights.slice(vertex*4,vertex*4+4).reduce((sum,w,k)=>sum+(ids[vertex*4+k]===bone?w:0),0)
  expect(at(0, headId)).toBeGreaterThan(.99)
  expect(at(1, handId)).toBeGreaterThan(.99)
})
