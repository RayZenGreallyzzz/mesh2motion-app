import { describe, expect, it } from 'vitest'
import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute } from 'three'
import { welded_surface_components } from './WeldedSurfaceComponents'

function meshWithUVSeams (): BufferGeometry {
  const g = new BufferGeometry()
  // Two indexed triangles are not connected by indices, but their duplicate
  // seam vertices have identical XYZ positions. A third isolated accessory is
  // physically distant and must remain separate.
  g.setAttribute('position', new Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    0, 0, 0, 1, 1, 0, 0, 1, 0,
    4, 0, 0, 5, 0, 0, 4, 1, 0
  ], 3))
  g.setIndex(new Uint16BufferAttribute([0, 1, 2, 3, 4, 5, 6, 7, 8], 1))
  return g
}

describe('clothing UV seam components', () => {
  it('welds a body surface split by UV islands while keeping detached accessory separate', () => {
    const components = welded_surface_components(meshWithUVSeams())
    expect(components.componentSizes.size).toBe(2)
    expect(components.componentByVertex[0]).toBe(components.componentByVertex[3])
    expect(components.componentByVertex[2]).toBe(components.componentByVertex[4])
    expect(components.componentByVertex[0]).not.toBe(components.componentByVertex[6])
    expect([...components.componentSizes.values()].sort((a,b) => a - b)).toEqual([3, 6])
  })

  it('also welds triangle-soup meshes without an index', () => {
    const g = meshWithUVSeams()
    g.setIndex(null)
    const components = welded_surface_components(g)
    expect(components.componentSizes.size).toBe(2)
  })
})
