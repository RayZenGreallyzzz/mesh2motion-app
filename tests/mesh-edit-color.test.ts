import { BufferGeometry, Color, Mesh, MeshStandardMaterial, Float32BufferAttribute, Texture, Vector3, type Intersection } from 'three'
import { expect, it, vi } from 'vitest'
import { sample_surface_color } from '../src/my-rigs/MeshEditColor.ts'

it('samples the tapped base texture using its transformed UV instead of light or material defaults', () => {
  const ctx = { drawImage: vi.fn(), getImageData: vi.fn(() => ({data: [178, 105, 86, 255]})) }
  const mock = vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  try {
    const g = new BufferGeometry().setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3))
    g.setAttribute('uv', new Float32BufferAttribute([0,0,1,0,0,1],2))
    const image = {width:8,height:8}, map = new Texture(image)
    map.flipY = false; map.offset.set(.25,.125)
    const object = new Mesh(g,new MeshStandardMaterial({color:new Color('white'), map}))
    const input = { object, distance:1, face: {a:0,b:1,c:2,normal:new Vector3(0,0,1),materialIndex:0}, point:new Vector3(.3,.3,0) } as Intersection<Mesh>
    expect(sample_surface_color(input).getHexString()).toBe('b26956')
    expect(ctx.drawImage).toHaveBeenCalledExactlyOnceWith(image,4,3,1,1,0,0,1,1)
  } finally { mock.mockRestore() }
})
