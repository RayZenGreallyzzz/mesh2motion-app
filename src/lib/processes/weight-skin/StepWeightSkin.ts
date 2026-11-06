import { ManualWeightEdits, setSelectedWeight, selectedWeight, type VertexWeights, type WeightEdit, type ChangedVertices } from '../../weight-paint/ManualWeightEdits.ts'
import { ChestWeightGuard, default_chest_guard, type ChestGuardOptions, type ChestGuardStats } from '../../solvers/ChestWeightGuard.ts'
import { CharacterWeightField } from '../../solvers/CharacterWeightField.ts'
import { UI } from '../../UI.ts'
import SkinningAlgorithm from '../../solvers/SkinningAlgorithm.ts'
import { welded_surface_components } from '../../solvers/WeldedSurfaceComponents.ts'
import { JointVolumeSupport } from '../../solvers/JointVolumeSupport.ts'
import { is_humanoid_skeleton_type } from '../../HumanoidSkeleton.ts'

import { Generators } from '../../Generators.ts'

import { Bone, type BufferGeometry, type Material, type Object3D, type Skeleton, Mesh, SkinnedMesh, Group, Uint16BufferAttribute, Float32BufferAttribute, Vector3 } from 'three'
import { SkeletonType } from '../../enums/SkeletonType.ts'

// Note: EventTarget is a built-ininterface and do not need to import it
export class StepWeightSkin extends EventTarget {
  private readonly ui: UI = UI.getInstance()
  private skinning_armature: Object3D | undefined
  private bone_skinning_formula: SkinningAlgorithm | undefined
  private binding_skeleton: Skeleton | undefined
  private binding_scene_root: Object3D | undefined
  private skinning_bone_names: string[] = []
  private readonly weight_field = new CharacterWeightField()
  private joint_volume_enabled = true
  private chest_guard = default_chest_guard()
  private chest_preview = false
  private chest_stats?: ChestGuardStats
  public set_chest_guard(options: ChestGuardOptions, preview: boolean): void { this.chest_guard = { ...options }; this.chest_preview = preview }
  public hide_chest_guard_preview(): void { this.chest_preview = false }
  public get_chest_guard_stats(): ChestGuardStats | undefined { return this.chest_stats }
  public is_chest_guard_preview(): boolean { return this.chest_guard.enabled && this.chest_preview && (this.chest_stats?.available ?? false) }

  private skinned_meshes: SkinnedMesh[] = []

  // stores the geometry data for meshes we will skin
  private all_mesh_geometry: BufferGeometry[] = []
  private all_mesh_materials: Material[] = []

  // weight painted mesh actually has multiple meshes that will go in a group
  private readonly weight_painted_mesh_preview: Group = new Group()

  private readonly manual_edits = new ManualWeightEdits()
  private manual_weight_preview_bone_index: number | null = null
  private clothing_weight_guard_enabled: boolean = false
  private rigid_skin_test_enabled: boolean = false
  private bind_rest_max_error = 0
  private bind_rest_sample_count = 0
  private bind_rest_failed_meshes = 0
  private bind_world_max_error = 0
  private bind_world_failed_meshes = 0


  constructor () {
    super()
    this.weight_painted_mesh_preview.name = 'Weight Painted Mesh Preview'

    // helps skeleton mesh render on top of this
    this.weight_painted_mesh_preview.renderOrder = -1
  }

  public bind_world_diagnostic (): { maxError: number, failedMeshes: number } {
    return { maxError: this.bind_world_max_error, failedMeshes: this.bind_world_failed_meshes }
  }

  public check_bind_after_world_transform (): void {
    this.bind_world_max_error = 0
    this.bind_world_failed_meshes = 0
    this.skinned_meshes.forEach((mesh) => this.check_bind_rest_pose(mesh, true))
  }

  public bind_rest_diagnostic (): { maxError: number, samples: number, failedMeshes: number } {
    return {
      maxError: this.bind_rest_max_error,
      samples: this.bind_rest_sample_count,
      failedMeshes: this.bind_rest_failed_meshes
    }
  }

  private check_bind_rest_pose (mesh: SkinnedMesh, afterWorld: boolean = false): void {
    const attr = mesh.geometry.getAttribute('position')
    if (attr === undefined || attr.count === 0) return

    // Three.js CPU skinning is the same linear-bind math used by the renderer.
    // At the REST pose, applying the skinning matrices must produce the original
    // vertex position. Otherwise it is impossible for an animation to be right.
    mesh.updateMatrixWorld(true)
    mesh.geometry.computeBoundingSphere()
    const radius = mesh.geometry.boundingSphere?.radius ?? 1
    const tolerance = Math.max(0.00001, radius * 0.0001)
    const samples = Math.min(attr.count, 128)
    const source = new Vector3()
    const skinned = new Vector3()
    let maxError = 0

    for (let sample = 0; sample < samples; sample++) {
      const vertex = samples === 1 ? 0 : Math.floor(sample * (attr.count - 1) / (samples - 1))
      source.fromBufferAttribute(attr, vertex)
      skinned.copy(source)
      mesh.applyBoneTransform(vertex, skinned)
      const delta = source.distanceTo(skinned)
      maxError = Math.max(maxError, delta)
    }

    if (afterWorld) {
      this.bind_world_max_error = Math.max(this.bind_world_max_error, maxError)
      if (!Number.isFinite(maxError) || maxError > tolerance) this.bind_world_failed_meshes++
    } else {
      this.bind_rest_sample_count += samples
      this.bind_rest_max_error = Math.max(this.bind_rest_max_error, maxError)
      if (!Number.isFinite(maxError) || maxError > tolerance) this.bind_rest_failed_meshes++
    }
    if (!Number.isFinite(maxError) || maxError > tolerance) {
      console.error('Skin bind mismatch:', afterWorld ? 'WORLD' : 'REST', mesh.name,
        { maxError, tolerance, samples })
    } else {
      console.info('Skin bind OK:', afterWorld ? 'WORLD' : 'REST', mesh.name, { maxError, samples })
    }
  }

  public begin (): void { }

  public create_bone_formula_object (editable_armature: Object3D, skeleton_type: SkeletonType): void {
    this.joint_volume_enabled = true
    // v5.8: bind the exact Bone hierarchy the user edited. No second rig rebuild,
    // no rest-axis rewrite, and no non-Bone object inside the skeleton chain.
    this.skinning_armature = editable_armature.clone(true)
    this.skinning_armature.name = 'Armature for skinning · Bone Chain v5.8'

    // v5.7 HARD SKIN proved the monster deformation survives even with one
    // 100% bone per vertex, so weight blending is not the root cause.
    this.rigid_skin_test_enabled = false

    const solverBones: Bone[] = []
    this.skinning_armature.children[0].traverse((object) => {
      if (object instanceof Bone) solverBones.push(object)
    })
    const names = solverBones.map((bone) => bone.name)
    if (this.skinning_bone_names.length && names.join('\0') !== this.skinning_bone_names.join('\0')) this.manual_edits.clear()
    this.skinning_bone_names = names

    this.bone_skinning_formula = new SkinningAlgorithm(this.skinning_armature.children[0], skeleton_type)
  }

  public skeleton (): Skeleton | undefined {
    // gets bone hierarchy from the armature
    return this.binding_skeleton
  }

  /**
   * @param geometry Add in all mesh geometry data to be skinned.
   */
  public add_to_geometry_data_to_skin (geometry: BufferGeometry): void {
    // add name to the geometry
    geometry.name = 'Mesh ' + this.all_mesh_geometry.length
    this.all_mesh_geometry.push(geometry)
  }

  public get_geometry_data_to_skin (): BufferGeometry[] {
    return this.all_mesh_geometry
  }

  // This can happen multiple times, so we need a better way to handle this to store all geometries
  // this will be useful when creating the weight painted mesh and that generation being done
  public set_mesh_geometry (geometry: BufferGeometry): void {
    if (this.bone_skinning_formula === undefined) {
      console.warn('Tried to set_mesh_geometry() in weight skinning step, but bone_skinning_formula is undefined!')
      return
    }

    this.bone_skinning_formula.set_geometry(geometry)
  }


  public create_binding_skeleton (): void {
    if (this.skinning_armature === undefined) {
      console.warn('Tried to create_binding_skeleton() but skinning_armature has no children!')
      return
    }

    // Keep the complete runtime hierarchy root. For Mobile Female this is a
    // non-Bone Object3D named root, followed by pelvis as the first deform Bone.
    this.binding_scene_root = this.skinning_armature.children[0]
    this.skinning_armature.updateMatrixWorld(true)
    this.binding_skeleton = Generators.create_skeleton(this.binding_scene_root)
    ;(this.binding_skeleton as Skeleton & { name: string }).name = 'Mesh Binding Skeleton'

    // Regression guard: except for the top/root Bone, every tracked Bone must
    // have a Bone parent. A Group/Object3D spacer breaks Skeleton.pose().
    const brokenBone = this.binding_skeleton.bones.find((bone, index) =>
      index > 0 && !(bone.parent instanceof Bone)
    )
    if (brokenBone !== undefined) {
      throw new Error(
        'Invalid humanoid Bone chain: ' + brokenBone.name +
        ' has non-Bone parent ' + (brokenBone.parent?.name ?? '(none)')
      )
    }

    const bindNames = this.binding_skeleton.bones.map((bone) => bone.name)
    if (
      bindNames.length !== this.skinning_bone_names.length ||
      bindNames.some((name, index) => name !== this.skinning_bone_names[index])
    ) {
      throw new Error(
        'Skinning bone index mismatch: solver=[' + this.skinning_bone_names.join(',') +
        '] bind=[' + bindNames.join(',') + ']'
      )
    }

    for (const bone of this.binding_skeleton.bones) {
      const values = [
        bone.position.x, bone.position.y, bone.position.z,
        bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w,
        bone.scale.x, bone.scale.y, bone.scale.z
      ]
      if (values.some((value) => !Number.isFinite(value))) {
        throw new Error('Non-finite bind transform on bone: ' + bone.name)
      }
      if (
        Math.abs(bone.scale.x - 1) > 0.001 ||
        Math.abs(bone.scale.y - 1) > 0.001 ||
        Math.abs(bone.scale.z - 1) > 0.001
      ) {
        throw new Error(
          'Unexpected bind scale on bone ' + bone.name + ': ' +
          bone.scale.x.toFixed(5) + ',' + bone.scale.y.toFixed(5) + ',' + bone.scale.z.toFixed(5)
        )
      }
    }

    if (this.joint_volume_enabled) {
      this.binding_skeleton = JointVolumeSupport.addToSkeleton(this.binding_skeleton)
    }
    this.binding_skeleton.calculateInverses()
  }

  /**
   * We might need to do the skinnning process multiple times
   * so we need to clear out the data from the previous
   * skinned mesh process
   */
  public reset_all_skin_process_data (): void {
    this.skinned_meshes = []
    this.all_mesh_materials = []
    this.all_mesh_geometry = []
    this.bind_rest_max_error = 0
    this.bind_rest_sample_count = 0
    this.bind_rest_failed_meshes = 0
    this.bind_world_max_error = 0
    this.bind_world_failed_meshes = 0

    // https://github.com/Mesh2Motion/mesh2motion-app/issues/82
    // Properly dispose of all children in the weight painted mesh preview to prevent memory leaks
    // It didn't seem to make much of a difference for Scott, but maybe it helps others
    this.weight_painted_mesh_preview.children.forEach((child) => {
      if (child instanceof SkinnedMesh || 'geometry' in child) {
        const mesh = child as any
        if (mesh.geometry) {
          mesh.geometry.dispose()
        }
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((mat: Material) => mat.dispose())
          } else {
            mesh.material.dispose()
          }
        }
      }
    })

    this.weight_painted_mesh_preview.clear()
  }

  public add_mesh_material (material: Material): void {
    this.all_mesh_materials.push(material)
  }

  private create_skinned_mesh (geometry: BufferGeometry, material: Material, idx: number): SkinnedMesh {
    if (this.binding_skeleton === undefined) {
      throw new Error('binding_skeleton must be initialized before creating skinned meshes. Call create_binding_skeleton() first.')
    }

    const skinned_mesh: SkinnedMesh = new SkinnedMesh(geometry, material)
    skinned_mesh.name = 'Skinned Mesh ' + idx.toString()
    skinned_mesh.castShadow = true // skinned mesh won't update right if this is false

    // The app intentionally shares one Skeleton between all material meshes.
    // Own the root hierarchy from the first mesh only; every other mesh can bind
    // to the same live bone matrices without reparenting the bones away again.
    if (idx === 0 && this.binding_scene_root !== undefined) {
      skinned_mesh.add(this.binding_scene_root)
    } else if (idx === 0) {
      skinned_mesh.add(this.binding_skeleton.bones[0])
    }
    // A root moved into its final SkinnedMesh parent has a NEW matrixWorld.
    // Capture bone inverses from THIS final hierarchy, not from the detached
    // armature clone. All material pieces subsequently share this same skeleton.
    if (idx === 0) {
      skinned_mesh.updateMatrixWorld(true)
      this.binding_skeleton.calculateInverses()
    }
    skinned_mesh.bind(this.binding_skeleton)
    this.check_bind_rest_pose(skinned_mesh)

    return skinned_mesh
  }

  public final_skinned_meshes (): SkinnedMesh[] {
    return this.skinned_meshes
  }

  public weight_painted_mesh_group (): Group | null {
    return this.weight_painted_mesh_preview
  }

  /**
   * Configure head weight correction settings for the solver
   * @param enabled Whether head weight correction is enabled
   * @param height The preview plane height threshold
   */
  public set_head_weight_correction_settings (enabled: boolean, height: number): void {
    if (this.bone_skinning_formula === undefined) return
    this.bone_skinning_formula.set_head_weight_correction_enabled(enabled)
    this.bone_skinning_formula.set_preview_plane_height(height)
  }

  /**
   * Configure arm plane correction settings for the solver
   * @param enabled Whether arm plane correction is enabled
   * @param offset Distance along X from the shoulder joint to place the plane
   */
  public set_arm_plane_correction_settings (enabled: boolean, offset: number): void {
    if (this.bone_skinning_formula === undefined) return
    this.bone_skinning_formula.set_arm_plane_correction_enabled(enabled)
    this.bone_skinning_formula.set_arm_plane_offset(offset)
  }

  public calculate_weights (): number[][] {
    if (this.bone_skinning_formula === undefined) return [[], []]
    return this.bone_skinning_formula.calculate_indexes_and_weights()
  }

  public set_manual_weight_preview_bone (bone_index: number | null): void {
    this.manual_weight_preview_bone_index = bone_index
  }

  public set_clothing_weight_guard_enabled (enabled: boolean): void {
    this.clothing_weight_guard_enabled = enabled
  }

  public get_bone_weight_stats (bone_index: number): { boneName: string, influenced: number, total: number, average: number, max: number } {
    const boneName = this.binding_skeleton?.bones[bone_index]?.name ?? ('Bone ' + bone_index.toString())
    let influenced = 0
    let total = 0
    let weightSum = 0
    let max = 0

    for (const geometry of this.all_mesh_geometry) {
      const skinIndex = geometry.getAttribute('skinIndex')
      const skinWeight = geometry.getAttribute('skinWeight')
      const positions = geometry.getAttribute('position')
      if (skinIndex === undefined || skinWeight === undefined || positions === undefined) continue
      total += positions.count
      const indexArray = skinIndex.array
      const weightArray = skinWeight.array
      for (let vertex = 0; vertex < positions.count; vertex++) {
        let selectedWeight = 0
        const offset = vertex * 4
        for (let slot = 0; slot < 4; slot++) {
          if (Number(indexArray[offset + slot]) === bone_index) selectedWeight += Number(weightArray[offset + slot] ?? 0)
        }
        if (selectedWeight > 0.0001) {
          influenced++
          weightSum += selectedWeight
          max = Math.max(max, selectedWeight)
        }
      }
    }

    return { boneName, influenced, total, average: influenced === 0 ? 0 : weightSum / influenced, max }
  }

  public clear_manual_weight_overrides (): void { this.manual_edits.clear() }
  public manual_weight_history (): { undo: boolean, redo: boolean } { return { undo: this.manual_edits.canUndo, redo: this.manual_edits.canRedo } }
  public manual_weight_locks (): Array<Set<number>> {
    return this.all_mesh_geometry.map((_, mesh) => new Set(
      [...(this.manual_edits.entries.get(mesh) ?? [])].filter(([, entry]) => entry.value !== null).map(([vertex]) => vertex)
    ))
  }
  public read_vertex_weights(mesh: number, vertex: number): VertexWeights | undefined {
    const g = this.all_mesh_geometry[mesh], ii = g?.getAttribute('skinIndex'), ww = g?.getAttribute('skinWeight')
    if (!ii || !ww || vertex < 0 || vertex >= ii.count) return undefined
    return { indices: [ii.getX(vertex),ii.getY(vertex),ii.getZ(vertex),ii.getW(vertex)], weights: [ww.getX(vertex),ww.getY(vertex),ww.getZ(vertex),ww.getW(vertex)] }
  }
  public paint_manual_weights(stroke: Map<number, Map<number, { amount: number, target?: number }>>, bone: number, strength: number, mode: 'add' | 'remove' | 'smooth'): number {
    if (!Number.isInteger(bone) || !this.binding_skeleton?.bones[bone] || !Number.isFinite(strength)) return 0
    const parent = this.binding_skeleton.bones[bone].parent
    const parentIndex = this.binding_skeleton.bones.findIndex(b => b === parent)
    const fallback = parentIndex >= 0 ? parentIndex : bone
    const edits: WeightEdit[] = []
    for (const [mesh, vertices] of stroke) for (const [vertex, sample] of vertices) {
      const base = this.read_vertex_weights(mesh,vertex)
      if (!base || !Number.isFinite(sample.amount)) continue
      const old = selectedWeight(base,bone), amount = Math.max(0,Math.min(1,strength*sample.amount))
      const target = mode === 'smooth' ? old + ((sample.target ?? old) - old)*amount : old + amount*(mode === 'remove'?-1:1)
      if (!Number.isFinite(target)) continue
      edits.push({mesh,vertex,base,next:setSelectedWeight(base,bone,target,fallback)})
    }
    return this.update_manual_attributes(this.manual_edits.commit(edits))
  }
  public add_manual_weight_adjustment(mesh: number, vertices: number[], bone: number, delta: number): void {
    if(!Number.isFinite(delta) || delta===0)return
    this.paint_manual_weights(new Map([[mesh,new Map(vertices.map(v=>[v,{amount:1}]))]]),bone,Math.abs(delta),delta<0?'remove':'add')
  }
  public undo_manual_weights(): number { return this.update_manual_attributes(this.manual_edits.undo()) }
  public redo_manual_weights(): number { return this.update_manual_attributes(this.manual_edits.redo()) }
  public reset_manual_weights(): number { return this.update_manual_attributes(this.manual_edits.reset()) }
  private update_manual_attributes(changed: ChangedVertices): number {
    let count = 0
    for (const [mesh,vertices] of changed) {
      const g=this.all_mesh_geometry[mesh],ii=g?.getAttribute('skinIndex'),ww=g?.getAttribute('skinWeight')
      if(!ii || !ww)continue
      for(const vertex of vertices){const v=this.manual_edits.current(mesh,vertex);if(!v)continue;ii.setXYZW(vertex,...v.indices as [number,number,number,number]);ww.setXYZW(vertex,...v.weights as [number,number,number,number]);count++}
      ii.needsUpdate=true;ww.needsUpdate=true
    }
    this.refresh_manual_weight_colors(changed)
    return count
  }
  public refresh_manual_weight_colors(changed?: ChangedVertices): void {
    const bone=this.manual_weight_preview_bone_index
    if(bone===null)return
    for(const object of this.weight_painted_mesh_preview.children){
      if(!object.userData.manualWeightSurface){object.visible=false;continue}
      const mesh=object as Mesh,index=Number(object.userData.weightMeshIndex),color=mesh.geometry.getAttribute('color'),g=this.all_mesh_geometry[index],ii=g?.getAttribute('skinIndex'),ww=g?.getAttribute('skinWeight')
      if(!color||!ii||!ww)continue
      const vertices=changed?.get(index)
      if(changed&&!vertices)continue
      const paint=(i:number)=>{let w=0;for(let k=0;k<4;k++)if(ii.array[i*4+k]===bone)w+=ww.array[i*4+k];const c=Generators.weight_heat_color(w);color.setXYZ(i,c[0],c[1],c[2])}
      if(vertices)vertices.forEach(paint);else for(let i=0;i<color.count;i++)paint(i)
      color.needsUpdate=true
    }
  }
  private apply_manual_weight_adjustments(mesh: number, indices: number[], weights: number[]): void { this.manual_edits.apply(mesh,indices,weights) }

  private bone_weight_family (bone_index: number): string {
    const raw = this.binding_skeleton?.bones[bone_index]?.name ?? ''
    const n = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (n.includes('root')) return 'root'
    const left = n.includes('left') || n.endsWith('l')
    const right = n.includes('right') || n.endsWith('r')
    const arm = /(shoulder|clavicle|upperarm|forearm|lowerarm|hand|wrist|finger|thumb|arm)/.test(n)
    const leg = /(thigh|upleg|upperleg|shin|calf|foot|toe|leg)/.test(n)
    if (arm && left) return 'armL'
    if (arm && right) return 'armR'
    if (leg && left) return 'legL'
    if (leg && right) return 'legR'
    if (/(pelvis|hips|hip)/.test(n)) return 'lowerCore'
    if (/(spine|chest)/.test(n)) return 'upperCore'
    if (/(neck|head)/.test(n)) return 'head'
    return 'other'
  }

  private apply_clothing_component_guard (geometry: BufferGeometry, skin_indices: number[], skin_weights: number[]): void {
    if (!this.clothing_weight_guard_enabled || this.binding_skeleton === undefined) return
    const vertexCount = geometry.getAttribute('position')?.count ?? 0
    if (vertexCount < 24) return

    // Meshy characters can have thousands of UV/index islands, although the
    // body, clothing and hair are one contiguous 3D surface. The original guard
    // treated these texture islands as separate garments and stripped weights
    // at their seams. Weld by 3D positions before applying any guard.
    const { componentByVertex, componentSizes: counts } = welded_surface_components(geometry)
    const find = (vertex: number): number => componentByVertex[vertex]

    const totals = new Map<number, Map<string, number>>()
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const component = find(vertex)
      let familyMap = totals.get(component)
      if (familyMap === undefined) { familyMap = new Map<string, number>(); totals.set(component, familyMap) }
      const offset = vertex * 4
      for (let slot = 0; slot < 4; slot++) {
        const w = skin_weights[offset + slot] ?? 0
        if (w <= 0.00001) continue
        const family = this.bone_weight_family(skin_indices[offset + slot])
        familyMap.set(family, (familyMap.get(family) ?? 0) + w)
      }
    }

    const allowed = new Map<number, Set<string>>()
    for (const [component, familyMap] of totals) {
      if ((counts.get(component) ?? 0) < 24) continue
      // A region containing most of the character is not an isolated piece
      // of clothing. Filtering it to 2-3 bone families destroys arms, legs and
      // head weights. On the supplied Neon Alleycat it covers >99% of vertices.
      if ((counts.get(component) ?? 0) > vertexCount * 0.5) continue
      const sorted = [...familyMap.entries()].sort((a, b) => b[1] - a[1])
      const total = sorted.reduce((sum, entry) => sum + entry[1], 0)
      if (total <= 0 || sorted.length < 2) continue
      const keep = new Set<string>()
      let cumulative = 0
      for (const [family, value] of sorted) {
        keep.add(family)
        cumulative += value / total
        if (cumulative >= 0.90 || keep.size >= 3) break
      }
      if (keep.size <= 3 && cumulative >= 0.86) allowed.set(component, keep)
    }

    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const keep = allowed.get(find(vertex))
      if (keep === undefined) continue
      const offset = vertex * 4
      let sum = 0
      const nextWeights = [0, 0, 0, 0]
      for (let slot = 0; slot < 4; slot++) {
        const family = this.bone_weight_family(skin_indices[offset + slot])
        const w = skin_weights[offset + slot] ?? 0
        if (keep.has(family)) { nextWeights[slot] = w; sum += w }
      }
      if (sum <= 0.00001) continue
      for (let slot = 0; slot < 4; slot++) skin_weights[offset + slot] = nextWeights[slot] / sum
    }
  }


  private apply_rigid_skin_test (skin_indices: number[], skin_weights: number[]): void {
    if (!this.rigid_skin_test_enabled) return

    for (let offset = 0; offset + 3 < skin_weights.length; offset += 4) {
      let bestSlot = 0
      let bestWeight = Number(skin_weights[offset] ?? 0)

      for (let slot = 1; slot < 4; slot++) {
        const weight = Number(skin_weights[offset + slot] ?? 0)
        if (weight > bestWeight) {
          bestWeight = weight
          bestSlot = slot
        }
      }

      const winningBone = Number(skin_indices[offset + bestSlot] ?? 0)
      skin_indices[offset] = winningBone
      skin_indices[offset + 1] = 0
      skin_indices[offset + 2] = 0
      skin_indices[offset + 3] = 0

      skin_weights[offset] = 1
      skin_weights[offset + 1] = 0
      skin_weights[offset + 2] = 0
      skin_weights[offset + 3] = 0
    }
  }

  public async prepare_automatic_weights (): Promise<void> {
    if (this.bone_skinning_formula) await this.weight_field.prepare(this.all_mesh_geometry, this.bone_skinning_formula)
  }

  public calculate_weights_for_all_mesh_data (regenerate_weight_painted_mesh: boolean = false): void {
    if (this.all_mesh_geometry.length === 0) {
      console.warn('Tried to calculate_weights_for_all_mesh_data() but all_mesh_geometry is empty!')
      return
    }

    if (this.bone_skinning_formula === undefined) return

    const shared = this.weight_field.calculate(this.all_mesh_geometry, this.bone_skinning_formula)
    const chest = this.chest_guard.enabled && this.binding_skeleton ? new ChestWeightGuard(this.binding_skeleton.bones, this.all_mesh_geometry, this.chest_guard) : undefined
    this.chest_stats = chest?.stats
    // Split the shared field back into the original meshes without changing indices.
    this.all_mesh_geometry.forEach((geometry_data: BufferGeometry, idx: number) => {
      const [final_skin_indices, final_skin_weights] = shared[idx]
      this.apply_clothing_component_guard(geometry_data, final_skin_indices, final_skin_weights)
      const chest_mask = chest?.apply(geometry_data, final_skin_indices, final_skin_weights, this.chest_preview)
      // Manual paint stays available for normal builds, but v5.5 deliberately
      // collapses the final result to one bone per vertex AFTER every adjustment.
      if (this.joint_volume_enabled && !this.rigid_skin_test_enabled && this.binding_skeleton !== undefined) {
        JointVolumeSupport.applyWeights(geometry_data, this.binding_skeleton, final_skin_indices, final_skin_weights)
      }
      this.apply_manual_weight_adjustments(idx, final_skin_indices, final_skin_weights)
      this.apply_rigid_skin_test(final_skin_indices, final_skin_weights)

      geometry_data.setAttribute('skinIndex', new Uint16BufferAttribute(final_skin_indices, 4))
      geometry_data.setAttribute('skinWeight', new Float32BufferAttribute(final_skin_weights, 4))

      const associated_material: Material = this.all_mesh_materials[idx]

      // create skined mesh from the geometry and material
      const temp_skinned_mesh: SkinnedMesh = this.create_skinned_mesh(geometry_data, associated_material, idx)
      this.skinned_meshes.push(temp_skinned_mesh) // add to skinned meshes references

      // re-generate the weight painted mesh display if needed
      if (regenerate_weight_painted_mesh) {
        const weight_painted_mesh = Generators.create_weight_painted_mesh(
          final_skin_indices, geometry_data, final_skin_weights, this.manual_weight_preview_bone_index, chest_mask
        )
        weight_painted_mesh.name = `Weight Painted Mesh ${idx}`
        weight_painted_mesh.userData.weightMeshIndex = idx
        weight_painted_mesh.userData.manualWeightSurface = true

        this.weight_painted_mesh_preview.add(weight_painted_mesh)
        // Dense triangle edges obscure the anatomical mask on high-poly models.
        if (!chest_mask) {
          const wireframe_mesh = Generators.create_wireframe_mesh_from_geometry(geometry_data)
          wireframe_mesh.userData.manualWeightSurface = false
          this.weight_painted_mesh_preview.add(wireframe_mesh)
        }
      }
    })

    console.log('Final skinned meshes:', this.skinned_meshes)
    console.log('Preview weight painted mesh re-generated:', this.weight_painted_mesh_preview)
  }
}
