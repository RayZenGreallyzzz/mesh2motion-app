import {
  AnimationClip, Bone, BoxGeometry, CylinderGeometry, Float32BufferAttribute, Group,
  MeshStandardMaterial, NumberKeyframeTrack, QuaternionKeyframeTrack, Skeleton,
  SkinnedMesh, Uint16BufferAttribute, VectorKeyframeTrack
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

// Small original fixture, not a user asset. Deliberately has two independent skins,
// a morph, a non-root translation, scaling and a partial skeletal clip.
export async function own_rig_fixture (): Promise<ArrayBuffer> {
  const scene = new Group()
  const body_root = new Bone(), tail = new Bone(), head_root = new Bone(), jaw = new Bone()
  body_root.name = 'BodyRoot'
  tail.name = 'Tail'
  tail.position.y = 0.8
  body_root.add(tail)
  head_root.name = 'HeadRoot'
  head_root.position.y = 2
  jaw.name = 'Jaw'
  jaw.position.y = -0.2
  head_root.add(jaw)
  const body_geo = new CylinderGeometry(0.45, 0.65, 1.8, 10, 4)
  body_geo.translate(0, 0.8, 0)
  const head_geo = new BoxGeometry(0.9, 0.65, 0.8, 1, 2, 1)
  head_geo.translate(0, 2, 0)
  const body = new SkinnedMesh(body_geo, new MeshStandardMaterial({ color: 0x69aebc, roughness: 0.6 }))
  const head = new SkinnedMesh(head_geo, new MeshStandardMaterial({ color: 0xe4b77d, roughness: 0.65 }))
  body.name = 'CreatureBody'
  head.name = 'CreatureHead'
  for (const [mesh, bones, midpoint] of [[body, [body_root, tail], 0.8], [head, [head_root, jaw], 2]] as const) {
    const positions = mesh.geometry.getAttribute('position')
    const indices = [], weights = []
    for (let i = 0; i < positions.count; i++) {
      indices.push(0, 1, 0, 0)
      const weight = Math.min(1, Math.max(0, (positions.getY(i) - midpoint + 0.4) / 0.8))
      weights.push(1 - weight, weight, 0, 0)
    }
    mesh.geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4))
    mesh.geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
    scene.add(mesh, bones[0])
    scene.updateMatrixWorld(true)
    mesh.bind(new Skeleton([...bones]))
  }
  const position = body_geo.getAttribute('position')
  const morph = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) morph[i * 3] = position.getX(i) * 0.2
  body_geo.morphAttributes.position = [new Float32BufferAttribute(morph, 3)]
  body_geo.morphTargetsRelative = true
  body.updateMorphTargets()
  body.morphTargetInfluences![0] = 0.15
  const clips = [
    new AnimationClip('Creature_AllChannels', 1, [
      new QuaternionKeyframeTrack(tail.uuid + '.quaternion', [0, 0.5, 1], [0, 0, 0, 1, 0, 0, 0.25, Math.sqrt(0.9375), 0, 0, 0, 1]),
      new VectorKeyframeTrack(jaw.uuid + '.position', [0, 0.5, 1], [0, -0.2, 0, 0, -0.4, 0.1, 0, -0.2, 0]),
      new VectorKeyframeTrack(jaw.uuid + '.scale', [0, 1], [1, 1, 1, 1.1, 0.9, 1]),
      new NumberKeyframeTrack(body.uuid + '.morphTargetInfluences', [0, 0.5, 1], [0.15, 0.8, 0.15])
    ]),
    new AnimationClip('Jaw_Partial', 1, [
      new QuaternionKeyframeTrack(jaw.uuid + '.quaternion', [0, 0.5, 1], [0, 0, 0, 1, 0.2, 0, 0, Math.sqrt(0.96), 0, 0, 0, 1])
    ])
  ]
  const bytes = await new GLTFExporter().parseAsync(scene, { binary: true, animations: clips }) as ArrayBuffer
  body.geometry.dispose()
  head.geometry.dispose()
  body.material.dispose()
  head.material.dispose()
  return bytes
}
