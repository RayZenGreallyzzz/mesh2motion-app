import { AnimationClip, Bone, BoxGeometry, Float32BufferAttribute, MeshBasicMaterial, Quaternion, QuaternionKeyframeTrack, Scene, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, VectorKeyframeTrack } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import JSZip from 'jszip'
import { MixamoMapper } from '../retarget/bone-automap/MixamoMapper.ts'
import { joint_character } from './HumanoidJointFixture.ts'

export async function joint_fit_import_fixtures (): Promise<Array<{ profile: string, pose: string, knee: number, elbow: number, model: number[] }>> {
  const result = []
  for (const [profile, pose, knee, elbow] of [['human', 'T', .40, .68], ['woman', 'A', .64, .58]] as const) {
    const model = await new GLTFExporter().parseAsync(joint_character(knee, elbow, pose), { binary: true }) as ArrayBuffer
    result.push({ profile, pose, knee, elbow, model: Array.from(new Uint8Array(model)) })
  }
  return result
}

export async function mixamo_import_fixture (): Promise<{ zip: number[], model: number[] }> {
  const loaded = await new GLTFLoader().loadAsync('/rigs/rig-human.glb')
  const remove: Bone[] = []
  loaded.scene.traverse(object => { if (object instanceof Bone && /^(middle|ring|pinky)_/.test(object.name)) remove.push(object) })
  remove.forEach(bone => bone.removeFromParent())
  const bones: Bone[] = []
  loaded.scene.traverse(object => {
    if (!(object instanceof Bone)) return
    object.name = (MixamoMapper.map_source_bone_name_to_mixamo(object.name) ?? object.name).replace('mixamorig','mixamorig:')
    bones.push(object)
  })
  const geometry = new BoxGeometry(.4, 1.6, .3, 2, 8, 2)
  geometry.translate(0, .9, 0)
  const count = geometry.getAttribute('position').count
  const pelvis = bones.findIndex(bone => bone.name === 'mixamorig:Hips')
  const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4)
  for (let vertex = 0; vertex < count; vertex++) { indices[vertex * 4] = pelvis; weights[vertex * 4] = 1 }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  const scene = new Scene(); scene.add(loaded.scene, mesh); scene.updateMatrixWorld(true)
  mesh.bind(new Skeleton(bones))
  const make = (name: string, amount: number) => {
    const tracks = bones.map(bone => {
      const end = bone.quaternion.clone()
      if (bone.name === 'mixamorig:LeftForeArm') end.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1), amount))
      return new QuaternionKeyframeTrack(bone.name + '.quaternion', [0,1], [...bone.quaternion.toArray(),...end.toArray()])
    })
    const hip = bones[pelvis]
    return new AnimationClip(name, 1, [...tracks, new VectorKeyframeTrack(hip.name + '.position', [0,1], [...hip.position.toArray(),...hip.position.clone().add(new Vector3(0,.02,0)).toArray()])])
  }
  const exporter = new GLTFExporter()
  const walk = await exporter.parseAsync(scene, { binary: true, animations: [make('Mixamo_Walk_Test', .7)] }) as ArrayBuffer
  const attack = await exporter.parseAsync(scene, { binary: true, animations: [make('Mixamo_Attack_Test', 1.4)] }) as ArrayBuffer
  const zip = new JSZip()
  zip.file('motions/walk.glb', walk); zip.file('motions/attack.glb', attack)
  zip.file('motions/duplicate.glb', walk); zip.file('README.txt', 'Synthetic test data created from the repository reference rig.')
  return { zip: Array.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })), model: Array.from(new Uint8Array(walk)) }
}
