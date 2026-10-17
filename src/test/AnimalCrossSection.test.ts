import { expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, Quaternion } from 'three'
import { AnimalAutoFit } from '../lib/processes/edit-skeleton/AnimalAutoFit.ts'
import { AnimalCrossSection } from '../lib/processes/edit-skeleton/AnimalCrossSection.ts'
it('places the core inside the torso despite a high spike and the empty gap between legs', () => {
  const model = new Group()
  const body = new Mesh(new BoxGeometry(1, .5, 2)); body.position.y = 1; model.add(body)
  for (const x of [-.4, .4]) for (const z of [-.7, .7]) {
    const leg = new Mesh(new BoxGeometry(.18, 1, .2)); leg.position.set(x, .25, z); model.add(leg)
  }
  const spike = new Mesh(new BoxGeometry(.05, 2, .05)); spike.position.set(0, 2, 0); model.add(spike)
  model.updateWorldMatrix(true, true)
  const sections = new AnimalCrossSection(model, null, new Quaternion(), AnimalAutoFit.sample(model))
  for (const z of [-.7, 0, .7]) {
    const center = sections.center(z)!
    expect(center.y).toBeGreaterThan(.85)
    expect(center.y).toBeLessThan(1.15)
    expect(center.radius).toBeGreaterThan(.4)
  }
})
