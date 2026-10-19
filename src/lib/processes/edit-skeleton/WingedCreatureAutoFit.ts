import { Box3, type Object3D, Quaternion, Vector3 } from 'three'
import { CreatureVolume } from './CreatureVolume.ts'

/** Anatomical proposal for an upright, bilaterally symmetric six-limbed
 * creature. Unsupported/disconnected forms return null without editing bones. */
export class WingedCreatureAutoFit {
  static propose (model: Object3D, frame: Object3D | null, yaw: Quaternion, points: Vector3[]): Map<string, Vector3> | null {
    const box = new Box3().setFromPoints(points), size = box.getSize(new Vector3())
    const mid = box.getCenter(new Vector3()).x, height = size.y, width = size.x
    const volume = new CreatureVolume(model, frame, yaw, points)
    if (volume.cells.length < 200) return null
    const central = (p: Vector3) => Math.abs(p.x - mid) < width * .035
    const core_id = volume.select((p, r) => central(p) && p.y < box.min.y + height * .7 ? r : -Infinity)
    if (core_id < 0) return null
    const core = volume.point(core_id)
    const paths = volume.paths(core_id)
    const connected = (i: number) => Number.isFinite(paths.distance[i])
    const head_id = volume.select((p, r, i) => connected(i) && central(p) && p.y > core.y + height * .15 && r > height * .018 ? p.z + r * .3 : -Infinity)
    const hip_id = volume.select((p, r, i) => connected(i) && central(p) && p.y < core.y - height * .09 && p.z < core.z - size.z * .06 ? r : -Infinity)
    if (head_id < 0 || hip_id < 0) return null
    const hip = volume.point(hip_id)
    const tail_id = volume.select((p, r, i) => connected(i) && central(p) && p.z < hip.z - size.z * .12 && r > volume.step * 1.5 ? paths.distance[i] : -Infinity)
    if (tail_id < 0) return null
    const head_path = volume.path(head_id, paths.parent)
    const hip_path = volume.path(hip_id, paths.parent).reverse()
    const tail_path = this.trim(volume.path(tail_id, paths.parent), hip)
    if (head_path.length < 12 || tail_path.length < 12) return null
    const result = new Map<string, Vector3>()
    const put = (name: string, p: Vector3, center = false) => {
      const point = p.clone(); if (center) point.x = mid
      result.set(name, point)
    }
    const along = CreatureVolume.along
    put('root', new Vector3(mid, box.min.y, hip.z))
    put('hips', hip, true)
    put('spine_0', along(hip_path, .65), true)
    put('spine_1', core, true)
    put('spine_2', along(head_path, .22), true)
    put('spine_3', along(head_path, .46), true)
    put('spine_4', along(head_path, .7), true)
    put('head', along(head_path, .87), true)
    put('mouth_upper', along(head_path, .93), true)
    put('mouth_upper_tip', along(head_path, 1), true)
    put('mouth_lower', along(head_path, .94).add(new Vector3(0, -height * .018, -height * .01)), true)
    put('mouth_lower_tip', along(head_path, 1).add(new Vector3(0, -height * .025, 0)), true)
    put('stomach', core, true)
    put('stomach_tip', core.clone().add(new Vector3(0, -height * .06, height * .025)), true)
    ;['tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5', 'tail_6', 'tail_tip'].forEach((name, i) => put(name, along(tail_path, .04 + i * .96 / 6), true))
    for (const side of ['l', 'r']) {
      const sign = side === 'l' ? 1 : -1
      const lateral = (p: Vector3) => (p.x - mid) * sign
      const arm_id = volume.select((p, r, i) => connected(i) && lateral(p) > width * .14 && lateral(p) < width * .24 && p.y > core.y + height * .15 ? p.y + r * .1 : -Infinity)
      const foot_id = volume.select((p, r, i) => connected(i) && lateral(p) > width * .05 && lateral(p) < width * .24 && p.y < box.min.y + height * .09 ? r : -Infinity)
      const wing_id = volume.select((p, r, i) => connected(i) && lateral(p) > width * .25 && p.y > core.y ? p.y : -Infinity)
      const tip_id = volume.select((p, r, i) => connected(i) && lateral(p) > width * .38 && p.y > core.y ? lateral(p) : -Infinity)
      const horn_id = volume.select((p, r, i) => connected(i) && lateral(p) > width * .035 && lateral(p) < width * .14 && p.y > volume.point(head_id).y + height * .12 ? p.y : -Infinity)
      if ([arm_id, foot_id, wing_id, tip_id].some(i => i < 0)) return null
      const arm_path = volume.path(arm_id, paths.parent)
      const foot_path = this.trim(volume.path(foot_id, paths.parent), hip)
      const wing_path = volume.path(wing_id, paths.parent)
      // A raised limb must attach at the chest, not at a horn on the head.
      if (along(arm_path, .3).y > core.y + height * .3 || arm_path.length < 10 || foot_path.length < 8) return null
      put('collar_anchor_' + side, core)
      const arm_names = ['front_leg_collar_', 'front_leg_', 'front_ankle_', 'front_foot_', 'front_toes_', 'front_toes_tip_']
      const arm_fractions = [.12, .25, .55, .84, .94, 1]
      arm_names.forEach((name, i) => put(name + side, along(arm_path, arm_fractions[i])))
      put('hips_anchor_' + side, hip)
      ;['back_leg_hip_', 'back_leg_', 'back_ankle_', 'back_foot_'].forEach((name, i) => put(name + side, along(foot_path, [.08, .2, .52, .9][i])))
      const foot = along(foot_path, 1)
      put('back_toes_' + side, foot)
      const toe_id = volume.select((p, r, i) => connected(i) && p.distanceTo(foot) < height * .09 && p.y < box.min.y + height * .055 ? p.z : -Infinity)
      put('back_toes_tip_' + side, toe_id >= 0 ? volume.point(toe_id) : foot.clone().add(new Vector3(0, 0, height * .025)))
      put('shoulder_' + side, core)
      put('wing_1_' + side, along(wing_path, .25))
      put('wing_2_' + side, along(wing_path, .55))
      const wrist = along(wing_path, .87)
      const wrist_id = volume.nearest(wrist)
      const outer = volume.paths(wrist_id, p => lateral(p) > width * .2 && p.y > hip.y)
      if (!Number.isFinite(outer.distance[tip_id])) return null
      const outer_path = volume.path(tip_id, outer.parent)
      put('wing_3_' + side, wrist)
      put('wing_4_' + side, along(outer_path, .33))
      put('wing_5_' + side, along(outer_path, .66))
      put('wing_tip_' + side, along(outer_path, 1))
      for (let feather = 1; feather <= 5; feather++) {
        const start = result.get('wing_' + feather + '_' + side)!
        const desired_x = Math.max(width * .21, lateral(start) + width * .035)
        const end_id = volume.select((p, r, i) => connected(i) && Math.abs(lateral(p) - desired_x) < width * .045 &&
          p.y > hip.y && p.y < start.y && p.z < start.z + height * .025 && p.z > hip.z - size.z * .08
          ? -p.y - Math.abs(lateral(p) - desired_x) : -Infinity)
        const end = end_id >= 0 ? volume.point(end_id) : start.clone().add(new Vector3(0, -height * .03, 0))
        put('wing_feather_' + feather + '_0_' + side, start)
        put('wing_feather_' + feather + '_1_' + side, start.clone().lerp(end, .5))
        put('wing_feather_' + feather + '_tip_' + side, end)
      }
      const horn_path = horn_id >= 0 ? this.trim(volume.path(horn_id, paths.parent), result.get('spine_4')!) : [result.get('head')!, result.get('head')!.clone().add(new Vector3(sign * height * .02, height * .04, 0))]
      put('horn_base_' + side, along(horn_path, .15))
      put('horn_' + side, along(horn_path, .5))
      put('horn_tip_' + side.toUpperCase(), along(horn_path, 1))
    }
    // Suppress voxel noise in a symmetric proposal; all joints remain editable.
    for (const [name, left] of result) {
      if (!/_l$/i.test(name)) continue
      const right = result.get(name.replace(/l$/i, name.endsWith('L') ? 'R' : 'r'))
      if (!right) continue
      const x = (Math.abs(left.x - mid) + Math.abs(right.x - mid)) / 2
      const y = (left.y + right.y) / 2, z = (left.z + right.z) / 2
      left.set(mid + x, y, z); right.set(mid - x, y, z)
    }
    return result
  }

  private static trim (path: Vector3[], start: Vector3): Vector3[] {
    let nearest = 0
    path.forEach((p, i) => { if (p.distanceToSquared(start) < path[nearest].distanceToSquared(start)) nearest = i })
    return path.slice(nearest)
  }
}
