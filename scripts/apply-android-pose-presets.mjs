import fs from 'node:fs'

function replaceOnce(path, search, replacement) {
  let text = fs.readFileSync(path, 'utf8')
  if (text.includes(replacement)) return
  if (!text.includes(search)) throw new Error(`Marker not found in ${path}`)
  text = text.replace(search, replacement)
  fs.writeFileSync(path, text)
}

const editPath = 'src/lib/processes/edit-skeleton/StepEditSkeleton.ts'
const htmlPath = 'src/create.html'

let edit = fs.readFileSync(editPath, 'utf8')

if (!edit.includes("public apply_humanoid_arm_pose_preset")) {
  edit = edit.replace(
    "  public algorithm (): string | null {\n    return this.skinning_algorithm\n  }\n",
    `  public algorithm (): string | null {\n    return this.skinning_algorithm\n  }\n\n  /**\n   * Apply a simple editable humanoid arm-pose preset. This only repositions the\n   * elbow and wrist joints; afterwards every joint remains fully draggable.\n   */\n  public apply_humanoid_arm_pose_preset (pose: 'a' | 't'): void {\n    if (!is_humanoid_skeleton_type(this._current_skeleton_type)) return\n    if (this.threejs_skeleton.bones.length === 0) return\n\n    const angle = pose === 't' ? 0 : 35 * Math.PI / 180\n    this.store_bone_state_for_undo()\n    let applied = false\n\n    for (const side of ['l', 'r'] as const) {\n      const upperarm = this.threejs_skeleton.bones.find(bone => bone.name === \\`upperarm_\\${side}\\`)\n      const lowerarm = this.threejs_skeleton.bones.find(bone => bone.name === \\`lowerarm_\\${side}\\`)\n      const hand = this.threejs_skeleton.bones.find(bone => bone.name === \\`hand_\\${side}\\`)\n      if (upperarm === undefined || lowerarm === undefined || hand === undefined) continue\n\n      upperarm.updateWorldMatrix(true, true)\n      lowerarm.updateWorldMatrix(true, true)\n      hand.updateWorldMatrix(true, true)\n\n      const shoulder = upperarm.getWorldPosition(new Vector3())\n      const elbow = lowerarm.getWorldPosition(new Vector3())\n      const wrist = hand.getWorldPosition(new Vector3())\n      const upper_length = shoulder.distanceTo(elbow)\n      const lower_length = elbow.distanceTo(wrist)\n      if (upper_length <= 0.0001 || lower_length <= 0.0001) continue\n\n      const side_sign = Math.sign(wrist.x - shoulder.x) || (side === 'l' ? 1 : -1)\n      const horizontal = Math.cos(angle)\n      const vertical = Math.sin(angle)\n\n      const elbow_target = new Vector3(\n        shoulder.x + side_sign * horizontal * upper_length,\n        shoulder.y - vertical * upper_length,\n        shoulder.z\n      )\n      this.set_bone_world_position(lowerarm, elbow_target)\n\n      const updated_elbow = lowerarm.getWorldPosition(new Vector3())\n      const wrist_target = new Vector3(\n        updated_elbow.x + side_sign * horizontal * lower_length,\n        updated_elbow.y - vertical * lower_length,\n        updated_elbow.z\n      )\n      this.set_bone_world_position(hand, wrist_target)\n      applied = true\n    }\n\n    if (applied) {\n      this.threejs_skeleton.bones[0]?.updateWorldMatrix(true, true)\n      this.dispatchEvent(new CustomEvent('skeletonTransformed'))\n    }\n  }\n\n  private set_bone_world_position (bone: Bone, world_position: Vector3): void {\n    if (bone.parent === null) return\n    bone.parent.updateWorldMatrix(true, false)\n    bone.position.copy(bone.parent.worldToLocal(world_position.clone()))\n    bone.updateWorldMatrix(true, true)\n  }\n`
  )

  edit = edit.replace(
    "  public begin (main_scene: Scene, skeleton_type: SkeletonType): void {\n    this.update_ui_options_on_begin(skeleton_type)\n",
    "  public begin (main_scene: Scene, skeleton_type: SkeletonType): void {\n    this._current_skeleton_type = skeleton_type\n    this.update_ui_options_on_begin(skeleton_type)\n"
  )

  edit = edit.replace(
    "  private update_ui_options_on_begin (skeleton_type: SkeletonType): void {\n",
    "  private update_ui_options_on_begin (skeleton_type: SkeletonType): void {\n    const pose_presets = document.getElementById('humanoid-pose-presets')\n    if (pose_presets !== null) {\n      pose_presets.style.display = is_humanoid_skeleton_type(skeleton_type) ? 'flex' : 'none'\n    }\n\n"
  )

  edit = edit.replace(
    "  public add_event_listeners (): void {\n",
    "  public add_event_listeners (): void {\n    document.getElementById('pose-preset-a')?.addEventListener('click', () => {\n      this.apply_humanoid_arm_pose_preset('a')\n    })\n    document.getElementById('pose-preset-t')?.addEventListener('click', () => {\n      this.apply_humanoid_arm_pose_preset('t')\n    })\n\n"
  )

  fs.writeFileSync(editPath, edit)
}

let html = fs.readFileSync(htmlPath, 'utf8')
if (!html.includes('id="humanoid-pose-presets"')) {
  html = html.replace(
    `          <div style="display: flex; flex-direction: column;">\n            \n            <div class="pill-switch-group" aria-label="Positioning mode">`,
    `          <div id="humanoid-pose-presets" style="display: none; flex-direction: column; gap: 0.35rem;">\n            <span class="pill-switch-label">Arm Pose</span>\n            <div style="display: flex; gap: 0.5rem;">\n              <button type="button" class="secondary-button" id="pose-preset-a">A-pose</button>\n              <button type="button" class="secondary-button" id="pose-preset-t">T-pose</button>\n            </div>\n            <small>Choose a starting pose, then drag joints directly on the model.</small>\n          </div>\n\n          <div style="display: flex; flex-direction: column;">\n            \n            <div class="pill-switch-group" aria-label="Positioning mode">`
  )
  fs.writeFileSync(htmlPath, html)
}

console.log('Android A/T pose presets applied')
