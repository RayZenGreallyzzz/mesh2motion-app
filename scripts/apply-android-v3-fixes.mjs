import fs from 'node:fs'

const path = 'src/lib/processes/edit-skeleton/StepEditSkeleton.ts'
let source = fs.readFileSync(path, 'utf8')

const startMarker = "  public apply_humanoid_arm_pose_preset (pose: 'a' | 't'): void {\n"
const endMarker = "  private find_arm_bone (role: 'upper' | 'lower' | 'hand', side: 'l' | 'r'): Bone | undefined {\n"

if (!source.includes('const shoulder_center = left_shoulder.clone().add(right_shoulder).multiplyScalar(0.5)')) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  if (start < 0 || end < 0) throw new Error('A/T pose method markers not found')

  const replacement = `  public apply_humanoid_arm_pose_preset (pose: 'a' | 't'): void {\n    if (!is_humanoid_skeleton_type(this._current_skeleton_type)) return\n    if (this.threejs_skeleton.bones.length === 0) return\n\n    const left_upper = this.find_arm_bone('upper', 'l')\n    const right_upper = this.find_arm_bone('upper', 'r')\n    const left_lower = this.find_arm_bone('lower', 'l')\n    const right_lower = this.find_arm_bone('lower', 'r')\n    const left_hand = this.find_arm_bone('hand', 'l')\n    const right_hand = this.find_arm_bone('hand', 'r')\n\n    if (left_upper === undefined || right_upper === undefined ||\n        left_lower === undefined || right_lower === undefined ||\n        left_hand === undefined || right_hand === undefined) return\n\n    this.threejs_skeleton.bones[0]?.updateWorldMatrix(true, true)\n\n    const left_shoulder = left_upper.getWorldPosition(new Vector3())\n    const right_shoulder = right_upper.getWorldPosition(new Vector3())\n    const shoulder_center = left_shoulder.clone().add(right_shoulder).multiplyScalar(0.5)\n    const world_up = new Vector3(0, 1, 0)\n\n    const downward_angle = pose === 't' ? 0 : 35 * Math.PI / 180\n    const horizontal = Math.cos(downward_angle)\n    const vertical = Math.sin(downward_angle)\n\n    this.store_bone_state_for_undo()\n    let applied = false\n\n    const chains = [\n      { upper: left_upper, lower: left_lower, hand: left_hand },\n      { upper: right_upper, lower: right_lower, hand: right_hand }\n    ]\n\n    for (const chain of chains) {\n      const shoulder = chain.upper.getWorldPosition(new Vector3())\n      const elbow = chain.lower.getWorldPosition(new Vector3())\n      const wrist = chain.hand.getWorldPosition(new Vector3())\n\n      const upper_length = shoulder.distanceTo(elbow)\n      const lower_length = elbow.distanceTo(wrist)\n      if (upper_length <= 0.0001 || lower_length <= 0.0001) continue\n\n      // Build the arm direction from the character's own shoulder line rather\n      // than world X. This stays correct when the imported model is rotated\n      // around Y and prevents A/T presets from sending arms behind the torso.\n      const outward = shoulder.clone().sub(shoulder_center)\n      outward.addScaledVector(world_up, -outward.dot(world_up))\n\n      if (outward.lengthSq() <= 0.000001) {\n        outward.copy(elbow).sub(shoulder)\n        outward.addScaledVector(world_up, -outward.dot(world_up))\n      }\n      if (outward.lengthSq() <= 0.000001) continue\n      outward.normalize()\n\n      const arm_direction = outward\n        .multiplyScalar(horizontal)\n        .addScaledVector(world_up, -vertical)\n        .normalize()\n\n      const elbow_target = shoulder.clone().addScaledVector(arm_direction, upper_length)\n      this.set_bone_world_position(chain.lower, elbow_target)\n\n      const updated_elbow = chain.lower.getWorldPosition(new Vector3())\n      const wrist_target = updated_elbow.clone().addScaledVector(arm_direction, lower_length)\n      this.set_bone_world_position(chain.hand, wrist_target)\n      applied = true\n    }\n\n    if (applied) {\n      this.threejs_skeleton.bones[0]?.updateWorldMatrix(true, true)\n      this.refresh_arm_plane_position()\n      this.dispatchEvent(new CustomEvent('skeletonTransformed'))\n    }\n  }\n\n`

  source = source.slice(0, start) + replacement + source.slice(end)
  fs.writeFileSync(path, source)
  console.log('Applied character-local A/T shoulder plane fix')
} else {
  console.log('Character-local A/T shoulder plane fix already present')
}
