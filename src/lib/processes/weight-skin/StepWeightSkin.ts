import { UI } from '../../UI.ts'
import SkinningAlgorithm from '../../solvers/SkinningAlgorithm.ts'

import { Generators } from '../../Generators.ts'

import { type BufferGeometry, type Material, type Object3D, type Skeleton, SkinnedMesh, Group, Uint16BufferAttribute, Float32BufferAttribute } from 'three'
import { SkeletonType } from '../../enums/SkeletonType.ts'
import { CleanMobileHumanoidRig } from '../../mobile-rig/CleanMobileHumanoidRig.ts'

// Note: EventTarget is a built-ininterface and do not need to import it
export class StepWeightSkin extends EventTarget {
  private readonly ui: UI = UI.getInstance()
  private skinning_armature: Object3D | undefined
  private bone_skinning_formula: SkinningAlgorithm | undefined
  private binding_skeleton: Skeleton | undefined
  private binding_scene_root: Object3D | undefined
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
  private clothing_weight_guard_enabled: boolean = false
  private rigid_skin_test_enabled: boolean = false

  constructor () {
    super()
    this.weight_painted_mesh_preview.name = 'Weight Painted Mesh Preview'

    // helps skeleton mesh render on top of this
    this.weight_painted_mesh_preview.renderOrder = -1
  }

  public begin (): void { }

  public create_bone_formula_object (editable_armature: Object3D, skeleton_type: SkeletonType): void {
    // v5.4: rebuild the bind/rest axes from final joint positions.
    if (skeleton_type === SkeletonType.MobileFemale) {
      this.skinning_armature = CleanMobileHumanoidRig.buildFromPlacedJoints(editable_armature)
    } else {
      this.skinning_armature = editable_armature.clone(true)
    }
    this.skinning_armature.name = 'Armature for skinning · Rest v5.4'

    // v5.5 diagnostic: remove ALL multi-bone blending for Mobile Female.
    // If stretching/flattening disappears, the fault is weight blending/LBS,
    // not joint placement, bind transforms or animation retargeting.
    this.rigid_skin_test_enabled = false

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
    this.binding_skeleton = Generators.create_skeleton(this.binding_scene_root)
    this.binding_skeleton.name = 'Mesh Binding Skeleton'
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
    const positions = geometry.getAttribute('position')
    const index = geometry.index
    const vertexCount = positions?.count ?? 0
    // Without an index we cannot reliably separate cape/skirt/accessory islands.
    // Be conservative and leave browser skinning untouched.
    if (vertexCount < 24 || index === null) return

    const parent = new Int32Array(vertexCount)
    for (let i = 0; i < vertexCount; i++) parent[i] = i
    const find = (value: number): number => {
      let x = value
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
      return x
    }
    const union = (a: number, b: number): void => {
      const ra = find(a); const rb = find(b)
      if (ra !== rb) parent[rb] = ra
    }
    for (let i = 0; i + 2 < index.count; i += 3) {
      const a = index.getX(i); const b = index.getX(i + 1); const c = index.getX(i + 2)
      union(a, b); union(b, c)
    }

    const totals = new Map<number, Map<string, number>>()
    const counts = new Map<number, number>()
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const component = find(vertex)
      counts.set(component, (counts.get(component) ?? 0) + 1)
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
      this.apply_clothing_component_guard(geometry_data, final_skin_indices, final_skin_weights)
      // Manual paint stays available for normal builds, but v5.5 deliberately
      // collapses the final result to one bone per vertex AFTER every adjustment.
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
