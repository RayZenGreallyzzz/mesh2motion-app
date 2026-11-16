import {
  AnimationClip, Bone, BoxGeometry, Float32BufferAttribute, Group, Quaternion, QuaternionKeyframeTrack,
  Raycaster, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, type Intersection, type Mesh
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { expect, it, vi } from 'vitest'
import { MeshEditPanel } from '../src/my-rigs/MeshEditPanel.ts'
import { write_mesh_edits, type MeshEdit } from '../src/my-rigs/MeshEditGlb.ts'
import { build_rig_asset, restore_rig_pose } from '../src/my-rigs/RigAsset.ts'
import { validate_native_skin } from '../src/my-rigs/NativeRigValidation.ts'
import { inspect_glb } from '../src/my-rigs/GlbEnvelope.ts'
import type { RigViewer } from '../src/my-rigs/RigViewer.ts'

it('edits a bound scaled GLB with the knife, saves both sides, and keeps the animation', async () => {
  const scene = new Group(), geometry = new BoxGeometry(8000, 2000, 700)
  const position = geometry.attributes.position
  const slots: number[] = []
  const weights: number[] = []
  for (let i = 0; i < position.count; i++) {
    slots.push(position.getX(i) < 0 ? 0 : 1, 0, 0, 0)
    weights.push(1, 0, 0, 0)
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(slots,4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights,4))
  const mesh = new SkinnedMesh(geometry), left = new Bone(), right = new Bone()
  mesh.scale.setScalar(.0001)
  left.name = 'left'; right.name = 'right'
  mesh.add(left, right); scene.add(mesh)
  mesh.bind(new Skeleton([left, right]))
  const bent = new Quaternion().setFromAxisAngle(new Vector3(0,1,0), .3)
  const clip = new AnimationClip('Test bend', 1, [new QuaternionKeyframeTrack('left.quaternion', [0,1], [0,0,0,1,...bent.toArray()])])
  const bytes = await new GLTFExporter().parseAsync(scene, {binary:true, animations:[clip]}) as ArrayBuffer
  const parse = async (data: ArrayBuffer) => build_rig_asset(await new GLTFLoader().parseAsync(data,''),inspect_glb(data),data,'Character')
  const asset = await parse(bytes)
  const bound = [...asset.nodes.values()].find(node => node.is_mesh)!.object as SkinnedMesh
  const preview = new Group()
  preview.add(asset.scene)
  let pick: ((hit: Intersection<Mesh>) => void) | undefined
  let blade: Group | undefined, saved: ArrayBuffer | undefined
  const view = {
    scene: preview, stop: () => restore_rig_pose(asset), model_size: () => 1,
    set_mesh_picker: (value?: typeof pick) => {pick = value},
    edit_gizmo: (target?: Group) => {blade = target},
    camera_rotation: () => new Quaternion()
  } as unknown as RigViewer
  const apply = vi.fn(async (edits: MeshEdit[]) => { saved = write_mesh_edits(bytes,edits) })
  const status = vi.fn(), panel = new MeshEditPanel(view,{apply, status})
  panel.start(asset)
  const button = (label: string) => [...panel.element.querySelectorAll('button')].find(b => b.textContent === label)!
  button('Нож').click()
  const ray = new Raycaster(new Vector3(0,0,1), new Vector3(0,0,-1))
  pick!(ray.intersectObject(bound, false)[0] as Intersection<Mesh>)
  expect(blade?.position.z).toBeCloseTo(-.001,6)
  const height = [...panel.element.querySelectorAll('label')].find(label => label.textContent?.startsWith('Высота'))!.querySelector('input')!
  height.value = '26'; height.dispatchEvent(new Event('input'))
  button('Отрезать').click()
  await vi.waitFor(() => expect(panel.has_edits).toBe(true))
  button('Применить').click()
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce())
  const reopened = await parse(saved!)
  expect(reopened.clips.map(c=>c.name)).toEqual(['Test bend'])
  expect(reopened.skeleton_count).toBe(asset.skeleton_count)
  validate_native_skin(reopened)
  const pieces = [...reopened.nodes.values()].filter(n => n.is_mesh)
  expect(pieces).toHaveLength(2)
  expect(status.mock.calls.some(([, error]) => error === true)).toBe(false)
  panel.end()
})
