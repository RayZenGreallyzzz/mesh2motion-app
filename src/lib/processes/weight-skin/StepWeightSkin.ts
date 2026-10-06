import { UI } from '../../UI.ts'
import SkinningAlgorithm from '../../solvers/SkinningAlgorithm.ts'

import { Generators } from '../../Generators.ts'

import { type BufferGeometry, type Material, type Object3D, type Skeleton, SkinnedMesh, Group, Uint16BufferAttribute, Float32BufferAttribute } from 'three'
import { type SkeletonType } from '../../enums/SkeletonType.ts'

// Note: EventTarget is a built-ininterface and do not need to import it
export class StepWeightSkin extends EventTarget {
  private readonly ui: UI = UI.getInstance()
  private skinning_armature: Object3D | undefined
  private bone_skinning_formula: SkinningAlgorithm | undefined
  private binding_skeleton: Skeleton | undefined
  private skinned_meshes: SkinnedMesh[] = []

  // stores the geometry data for meshes we will skin
  private all_mesh_geometry: BufferGeometry[] = []
  private all_mesh_materials: Material[] = []

  // weight painted mesh actually has multiple meshes that will go in a group
  private readonly weight_painted_mesh_preview: Group = new Group()

  // Manual weight paint is stored as additive deltas on top of the automatic
  // solver. Geometry order and vertex order stay stable while editing a model,
  // so these survive preview rebuilds and are applied again at Bind.
  private readonly manual_weight_deltas = new Map<number, Map<number, Map<number, number>>>()
  private manual_weight_preview_bone_index: number | null = null

  constructor () {
    super()
    this.weight_painted_mesh_preview.name = 'Weight Painted Mesh Preview'

    // helps skeleton mesh render on top of this
    this.weight_painted_mesh_preview.renderOrder = -1
  }

  public begin (): void { }

  public create_bone_formula_object (editable_armature: Object3D, skeleton_type: SkeletonType): void {
    this.skinning_armature = editable_armature.clone()
    this.skinning_armature.name = 'Armature for skinning'

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

    // when we copy over the armature with the bind, we will lose the reference in the variable
    this.binding_skeleton = Generators.create_skeleton(this.skinning_armature.children[0])
    this.binding_skeleton.name = 'Mesh Binding Skeleton'
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

    // do the binding for the mesh to the skeleton
    skinned_mesh.add(this.binding_skeleton.bones[0])
    skinned_mesh.bind(this.binding_skeleton)

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

  public clear_manual_weight_overrides (): void {
    this.manual_weight_deltas.clear()
  }

  public add_manual_weight_adjustment (
    mesh_index: number,
    vertex_indices: number[],
    bone_index: number,
    delta: number
  ): void {
    if (!Number.isInteger(mesh_index) || !Number.isInteger(bone_index) || !Number.isFinite(delta) || delta === 0) return

    let mesh_map = this.manual_weight_deltas.get(mesh_index)
    if (mesh_map === undefined) {
      mesh_map = new Map<number, Map<number, number>>()
      this.manual_weight_deltas.set(mesh_index, mesh_map)
    }

    for (const vertex_index of vertex_indices) {
      if (!Number.isInteger(vertex_index) || vertex_index < 0) continue
      let vertex_map = mesh_map.get(vertex_index)
      if (vertex_map === undefined) {
        vertex_map = new Map<number, number>()
        mesh_map.set(vertex_index, vertex_map)
      }

      const next_delta = Math.max(-1, Math.min(1, (vertex_map.get(bone_index) ?? 0) + delta))
      if (Math.abs(next_delta) < 0.00001) vertex_map.delete(bone_index)
      else vertex_map.set(bone_index, next_delta)

      if (vertex_map.size === 0) mesh_map.delete(vertex_index)
    }

    if (mesh_map.size === 0) this.manual_weight_deltas.delete(mesh_index)
  }

  private apply_manual_weight_adjustments (mesh_index: number, skin_indices: number[], skin_weights: number[]): void {
    const mesh_map = this.manual_weight_deltas.get(mesh_index)
    if (mesh_map === undefined) return

    for (const [vertex_index, bone_deltas] of mesh_map) {
      const offset = vertex_index * 4
      if (offset + 3 >= skin_indices.length || offset + 3 >= skin_weights.length) continue

      const fallback_bone = skin_indices[offset]
      const weights = new Map<number, number>()
      for (let slot = 0; slot < 4; slot++) {
        const weight = skin_weights[offset + slot] ?? 0
        if (weight <= 0) continue
        const bone = skin_indices[offset + slot]
        weights.set(bone, (weights.get(bone) ?? 0) + weight)
      }

      for (const [bone_index, delta] of bone_deltas) {
        const next = Math.max(0, Math.min(1, (weights.get(bone_index) ?? 0) + delta))
        if (next <= 0.00001) weights.delete(bone_index)
        else weights.set(bone_index, next)
      }

      let entries = [...weights.entries()]
        .filter(([, weight]) => weight > 0.00001)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)

      if (entries.length === 0) entries = [[fallback_bone, 1]]
      const total = entries.reduce((sum, [, weight]) => sum + weight, 0) || 1

      for (let slot = 0; slot < 4; slot++) {
        const entry = entries[slot]
        skin_indices[offset + slot] = entry?.[0] ?? fallback_bone
        skin_weights[offset + slot] = entry === undefined ? 0 : entry[1] / total
      }
    }
  }

  public calculate_weights_for_all_mesh_data (regenerate_weight_painted_mesh: boolean = false): void {
    if (this.all_mesh_geometry.length === 0) {
      console.warn('Tried to calculate_weights_for_all_mesh_data() but all_mesh_geometry is empty!')
      return
    }

    if (this.bone_skinning_formula === undefined) return

    // loop through each mesh geometry and calculate the weights
    this.all_mesh_geometry.forEach((geometry_data: BufferGeometry, idx: number) => {
      this.bone_skinning_formula!.set_geometry(geometry_data)
      const [final_skin_indices, final_skin_weights]: number[][] = this.calculate_weights()
      this.apply_manual_weight_adjustments(idx, final_skin_indices, final_skin_weights)

      geometry_data.setAttribute('skinIndex', new Uint16BufferAttribute(final_skin_indices, 4))
      geometry_data.setAttribute('skinWeight', new Float32BufferAttribute(final_skin_weights, 4))

      const associated_material: Material = this.all_mesh_materials[idx]

      // create skined mesh from the geometry and material
      const temp_skinned_mesh: SkinnedMesh = this.create_skinned_mesh(geometry_data, associated_material, idx)
      this.skinned_meshes.push(temp_skinned_mesh) // add to skinned meshes references

      // re-generate the weight painted mesh display if needed
      if (regenerate_weight_painted_mesh) {
        const weight_painted_mesh = Generators.create_weight_painted_mesh(
          final_skin_indices, geometry_data, final_skin_weights, this.manual_weight_preview_bone_index
        )
        weight_painted_mesh.name = `Weight Painted Mesh ${idx}`
        weight_painted_mesh.userData.weightMeshIndex = idx
        weight_painted_mesh.userData.manualWeightSurface = true

        const wireframe_mesh = Generators.create_wireframe_mesh_from_geometry(geometry_data)
        wireframe_mesh.userData.manualWeightSurface = false
        this.weight_painted_mesh_preview?.add(weight_painted_mesh, wireframe_mesh)
      }
    })

    console.log('Final skinned meshes:', this.skinned_meshes)
    console.log('Preview weight painted mesh re-generated:', this.weight_painted_mesh_preview)
  }
}
