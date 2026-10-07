import { SkeletonType } from './enums/SkeletonType'
import { humanVariations, foxVariations, birdVariations, kaijuVariations, 
  fishVariations, ModelVariation } from './RigModelVariations'

export interface RigConfigEntry {
  skeleton_type: SkeletonType
  model_file: string
  rig_file: string
  rig_display_name: string
  animation_files: string[]
  animation_preview_folder: string
  skeleton_template_image_url: string
  position_tracking_bone_name: string 
  model_variations?: ModelVariation[]
}

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
      rig_display_name: 'Humanoid v5.5 · RIGID SKIN TEST',
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
      skeleton_template_image_url: 'rigs/reference/snake.png',
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Fish,
      model_file: 'models/model-shark.glb',
      rig_file: 'rigs/rig-shark.glb',
      rig_display_name: 'Fish',
      animation_files: ['../animations/shark-animations.glb'],
      animation_preview_folder: 'shark',
      position_tracking_bone_name: 'pelvis',
      skeleton_template_image_url: 'rigs/reference/shark.png',
      model_variations: fishVariations
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Horse,
      model_file: 'models/model-horse.glb',
      rig_file: 'rigs/rig-horse.glb',
      rig_display_name: 'Horse',
      animation_files: ['../animations/horse-animations.glb'],
      animation_preview_folder: 'horse',
      position_tracking_bone_name: 'hips',
      skeleton_template_image_url: 'rigs/reference/horse.png',
    } satisfies RigConfigEntry
  ]

  static by_key (rig_key: string): RigConfigEntry | undefined {
    return this.all.find(r => r.skeleton_type === rig_key as SkeletonType)
  }

  static by_skeleton_type (skeleton_type: SkeletonType): RigConfigEntry | undefined {
    return this.all.find(r => r.skeleton_type === skeleton_type)
  }

  static rig_file_for (skeleton_type: SkeletonType): string | undefined {
    return this.by_skeleton_type(skeleton_type)?.rig_file
  }

  static get_animation_file_paths (skeleton_type: SkeletonType): string[] {
    const config = this.by_skeleton_type(skeleton_type)
    if (config === undefined || config.animation_files.length === 0) return []
    return config.animation_files
  }
}
