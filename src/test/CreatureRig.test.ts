import { beforeAll, describe, expect, it } from 'vitest'
import { AnimationMixer, Bone, BoxGeometry, Group, Mesh, Quaternion, Skeleton, Vector3 } from 'three'
import { read_glb } from './GlbFixture.ts'
import { winged_creature_fixture } from './WingedCreatureFixture.ts'
import { AnimalAutoFit } from '../lib/processes/edit-skeleton/AnimalAutoFit.ts'
import { CreatureVolume } from '../lib/processes/edit-skeleton/CreatureVolume.ts'
import { CreatureAnimationLibrary } from '../lib/processes/animations-listing/CreatureAnimationLibrary.ts'

it('unions overlapping meshes without filling the gap between separate limbs', () => {
  const model = new Group()
  for (const x of [-.5, -.35, .5]) {
    const mesh = new Mesh(new BoxGeometry(.3, 1, .3)); mesh.position.x = x; model.add(mesh)
  }
  model.updateWorldMatrix(true, true)
  const volume = new CreatureVolume(model, null, new Quaternion(), AnimalAutoFit.sample(model), 64)
  const nearest = (x: number) => volume.point(volume.nearest(new Vector3(x, 0, 0)))
  expect(nearest(-.42).distanceTo(new Vector3(-.42, 0, 0))).toBeLessThan(volume.step * 2)
  expect(Math.abs(nearest(0).x)).toBeGreaterThan(.18)
})

describe('upright winged creature', () => {
  let rig: Group, skeleton: Skeleton
  beforeAll(async () => {
    const [loaded, reference] = await Promise.all([read_glb('static/rigs/rig-dragon.glb'), read_glb('static/models/model-dragon.glb')])
    rig = loaded.scene
    const bones: Bone[] = []; rig.traverse(o => { if (o instanceof Bone) bones.push(o) })
    skeleton = new Skeleton(bones)
    let undo = 0
    const result = AnimalAutoFit.fit(winged_creature_fixture(), skeleton, null, AnimalAutoFit.reference(reference.scene, rig), () => { undo++ }, 'upright-winged')
    expect(result).toContain('двуногий')
    expect(undo).toBe(1)
  }, 20000)

  it('separates hips, raised forelimbs, wings, neck and curled tail', () => {
    const p = (name: string) => skeleton.getBoneByName(name)!.getWorldPosition(new Vector3())
    expect(p('hips').y).toBeGreaterThan(.35)
    expect(p('hips').y).toBeLessThan(.7)
    expect(p('head').y - p('hips').y).toBeGreaterThan(.6)
    expect(p('front_foot_l').y - p('hips').y).toBeGreaterThan(.5)
    expect(p('back_foot_l').y).toBeLessThan(.22)
    expect(p('wing_tip_l').x).toBeGreaterThan(.8)
    const tail = Array.from({ length: 6 }, (_, i) => p('tail_' + (i + 1)))
    expect(p('tail_tip').z).toBeGreaterThan(Math.min(...tail.map(p => p.z)) + .1)
    for (const bone of skeleton.bones) expect(bone.position.toArray().every(Number.isFinite)).toBe(true)
  })

  it('creates looping exportable motions without changing rest pose or bone lengths', () => {
    expect(CreatureAnimationLibrary.supports(skeleton)).toBe(true)
    const rest = skeleton.bones.map(b => ({ p: b.position.clone(), q: b.quaternion.clone(), length: b.parent instanceof Bone ? b.getWorldPosition(new Vector3()).distanceTo(b.parent.getWorldPosition(new Vector3())) : 0 }))
    const clips = CreatureAnimationLibrary.generate(skeleton)
    expect(clips.map(c => c.name)).toEqual(['Creature_Rest_Pose', 'Creature_Idle', 'Creature_Walk', 'Creature_Fly_Flap', 'Creature_Fly_Glide'])
    skeleton.bones.forEach((bone, i) => {
      expect(bone.position.distanceTo(rest[i].p)).toBe(0)
      expect(bone.quaternion.angleTo(rest[i].q)).toBeLessThan(1e-7)
    })
    for (const clip of clips) {
      expect(clip.tracks.every(t => t.name.endsWith('.quaternion'))).toBe(true)
      for (const track of clip.tracks) {
        const first = new Quaternion().fromArray(track.values, 0)
        const last = new Quaternion().fromArray(track.values, track.values.length - 4)
        expect(Math.abs(first.dot(last))).toBeCloseTo(1, 5)
      }
      const mixer = new AnimationMixer(rig)
      mixer.clipAction(clip).play()
      for (const fraction of [0, .13, .25, .51, .78, .99]) {
        mixer.setTime(clip.duration * fraction); rig.updateWorldMatrix(true, true)
        skeleton.bones.forEach((bone, i) => {
          expect(bone.position.distanceTo(rest[i].p)).toBeLessThan(1e-7)
          if (bone.parent instanceof Bone) expect(bone.getWorldPosition(new Vector3()).distanceTo(bone.parent.getWorldPosition(new Vector3()))).toBeCloseTo(rest[i].length, 5)
        })
      }
      mixer.stopAllAction(); mixer.uncacheRoot(rig)
    }
  })

  it('fits after moving, rotating and scaling the shared editing frame', async () => {
    const [loaded, reference] = await Promise.all([read_glb('static/rigs/rig-dragon.glb'), read_glb('static/models/model-dragon.glb')])
    const source = AnimalAutoFit.reference(reference.scene, loaded.scene)
    const bones: Bone[] = []; loaded.scene.traverse(o => { if (o instanceof Bone) bones.push(o) })
    const frame = new Group(), model = winged_creature_fixture()
    frame.add(model, loaded.scene); frame.position.set(2, .3, -1); frame.rotation.set(.2, .6, -.1); frame.scale.setScalar(1.2)
    frame.updateWorldMatrix(true, true)
    const fitted = AnimalAutoFit.fit(model, new Skeleton(bones), frame, source, () => {}, 'upright-winged')
    expect(fitted).toContain('двуногий')
    for (const bone of bones) {
      const local = frame.worldToLocal(bone.getWorldPosition(new Vector3()))
      const expected = skeleton.getBoneByName(bone.name)!.getWorldPosition(new Vector3())
      expect(local.distanceTo(expected)).toBeLessThan(.025)
    }
  }, 20000)

  it('does not treat the original quadruped dragon as upright', async () => {
    const loaded = await read_glb('static/rigs/rig-dragon.glb')
    const bones: Bone[] = []; loaded.scene.traverse(o => { if (o instanceof Bone) bones.push(o) })
    expect(CreatureAnimationLibrary.supports(new Skeleton(bones))).toBe(false)
  })
})
