import { CatmullRomCurve3, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape, SphereGeometry, TubeGeometry, Vector3 } from 'three'

/** Synthetic geometry, independent of private uploaded models. */
export function winged_creature_fixture (): Group {
  const group = new Group()
  const material = new MeshStandardMaterial({ color: 0x6babb9, roughness: .8 })
  const tube = (points: number[][], radius: number) => {
    const curve = new CatmullRomCurve3(points.map(p => new Vector3().fromArray(p)))
    group.add(new Mesh(new TubeGeometry(curve, 48, radius, 10, false), material))
  }
  const ellipsoid = (point: number[], scale: number[]) => {
    const mesh = new Mesh(new SphereGeometry(1, 20, 16), material)
    mesh.position.fromArray(point); mesh.scale.fromArray(scale); group.add(mesh)
  }
  ellipsoid([0, .82, .18], [.23, .24, .27])
  ellipsoid([0, .52, -.15], [.19, .18, .22])
  tube([[0, .52, -.15], [0, .67, -.04], [0, .82, .18]], .14)
  tube([[0, .85, .23], [0, 1.2, .21], [0, 1.51, .34], [0, 1.6, .6], [0, 1.46, .87]], .075)
  ellipsoid([0, 1.46, .87], [.11, .12, .14])
  tube([[0, .52, -.2], [0, .25, -.5], [0, .2, -.8], [0, .4, -1], [0, .6, -.85], [0, .5, -.64]], .06)
  for (const sign of [-1, 1]) {
    tube([[.12 * sign, .55, -.15], [.24 * sign, .4, -.07], [.25 * sign, .12, -.18]], .06)
    ellipsoid([.25 * sign, .06, -.12], [.09, .055, .15])
    tube([[.12 * sign, .87, .19], [.28 * sign, 1.04, -.02], [.37 * sign, 1.4, -.04], [.43 * sign, 1.49, -.01]], .035)
    tube([[.15 * sign, .9, .23], [.46 * sign, 1.18, .3], [.73 * sign, 1.44, .38], [1.04 * sign, 1.17, .28]], .035)
    tube([[.06 * sign, 1.52, .61], [.13 * sign, 1.7, .65], [.17 * sign, 1.8, .52]], .026)
    const shape = new Shape()
    shape.moveTo(.15, .89); shape.lineTo(.73, 1.44); shape.lineTo(1.04, 1.17)
    shape.lineTo(.84, .65); shape.lineTo(.46, .79); shape.closePath()
    const wing = new Mesh(new ExtrudeGeometry(shape, { depth: .018, bevelEnabled: false }), material)
    wing.scale.x = sign; wing.position.z = .27; group.add(wing)
  }
  group.updateWorldMatrix(true, true)
  return group
}
