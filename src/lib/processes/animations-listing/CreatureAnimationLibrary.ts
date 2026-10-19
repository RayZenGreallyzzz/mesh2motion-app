import { AnimationClip, Bone, Group, Quaternion, QuaternionKeyframeTrack, Skeleton, Vector3 } from 'three'

/** Offline motions around the fitted rest pose. Only rotations are animated:
 * lengths and fitted curvature survive, without importing quadruped offsets. */
export class CreatureAnimationLibrary {
  static supports (skeleton: Skeleton): boolean {
    const point = (name: string) => skeleton.getBoneByName(name)?.getWorldPosition(new Vector3())
    skeleton.bones[0]?.updateWorldMatrix(true, true)
    const hip = point('hips'), head = point('head'), hand = point('front_foot_l'), foot = point('back_foot_l')
    if (!hip || !head || !hand || !foot || !point('wing_1_l') || !point('wing_1_r')) return false
    const leg = hip.distanceTo(foot)
    return leg > 1e-6 && head.y - hip.y > leg * .65 && hand.y - hip.y > leg * .5
  }

  static generate (skeleton: Skeleton): AnimationClip[] {
    // Private hierarchy: preview generation never mutates the binding rig.
    const root = new Group()
    const clones = new Map<Bone, Bone>(), bones = new Map<string, Bone>()
    for (const original of skeleton.bones) {
      const bone = new Bone()
      bone.name = original.name
      bone.position.copy(original.position); bone.quaternion.copy(original.quaternion); bone.scale.copy(original.scale)
      clones.set(original, bone); bones.set(bone.name, bone)
    }
    for (const [original, bone] of clones) {
      const parent = clones.get(original.parent as Bone)
      if (parent) parent.add(bone)
      else {
        const container = new Group()
        container.matrixAutoUpdate = false
        original.parent?.updateWorldMatrix(true, false)
        container.matrix.copy(original.parent?.matrixWorld ?? root.matrix)
        root.add(container); container.add(bone)
      }
    }
    root.updateWorldMatrix(true, true)
    const rest = new Map([...bones].map(([name, bone]) => [name, {
      local: bone.quaternion.clone(), world: bone.getWorldQuaternion(new Quaternion()),
      point: bone.getWorldPosition(new Vector3())
    }]))
    const x_axis = new Vector3(1, 0, 0), y_axis = new Vector3(0, 1, 0), z_axis = new Vector3(0, 0, 1)
    x_axis.subVectors(rest.get('back_leg_l')!.point, rest.get('back_leg_r')!.point).normalize()
    z_axis.crossVectors(x_axis, y_axis).normalize()
    const turn = (name: string, axis: Vector3, angle: number) => {
      const bone = bones.get(name), bind = rest.get(name)
      if (!bone || !bind) return
      const local_delta = bind.world.clone().invert().multiply(new Quaternion().setFromAxisAngle(axis, angle)).multiply(bind.world)
      bone.quaternion.copy(bind.local).multiply(local_delta).normalize()
    }
    const clips: AnimationClip[] = []
    for (const [name, duration] of [['Creature_Rest_Pose', 1], ['Creature_Idle', 4], ['Creature_Walk', 2], ['Creature_Fly_Flap', 1.6], ['Creature_Fly_Glide', 4]] as const) {
      const frames = Math.round(duration * 30)
      const times = Array.from({ length: frames + 1 }, (_, i) => i * duration / frames)
      const values = new Map([...bones.keys()].map(name => [name, [] as number[]]))
      const walking = name === 'Creature_Walk', flying = name.startsWith('Creature_Fly')
      const flap = name === 'Creature_Fly_Flap', still = name === 'Creature_Rest_Pose'
      for (const time of times) {
        for (const [name, bone] of bones) bone.quaternion.copy(rest.get(name)!.local)
        const phase = time / duration * Math.PI * 2
        if (!still) {
          turn('spine_1', x_axis, .008 * Math.sin(phase))
          turn('spine_3', y_axis, .014 * Math.sin(phase))
          turn('head', y_axis, .02 * Math.sin(phase + .4))
          for (let tail = 1; tail <= 6; tail++) turn('tail_' + tail, y_axis, (flying ? .025 : .014) * Math.sin(phase - tail * .4))
          for (const side of ['l', 'r']) {
            const sign = side === 'l' ? 1 : -1
            turn('shoulder_' + side, z_axis, sign * (flap ? .28 : flying ? .045 : .012) * Math.sin(phase))
            if (flap) turn('wing_2_' + side, z_axis, sign * .035 * Math.sin(phase - .5))
            turn('front_leg_' + side, x_axis, (walking ? .045 * sign : .012) * Math.sin(phase))
          }
          root.updateWorldMatrix(true, true)
          if (walking || flying) for (const side of ['l', 'r']) {
            const upper = bones.get('back_leg_' + side)!, lower = bones.get('back_ankle_' + side)!, ankle = bones.get('back_foot_' + side)!
            const origin = rest.get(ankle.name)!.point
            const length = rest.get(upper.name)!.point.distanceTo(rest.get(lower.name)!.point) + rest.get(lower.name)!.point.distanceTo(origin)
            const angle = phase + (side === 'r' ? Math.PI : 0)
            const target = origin.clone()
            if (walking) target.addScaledVector(z_axis, length * .12 * Math.cos(angle)).addScaledVector(y_axis, length * .09 * Math.max(0, Math.sin(angle)) ** 2)
            else target.addScaledVector(y_axis, length * .18).addScaledVector(z_axis, -length * .08)
            this.solve_leg(upper, lower, ankle, target, rest.get(lower.name)!.point, rest.get(ankle.name)!.world)
          }
        }
        for (const [name, bone] of bones) {
          const output = values.get(name)!, q = bone.quaternion
          const previous = output.length - 4
          const sign = previous >= 0 && output[previous] * q.x + output[previous + 1] * q.y + output[previous + 2] * q.z + output[previous + 3] * q.w < 0 ? -1 : 1
          output.push(q.x * sign, q.y * sign, q.z * sign, q.w * sign)
        }
      }
      clips.push(new AnimationClip(name, duration, [...values].map(([bone, data]) => new QuaternionKeyframeTrack(bone + '.quaternion', times, data))))
    }
    return clips
  }

  private static solve_leg (upper: Bone, lower: Bone, foot: Bone, target: Vector3, rest_knee: Vector3, rest_foot: Quaternion): void {
    const a = upper.getWorldPosition(new Vector3()), b = lower.getWorldPosition(new Vector3()), c = foot.getWorldPosition(new Vector3())
    const first = a.distanceTo(b), second = b.distanceTo(c)
    if (Math.min(first, second) < 1e-7) return
    const direction = target.clone().sub(a)
    const distance = Math.max(Math.abs(first - second) + 1e-6, Math.min(first + second - 1e-6, direction.length()))
    direction.normalize()
    const pole = rest_knee.clone().sub(a).addScaledVector(direction, -rest_knee.clone().sub(a).dot(direction))
    if (pole.lengthSq() < 1e-10) pole.crossVectors(direction, new Vector3(1, 0, 0))
    if (pole.lengthSq() < 1e-10) pole.crossVectors(direction, new Vector3(0, 0, 1))
    pole.normalize()
    const along = (first * first - second * second + distance * distance) / (2 * distance)
    const knee = a.clone().addScaledVector(direction, along).addScaledVector(pole, Math.sqrt(Math.max(0, first * first - along * along)))
    const reached = a.clone().addScaledVector(direction, distance)
    const aim = (bone: Bone, child: Bone, point: Vector3) => {
      const origin = bone.getWorldPosition(new Vector3())
      const from = child.getWorldPosition(new Vector3()).sub(origin).normalize()
      const to = point.clone().sub(origin).normalize()
      const world = new Quaternion().setFromUnitVectors(from, to).multiply(bone.getWorldQuaternion(new Quaternion()))
      bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world)).normalize()
      bone.updateWorldMatrix(true, true)
    }
    aim(upper, lower, knee); aim(lower, foot, reached)
    foot.quaternion.copy(foot.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(rest_foot)).normalize()
    foot.updateWorldMatrix(true, true)
  }
}
