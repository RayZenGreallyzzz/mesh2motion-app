import { load_pack_rig } from '../../../library/PackRigSource.ts'
import { RestSpaceRetargeter, type BoneRestSpace } from '../../../retarget/RestSpaceRetargeter.ts'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type AnimationClip } from 'three'
import { AnimationUtility } from './AnimationUtility.ts'
import { SkeletonType } from '../../enums/SkeletonType.ts'
import { RigConfig } from '../../RigConfig.ts'
import { type AnimationClipMetadata, type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'
import { LoadError, NoAnimationsError } from './AnimationImportErrors.ts'
import { type SkinnedMesh } from 'three'
import { is_humanoid_skeleton_type } from '../../HumanoidSkeleton.ts'
import { load_rig_asset } from '../../../my-rigs/RigAssetLoader.ts'
import { asset_from_motion } from '../../../my-rigs/MotionDocument.ts'
import { dispose_rig_scene } from '../../../my-rigs/RigAsset.ts'
import { MotionImportClient } from '../../../my-rigs/MotionImportClient.ts'
import { input_format, type MotionInput } from '../../../my-rigs/MotionArchive.ts'
import { is_mixamo_source, retarget_imported_clips } from './ImportedAnimationRetargeter.ts'

export interface AnimationLoadProgress {
  loaded: number
  total: number
  percentage: number
  currentFile: string
  currentFileProgress: number
  currentFileLoaded: number
  currentFileTotal: number
  overallBytesLoaded: number
  overallBytesTotal: number
}

export class AnimationLoader extends EventTarget {
  private readonly gltf_loader: GLTFLoader = new GLTFLoader()
  private readonly motion_import = new MotionImportClient()
  private human_reference?: Promise<Map<string, BoneRestSpace>>
  private animations_file_path: string = 'animations/'
  private readonly file_progress_map = new Map<string, { loaded: number, total: number }>()
  private completed_files: number = 0
  private total_files: number = 0

  private skeleton_type: SkeletonType | null = null

  private create_default_metadata (): AnimationClipMetadata {
    return {
      source_type: 'default-library',
      tags: []
    }
  }

  /**
   * Sets the base path for animation files
   */
  public set_animations_file_path (path: string): void {
    this.animations_file_path = path
  }

  /**
   * Loads all animations for the specified skeleton type
   * @param skeleton_type The type of skeleton to load animations for
   * @param skeleton_scale Scale factor to apply to position keyframes
   * @returns Promise that resolves with the loaded animation clips
   */
  public async load_animations (
    skeleton_type: SkeletonType,
    skeleton_scale: number = 1.0,
    _retarget_target?: SkinnedMesh
  ): Promise<TransformedAnimationClipPair[]> {
    this.skeleton_type = skeleton_type
    const pack = RigConfig.by_key(skeleton_type)?.pack_source
    if (pack) return this.process_loaded_animations((await load_pack_rig(pack)).clips, skeleton_scale, { tags: ['pack', 'offline'] })
    const configured_animation_files = RigConfig.get_animation_file_paths(this.skeleton_type)
    const file_paths = configured_animation_files.map(f => `${this.animations_file_path}${f}`)

    if (file_paths.length === 0) {
      throw new Error(`No animation files found for skeleton type: ${this.skeleton_type}`)
    }

    // Initialize progress tracking
    this.file_progress_map.clear()
    this.completed_files = 0
    this.total_files = file_paths.length

    // Initialize all files in progress map
    file_paths.forEach(file_path => {
      this.file_progress_map.set(file_path, { loaded: 0, total: 1 })
    })

    return await new Promise((resolve, reject) => {
      const loaded_clips: TransformedAnimationClipPair[] = []
      let completed_loads = 0
      const total_loads = file_paths.length
      let has_error = false

      // Emit initial progress
      this.emit_enhanced_progress('', 0, 1)

      file_paths.forEach((file_path, index) => {
        this.gltf_loader.load(
          file_path,
          (gltf: any) => {
            if (has_error) return // Don't process if we already had an error

            try {
              // Mark file as completed
              this.file_progress_map.set(file_path, { loaded: 1, total: 1 })
              this.completed_files++

              // Process the loaded animations
              const processed_clips = this.process_loaded_animations(
                gltf.animations as AnimationClip[],
                skeleton_scale,
                {
                  source_type: 'default-library',
                  tags: []
                }
              )
              loaded_clips.push(...processed_clips)

              completed_loads++

              // Emit progress update
              this.emit_enhanced_progress(file_path, 1, 1)

              // Check if all animations are loaded. Retarget exactly once after
              // all three human libraries are present so concurrent GLTF callbacks
              // never mutate the same source/target skeleton at the same time.
              if (completed_loads === total_loads) {
                const finalize = async (): Promise<void> => {
                  // Return the library immediately. Mobile Female retargeting is
                  // performed lazily per selected clip in StepAnimationsListing.
                  const final_clips = loaded_clips

                  final_clips.sort((a, b) => {
                    return a.display_animation_clip.name.localeCompare(b.display_animation_clip.name)
                  })

                  resolve(final_clips)
                }

                void finalize().catch((error: unknown) => {
                  if (has_error) return
                  has_error = true
                  const error_message = error instanceof Error ? error.message : String(error)
                  reject(new Error(`Failed to retarget animations: ${error_message}`))
                })
              }
            } catch (error) {
              if (!has_error) {
                has_error = true
                const error_message = error instanceof Error ? error.message : String(error)
                reject(new Error(`Failed to process animations from ${file_path}: ${error_message}`))
              }
            }
          },
          (progress_event) => {
            // Enhanced progress tracking during file loading
            if (progress_event.lengthComputable) {
              const current_progress = { loaded: progress_event.loaded, total: progress_event.total }
              this.file_progress_map.set(file_path, current_progress)

              // Emit real-time progress
              this.emit_enhanced_progress(file_path, progress_event.loaded, progress_event.total)
            }
          },
          (error) => {
            if (!has_error) {
              has_error = true
              const error_message = error instanceof Error ? error.message : String(error)
              reject(new Error(`Failed to load animation file ${file_path}: ${error_message}`))
            }
          }
        )
      })
    })
  }

  /**
   * Loads animations from a local GLB file and validates against target skeleton.
   * @param file The GLB file to load
   * @param skinned_meshes Target skinned meshes to validate against
   * @param skeleton_scale Scale factor to apply to position keyframes
   * @returns Promise that resolves with the loaded animation clips
   * @throws {NoAnimationsError} If no animations found in file
   * @throws {LoadError} If file cannot be loaded
   */
  public async load_animations_from_file (
    file: File,
    skeleton_scale: number = 1.0,
    metadata_override: Partial<AnimationClipMetadata> = {},
    target_rest?: ReadonlyMap<string, BoneRestSpace>
  ): Promise<TransformedAnimationClipPair[]> {
    const format = input_format(file.name)
    if (!format) throw new LoadError('Поддерживаются анимации GLB и FBX')
    return this.load_animations_from_input({ blob: file, name: file.name, format, size: file.size },
      skeleton_scale, metadata_override, target_rest)
  }

  public async load_animations_from_input (
    input: MotionInput, skeleton_scale: number = 1,
    metadata_override: Partial<AnimationClipMetadata> = {}, target_rest?: ReadonlyMap<string, BoneRestSpace>, known_ids: string[] = []
  ): Promise<TransformedAnimationClipPair[]> {
    this.file_progress_map.clear()
    this.completed_files = 0
    this.total_files = 1
    this.file_progress_map.set(input.name, { loaded: 0, total: input.size })
    this.emit_enhanced_progress(input.name, 0, input.size)
    let asset
    try {
      const parsed = await this.motion_import.read(input, known_ids)
      if (parsed.kind === 'duplicate') return []
      asset = parsed.kind === 'glb' ? await load_rig_asset(parsed.bytes, input.name) : asset_from_motion(parsed.document)
      if (!asset.clips.length) throw new NoAnimationsError('В файле нет анимаций')
      const source_rest = RestSpaceRetargeter.capture(asset.scene)
      const mixamo = is_mixamo_source(source_rest)
      // RigAsset uses UUID bindings internally. Resolve them before name-based retargeting.
      const node_names = new Map([...asset.nodes.values()].map(node => [node.object.uuid, node.name]))
      let animations = asset.clips.map(clip => {
        const result = clip.clone()
        for (const track of result.tracks) {
          const separator = track.name.lastIndexOf('.')
          const name = node_names.get(track.name.slice(0, separator))
          if (!name) throw new Error('Не найдена кость дорожки ' + track.name)
          track.name = name + track.name.slice(separator)
        }
        return result
      })
      if (target_rest?.size) {
        const reference = mixamo && this.skeleton_type !== null && is_humanoid_skeleton_type(this.skeleton_type)
          ? await this.load_human_reference() : undefined
        animations = retarget_imported_clips(animations, source_rest, target_rest, reference)
      }
      return this.process_loaded_animations(animations, target_rest?.size ? 1 : skeleton_scale, {
        ...metadata_override,
        tags: [...(metadata_override.tags ?? []), parsed.id, ...(mixamo ? ['mixamo'] : [])]
      })
    } catch (error) {
      if (error instanceof NoAnimationsError) throw error
      throw new LoadError('Не удалось импортировать ' + input.name + ': ' + (error instanceof Error ? error.message : String(error)))
    } finally {
      if (asset) dispose_rig_scene(asset.scene)
      this.file_progress_map.set(input.name, { loaded: input.size, total: input.size })
      this.completed_files = 1
      this.emit_enhanced_progress(input.name, input.size, input.size)
    }
  }

  private async load_human_reference (): Promise<Map<string, BoneRestSpace>> {
    this.human_reference ??= (async () => {
      const gltf = await this.gltf_loader.loadAsync(RigConfig.rig_file_for(SkeletonType.Human)!)
      try {
        const all = RestSpaceRetargeter.capture(gltf.scene)
        const bones = new Map<string, BoneRestSpace>()
        gltf.scene.traverse(object => { if (object.type === 'Bone') bones.set(object.name, all.get(object.name)!) })
        return bones
      } finally { dispose_rig_scene(gltf.scene) }
    })()
    try { return await this.human_reference } catch (error) { this.human_reference = undefined; throw error }
  }

  /**
   * Mobile Humanoid v2 deliberately removes finger and terminal leaf bones.
   * The stock library still contains tracks for them, so strip only those tracks
   * while preserving every core body/root-motion track unchanged.
   */
  private filter_mobile_humanoid_v2_tracks (clips: AnimationClip[]): void {
    if (this.skeleton_type !== SkeletonType.MobileFemale) return

    const removedPrefixes = ['thumb_', 'index_', 'middle_', 'ring_', 'pinky_']
    const removedExact = new Set(['head_leaf', 'ball_leaf_l', 'ball_leaf_r'])

    const targetBoneName = (trackName: string): string => {
      const bonesMatch = trackName.match(/\.bones\[([^\]]+)\]/i)
      if (bonesMatch !== null) return bonesMatch[1].toLowerCase()
      const propertyIndex = trackName.lastIndexOf('.')
      const target = propertyIndex >= 0 ? trackName.slice(0, propertyIndex) : trackName
      const pathParts = target.split(/[\/|:]/)
      return (pathParts[pathParts.length - 1] ?? target).toLowerCase()
    }

    for (const clip of clips) {
      clip.tracks = clip.tracks.filter(track => {
        const bone = targetBoneName(track.name)
        if (removedExact.has(bone)) return false
        return !removedPrefixes.some(prefix => bone.startsWith(prefix))
      })
    }
  }

  /**
   * Processes raw animation clips from GLTF file
   */
  public process_loaded_animations (
    raw_animations: AnimationClip[],
    skeleton_scale: number,
    metadata_override: Partial<AnimationClipMetadata> = {}
  ): TransformedAnimationClipPair[] {

    if(this.skeleton_type === null) {
      throw new Error('Skeleton type is not set (process_loaded_animations). Cannot process animations.')
    }

    // Deep clone the animations to avoid modifying originals
    const cloned_animations = AnimationUtility.deep_clone_animation_clips(raw_animations)

    this.filter_mobile_humanoid_v2_tracks(cloned_animations)

    const position_tracking_bone_name: string | undefined = 
    RigConfig.by_skeleton_type(this.skeleton_type)?.position_tracking_bone_name

    // Clean track data (remove position tracks except for specific cases)
    if (!RigConfig.by_key(this.skeleton_type)?.pack_source && !metadata_override.tags?.includes('mixamo')) {
      AnimationUtility.clean_track_data(cloned_animations, position_tracking_bone_name)
    }

    // Apply skeleton scaling to position keyframes
    AnimationUtility.apply_skeleton_scale_to_position_keyframes(cloned_animations, skeleton_scale)

    // v5.8 baseline: keep original + display copy. This was already stable on
    // tablet with the full 178-animation library; the important performance
    // difference is direct mixer playback rather than per-selection retarget bake.
    return cloned_animations.map(clip => ({
      original_animation_clip: clip,
      display_animation_clip: AnimationUtility.deep_clone_animation_clip(clip),
      metadata: {
        ...this.create_default_metadata(),
        ...metadata_override
      }
    }))
  }

  /**
   * Emits enhanced progress event to listeners
   */
  private emit_enhanced_progress (current_file: string, file_loaded: number, file_total: number): void {
    // Calculate overall progress across all files
    let total_bytes_loaded = 0
    let total_bytes_total = 0
    let files_in_progress = 0

    this.file_progress_map.forEach((progress, file_path) => {
      total_bytes_loaded += progress.loaded
      total_bytes_total += progress.total
      if (progress.loaded < progress.total) {
        files_in_progress++
      }
    })

    // Calculate percentages
    const current_file_percentage = file_total > 0 ? Math.round((file_loaded / file_total) * 100) : 0

    // Calculate file-based progress (completed files vs total files)
    const file_based_percentage = this.total_files > 0
      ? Math.round(((this.completed_files + (files_in_progress > 0 ? 0.5 : 0)) / this.total_files) * 100)
      : 0

    // send the current animation loading progress data to listener to handle
    const progress: AnimationLoadProgress = {
      loaded: this.completed_files,
      total: this.total_files,
      percentage: file_based_percentage,
      currentFile: current_file,
      currentFileProgress: current_file_percentage,
      currentFileLoaded: file_loaded,
      currentFileTotal: file_total,
      overallBytesLoaded: total_bytes_loaded,
      overallBytesTotal: total_bytes_total
    }

    this.dispatchEvent(new CustomEvent('progress', { detail: progress }))
  }
}
