import { CreatureAnimationLibrary } from '../src/lib/processes/animations-listing/CreatureAnimationLibrary.ts'
import { AnimationMixer, Bone, Box3, Group, Mesh, Skeleton, Vector3 } from 'three'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { read_glb } from '../src/test/GlbFixture.ts'
import { AnimalAutoFit } from '../src/lib/processes/edit-skeleton/AnimalAutoFit.ts'
import { fit_humanoid_rig } from '../src/lib/processes/edit-skeleton/HumanoidAutoFit.ts'
import { ModelCleanupUtility } from '../src/lib/processes/load-model/ModelCleanupUtility.ts'
import { StepWeightSkin } from '../src/lib/processes/weight-skin/StepWeightSkin.ts'
import { RigConfig } from '../src/lib/RigConfig.ts'
import { SkeletonType } from '../src/lib/enums/SkeletonType.ts'
import { AnimationUtility } from '../src/lib/processes/animations-listing/AnimationUtility.ts'
import { RestPoseAnimationBridge } from '../src/lib/processes/animations-listing/RestPoseAnimationBridge.ts'
import { JointVolumeSupport } from '../src/lib/solvers/JointVolumeSupport.ts'
import { HumanoidClipCalibration } from '../src/lib/processes/animations-listing/HumanoidClipCalibration.ts'
import { is_humanoid_skeleton_type } from '../src/lib/HumanoidSkeleton.ts'
const print = console.log.bind(console)
console.log = () => {}; console.time = () => {}; console.timeEnd = () => {}; console.info = () => {}
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] } as any
const directory = process.env.RIG_CHECK_OUTPUT ?? 'artifacts/rig-check'
mkdirSync(directory, { recursive: true })
const cases: Array<{ name: string, file: string, type: SkeletonType }> = process.argv[2] === '--humanoids'
  ? [
      { name: 'human', file: 'static/models/model-human.glb', type: SkeletonType.Human },
      { name: 'female', file: 'static/models-variation/human/female.glb', type: SkeletonType.MobileFemale },
      { name: 'monster', file: 'static/models-variation/human/monster_3.glb', type: SkeletonType.MobileFemale }
    ]
  : process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
  : RigConfig.all.filter(c => ![SkeletonType.Human, SkeletonType.MobileFemale].includes(c.skeleton_type))
    .map(c => ({ name: c.skeleton_type, file: 'static/' + c.model_file, type: c.skeleton_type }))
const results = []
for (const item of cases) {
  const config = RigConfig.all.find(c => c.skeleton_type === item.type)!
  const [input, rig, model] = await Promise.all([read_glb(item.file), read_glb('static/' + config.rig_file), read_glb('static/' + config.model_file)])
  const reference = AnimalAutoFit.reference(model.scene, rig.scene)
  ModelCleanupUtility.bake_transforms_into_geometry(input.scene)
  const target = ModelCleanupUtility.strip_out_all_unecessary_model_data(input.scene, item.name, false)
  ModelCleanupUtility.scale_model_on_import_if_extreme(target)
  ModelCleanupUtility.move_model_to_floor(target)
  const bones: Bone[] = []
  rig.scene.traverse(object => { if (object instanceof Bone) bones.push(object) })
  const skeleton = new Skeleton(bones)
  const source_rest = new Map(bones.map(b => [b.name, { position: b.position.clone(), quaternion: b.quaternion.clone(), parent_name: b.parent?.name }]))
  if (is_humanoid_skeleton_type(item.type)) fit_humanoid_rig(target, skeleton, null, () => {})
  else AnimalAutoFit.fit(target, skeleton, null, reference, () => {})
  const target_rest = new Map(bones.map(b => [b.name, { position: b.position.clone(), quaternion: b.quaternion.clone(), parent_name: b.parent?.name }]))
  const humanoid = is_humanoid_skeleton_type(item.type) ? new HumanoidClipCalibration(source_rest, target_rest) : null
  const joints = bones.map(b => ({ name: b.name, parent: bones.indexOf(b.parent as Bone), position: b.getWorldPosition(new Vector3()).toArray() }))
  const positions: number[] = [], triangles: number[] = []
  const step = new StepWeightSkin()
  step.create_bone_formula_object(rig.scene, item.type)
  step.create_binding_skeleton()
  target.traverse(object => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    const attribute = mesh.geometry.getAttribute('position'), offset = positions.length / 3
    for (let i = 0; i < attribute.count; i++) positions.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i))
    for (let i = 0; i < (mesh.geometry.index?.count ?? attribute.count); i++) triangles.push(offset + (mesh.geometry.index?.getX(i) ?? i))
    step.add_to_geometry_data_to_skin(mesh.geometry)
    step.add_mesh_material(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)
  })
  const start = performance.now()
  step.calculate_weights_for_all_mesh_data(false)
  const ms = performance.now() - start
  const meshes = step.final_skinned_meshes()
  const root = new Group(); root.add(...meshes)
  const output = directory + '/' + item.name
  mkdirSync(output, { recursive: true })
  writeFileSync(output + '/positions.bin', Buffer.from(new Float32Array(positions).buffer))
  writeFileSync(output + '/triangles.bin', Buffer.from(new Uint32Array(triangles).buffer))
  writeFileSync(output + '/joints.json', JSON.stringify(joints))
  const creature = item.type === SkeletonType.Dragon && CreatureAnimationLibrary.supports(step.skeleton()!)
  const clips = creature ? CreatureAnimationLibrary.generate(step.skeleton()!) : (await Promise.all(config.animation_files.map(file => read_glb('static/' + file.replace('../', ''))))).flatMap(g => g.animations)
  AnimationUtility.clean_track_data(clips, config.position_tracking_bone_name)
  let frames = 0, invalid = 0, rest_error = 0, captured = 0
  const point = new Vector3()
  root.updateWorldMatrix(true, true)
  for (const mesh of meshes) {
    mesh.skeleton.update()
    const p = mesh.geometry.getAttribute('position')
    for (let i = 0; i < p.count; i += Math.max(1, Math.ceil(p.count / 2000))) {
      point.fromBufferAttribute(p, i)
      rest_error = Math.max(rest_error, mesh.applyBoneTransform(i, point.clone()).distanceTo(point))
    }
  }
  for (const clip of clips.sort((a, b) => Number(/run|sprint/i.test(b.name)) - Number(/run|sprint/i.test(a.name)))) {
    if (humanoid) humanoid.apply(clip, 1)
    else if (!creature) RestPoseAnimationBridge.rebase_clip_to_rest_pose(clip, source_rest, target_rest)
    JointVolumeSupport.updateClip(clip, meshes[0].skeleton)
    const mixer = new AnimationMixer(root)
    mixer.clipAction(clip).play()
    for (const fraction of [0, .25, .5, .75]) {
      mixer.setTime(clip.duration * fraction)
      root.updateWorldMatrix(true, true)
      const box = new Box3()
      for (const mesh of meshes) {
        mesh.skeleton.update()
        const p = mesh.geometry.getAttribute('position')
        for (let i = 0; i < p.count; i += Math.max(1, Math.ceil(p.count / 2000))) {
          point.fromBufferAttribute(p, i)
          mesh.applyBoneTransform(i, point)
          if (!point.toArray().every(Number.isFinite)) invalid++
          box.expandByPoint(point)
        }
      }
      frames++
      if (captured < 3 && fraction === .25 && /run|walk|fly|slither/i.test(clip.name)) {
        const posed: number[] = []
        for (const mesh of meshes) {
          const p = mesh.geometry.getAttribute('position')
          for (let i = 0; i < p.count; i++) {
            point.fromBufferAttribute(p, i); mesh.applyBoneTransform(i, point); posed.push(...point.toArray())
          }
        }
        writeFileSync(output + '/' + clip.name.replace(/[^\w-]/g, '_') + '.bin', Buffer.from(new Float32Array(posed).buffer))
        captured++
      }
    }
    mixer.stopAllAction(); mixer.uncacheRoot(root)
  }
  const result = { name: item.name, vertices: positions.length / 3, clips: clips.length, frames, weights_ms: Math.round(ms), rest_error, invalid }
  results.push(result); print(JSON.stringify(result))
  if (invalid || rest_error > 1e-4) throw new Error('Invalid rig: ' + item.name)
}
writeFileSync(directory + '/results.json', JSON.stringify(results, null, 2))
