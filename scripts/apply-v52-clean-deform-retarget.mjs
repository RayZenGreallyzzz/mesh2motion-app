import fs from 'node:fs'

function update (path, transform) {
  const before = fs.readFileSync(path, 'utf8')
  const after = transform(before)
  if (after !== before) {
    fs.writeFileSync(path, after)
    console.log(`Updated ${path}`)
  } else {
    console.log(`No change needed: ${path}`)
  }
}

function replaceRequired (source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`${label}: anchor not found`)
  return source.replace(before, after)
}

update('src/lib/processes/weight-skin/StepWeightSkin.ts', (source) => {
  if (!source.includes('CleanMobileHumanoidRig')) {
    const anchor = "import { type SkeletonType } from '../../enums/SkeletonType.ts'"
    if (!source.includes(anchor)) throw new Error('StepWeightSkin skeleton type import anchor not found')
    source = source.replace(
      anchor,
      "import { SkeletonType } from '../../enums/SkeletonType.ts'\nimport { CleanMobileHumanoidRig } from '../../mobile-rig/CleanMobileHumanoidRig.ts'"
    )
  }

  if (!source.includes('private binding_scene_root')) {
    source = replaceRequired(
      source,
      '  private binding_skeleton: Skeleton | undefined\n',
      '  private binding_skeleton: Skeleton | undefined\n  private binding_scene_root: Object3D | undefined\n',
      'StepWeightSkin binding root field'
    )
  }

  // Replay-safe: v5.3/v5.4 supersede this exact v5.2 method body.
  if (!source.includes('buildFromPlacedJoints') &&
      !source.includes('Mobile Female edits the final clean deform rig directly')) {
    source = replaceRequired(
      source,
      `  public create_bone_formula_object (editable_armature: Object3D, skeleton_type: SkeletonType): void {\n    this.skinning_armature = editable_armature.clone()\n    this.skinning_armature.name = 'Armature for skinning'\n\n    this.bone_skinning_formula = new SkinningAlgorithm(this.skinning_armature.children[0], skeleton_type)\n  }`,
      `  public create_bone_formula_object (editable_armature: Object3D, skeleton_type: SkeletonType): void {\n    // Mobile Female no longer binds the edited stock mannequin hierarchy. Build\n    // a fresh deform rig from the exact joint positions the user placed.\n    this.skinning_armature = skeleton_type === SkeletonType.MobileFemale\n      ? CleanMobileHumanoidRig.build(editable_armature)\n      : editable_armature.clone()\n    this.skinning_armature.name = 'Armature for skinning'\n\n    this.bone_skinning_formula = new SkinningAlgorithm(this.skinning_armature.children[0], skeleton_type)\n  }`,
      'StepWeightSkin clean rig creation'
    )
  }

  source = replaceRequired(
    source,
    `    // when we copy over the armature with the bind, we will lose the reference in the variable\n    this.binding_skeleton = Generators.create_skeleton(this.skinning_armature.children[0])\n    this.binding_skeleton.name = 'Mesh Binding Skeleton'`,
    `    // Keep the complete runtime hierarchy root. For Mobile Female this is a\n    // non-Bone Object3D named root, followed by pelvis as the first deform Bone.\n    this.binding_scene_root = this.skinning_armature.children[0]\n    this.binding_skeleton = Generators.create_skeleton(this.binding_scene_root)\n    this.binding_skeleton.name = 'Mesh Binding Skeleton'\n    this.binding_skeleton.calculateInverses()`,
    'StepWeightSkin binding skeleton'
  )

  source = replaceRequired(
    source,
    `    // do the binding for the mesh to the skeleton\n    skinned_mesh.add(this.binding_skeleton.bones[0])\n    skinned_mesh.bind(this.binding_skeleton)`,
    `    // The app intentionally shares one Skeleton between all material meshes.\n    // Own the root hierarchy from the first mesh only; every other mesh can bind\n    // to the same live bone matrices without reparenting the bones away again.\n    if (idx === 0 && this.binding_scene_root !== undefined) {\n      skinned_mesh.add(this.binding_scene_root)\n    } else if (idx === 0) {\n      skinned_mesh.add(this.binding_skeleton.bones[0])\n    }\n    skinned_mesh.bind(this.binding_skeleton)`,
    'StepWeightSkin root ownership'
  )

  return source
})

update('src/lib/processes/animations-listing/AnimationLoader.ts', (source) => {
  if (!source.includes('MobileHumanoidAnimationRetargeter')) {
    const anchor = "import { LoadError, NoAnimationsError } from './AnimationImportErrors.ts'\n"
    if (!source.includes(anchor)) throw new Error('AnimationLoader retarget import anchor not found')
    source = source.replace(
      anchor,
      anchor + "import { MobileHumanoidAnimationRetargeter } from '../../mobile-rig/MobileHumanoidAnimationRetargeter.ts'\nimport { type SkinnedMesh } from 'three'\n"
    )
  }

  source = replaceRequired(
    source,
    `  public async load_animations (\n    skeleton_type: SkeletonType,\n    skeleton_scale: number = 1.0\n  ): Promise<TransformedAnimationClipPair[]> {`,
    `  public async load_animations (\n    skeleton_type: SkeletonType,\n    skeleton_scale: number = 1.0,\n    retarget_target?: SkinnedMesh\n  ): Promise<TransformedAnimationClipPair[]> {`,
    'AnimationLoader load signature'
  )

  if (!source.includes('MobileHumanoidAnimationRetargeter.retargetPairs')) {
    const before = `              // Check if all animations are loaded\n              if (completed_loads === total_loads) {\n                // Sort animations alphabetically by name\n                loaded_clips.sort((a, b) => {\n                  return a.display_animation_clip.name.localeCompare(b.display_animation_clip.name)\n                })\n\n                resolve(loaded_clips)\n              }`
    const after = `              // Check if all animations are loaded. Retarget exactly once after\n              // all three human libraries are present so concurrent GLTF callbacks\n              // never mutate the same source/target skeleton at the same time.\n              if (completed_loads === total_loads) {\n                const finalize = async (): Promise<void> => {\n                  let final_clips = loaded_clips\n                  if (this.skeleton_type === SkeletonType.MobileFemale && retarget_target !== undefined) {\n                    final_clips = await MobileHumanoidAnimationRetargeter.retargetPairs(retarget_target, loaded_clips)\n                  }\n\n                  final_clips.sort((a, b) => {\n                    return a.display_animation_clip.name.localeCompare(b.display_animation_clip.name)\n                  })\n\n                  resolve(final_clips)\n                }\n\n                void finalize().catch((error: unknown) => {\n                  if (has_error) return\n                  has_error = true\n                  const error_message = error instanceof Error ? error.message : String(error)\n                  reject(new Error(\`Failed to retarget animations: \${error_message}\`))\n                })\n              }`
    if (!source.includes(before)) throw new Error('AnimationLoader finalize anchor not found')
    source = source.replace(before, after)
  }

  return source
})

update('src/lib/processes/animations-listing/StepAnimationsListing.ts', (source) => {
  source = replaceRequired(
    source,
    '    this.animation_loader.load_animations(this.skeleton_type, this.skeleton_scale)',
    '    this.animation_loader.load_animations(this.skeleton_type, this.skeleton_scale, final_skinned_meshes[0])',
    'StepAnimationsListing target mesh'
  )

  source = replaceRequired(
    source,
    `  private reset_root_motion_position (skinned_mesh: SkinnedMesh): void {\n    if (skinned_mesh.skeleton.bones.length > 0) {\n      const root_bone = skinned_mesh.skeleton.bones[0] // should always be root bone\n      root_bone.position.set(0, 0, 0)\n      root_bone.updateMatrixWorld(true)\n    }\n  }`,
    `  private reset_root_motion_position (skinned_mesh: SkinnedMesh): void {\n    // Mobile Humanoid keeps root-motion as a non-deform Object3D. Never zero\n    // skeleton.bones[0] blindly: on the clean rig that bone is pelvis.\n    const motion_root = skinned_mesh.getObjectByName('root')\n    if (motion_root !== undefined) {\n      motion_root.position.set(0, 0, 0)\n      motion_root.updateMatrixWorld(true)\n      return\n    }\n\n    if (skinned_mesh.skeleton.bones.length > 0) {\n      const legacy_root = skinned_mesh.skeleton.bones[0]\n      legacy_root.position.set(0, 0, 0)\n      legacy_root.updateMatrixWorld(true)\n    }\n  }`,
    'StepAnimationsListing root reset'
  )

  if (!source.includes('const animated_skeletons = new Set')) {
    const before = `    this.skinned_meshes_to_animate.forEach((skinned_mesh: SkinnedMesh) => {\n      this.reset_root_motion_position(skinned_mesh)\n\n      const clip_to_play: AnimationClip = this.animation_clips_loaded[this.current_playing_index].display_animation_clip\n      const anim_action: AnimationAction = this.animation_mixer.clipAction(clip_to_play, skinned_mesh)\n\n      anim_action.stop()\n      anim_action.play()\n\n      // Collect all animation actions for the animation player\n      all_animation_actions.push(anim_action)\n    })`
    const after = `    // Material submeshes share one live binding skeleton. Animate each unique\n    // skeleton only once, using the first mesh which owns the root hierarchy.\n    const animated_skeletons = new Set<object>()\n    this.skinned_meshes_to_animate.forEach((skinned_mesh: SkinnedMesh) => {\n      if (animated_skeletons.has(skinned_mesh.skeleton)) return\n      animated_skeletons.add(skinned_mesh.skeleton)\n\n      this.reset_root_motion_position(skinned_mesh)\n\n      const clip_to_play: AnimationClip = this.animation_clips_loaded[this.current_playing_index].display_animation_clip\n      const anim_action: AnimationAction = this.animation_mixer.clipAction(clip_to_play, skinned_mesh)\n\n      anim_action.stop()\n      anim_action.play()\n\n      all_animation_actions.push(anim_action)\n    })`
    if (!source.includes(before)) throw new Error('StepAnimationsListing playback anchor not found')
    source = source.replace(before, after)
  }

  return source
})

update('src/lib/RigConfig.ts', (source) => {
  source = source.replace(
    "rig_display_name: 'Humanoid Rig v2 · Surface Skin',",
    "rig_display_name: 'Humanoid Clean Rig · Retarget',"
  )
  return source
})

update('src/Mesh2MotionEngine.ts', (source) => {
  if (!source.includes('mobileHelperThickness')) {
    const before = `    this.skeleton_helper = new CustomSkeletonHelper(this.find_skeleton_root_bone(new_skeleton))`
    const after = `    const mobileHelperThickness = this.load_skeleton_step.skeleton_type() === SkeletonType.MobileFemale ? 0.045 : 0.1\n    this.skeleton_helper = new CustomSkeletonHelper(this.find_skeleton_root_bone(new_skeleton), {\n      thickness_ratio: mobileHelperThickness\n    })`
    if (!source.includes(before)) throw new Error('Mesh2MotionEngine helper anchor not found')
    source = source.replace(before, after)
  }
  return source
})
