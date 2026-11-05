import { QuaternionKeyframeTrack, type AnimationClip } from 'three'
import { MixamoMapper } from '../../../retarget/bone-automap/MixamoMapper.ts'
import { normalized_lookup_key } from '../../../retarget/bone-automap/BoneNameTokenizer.ts'
import { RestSpaceRetargeter, type BoneRestSpace } from '../../../retarget/RestSpaceRetargeter.ts'
import { HumanoidClipCalibration, type HumanoidRestJoint } from './HumanoidClipCalibration.ts'

const CORE_BONES = ['pelvis', 'head', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r']

export function is_mixamo_source (rest: ReadonlyMap<string, BoneRestSpace>): boolean {
  const keys = new Set([...rest.keys()].map(normalized_lookup_key))
  const matched = CORE_BONES.filter(name => keys.has(normalized_lookup_key(MixamoMapper.map_source_bone_name_to_mixamo(name)!))).length
  return matched >= Math.ceil(CORE_BONES.length * .8)
}

/** Reuse the editor's Mixamo name table and fitted-pose calibration for imported motions. */
export function retarget_imported_clips (
  clips: AnimationClip[], source: ReadonlyMap<string, BoneRestSpace>,
  target: ReadonlyMap<string, BoneRestSpace>, human_reference?: ReadonlyMap<string, BoneRestSpace>
): AnimationClip[] {
  const mixamo = is_mixamo_source(source)
  const destination = mixamo && human_reference ? human_reference : target
  const names = new Map<string, string[]>()
  for (const name of source.keys()) {
    const key = normalized_lookup_key(name)
    names.set(key, [...(names.get(key) ?? []), name])
  }
  const mappings = new Map<string, string>()
  for (const name of destination.keys()) {
    if (source.has(name)) { mappings.set(name, name); continue }
    if (!mixamo || name.startsWith('rig_volume_')) continue
    const expected = MixamoMapper.map_source_bone_name_to_mixamo(name) ?? name
    const candidates = names.get(normalized_lookup_key(expected))
    if (candidates?.length === 1) mappings.set(name, candidates[0])
  }

  if (mixamo) {
    // Optional fingers and end markers may differ. Both complete body chains must match.
    for (const name of CORE_BONES) {
      const key = normalized_lookup_key(MixamoMapper.map_source_bone_name_to_mixamo(name)!)
      const destination_name = destination.has(name) ? name : [...destination.keys()]
        .find(candidate => normalized_lookup_key(candidate) === key)
      if (!destination_name || !mappings.has(destination_name) || human_reference && !target.has(name)) {
        throw new Error('Не удалось сопоставить скелет Mixamo. Проверьте кость ' + name)
      }
    }
  }

  const calibration = mixamo && human_reference
    ? new HumanoidClipCalibration(as_joints(human_reference), as_joints(target)) : undefined
  return clips.map(clip => {
    const converted = RestSpaceRetargeter.retarget(clip, source, destination, mappings)
    if (!mixamo) {
      // Preserve strict validation for existing imports with unknown extra bones.
      const converted_names = new Set(converted.tracks.map(track => track.name))
      for (const track of clip.tracks) {
        const normalized_name = track.name.replace(/^.*\.bones\[([^\]]+)\]\./, '$1.')
        if (!converted_names.has(normalized_name)) converted.tracks.push(track.clone())
      }
      return converted
    }
    if (!converted.tracks.length) throw new Error('В файле нет движений для сопоставленных костей Mixamo')
    calibration?.apply(converted, 1)
    converted.tracks = converted.tracks.filter(track => target.has(track.name.slice(0, track.name.lastIndexOf('.'))))
    // The rest snapshot is authoritative for fingers absent from the donor.
    const rotations = new Set(converted.tracks.filter(track => track.name.endsWith('.quaternion'))
      .map(track => track.name.slice(0, -'.quaternion'.length)))
    for (const [name, rest] of target) {
      if (rotations.has(name) || name.startsWith('rig_volume_')) continue
      const rotation = rest.parent_rotation.clone().invert().multiply(rest.world_rotation).normalize()
      converted.tracks.push(new QuaternionKeyframeTrack(name + '.quaternion', [0], rotation.toArray()))
    }
    return converted
  })
}

function as_joints (rest: ReadonlyMap<string, BoneRestSpace>): Map<string, HumanoidRestJoint> {
  return new Map([...rest].map(([name, pose]) => [name, {
    position: pose.position,
    quaternion: pose.parent_rotation.clone().invert().multiply(pose.world_rotation).normalize(),
    parent_name: pose.parent_name && rest.has(pose.parent_name) ? pose.parent_name : undefined
  }]))
}
