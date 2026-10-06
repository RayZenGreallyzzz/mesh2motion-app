import fs from 'node:fs'

const path = 'src/Mesh2MotionEngine.ts'
let src = fs.readFileSync(path, 'utf8')

const marker = 'Canonical rig world transform v4.8'
if (src.includes(marker)) {
  console.log('v4.8 canonical rig transform already applied')
  process.exit(0)
}

function replaceOnce(oldText, newText, label) {
  if (!src.includes(oldText)) throw new Error(`v4.8 patch failed: ${label}`)
  src = src.replace(oldText, newText)
}

replaceOnce(
`  public lock_rig_setup (): void {
    if (this.rig_setup_locked_state) return

    this.transform_controls.detach()
    this.bake_rig_setup_group_transform()
    this.rig_setup_locked_state = true
    this.update_edit_bone_interaction_mode()
    this.update_rig_setup_controls()
  }`,
`  public lock_rig_setup (): void {
    if (this.rig_setup_locked_state) return

    this.transform_controls.detach()

    // Canonical rig world transform v4.8
    // Keep the user's global move/rotate/scale OUTSIDE the armature instead of
    // baking it into the root bone. Animation clips contain local quaternion
    // tracks authored for the canonical browser rig. Baking a global rotation
    // into the armature makes the joints look correctly placed in bind pose but
    // causes those animation quaternions to fight the baked orientation and can
    // twist the entire character. The shared Rig Setup Group stays as the
    // non-animated world transform; skinning is calculated from the model and
    // armature's canonical local coordinates and the same world transform is
    // copied onto the generated preview/skinned outputs afterwards.
    this.rig_setup_group?.updateWorldMatrix(true, true)
    this.rig_setup_locked_state = true
    this.update_edit_bone_interaction_mode()
    this.update_rig_setup_controls()
  }`,
'lock_rig_setup')

const helperAnchor = `  public refresh_manual_weight_editor (): void {`
const helper = `  /**
   * Copy the non-animated Rig Setup Group world transform onto generated skin
   * outputs. The skeleton itself stays canonical, matching the browser rig and
   * the coordinate system used by the bundled animation quaternion tracks.
   */
  private apply_rig_world_transform_to_skin_outputs (): void {
    const group = this.rig_setup_group
    if (group === null) return

    group.updateWorldMatrix(true, true)
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    group.matrixWorld.decompose(position, quaternion, scale)

    const apply = (object: THREE.Object3D): void => {
      object.position.copy(position)
      object.quaternion.copy(quaternion)
      object.scale.copy(scale)
      object.updateMatrixWorld(true)
    }

    this.weight_skin_step.final_skinned_meshes().forEach(apply)
    const preview = this.weight_skin_step.weight_painted_mesh_group()
    if (preview !== null) apply(preview)
  }

`
if (!src.includes(helperAnchor)) throw new Error('v4.8 patch failed: helper anchor')
src = src.replace(helperAnchor, helper + helperAnchor)

replaceOnce(
`      this.remove_skinned_meshes_from_scene()
      this.calculate_skin_weighting_for_models()
      this.scene.add(...this.weight_skin_step.final_skinned_meshes())
      this.scene.add(this.weight_skin_step.weight_painted_mesh_group())`,
`      this.remove_skinned_meshes_from_scene()
      this.calculate_skin_weighting_for_models()
      this.apply_rig_world_transform_to_skin_outputs()
      this.scene.add(...this.weight_skin_step.final_skinned_meshes())
      this.scene.add(this.weight_skin_step.weight_painted_mesh_group())`,
'WeightSkin output transform')

replaceOnce(
`    this.calculate_skin_weighting_for_models()

    if (this.scene.getObjectByName('Weight Painted Mesh Preview') === undefined) {`,
`    this.calculate_skin_weighting_for_models()
    this.apply_rig_world_transform_to_skin_outputs()

    if (this.scene.getObjectByName('Weight Painted Mesh Preview') === undefined) {`,
'regenerated output transform')

replaceOnce(
`  public remove_imported_model (): void {
    if (this.load_model_step.model_meshes() !== undefined) {
      const imported_model = this.scene.getObjectByName('Imported Model')
      if (imported_model !== undefined) {
        this.scene.remove(imported_model)
      }
    }
  }`,
`  public remove_imported_model (): void {
    // The canonical rig setup group can still own the hidden source model when
    // restarting the flow. Remove the wrapper itself so no stale armature/model
    // survives into the next import.
    if (this.rig_setup_group !== null) {
      this.rig_setup_group.removeFromParent()
      this.rig_setup_group = null
    }

    if (this.load_model_step.model_meshes() !== undefined) {
      const imported_model = this.scene.getObjectByName('Imported Model')
      if (imported_model !== undefined) imported_model.removeFromParent()
    }
  }`,
'rig group cleanup')

fs.writeFileSync(path, src)
console.log('v4.8 canonical rig transform patch applied')
