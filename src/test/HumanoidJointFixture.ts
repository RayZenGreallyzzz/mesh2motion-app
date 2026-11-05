import { BoxGeometry, Group, LatheGeometry, Mesh, Vector2, Vector3 } from 'three'

/** Known geometric landmarks, independent of the fit's template proportions. */
export function joint_character (kneeY: number, elbowX: number, pose: 'T' | 'A' = 'T'): Group {
  const model = new Group()
  const box = (x: number, y: number, z: number, w: number, h: number, d: number) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d, 8, 8, 8))
    mesh.position.set(x, y, z); model.add(mesh)
  }
  box(0, 1.27, 0, .46, .62, .26)
  box(0, 1.64, 0, .12, .15, .12)
  box(0, 1.84, 0, .25, .32, .22)
  for (const sign of [-1, 1]) {
    const arm = new Mesh(new LatheGeometry([
      new Vector2(.065, .23), new Vector2(.08, .32),
      new Vector2(.07, elbowX - .05), new Vector2(.04, elbowX),
      new Vector2(.065, elbowX + .05), new Vector2(.055, .85), new Vector2(.06, .95)
    ], 24))
    arm.rotation.z = -sign * Math.PI / 2
    arm.position.y = 1.51
    if (pose === 'A') {
      // Rotate the complete limb around the shoulder, not around the origin.
      const shoulder = new Vector3(sign * .23, 1.51, 0), angle = -sign * .45
      arm.position.copy(new Vector3(0, 1.51, 0).sub(shoulder).applyAxisAngle(new Vector3(0, 0, 1), angle).add(shoulder))
      arm.rotation.z += angle
    }
    model.add(arm)
    const leg = new Mesh(new LatheGeometry([
      new Vector2(.06, .12), new Vector2(.105, .26),
      new Vector2(.12, kneeY - .13), new Vector2(.055, kneeY),
      new Vector2(.12, kneeY + .13), new Vector2(.15, .99)
    ], 24))
    leg.position.x = sign * .19; model.add(leg)
    box(sign * .19, .06, .06, .16, .12, .33)
  }
  model.updateWorldMatrix(true, true)
  return model
}
