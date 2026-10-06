import fs from 'node:fs'

function update(path, transform) {
  const before = fs.readFileSync(path, 'utf8')
  const after = transform(before)
  if (after !== before) {
    fs.writeFileSync(path, after)
    console.log(`Updated ${path}`)
  } else {
    console.log(`No change needed: ${path}`)
  }
}

update('src/lib/processes/load-skeleton/StepLoadSkeleton.ts', (source) => {
  if (!source.includes("MobileHumanoidRigV2")) {
    const importAnchor = "import { effective_hand_skeleton_type, is_humanoid_skeleton_type } from '../../HumanoidSkeleton.ts'\n"
    if (!source.includes(importAnchor)) throw new Error('StepLoadSkeleton import anchor not found')
    source = source.replace(importAnchor, importAnchor + "import { MobileHumanoidRigV2 } from '../../mobile-rig/MobileHumanoidRigV2.ts'\n")
  }

  if (!source.includes('MobileHumanoidRigV2.apply(this.loaded_armature)')) {
    const anchor = `      if (is_humanoid_skeleton_type(this.skeleton_file_path())) {\n        const helper = new HandHelper()\n        helper.modify_hand_skeleton(this.loaded_armature, this.hand_skeleton_type())\n      }\n`
    if (!source.includes(anchor)) throw new Error('StepLoadSkeleton hand-helper anchor not found')
    source = source.replace(anchor, `${anchor}\n      // Mobile Humanoid v2 keeps the stock human rest frames for animation\n      // compatibility, then prunes/augments the hierarchy into the 27-bone game rig.\n      if (this.skeleton_file_path() === SkeletonType.MobileFemale) {\n        MobileHumanoidRigV2.apply(this.loaded_armature)\n      }\n`)
  }
  return source
})

update('src/lib/processes/animations-listing/AnimationLoader.ts', (source) => {
  source = source.replace(
    "import { type SkeletonType } from '../../enums/SkeletonType.ts'",
    "import { SkeletonType } from '../../enums/SkeletonType.ts'"
  )

  if (!source.includes('filter_mobile_humanoid_v2_tracks')) {
    const anchor = `  /**\n   * Processes raw animation clips from GLTF file\n   */\n`
    if (!source.includes(anchor)) throw new Error('AnimationLoader method anchor not found')
    const method = `  /**\n   * Mobile Humanoid v2 deliberately removes finger and terminal leaf bones.\n   * The stock library still contains tracks for them, so strip only those tracks\n   * while preserving every core body/root-motion track unchanged.\n   */\n  private filter_mobile_humanoid_v2_tracks (clips: AnimationClip[]): void {\n    if (this.skeleton_type !== SkeletonType.MobileFemale) return\n\n    const removedPrefixes = ['thumb_', 'index_', 'middle_', 'ring_', 'pinky_']\n    const removedExact = new Set(['head_leaf', 'ball_leaf_l', 'ball_leaf_r'])\n\n    const targetBoneName = (trackName: string): string => {\n      const bonesMatch = trackName.match(/\\.bones\\[([^\\]]+)\\]/i)\n      if (bonesMatch !== null) return bonesMatch[1].toLowerCase()\n      const propertyIndex = trackName.lastIndexOf('.')\n      const target = propertyIndex >= 0 ? trackName.slice(0, propertyIndex) : trackName\n      const pathParts = target.split(/[\\/|:]/)\n      return (pathParts[pathParts.length - 1] ?? target).toLowerCase()\n    }\n\n    for (const clip of clips) {\n      clip.tracks = clip.tracks.filter(track => {\n        const bone = targetBoneName(track.name)\n        if (removedExact.has(bone)) return false\n        return !removedPrefixes.some(prefix => bone.startsWith(prefix))\n      })\n    }\n  }\n\n`
    source = source.replace(anchor, method + anchor)
  }

  if (!source.includes('this.filter_mobile_humanoid_v2_tracks(cloned_animations)')) {
    const anchor = `    const cloned_animations = AnimationUtility.deep_clone_animation_clips(raw_animations)\n`
    if (!source.includes(anchor)) throw new Error('AnimationLoader clone anchor not found')
    source = source.replace(anchor, anchor + `\n    this.filter_mobile_humanoid_v2_tracks(cloned_animations)\n`)
  }
  return source
})

update('src/lib/RigConfig.ts', (source) => {
  source = source.replace(
    "rig_display_name: 'Humanoid AutoRig · Surface Skin v2',",
    "rig_display_name: 'Humanoid Rig v2 · Surface Skin',"
  )
  source = source.replace(
    "rig_display_name: 'Humanoid AutoRig · Browser Skin',",
    "rig_display_name: 'Humanoid Rig v2 · Surface Skin',"
  )
  return source
})
