import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { Mesh as ImportedMesh } from 'three/src/objects/Mesh.js'
import { HumanoidSurfaceSampler } from './HumanoidSurfaceSampler.ts'

describe('humanoid volume placement', () => {
  it('pairs torso surfaces without including the hair behind them', () => {
    const group = new Group()
    const torso = new Mesh(new BoxGeometry(0.4, 1, 0.3), new MeshBasicMaterial())
    torso.position.set(0, 1, 0)
    const hair = new Mesh(new BoxGeometry(0.3, 1, 0.04, 20, 40, 2), new MeshBasicMaterial())
    hair.position.set(0, 1.2, -0.35)
    group.add(torso, hair)
    const sampler = new HumanoidSurfaceSampler(group)
    expect(sampler.depth_center(0, 1, -0.2)).toBeCloseTo(0, 6)
    expect(sampler.depth_center(0.13, 1.2, -0.2)).toBeCloseTo(0, 6)
    expect(sampler.depth_center(4, 1, 0.123)).toBe(0.123)
  })

  it('handles the source-module Mesh used by the actual model importer', () => {
    const mesh = new ImportedMesh(new BoxGeometry(0.3, 1, 0.2), new MeshBasicMaterial())
    mesh.position.set(0, 1, 0.25)
    const sampler = new HumanoidSurfaceSampler(mesh)
    expect(sampler.points.length).toBeGreaterThan(0)
    expect(sampler.depth_center(0, 1, -1)).toBeCloseTo(0.25, 6)
  })

  it('finds the arm center in A and T poses without relying on vertex density', () => {
    for (const angle of [0, -Math.PI / 4]) {
      const model = new Group()
      const arm = new Mesh(new BoxGeometry(0.8, 0.06, 0.08), new MeshBasicMaterial())
      arm.position.set(0.5, 1.3, 0)
      arm.rotation.z = angle
      // Dense unrelated body geometry must not determine the limb center.
      const body = new Mesh(new BoxGeometry(0.2, 2, 0.2, 10, 30, 10), new MeshBasicMaterial())
      body.position.y = 1
      model.add(arm, body)
      const sampler = new HumanoidSurfaceSampler(model)
      expect(sampler.arm_center_y(0.55, 1.4)).toBeCloseTo(1.3 + 0.05 * Math.tan(angle), 5)
    }
  })
})
