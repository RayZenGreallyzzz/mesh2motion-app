import { SkeletonType } from './enums/SkeletonType'
import { humanVariations, foxVariations, birdVariations, kaijuVariations, 
  fishVariations, ModelVariation } from './RigModelVariations'

export interface RigConfigEntry {
  skeleton_type: SkeletonType // The SkeletonType enum member for this rig
  model_file: string // Model file path relative to the static root, e.g. 'models/model-human.glb'
  rig_file: string // Rig/skeleton GLB file path relative to the static root, e.g. 'rigs/rig-human.glb'
  rig_display_name: string // Display name shown in both the model and skeleton dropdowns
  animation_files: string[] // Animation filenames (no base path) loaded for this rig type
  animation_preview_folder: string // Sub-folder name used when referencing animation preview thumbnails
  skeleton_template_image_url: string // URL for the skeleton template image shown in the edit skeleton step
  // The bone used for position tracking (e.g., 'hips' or 'head').
  // we only have one bone per rig that we allow position keyframes (besides root)
  position_tracking_bone_name: string 
  model_variations?: ModelVariation[] // similar models (human, zombie, etc)
}

/**
 * Single source of truth for every supported rig type.
 * To add a new rig, append one entry to `RigConfig.all` and add the
 * corresponding GLB/rig files — no other TypeScript changes are required.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RigConfig {
  static readonly all: RigConfigEntry[] = [
    {
      skeleton_type: SkeletonType.Human,
      model_file: 'models/model-human.glb',
      rig_file: 'rigs/rig-human.glb',
      rig_display_name: 'Human · Surface Skin v2',
      animation_files: [
        '../animations/human-base-animations.glb', 
        '../animations/human-addon-animations.glb',
        '../animations/human-mocap-animations.glb'
      ],
      animation_preview_folder: 'human',
      position_tracking_bone_name: 'pelvis',
      skeleton_template_image_url: 'rigs/reference/human.png',
      model_variations: humanVariations
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.MobileFemale,
      model_file: 'models/model-human.glb',
      rig_file: 'rigs/rig-human.glb',
      rig_display_name: 'Humanoid AutoRig · Surface Skin v2',
      animation_files: [
        '../animations/human-base-animations.glb',
        '../animations/human-addon-animations.glb',
        '../animations/human-mocap-animations.glb'
      ],
      animation_preview_folder: 'human',
      position_tracking_bone_name: 'pelvis',
      skeleton_template_image_url: 'rigs/reference/human.png'
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Fox,
      model_file: 'models/model-fox.glb',
      rig_file: 'rigs/rig-fox.glb',
      rig_display_name: 'Fox',
      animation_files: ['../animations/fox-animations.glb'],
      animation_preview_folder: 'fox',
      position_tracking_bone_name: 'hips',
      skeleton_template_image_url: 'rigs/reference/fox.png',
      model_variations: foxVariations
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Bird,
      model_file: 'models/model-bird.glb',
      rig_file: 'rigs/rig-bird.glb',
      rig_display_name: 'Bird',
      animation_files: ['../animations/bird-animations.glb'],
      animation_preview_folder: 'bird',
      position_tracking_bone_name: 'hips',
      skeleton_template_image_url: 'rigs/reference/bird.png',
      model_variations: birdVariations
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Dragon,
      model_file: 'models/model-dragon.glb',
      rig_file: 'rigs/rig-dragon.glb',
      rig_display_name: 'Dragon',
      animation_files: ['../animations/dragon-animations.glb'],
      animation_preview_folder: 'dragon',
      position_tracking_bone_name: 'hips',
      skeleton_template_image_url: 'rigs/reference/dragon.png',
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Kaiju,
      model_file: 'models/model-kaiju.glb',
      rig_file: 'rigs/rig-kaiju.glb',
      rig_display_name: 'Kaiju',
      animation_files: ['../animations/kaiju-animations.glb'],
      animation_preview_folder: 'kaiju',
      position_tracking_bone_name: 'hips',
      skeleton_template_image_url: 'rigs/reference/kaiju.png',
      model_variations: kaijuVariations
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Spider,
      model_file: 'models/model-spider.glb',
      rig_file: 'rigs/rig-spider.glb',
      rig_display_name: 'Spider',
      animation_files: ['../animations/spider-animations.glb'],
      animation_preview_folder: 'spider',
      position_tracking_bone_name: 'hips',
      skeleton_template_image_url: 'rigs/reference/spider.png',
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Snake,
      model_file: 'models/model-snake.glb',
      rig_file: 'rigs/rig-snake.glb',
      rig_display_name: 'Snake',
      animation_files: ['../animations/snake-animations.glb'],
      animation_preview_folder: 'snake',
      position_tracking_bone_name: 'head',
      skeleton_template_image_url: 'rigs/reference/snake.png'
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Fish,
      model_file: 'models/model-fish.glb',
      rig_file: 'rigs/rig-fish.glb',
      rig_display_name: 'Fish',
      animation_files: ['../animations/fish-animations.glb'],
      animation_preview_folder: 'fish',
      position_tracking_bone_name: 'head',
      skeleton_template_image_url: 'rigs/reference/fish.png',
      model_variations: fishVariations
    } satisfies RigConfigEntry,
  ]

  static by_skeleton_type (type: SkeletonType | null | undefined): RigConfigEntry | undefined {
    return this.all.find(entry => entry.skeleton_type === type)
  }

  static get_animation_file_paths (type: SkeletonType | null | undefined): string[] {
    return this.by_skeleton_type(type)?.animation_files ?? []
  }
}
